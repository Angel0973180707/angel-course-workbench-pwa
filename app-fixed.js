/* Angel Course Workbench - app.js
   - Data source: Course API (GAS) for idea/draft/final
   - Tools source: Tools API (GAS) for tool library (read-only)
   - Save uses text/plain to avoid CORS preflight (common issue on GAS)
*/

const DEFAULT_COURSE_API = "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec";
const DEFAULT_TOOLS_API  = "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec?sheet=%E5%B7%A5%E5%85%B7%E5%BA%AB%E5%AD%98%E7%AE%A1%E7%90%86&format=tools";

const STATE_LABEL = { idea:"發想", draft:"草稿", final:"完稿" };
const STATE_SHEET = { idea:"發想", draft:"草稿", final:"幸福教養課程管理" };

const BASE_HEADERS = [
  "id","title","type","status","version","owner","audience","duration_min","capacity","tags",
  "summary","objectives","outline","materials","links","assets","notes","created_at","updated_at"
];

// New fields (we'll store as extra columns automatically by API)
const EXTRA_FIELDS = [
  "kind","kind_other","total_duration","location","venue_type","core_concept",
  "main_tool","sub_tools","tool_uids","module_items"
];

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const toastLine = $("#toastLine");
const sheetHint = $("#sheetHint");

let state = "idea";
let current = {}; // currently edited item
let listCache = { idea:[], draft:[], final:[] };

let toolsAll = [];
let pickedMainTool = null;      // tool obj
let pickedSubTools = [];        // tool obj[]
let moduleCandidates = [];      // final items
let moduleSelectedIds = new Set();

function toast(msg){
  toastLine.textContent = msg;
}

function readSettings(){
  const saved = JSON.parse(localStorage.getItem("angelCourseWB.settings") || "{}");
  return {
    courseApi: saved.courseApi || DEFAULT_COURSE_API,
    toolsApi:  saved.toolsApi  || DEFAULT_TOOLS_API,
  };
}

function saveSettings(obj){
  localStorage.setItem("angelCourseWB.settings", JSON.stringify(obj));
}

/* ====== NETWORK ====== */
async function apiPing(url){
  const u = new URL(url);
  u.searchParams.set("mode","ping");
  const res = await fetch(u.toString(), { method:"GET" });
  return await res.json();
}

async function apiList(state, {q=""}={}){
  const { courseApi } = readSettings();
  const u = new URL(courseApi);
  u.searchParams.set("mode","list");
  u.searchParams.set("state", state);
  if(q) u.searchParams.set("q", q);
  u.searchParams.set("limit","300");
  const res = await fetch(u.toString(), { method:"GET" });
  const json = await res.json();
  if(!json || !json.ok) throw new Error(json?.error || "list failed");
  return json.items || [];
}

async function apiGet(state, id){
  const { courseApi } = readSettings();
  const u = new URL(courseApi);
  u.searchParams.set("mode","get");
  u.searchParams.set("state", state);
  u.searchParams.set("id", id);
  const res = await fetch(u.toString(), { method:"GET" });
  const json = await res.json();
  if(!json || !json.ok) throw new Error(json?.error || "get failed");
  return json.item;
}

async function apiUpsert(state, item){
  const { courseApi } = readSettings();
  const u = new URL(courseApi);
  u.searchParams.set("mode","upsert");
  u.searchParams.set("state", state);

  // Important: avoid preflight; use text/plain + JSON string
  const res = await fetch(u.toString(), {
    method:"POST",
    headers: { "Content-Type":"text/plain;charset=utf-8" },
    body: JSON.stringify({ item })
  });
  const json = await res.json();
  if(!json || !json.ok) throw new Error(json?.error || "save failed");
  return json;
}

async function apiPromote(from, to, id){
  const { courseApi } = readSettings();
  const u = new URL(courseApi);
  u.searchParams.set("mode","promote");
  u.searchParams.set("from", from);
  u.searchParams.set("to", to);
  u.searchParams.set("id", id);
  u.searchParams.set("overwrite", "1");
  const res = await fetch(u.toString(), { method:"GET" });
  const json = await res.json();
  if(!json || !json.ok) throw new Error(json?.error || "promote failed");
  return json;
}

async function apiDelete(state, id){
  const { courseApi } = readSettings();
  const u = new URL(courseApi);
  u.searchParams.set("mode","delete");
  u.searchParams.set("state", state);
  u.searchParams.set("id", id);
  const res = await fetch(u.toString(), { method:"GET" });
  const json = await res.json();
  if(!json || !json.ok) throw new Error(json?.error || "delete failed");
  return json;
}

async function toolsFetchAll(){
  const { toolsApi } = readSettings();

  // ✅ Auto-append tool export params if user only pasted .../exec
  let url = toolsApi;
  try{
    const u = new URL(url);
    if(!u.searchParams.get("format")){
      u.searchParams.set("sheet","工具庫存管理");
      u.searchParams.set("format","tools");
    }
    // ✅ cache-bust for always-latest sync
    u.searchParams.set("_ts", String(Date.now()));
    url = u.toString();
  }catch(_){
    // if URL parse fails, just use as-is
  }

  const res = await fetch(url, { method:"GET" });
  const json = await res.json();

  // Accept both formats:
  // A) { ok:true, tools:[...] }
  // B) { ok:true, items:[...] }
  const arr = json?.tools || json?.items || [];
  if(!json?.ok) throw new Error(json?.error || "tools api failed");
  toolsAll = arr.map(t => normalizeTool(t)).filter(t=>t.toolCode || t.name);
  return toolsAll;
}

function normalizeTool(t){
  const toolCode = String(t.toolCode || t["工具ID"] || "").trim();
  const name = String(t.name || t["工具名稱"] || "").trim();
  const link = String(t.link || t["工具連結"] || "").trim();
  const category = String(t.category || t["性質分類"] || "").trim();
  const core = String(t.core || t["核心功能"] || "").trim();
  const pain_points = String(t.pain_points || t["適用對象/痛點"] || "").trim();
  const tips = String(t.tips || t["智多星錦囊"] || "").trim();
  const status = String(t.status || "active").trim().toLowerCase();
  const toolUid = String(t.toolUid || t.tool_uid || t.tool_id || "").trim() || stableUid(toolCode, link);
  return { toolCode, name, link, category, core, pain_points, tips, status, toolUid };
}

function stableUid(toolCode, link){
  const raw = (String(toolCode||"")+"|"+String(link||"")).toLowerCase();
  let h=0;
  for(let i=0;i<raw.length;i++){ h = ((h<<5)-h) + raw.charCodeAt(i); h |= 0; }
  return "tool_"+Math.abs(h);
}

/* ====== FORM ====== */
function clearForm(){
  current = {
    id:"",
    title:"",
    kind:"單場演講",
    kind_other:"",
    duration_min:"",
    total_duration:"",
    capacity:"",
    location:"",
    venue_type:"室內",
    core_concept:"",
    tags:"",
    summary:"",
    objectives:"",
    outline:"",
    materials:"",
    links:"",
    assets:"",
    notes:"",
    main_tool:"",
    sub_tools:"",
    tool_uids:"",
    module_items:""
  };
  pickedMainTool = null;
  pickedSubTools = [];
  writeForm();
  rebuildPreviews();
  updateProposalPreview();
}

function readForm(){
  const item = Object.assign({}, current);
  item.id = $("#f_id").value.trim();
  item.title = $("#f_title").value.trim();

  item.kind = $("#f_kind").value;
  item.kind_other = $("#f_kind_other").value.trim();

  item.duration_min = $("#f_duration_min").value.trim();
  item.total_duration = $("#f_total_duration").value.trim();

  item.capacity = $("#f_capacity").value.trim();
  item.location = $("#f_location").value.trim();
  item.venue_type = $("#f_venue_type").value;

  item.core_concept = $("#f_core_concept").value.trim();
  item.summary = $("#f_summary").value.trim();

  // tool fields maintained by picker
  item.main_tool = pickedMainTool ? `${pickedMainTool.toolCode}｜${pickedMainTool.name}` : "";
  item.sub_tools = pickedSubTools.map(t=>`${t.toolCode}｜${t.name}`).join("；");
  item.tool_uids = [
    pickedMainTool ? pickedMainTool.toolUid : "",
    ...pickedSubTools.map(t=>t.toolUid)
  ].filter(Boolean).join(",");

  // derived helper fields
  item.type = kindToType(item.kind);
  item.status = state; // layer status
  item.updated_at = new Date().toISOString();

  // links: ensure tools included
  const toolLinks = [];
  if(pickedMainTool?.link) toolLinks.push(pickedMainTool.link);
  pickedSubTools.forEach(t=> t.link && toolLinks.push(t.link));
  const mergedLinks = mergeLinks(item.links || "", toolLinks);
  item.links = mergedLinks;

  // tags: auto from kind + venue + maybe tool codes
  item.tags = buildTags(item);

  return item;
}

function writeForm(){
  $("#f_id").value = current.id || "";
  $("#f_title").value = current.title || "";
  $("#f_kind").value = current.kind || "單場演講";
  $("#f_kind_other").value = current.kind_other || "";
  $("#f_duration_min").value = current.duration_min || "";
  $("#f_total_duration").value = current.total_duration || "";
  $("#f_capacity").value = current.capacity || "";
  $("#f_location").value = current.location || "";
  $("#f_venue_type").value = current.venue_type || "室內";
  $("#f_core_concept").value = current.core_concept || "";
  $("#f_summary").value = current.summary || "";

  // tool lines
  renderPickedTools();
}

function kindToType(kind){
  // keep a stable type for filtering
  if(kind === "模組課程") return "module";
  if(kind === "單場演講") return "talk";
  if(kind === "單場課程") return "single_class";
  if(kind === "單場活動") return "single_event";
  if(kind === "研習（有作業）") return "training";
  return "other";
}

function mergeLinks(existing, toolLinks){
  const norm = (s)=>String(s||"").trim();
  const list = [];
  const push = (u)=>{ const v=norm(u); if(v && !list.includes(v)) list.push(v); };

  // split existing by whitespace/;,/newlines
  norm(existing).split(/[\s,;，；\n]+/).forEach(push);
  toolLinks.forEach(push);
  return list.join("\n");
}

function buildTags(item){
  const tags = new Set();
  if(item.kind) tags.add(item.kind);
  if(item.venue_type) tags.add(item.venue_type);
  if(pickedMainTool?.toolCode) tags.add(pickedMainTool.toolCode);
  return Array.from(tags).join(" ");
}

function renderPickedTools(){
  $("#mainToolLine").textContent = pickedMainTool ? `${pickedMainTool.toolCode}｜${pickedMainTool.name}` : "未選";
  $("#subToolsLine").textContent = pickedSubTools.length ? pickedSubTools.map(t=>`${t.toolCode}｜${t.name}`).join("、") : "未選";
}

function rebuildPreviews(){
  const item = readForm();
  $("#aiPreview").value = buildAIPrompt(item);
  $("#tsvPreview").value = buildTSVLine(item);
  updateProposalPreview(item);
}

function buildAIPrompt(item){
  const kindText = item.kind === "其他" ? `其他：${item.kind_other || "（未填）"}` : item.kind;
  const mainTool = item.main_tool || "（未選）";
  const subTools = item.sub_tools || "（未選）";

  return [
`你是「天使笑長」的協作夥伴。請用溫柔、可落地、不說教的語氣，協助我完成一份課程/活動企劃。`,
``,
`【已知資料】`,
`- 主題：${item.title || "（未填）"}`,
`- 形式：${kindText}`,
`- 單堂時數：${item.duration_min || "（未填）"}；總時數：${item.total_duration || "（未填）"}`,
`- 人數：${item.capacity || "（未填）"}`,
`- 地點：${item.location || "（未填）"}（${item.venue_type || "（未填）"}）`,
`- 核心概念：${item.core_concept || "（未填）"}`,
`- 工具書搭配：主工具：${mainTool}；副工具：${subTools}`,
`- 活動簡述：${item.summary || "（未填）"}`,
``,
`【請產出】`,
`a. 建議活動名稱（至少 5 個）`,
`b. 活動內容（面向家長/老師可理解的描述）`,
`c. 活動流程（含時間分配）`,
`d. 活動 KPI 與回饋方式（如何看見成效）`,
`e. 活動簡案（提案用：一頁版）`,
`f. 活動詳案（備課用：含 PPT 教材大綱 + 口說稿架構 + 作業/練習設計）`,
``,
`【格式要求】`,
`- 內容要能直接複製到我的課程管理表`,
`- 列點清楚、用語能說出口`,
`- 每一段都要把「工具書如何用」自然寫進去（不可忽略）`,
  ].join("\n");
}

function buildTSVLine(item){
  // TSV = Tab-Separated Values：用「Tab」分隔欄位（貼到試算表最穩）
  const cols = [
    item.id || "",
    item.title || "",
    item.type || "",
    item.status || "",
    item.version || "",
    item.owner || "",
    item.audience || "",
    item.duration_min || "",
    item.capacity || "",
    item.tags || "",
    item.summary || "",
    item.objectives || "",
    item.outline || "",
    item.materials || "",
    item.links || "",
    item.assets || "",
    item.notes || "",
    item.created_at || "",
    item.updated_at || "",
  ];

  // Auto clean newlines inside cells -> replace with " / "
  const clean = (s)=>String(s||"").replace(/\r?\n+/g, " / ").trim();
  return cols.map(clean).join("\t");
}

/* ====== LIST RENDER ====== */
function renderList(items){
  const root = $("#list");
  root.innerHTML = "";

  if(!items.length){
    root.innerHTML = `<div class="hint" style="padding:12px 16px;">（這個狀態目前沒有資料）</div>`;
    return;
  }

  for(const it of items){
    const el = document.createElement("div");
    el.className = "item";
    const meta = [
      `ID：${it.id || "—"}`,
      `形式：${it.kind || it.type || "—"}`,
      `人數：${it.capacity || "—"}`,
      `時數：${it.duration_min || "—"}${it.total_duration ? " / "+it.total_duration : ""}`,
      `主工具：${it.main_tool || "—"}`
    ].join("｜");

    const nextAction = (state==="idea") ? "升級到草稿" : (state==="draft" ? "升級到完稿" : "—");
    const nextState = (state==="idea") ? "draft" : (state==="draft" ? "final" : null);

    el.innerHTML = `
      <div class="itemMain">
        <div class="itemTitle">${escapeHtml(it.title || "(未命名)")}</div>
        <div class="itemMeta">${escapeHtml(meta)}</div>
      </div>
      <div class="itemActions">
        <button class="pill ok" data-act="load" data-id="${escapeAttr(it.id)}">載入</button>
        ${nextState ? `<button class="pill" data-act="promote" data-id="${escapeAttr(it.id)}" data-to="${nextState}">${nextAction}</button>` : `<span class="pill">完稿</span>`}
        <button class="pill danger" data-act="delete" data-id="${escapeAttr(it.id)}">刪除</button>
      </div>
    `;
    root.appendChild(el);
  }

  root.addEventListener("click", onListClick, { once:true });
}

async function onListClick(e){
  const btn = e.target.closest("[data-act]");
  if(!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;

  try{
    if(act === "load"){
      const item = await apiGet(state, id);
      loadItemToEditor(item);
      toast(`已載入：${id}`);
    }
    if(act === "promote"){
      const to = btn.dataset.to;
      await apiPromote(state, to, id);
      toast(`已升級：${id} → ${STATE_LABEL[to]}`);
      await reloadCurrentState();
    }
    if(act === "delete"){
      const ok = confirm(`確定刪除 ${id}？（可在試算表復原也可以）`);
      if(!ok) return;
      await apiDelete(state, id);
      toast(`已刪除：${id}`);
      await reloadCurrentState();
      if(current.id === id) clearForm();
    }
  }catch(err){
    toast(`失敗：${err.message || err}`);
  }finally{
    // rebind click handler
    $("#list").addEventListener("click", onListClick, { once:true });
  }
}

function loadItemToEditor(item){
  current = Object.assign({}, item);

  // restore tools
  pickedMainTool = null;
  pickedSubTools = [];

  if(item.main_tool){
    const code = String(item.main_tool).split("｜")[0].trim();
    pickedMainTool = toolsAll.find(t=>t.toolCode===code) || pickedMainTool;
  }
  if(item.sub_tools){
    const codes = String(item.sub_tools).split(/；|,|，/).map(s=>s.split("｜")[0].trim()).filter(Boolean);
    pickedSubTools = codes.map(c=>toolsAll.find(t=>t.toolCode===c)).filter(Boolean);
  }

  // keep state layer consistent with current tab
  writeForm();
  rebuildPreviews();
  updateProposalPreview(item);
}

/* ====== MODULE BUILDER ====== */
function renderModuleList(items){
  const root = $("#moduleList");
  root.innerHTML = "";

  if(!items.length){
    root.innerHTML = `<div class="hint" style="padding:12px 16px;">（完稿目前沒有可選項）</div>`;
    return;
  }

  for(const it of items){
    const id = it.id || "";
    const checked = moduleSelectedIds.has(id);
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemMain">
        <div class="itemTitle">${escapeHtml(it.title || "(未命名)")}</div>
        <div class="itemMeta">ID：${escapeHtml(id)}｜形式：${escapeHtml(it.kind || it.type || "—")}｜時數：${escapeHtml(it.duration_min||"—")}</div>
      </div>
      <div class="itemActions">
        <label class="pill ok" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" data-mid="${escapeAttr(id)}" ${checked ? "checked":""} />
          選
        </label>
      </div>
    `;
    root.appendChild(el);
  }

  root.addEventListener("change", (e)=>{
    const cb = e.target.closest("input[data-mid]");
    if(!cb) return;
    const id = cb.dataset.mid;
    if(cb.checked) moduleSelectedIds.add(id); else moduleSelectedIds.delete(id);
  }, { once:true });
}

/* ====== UI / EVENTS ====== */
function setState(next){
  state = next;
  $$(".segBtn").forEach(b=>b.classList.toggle("active", b.dataset.state===state));
  sheetHint.textContent = `存到：${STATE_SHEET[state]}`;
  toast(`切換：${STATE_LABEL[state]}`);
  reloadCurrentState().catch(err=>toast(`同步失敗：${err.message||err}`));
}

async function reloadCurrentState(){
  const q = $("#q").value.trim();
  const items = await apiList(state, { q });
  listCache[state] = items;
  renderList(items);
}

function openSheet(id){
  const el = document.getElementById(id);
  el.classList.add("show");
  el.setAttribute("aria-hidden","false");
}
function closeSheet(id){
  const el = document.getElementById(id);
  el.classList.remove("show");
  el.setAttribute("aria-hidden","true");
}

/* ====== TOOL PICKER ====== */
function fillToolFilters(){
  const cats = Array.from(new Set(toolsAll.map(t=>t.category).filter(Boolean))).sort();
  const sel = $("#tool_cat");
  sel.innerHTML = `<option value="">全部分類</option>` + cats.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
}

function renderToolLists(){
  const q = $("#tool_q").value.trim().toLowerCase();
  const cat = $("#tool_cat").value.trim();
  const prefix = $("#tool_prefix").value.trim();

  const filter = (t)=>{
    if(t.status && t.status !== "active") return false;
    if(cat && t.category !== cat) return false;
    if(prefix && !String(t.toolCode||"").startsWith(prefix)) return false;
    if(!q) return true;
    const hay = `${t.toolCode} ${t.name} ${t.category} ${t.core} ${t.pain_points}`.toLowerCase();
    return hay.includes(q);
  };

  const list = toolsAll.filter(filter).slice(0, 300);

  const mainRoot = $("#toolMainList");
  const subRoot = $("#toolSubList");
  mainRoot.innerHTML = "";
  subRoot.innerHTML = "";

  for(const t of list){
    const mainChecked = pickedMainTool && pickedMainTool.toolCode === t.toolCode;
    const subChecked = pickedSubTools.some(x=>x.toolCode===t.toolCode);

    const mainEl = document.createElement("div");
    mainEl.className = "item";
    mainEl.innerHTML = `
      <div class="itemMain">
        <div class="itemTitle">${escapeHtml(t.toolCode)}｜${escapeHtml(t.name)}</div>
        <div class="itemMeta">${escapeHtml(t.category || "")}</div>
      </div>
      <div class="itemActions">
        <label class="pill ok" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="radio" name="mainTool" data-main="${escapeAttr(t.toolCode)}" ${mainChecked?"checked":""}/>
          主
        </label>
      </div>
    `;
    mainRoot.appendChild(mainEl);

    const subEl = document.createElement("div");
    subEl.className = "item";
    subEl.innerHTML = `
      <div class="itemMain">
        <div class="itemTitle">${escapeHtml(t.toolCode)}｜${escapeHtml(t.name)}</div>
        <div class="itemMeta">${escapeHtml(t.category || "")}</div>
      </div>
      <div class="itemActions">
        <label class="pill" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" data-sub="${escapeAttr(t.toolCode)}" ${subChecked?"checked":""}/>
          副
        </label>
      </div>
    `;
    subRoot.appendChild(subEl);
  }

  // bind events
  mainRoot.addEventListener("change", (e)=>{
    const r = e.target.closest("input[data-main]");
    if(!r) return;
    const code = r.dataset.main;
    pickedMainTool = toolsAll.find(t=>t.toolCode===code) || null;
    // if main tool exists in sub, remove it
    pickedSubTools = pickedSubTools.filter(t=>t.toolCode !== code);
    $("#toolsStatusLine").textContent = `主工具：${pickedMainTool ? pickedMainTool.toolCode+"｜"+pickedMainTool.name : "未選"}`;
  }, { once:true });

  subRoot.addEventListener("change", (e)=>{
    const cb = e.target.closest("input[data-sub]");
    if(!cb) return;
    const code = cb.dataset.sub;
    if(pickedMainTool && pickedMainTool.toolCode === code){
      cb.checked = false;
      return;
    }
    const tool = toolsAll.find(t=>t.toolCode===code);
    if(!tool) return;
    if(cb.checked){
      if(!pickedSubTools.some(x=>x.toolCode===code)) pickedSubTools.push(tool);
    }else{
      pickedSubTools = pickedSubTools.filter(x=>x.toolCode!==code);
    }
    $("#toolsStatusLine").textContent = `副工具：${pickedSubTools.length} 個`;
  }, { once:true });
}

/* ====== PROPOSAL ====== */
function updateProposalPreview(item = readForm()){
  const kindText = item.kind === "其他" ? `其他：${item.kind_other || "（未填）"}` : item.kind;
  const lines = [
    `【提案名稱】${item.title || "（未填）"}`,
    `【形式】${kindText}`,
    `【時數】單堂：${item.duration_min || "（未填）"}｜總：${item.total_duration || "（未填）"}`,
    `【人數】${item.capacity || "（未填）"}`,
    `【地點】${item.location || "（未填）"}（${item.venue_type || "（未填）"}）`,
    `【核心概念】${item.core_concept || "（未填）"}`,
    `【工具書】主：${item.main_tool || "（未選）"}｜副：${item.sub_tools || "（未選）"}`,
    ``,
    `【簡述】`,
    item.summary || "（未填）"
  ];
  $("#proposalPreview").value = lines.join("\n");
}

/* ====== COPY HELPERS ====== */
async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

/* ====== SANITIZE ====== */
function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

/* ====== INIT ====== */
async function init(){
  // Register SW
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  // Bind status tabs
  $$(".segBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>setState(btn.dataset.state));
  });

  // Bind editor changes -> rebuild previews
  ["#f_title","#f_id","#f_kind","#f_kind_other","#f_duration_min","#f_total_duration","#f_capacity","#f_location","#f_venue_type","#f_core_concept","#f_summary"]
    .forEach(sel=>$(sel).addEventListener("input", ()=>rebuildPreviews()));
  $("#f_kind").addEventListener("change", ()=>rebuildPreviews());

  $("#btnNew").addEventListener("click", ()=>{
    clearForm();
    toast("已新增空白稿");
  });

  $("#btnSave").addEventListener("click", async ()=>{
    try{
      const item = readForm();

      // enforce tool requirement
      if(!pickedMainTool){
        alert("提醒：每一個活動都要搭配工具書。\n請先選一個「主工具」。");
        return;
      }

      // map extra fields onto item for API storage
      item.kind = item.kind;
      item.kind_other = item.kind_other;
      item.total_duration = item.total_duration;
      item.location = item.location;
      item.venue_type = item.venue_type;
      item.core_concept = item.core_concept;
      item.main_tool = item.main_tool;
      item.sub_tools = item.sub_tools;
      item.tool_uids = item.tool_uids;

      const res = await apiUpsert(state, item);
      const saved = res.item || item;
      current = Object.assign({}, saved);
      $("#f_id").value = saved.id || item.id || "";
      toast(`已存回：${STATE_SHEET[state]}（${res.action || "ok"}）`);
      await reloadCurrentState();
    }catch(err){
      toast(`存檔失敗：${err.message || err}`);
      alert("存檔失敗：\n\n1) 請確認 GAS 部署：Execute as=Me、Who has access=Anyone\n2) 若你是用 Chrome/Edge：關閉「封鎖第三方 Cookie」或改用「無痕視窗」測試\n3) 也可能是 API 回傳格式不同（請貼回我看）\n\n錯誤："+(err.message||err));
    }
  });

  $("#btnReload").addEventListener("click", ()=>reloadCurrentState().catch(err=>toast(err.message||err)));
  $("#btnSearch").addEventListener("click", ()=>reloadCurrentState().catch(err=>toast(err.message||err)));
  $("#q").addEventListener("keydown", (e)=>{ if(e.key==="Enter") $("#btnSearch").click(); });

  // AI copy
  $("#btnCopyAI").addEventListener("click", async ()=>{
    const ok = await copyText($("#aiPreview").value);
    toast(ok ? "已複製 AI 指令" : "複製失敗");
  });

  $("#btnCopyTSV").addEventListener("click", async ()=>{
    const ok = await copyText($("#tsvPreview").value);
    toast(ok ? "已複製 TSV 一列" : "複製失敗");
  });

  $("#btnCopyProposal").addEventListener("click", async ()=>{
    const ok = await copyText($("#proposalPreview").value);
    toast(ok ? "已複製提案摘要" : "複製失敗");
  });

  // Settings
  $("#btnSettings").addEventListener("click", ()=>{
    const s = readSettings();
    $("#apiCourse").value = s.courseApi;
    $("#apiTools").value = s.toolsApi;
    openSheet("settings");
  });
  $("#btnCloseSettings").addEventListener("click", ()=>closeSheet("settings"));
  $("#btnSaveSettings").addEventListener("click", ()=>{
    saveSettings({ courseApi: $("#apiCourse").value.trim(), toolsApi: $("#apiTools").value.trim() });
    toast("設定已儲存");
    closeSheet("settings");
  });
  $("#btnTestApi").addEventListener("click", async ()=>{
    try{
      const course = $("#apiCourse").value.trim();
      const tools = $("#apiTools").value.trim();
      const a = await apiPing(course);

      let toolsUrl = tools;
      try{
        const u = new URL(toolsUrl);
        if(!u.searchParams.get("format")){
          u.searchParams.set("sheet","工具庫存管理");
          u.searchParams.set("format","tools");
        }
        u.searchParams.set("_ts", String(Date.now()));
        toolsUrl = u.toString();
      }catch(_){}

      const b = await fetch(toolsUrl).then(r=>r.json());
      $("#apiTestLine").textContent = `課程API：${a.ok?"OK":"FAIL"}｜工具API：${b.ok?"OK":"FAIL"}`;
    }catch(err){
      $("#apiTestLine").textContent = `測試失敗：${err.message||err}`;
    }
  });

  // Tool Picker
  $("#btnPickTools").addEventListener("click", async ()=>{
    try{
      if(!toolsAll.length){
        toast("載入工具庫中…");
        await toolsFetchAll();
        fillToolFilters();
      }
      renderToolLists();
      openSheet("toolPicker");
      $("#toolsStatusLine").textContent = "請選主工具（必選），副工具可複選。";
    }catch(err){
      toast("工具庫讀取失敗："+(err.message||err));
      alert("工具庫讀取失敗。\n\n請確認你提供的工具API可直接在瀏覽器開啟看到 JSON。\n錯誤："+(err.message||err));
    }
  });
  $("#btnCloseTools").addEventListener("click", ()=>closeSheet("toolPicker"));
  $("#btnToolSearch").addEventListener("click", ()=>renderToolLists());
  ["#tool_q","#tool_cat","#tool_prefix"].forEach(sel=>{
    $(sel).addEventListener("change", ()=>renderToolLists());
    $(sel).addEventListener("input", ()=>renderToolLists());
  });

  $("#btnApplyTools").addEventListener("click", ()=>{
    renderPickedTools();
    rebuildPreviews();
    updateProposalPreview();
    closeSheet("toolPicker");
    toast("已套用工具勾選");
  });

  // Module builder
  $("#btnModuleSync").addEventListener("click", async ()=>{
    try{
      toast("載入完稿清單中…");
      const items = await apiList("final", { q: $("#m_q").value.trim() });
      // only single items (not module)
      moduleCandidates = items.filter(it => (it.type || "") !== "module");
      renderModuleList(moduleCandidates);
      toast(`完稿載入：${moduleCandidates.length} 筆`);
    }catch(err){
      toast("載入完稿失敗："+(err.message||err));
    }
  });

  $("#btnModuleFilter").addEventListener("click", ()=>{
    const q = $("#m_q").value.trim().toLowerCase();
    const filtered = !q ? moduleCandidates : moduleCandidates.filter(it=>{
      const hay = `${it.id||""} ${it.title||""} ${it.tags||""} ${it.summary||""}`.toLowerCase();
      return hay.includes(q);
    });
    renderModuleList(filtered);
  });

  $("#btnBuildModule").addEventListener("click", async ()=>{
    try{
      if(moduleSelectedIds.size < 2){
        alert("請至少勾選 2 個單場完稿，才有模組的意義。");
        return;
      }
      const title = $("#m_title").value.trim();
      if(!title){
        alert("請先填「模組主題」。");
        return;
      }

      const selected = moduleCandidates.filter(x=>moduleSelectedIds.has(x.id));
      const toolLinks = [];
      const toolCodes = new Set();

      selected.forEach(it=>{
        // merge links
        String(it.links||"").split(/\s+/).forEach(u=>u && toolLinks.push(u));
        // tags may include tool codes; also parse main_tool/sub_tools
        if(it.main_tool) toolCodes.add(String(it.main_tool).split("｜")[0].trim());
        if(it.sub_tools){
          String(it.sub_tools).split(/；|,|，/).forEach(s=>{
            const c = s.split("｜")[0].trim();
            if(c) toolCodes.add(c);
          });
        }
      });

      // build module item
      const moduleItem = {
        title,
        kind: "模組課程",
        kind_other: "",
        type: "module",
        status: "final",
        duration_min: "", // can be blank; you filled total
        total_duration: $("#m_total_duration").value.trim(),
        capacity: "", // optional
        location: "",
        venue_type: "皆可",
        core_concept: "",
        summary: `模組課程（由 ${selected.length} 個單場完稿組合）`,
        module_items: selected.map(x=>`${x.id}｜${x.title}`).join("\n"),
        notes: `【組合清單】\n`+selected.map((x,i)=>`${String(i+1).padStart(2,"0")} ${x.id}｜${x.title}`).join("\n"),
        links: Array.from(new Set(toolLinks)).join("\n"),
        tags: Array.from(toolCodes).join(" "),
        main_tool: "",  // module may pick later; keep empty
        sub_tools: "",
        tool_uids: "",
      };

      // allow save even if module has no main tool yet (but still remind)
      const ok = confirm("要把這個模組直接存入「完稿」嗎？\n（之後仍可載入再補主工具）");
      if(!ok) return;

      const res = await apiUpsert("final", moduleItem);
      toast("模組已存入完稿："+(res.id || res.item?.id || ""));
      moduleSelectedIds.clear();
      $("#m_title").value = "";
      await reloadCurrentState();
    }catch(err){
      toast("建立模組失敗："+(err.message||err));
      alert("建立模組失敗："+(err.message||err));
    }
  });

  // initial tool load (lazy) and default tab
  clearForm();
  setState("idea");
  rebuildPreviews();
}

init();
