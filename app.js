// Angel Course Workbench Step 2-3
// - AI prompt full template
// - Tool library API (read) + inline picker (no overlay)
// - Course management API (write) best-effort with fallbacks
//
// NOTE: Since Apps Script endpoints may differ, we implement resilient "try multiple payload shapes".

const TOOL_API = "https://script.google.com/macros/s/AKfycbwecHTILAMuk5Izr_yF9wfce_qNjxuy28XuvpDzK0LZ4Wszmw7zI3xve8jeLghzveWbXA/exec";
const COURSE_API = "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec";

const LS_KEY = "angel_course_workbench_step2_3";
const LS_TOOLS_KEY = "angel_tools_cache_v1";
const LS_DEBUG_KEY = "angel_tools_last_debug_v1";

// ---- Tool API robustness ----
function withQuery(url, q){
  const u = new URL(url);
  Object.entries(q).forEach(([k,v])=>u.searchParams.set(k,v));
  return u.toString();
}
async function fetchMaybeJson(url){
  try{
    const resp = await fetch(url, { method:"GET", cache:"no-store" });
    const text = await resp.text();
    // try JSON first
    try{
      const data = JSON.parse(text);
      return { ok:true, status:resp.status, data, text };
    }catch(_){
      // try TSV (first line as headers)
      if(text && text.includes("\t") && text.includes("\n")){
        const rows = text.trim().split(/\r?\n/).filter(Boolean);
        const headers = rows.shift().split("\t").map(h=>h.trim()).filter(Boolean);
        const items = rows.map(line=>{
          const cols = line.split("\t");
          const obj = {};
          headers.forEach((h,i)=> obj[h]= (cols[i]??"").trim());
          return obj;
        });
        return { ok:true, status:resp.status, data:{ ok:true, items }, text };
      }
      return { ok:false, status:resp.status, text, error:"not_json" };
    }
  }catch(e){
    return { ok:false, status:0, error:String(e) };
  }
}


const STATE_MAP = { idea: "發想", draft: "草稿", final: "完稿" };
const TABLE_MAP = { idea: "ideas", draft: "drafts", final: "final" };

const HEADERS = [
  "id","title","type","status","version","owner","audience","duration_min","capacity","tags",
  "summary","objectives","outline","materials","links","assets","notes","created_at","updated_at"
];

const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);

function nowISO() { return new Date().toISOString(); }
function setToolDebug(msg){
  const box = document.getElementById("dbg_tool_result");
  if(box) box.value = msg;
}

function toast(msg){
  el("toast").textContent = msg;
  setTimeout(()=>{ el("toast").textContent=""; }, 1800);
}

function defaultModel(){
  return {
    state: "idea",
    id: "",
    title: "",
    type: "",
    status: "ready",
    version: "v1",
    owner: "",
    audience: "",
    duration_min: "120",
    capacity: "20",
    tags: "",
    summary: "",
    objectives: "",
    outline: "",
    materials: "",
    links: "",
    assets: "",
    notes: "",
    closing_line: "",
    framework_text: "",
    episodes: "8",
    // tool selection
    main_tool_code: "",
    main_tool_name: "",
    main_tool_link: "",
    sub_tools: [], // [{toolCode,name,link,category,tags}]
    // draft extras
    rhythm: "",
    feedback: "",
    created_at: "",
    updated_at: ""
  };
}

function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : defaultModel();
  }catch(e){ return defaultModel(); }
}
let model = loadLocal();

function ensureId(){
  if(!model.id) model.id = "C-" + Date.now();
}
function saveLocal(silent=false){
  ensureId();
  if(!model.created_at) model.created_at = nowISO();
  model.updated_at = nowISO();
  localStorage.setItem(LS_KEY, JSON.stringify(model));
  if(!silent) toast("已存本機 ✓");
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function setDot(dotEl, status){
  dotEl.classList.remove("ok","doing","todo");
  dotEl.classList.add(status);
}
function computeProgress(){
  const ideaDone = !!model.title && !!model.audience && !!model.tags && (!!model.framework_text || model.framework_text==="");
  const draftDone = !!model.objectives && !!model.outline;
  const finalDone = !!model.summary && !!model.outline && !!model.materials;
  return { ideaDone, draftDone, finalDone };
}
function renderProgress(){
  const { ideaDone, draftDone, finalDone } = computeProgress();
  const s = model.state;
  setDot(el("dotIdea"), ideaDone ? "ok" : (s==="idea" ? "doing" : "todo"));
  setDot(el("dotDraft"), draftDone ? "ok" : (s==="draft" ? "doing" : "todo"));
  setDot(el("dotFinal"), finalDone ? "ok" : (s==="final" ? "doing" : "todo"));
  el("stateLabel").textContent = STATE_MAP[s];
  el("stateLabelBottom").textContent = STATE_MAP[s];
  el("apiHint").textContent = `送出會寫入：${TABLE_MAP[s]}（若 API 失敗，你仍可用 TSV 貼回表格）`;
}

function setState(next){
  model.state = next;
  renderAll();
  saveLocal(true);
}

function stepCard({ key, title, sub, bodyHtml }){
  const wrapper = document.createElement("section");
  wrapper.className = "step";
  wrapper.dataset.key = key;
  wrapper.innerHTML = `
    <div class="step-hd" role="button" tabindex="0">
      <div>
        <div class="step-title">${title}</div>
        <div class="step-sub">${sub}</div>
      </div>
      <div class="chev">⌄</div>
    </div>
    <div class="step-bd">${bodyHtml}</div>
  `;
  const hd = wrapper.querySelector(".step-hd");
  const toggle = ()=> wrapper.classList.toggle("open");
  hd.addEventListener("click", toggle);
  hd.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" ") toggle(); });
  wrapper.classList.add("open"); // default open (less confusing)
  return wrapper;
}

function inputField({ id, label, placeholder="", value="", type="text" }){
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" type="${type}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" />
    </div>
  `;
}
function textareaField({ id, label, placeholder="", value="" }){
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <textarea id="${id}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

/* --------------------- Tool Library --------------------- */
let tools = [];
function normalizeTool(raw){
  raw = raw || {};
  // accept many possible header names from Sheets / GAS
  const toolCode = (raw.toolCode || raw.tool_code || raw.ToolCode || raw.code || raw.toolcode || raw.Tool || raw.id || "").toString().trim();
  const name = (raw.name || raw.title || raw.toolName || raw.tool_name || raw.ToolName || raw["工具名稱"] || "").toString().trim();
  const summary = (raw.core || raw.summary || raw.desc || raw.description || raw["核心功能"] || "").toString().trim();
  const pain = (raw.pain || raw.painPoints || raw.pain_points || raw.problem || raw.painpoint || raw["痛點"] || raw.pain_points_text || "").toString().trim();
  const steps = (raw.steps || raw.flow || raw.how || raw["操作步驟"] || "").toString().trim();
  const tips = (raw.tips || raw.hints || raw["智多星錦囊"] || "").toString().trim();
  const link = (raw.link || raw.url || raw.href || raw["工具連結"] || "").toString().trim();
  const category = (raw.category || raw.type || raw.group || raw["性質分類"] || "").toString().trim();
  const tags = (raw.tags || raw.keywords || raw["標籤"] || "").toString().trim();
  const status = (raw.status || raw.state || "").toString().trim();
  const videoTitle = (raw.video_title || raw.videoTitle || raw["影片名稱"] || "").toString().trim();
  const videoLink = (raw.video_link || raw.videoLink || raw["影片連結"] || "").toString().trim();
  return { toolCode, name, summary, pain, steps, tips, link, category, tags, status, videoTitle, videoLink };
}
function loadToolsCache(){
  try{
    const raw = localStorage.getItem(LS_TOOLS_KEY);
    if(!raw) return [];
    const j = JSON.parse(raw);
    return (j || []).map(normalizeTool);
  }catch(e){ return []; }
}
function saveToolsCache(list){
  try{
    localStorage.setItem(LS_TOOLS_KEY, JSON.strasync function syncTools(){
  const msg = el("toolsMsg");
  if(msg) msg.textContent = "同步中…";
  const base = (settings.toolApi || TOOL_API || "").trim();
  const tries = [
    base + (base.includes("?") ? "&" : "?") + "action=list_tools",
    base + (base.includes("?") ? "&" : "?") + "action=tools",
    base + (base.includes("?") ? "&" : "?") + "action=list",
    base
  ].filter(Boolean);
  let last = null;

  for(const url of tries){
    last = { url };
    const r = await fetchMaybeJson(url);
    last.status = r.status;
    last.error = r.error || null;

    if(!r.ok){
      last.text = (r.text||"").slice(0, 300);
      continue;
    }

    const j = r.data || {};
    // accept multiple shapes
    let arr = j.items || j.data || j.rows || j.result || j.tools || (j.ok && Array.isArray(j) ? j : null);

    // If rows is a 2D array, convert using first row as headers
    if(Array.isArray(arr) && arr.length && Array.isArray(arr[0])){
      const headers = arr[0].map(h=>String(h||"").trim());
      arr = arr.slice(1).map(row=>{
        const o={};
        headers.forEach((h,i)=>{ if(h) o[h]=String(row[i]??"").trim(); });
        return o;
      });
    }

    // Some APIs wrap as {ok:true, items:{items:[...]}}
    if(arr && !Array.isArray(arr) && typeof arr==="object"){
      const maybe = arr.items || arr.data || arr.rows;
      if(Array.isArray(maybe)) arr = maybe;
    }

    if(Array.isArray(arr)){
      // normalize + drop empty rows
      const normalized = arr.map(normalizeTool).filter(t=>{
        const has = (t.toolCode||"").trim() || (t.name||"").trim() || (t.link||"").trim();
        return !!has;
      });
      tools = normalized;
      saveToolsCache(normalized);
      if(msg) msg.textContent = `✅ 工具庫已同步：${normalized.length} 筆`;
      renderToolLists();
      return normalized;
    }else{
      last.text = (r.text||"").slice(0, 300);
    }
  }

  // fail / empty
  const cached = loadToolsCache();
  tools = cached;
  renderToolLists();
  if(msg){
    const hint = cached.length ? `已改用本機快取：${cached.length} 筆` : "目前仍是 0 筆（可能是 API 回傳格式或權限/CORS 問題）";
    msg.textContent = `⚠️ 無法同步工具庫。${hint}`;
  }
  // store debug
  try{ localStorage.setItem(LS_DEBUG_KEY, JSON.stringify(last||{})); }catch(_){}
  return cached;
}
 API 是否「任何人」可存取，且回傳 JSON）`);
  }
  renderAll();
}

/* --------------- Tool Picker UI (inline) --------------- */
function getSubToolsText(){
  if(!model.sub_tools || !model.sub_tools.length) return "";
  return model.sub_tools
    .map(t => `${t.name || ""}｜${t.link || ""}`.trim())
    .filter(Boolean)
    .join("\n");
}
function rebuildLinksFromTools(){
  const lines = [];
  if(model.main_tool_name && model.main_tool_link){
    lines.push(`${model.main_tool_name}｜${model.main_tool_link}`);
  }
  (model.sub_tools||[]).forEach(t=>{
    if(t.name && t.link) lines.push(`${t.name}｜${t.link}`);
  });
  // merge with existing links (keep other links too)
  const existing = (model.links||"").split("\n").map(s=>s.trim()).filter(Boolean);
  const merged = [...new Set([...lines, ...existing])];
  model.links = merged.join("\n");
}
function toolItemHtml(t, mode){
  // mode: "main" | "sub"
  const checkedMain = (mode==="main") && (model.main_tool_code === t.toolCode);
  const checkedSub = (mode==="sub") && (model.sub_tools||[]).some(x => (x.toolCode===t.toolCode) || (x.link && x.link===t.link));
  const inputType = mode==="main" ? "radio" : "checkbox";
  const nameAttr = mode==="main" ? "mainTool" : `subTool_${t.toolCode}`;
  const tagPills = [
    t.toolCode ? `<span class="pilltag">${escapeHtml(t.toolCode)}</span>` : "",
    t.category ? `<span class="pilltag">${escapeHtml(t.category)}</span>` : ""
  ].filter(Boolean).join("");
  const subline = [t.summary, t.pain, t.tags].filter(Boolean).join("｜");
  return `
    <div class="tool-item">
      <input type="${inputType}" name="${nameAttr}" ${checkedMain||checkedSub ? "checked" : ""}
        data-toolcode="${escapeHtml(t.toolCode)}"
        data-name="${escapeHtml(t.name)}"
        data-link="${escapeHtml(t.link)}"
        data-category="${escapeHtml(t.category)}"
        data-tags="${escapeHtml(typeof t.tags==="string"?t.tags:JSON.stringify(t.tags))}"
      />
      <div class="tool-meta">
        <div class="tool-name">${escapeHtml(t.name)}</div>
        <div class="tool-sub">${escapeHtml(subline || (t.link || ""))}</div>
        <div class="tagline">${tagPills}</div>
      </div>
    </div>
  `;
}
function toolsPickerHtml(){
  const all = tools.length ? tools : loadToolsCache();
  const emptyBanner = (!all || !all.length) ? `<div class="hint"><b>工具庫尚未載入。</b> 先按右上「同步工具庫」。如果仍為空，代表 API 沒有回傳 JSON 或權限不是「任何人」。</div>` : ``;
  const categories = [...new Set(all.map(t => (t.category||"").trim()).filter(Boolean))].sort();
  const prefixes = ["ALL","MIX","EQ","COM","ACT","REL","KIDS","NEURO","LIFE","POEM"];
  return `
    <div class="tools-panel">
      <div class="tools-toolbar">
        <input id="toolSearch" placeholder="搜尋：工具名/代碼/類別" />
        <select id="toolPrefix">
          ${prefixes.map(p=>`<option value="${p}">${p}</option>`).join("")}
        </select>
        <select id="toolCategory">
          <option value="ALL">全部分類</option>
          ${categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
        </select>
        <button id="btnToolsClear" class="btn ghost" type="button">清空勾選</button>
      </div>

      ${emptyBanner}

      <div class="tools-grid">
        <div class="tools-box">
          <h3>主工具（單選）</h3>
          <div id="mainToolList"></div>
        </div>
        <div class="tools-box">
          <h3>副工具（多選）</h3>
          <div id="subToolList"></div>
        </div>
      </div>

      <div class="hint">
        勾選後會自動整理到 <b>links</b> 欄位；你仍可在下方手動加上其他連結。
      </div>
    </div>
  `;
}
function filterTools(all, q, prefix, category){
  const qq = (q||"").trim().toLowerCase();
  return all.filter(t=>{
    const okQ = !qq || [t.toolCode,t.name,t.category,t.tags,t.summary,t.pain,t.link].join(" ").toLowerCase().includes(qq);
    const okPrefix = (prefix==="ALL") || ((t.toolCode||"").toUpperCase().startsWith(prefix));
    const okCat = (category==="ALL") || ((t.category||"")===category);
    return okQ && okPrefix && okCat;
  });
}
function renderToolLists(){
  const all = tools.length ? tools : loadToolsCache();
  const q = el("toolSearch")?.value || "";
  const prefix = el("toolPrefix")?.value || "ALL";
  const cat = el("toolCategory")?.value || "ALL";
  const list = filterTools(all, q, prefix, cat).slice(0, 60); // keep light
  const mainHtml = list.map(t=>toolItemHtml(t,"main")).join("") || `<div class="mini">（找不到）</div>`;
  const subHtml  = list.map(t=>toolItemHtml(t,"sub")).join("") || `<div class="mini">（找不到）</div>`;
  el("mainToolList").innerHTML = mainHtml;
  el("subToolList").innerHTML = subHtml;

  // bind change
  el("mainToolList").querySelectorAll("input[type=radio]").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      model.main_tool_code = inp.dataset.toolcode || "";
      model.main_tool_name = inp.dataset.name || "";
      model.main_tool_link = inp.dataset.link || "";
      rebuildLinksFromTools();
      saveLocal(true);
      toast("主工具已選 ✓");
    });
  });
  el("subToolList").querySelectorAll("input[type=checkbox]").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      const t = {
        toolCode: inp.dataset.toolcode || "",
        name: inp.dataset.name || "",
        link: inp.dataset.link || "",
        category: inp.dataset.category || "",
        tags: inp.dataset.tags || ""
      };
      model.sub_tools = model.sub_tools || [];
      const exists = model.sub_tools.some(x => (x.toolCode && x.toolCode===t.toolCode) || (x.link && x.link===t.link));
      if(inp.checked && !exists){
        model.sub_tools.push(t);
      }
      if(!inp.checked && exists){
        model.sub_tools = model.sub_tools.filter(x => !((x.toolCode && x.toolCode===t.toolCode) || (x.link && x.link===t.link)));
      }
      rebuildLinksFromTools();
      saveLocal(true);
      toast("副工具已更新 ✓");
      // also sync textarea display if present
      const ta = el("f_tools_with_links");
      if(ta) ta.value = getSubToolsText();
    });
  });
}
function bindToolPickerControls(){
  const search = el("toolSearch");
  const prefix = el("toolPrefix");
  const cat = el("toolCategory");
  if(search) search.addEventListener("input", ()=> renderToolLists());
  if(prefix) prefix.addEventListener("change", ()=> renderToolLists());
  if(cat) cat.addEventListener("change", ()=> renderToolLists());
  const btnClear = el("btnToolsClear");
  if(btnClear) btnClear.addEventListener("click", ()=>{
    model.main_tool_code=""; model.main_tool_name=""; model.main_tool_link="";
    model.sub_tools=[];
    rebuildLinksFromTools();
    saveLocal(true);
    renderAll();
    toast("已清空勾選");
  });
}

/* --------------------- Steps rendering --------------------- */
function renderSteps(){
  const area = el("stepsArea");
  area.innerHTML = "";
  const s = model.state;

  if(s==="idea"){
    area.appendChild(stepCard({
      key:"I1", title:"I-1｜一句話定義", sub:"課名、對象、痛點（先站穩，不求完整）",
      bodyHtml:`
        <div class="grid two">
          ${inputField({id:"f_title",label:"title（課名）",placeholder:"例如：給親子的｜幸福教養體驗活動",value:model.title})}
          ${inputField({id:"f_audience",label:"audience（對象）",placeholder:"親子/家長/老師",value:model.audience})}
        </div>
        ${inputField({id:"f_tags",label:"tags（關鍵痛點/標籤）",placeholder:"#情緒急救 #關係修復 #不打不罵",value:model.tags})}
        <div class="hint">先寫「你真的想解的痛點」就好，不用漂亮。</div>
      `
    }));

    area.appendChild(stepCard({
      key:"I2", title:"I-2｜結果感（結尾一句話）", sub:"一句能定錨的話",
      bodyHtml:`
        ${textareaField({id:"f_closing",label:"closing_line（結尾定錨句）",placeholder:"孩子不需要你完美，他需要你回得來。",value:model.closing_line})}
      `
    }));

    area.appendChild(stepCard({
      key:"I3", title:"I-3｜工具配方（工具庫勾選）", sub:"主工具單選 / 副工具多選（頁內、無遮罩）",
      bodyHtml:`
        ${toolsPickerHtml()}
        <div class="grid two">
          ${inputField({id:"f_main_tool_name",label:"主工具（自動帶入，可手改）",placeholder:"",value:model.main_tool_name})}
          ${inputField({id:"f_main_tool_link",label:"主工具連結（自動帶入，可手改）",placeholder:"",value:model.main_tool_link})}
        </div>
        ${textareaField({id:"f_tools_with_links",label:"副工具清單（自動帶入，可手改）",placeholder:"每行一個：工具名｜連結",value:getSubToolsText()})}
        ${textareaField({id:"f_links",label:"links（工具連結整理＋其他連結）",placeholder:"會自動整理到這裡，你也可以再加別的連結",value:model.links})}
      `
    }));

    area.appendChild(stepCard({
      key:"I4", title:"I-4｜粗架構（8 集一句話大綱）", sub:"先把方向站起來",
      bodyHtml:`
        ${textareaField({id:"f_framework",label:"framework_text（8 集一句話大綱）",placeholder:"01 ...\n02 ...\n...\n08 ...",value:model.framework_text})}
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btnGoDraft" class="btn primary" type="button">進草稿 →</button>
        </div>
      `
    }));
  }

  if(s==="draft"){
    area.appendChild(stepCard({
      key:"D1", title:"D-1｜目標與節律", sub:"可試教、可內測：先把目標與節律說清楚",
      bodyHtml:`
        ${textareaField({id:"f_objectives",label:"objectives（條列）",placeholder:"- ...\n- ...",value:model.objectives})}
        ${inputField({id:"f_rhythm",label:"每週節律（rhythm）",placeholder:"例如：120 分鐘｜90 分鐘｜含作業",value:model.rhythm})}
      `
    }));
    area.appendChild(stepCard({
      key:"D2", title:"D-2｜八堂詳細版（短表述）", sub:"每集：目標｜工具｜練習｜作業",
      bodyHtml:`
        ${textareaField({id:"f_outline",label:"outline（可試教版本）",placeholder:"第1堂：目標｜工具｜練習｜作業\n第2堂：...",value:model.outline})}
      `
    }));
    area.appendChild(stepCard({
      key:"D3", title:"D-3｜交付物與材料", sub:"練習單、提醒、講稿、指引、結業小抄…",
      bodyHtml:`
        ${textareaField({id:"f_materials",label:"materials（清單）",placeholder:"- 練習單...\n- 提醒卡...",value:model.materials})}
        ${textareaField({id:"f_links_draft",label:"links（工具連結整理＋其他連結）",placeholder:"",value:model.links})}
      `
    }));
    area.appendChild(stepCard({
      key:"D4", title:"D-4｜回饋與追蹤", sub:"每週回饋題、追蹤方式、工具使用頻率建議",
      bodyHtml:`
        ${textareaField({id:"f_feedback",label:"feedback（回饋與追蹤）",placeholder:"每週 3 題回饋：\n1) ...\n2) ...\n追蹤方式：...",value:model.feedback})}
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btnGoFinal" class="btn primary" type="button">進完稿 →</button>
        </div>
      `
    }));
  }

  if(s==="final"){
    area.appendChild(stepCard({
      key:"F1", title:"F-1｜正式提案版文案", sub:"summary / objectives / why effective（腦科學＋幸福教養一句話）",
      bodyHtml:`
        ${textareaField({id:"f_summary",label:"summary（對外版）",placeholder:"一段能對外提案的文字",value:model.summary})}
        ${textareaField({id:"f_objectives_final",label:"objectives（對外可讀版）",placeholder:"- ...\n- ...",value:model.objectives})}
        ${textareaField({id:"f_why",label:"why effective（放在 notes 內）",placeholder:"腦科學＋幸福教養一句話",value:model.notes})}
      `
    }));
    area.appendChild(stepCard({
      key:"F2", title:"F-2｜課程設計定稿", sub:"outline / materials / links（正式可上架）",
      bodyHtml:`
        ${textareaField({id:"f_outline_final",label:"outline（正式版）",placeholder:"",value:model.outline})}
        ${textareaField({id:"f_materials_final",label:"materials（正式清單）",placeholder:"",value:model.materials})}
        ${textareaField({id:"f_links_final",label:"links（工具連結整理＋其他連結）",placeholder:"",value:model.links})}
      `
    }));
    area.appendChild(stepCard({
      key:"F3", title:"F-3｜製作物生成（用 AI 指令一鍵帶出）", sub:"PPT 大綱、逐頁講稿、口播稿、主持稿",
      bodyHtml:`
        <div class="hint">
          這一步你不用手打。你按底部「一鍵複製｜AI 指令（完整）」貼到 ChatGPT / Gemini，會依「完稿」規格輸出：提案版＋PPT＋逐頁講稿＋口播稿＋主持稿。
        </div>
        ${textareaField({id:"f_assets",label:"assets（檔案清單）",placeholder:"ppt/講稿/練習單/音檔...",value:model.assets})}
      `
    }));
    area.appendChild(stepCard({
      key:"F4", title:"F-4｜確認與封存", sub:"status 預設 ready（保守）＋ version ＋ notes",
      bodyHtml:`
        <div class="grid two">
          ${inputField({id:"f_status",label:"status（ready/hold/archived）",placeholder:"ready",value:model.status || "ready"})}
          ${inputField({id:"f_version_final",label:"version",placeholder:"v1",value:model.version || "v1"})}
        </div>
        ${textareaField({id:"f_notes_final",label:"notes",placeholder:"封存說明、注意事項…",value:model.notes})}
      `
    }));
  }

  bindInputs();
  // Tool picker only exists on idea state
  if(model.state==="idea"){
    bindToolPickerControls();
    renderToolLists();
  }
  bindStateJumpButtons();
}

function bindStateJumpButtons(){
  const btnGoDraft = el("btnGoDraft");
  if(btnGoDraft) btnGoDraft.addEventListener("click", ()=> setState("draft"));
  const btnGoFinal = el("btnGoFinal");
  if(btnGoFinal) btnGoFinal.addEventListener("click", ()=> setState("final"));
}

function bindInputs(){
  const bind = (id, field) => {
    const node = el(id);
    if(!node) return;
    node.addEventListener("input", ()=>{
      model[field] = node.value;
      // keep some cross-field sync
      if(field==="f_main_tool_name") model.main_tool_name = node.value;
      saveLocal(true);
      renderProgress();
    });
  };

  // idea
  if(el("f_title")) el("f_title").addEventListener("input", e=>{ model.title=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_audience")) el("f_audience").addEventListener("input", e=>{ model.audience=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_tags")) el("f_tags").addEventListener("input", e=>{ model.tags=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_closing")) el("f_closing").addEventListener("input", e=>{ model.closing_line=e.target.value; saveLocal(true); });
  if(el("f_framework")) el("f_framework").addEventListener("input", e=>{ model.framework_text=e.target.value; saveLocal(true); renderProgress(); });

  if(el("f_main_tool_name")) el("f_main_tool_name").addEventListener("input", e=>{ model.main_tool_name=e.target.value; saveLocal(true); });
  if(el("f_main_tool_link")) el("f_main_tool_link").addEventListener("input", e=>{ model.main_tool_link=e.target.value; saveLocal(true); });
  if(el("f_tools_with_links")) el("f_tools_with_links").addEventListener("input", e=>{
    // manual edits stay in text; we also keep sub_tools best-effort (do not parse aggressively)
    saveLocal(true);
  });
  if(el("f_links")) el("f_links").addEventListener("input", e=>{ model.links=e.target.value; saveLocal(true); });

  // draft
  if(el("f_objectives")) el("f_objectives").addEventListener("input", e=>{ model.objectives=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_rhythm")) el("f_rhythm").addEventListener("input", e=>{ model.rhythm=e.target.value; saveLocal(true); });
  if(el("f_outline")) el("f_outline").addEventListener("input", e=>{ model.outline=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_materials")) el("f_materials").addEventListener("input", e=>{ model.materials=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_links_draft")) el("f_links_draft").addEventListener("input", e=>{ model.links=e.target.value; saveLocal(true); });
  if(el("f_feedback")) el("f_feedback").addEventListener("input", e=>{ model.feedback=e.target.value; saveLocal(true); });

  // final
  if(el("f_summary")) el("f_summary").addEventListener("input", e=>{ model.summary=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_objectives_final")) el("f_objectives_final").addEventListener("input", e=>{ model.objectives=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_why")) el("f_why").addEventListener("input", e=>{ model.notes=e.target.value; saveLocal(true); });
  if(el("f_outline_final")) el("f_outline_final").addEventListener("input", e=>{ model.outline=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_materials_final")) el("f_materials_final").addEventListener("input", e=>{ model.materials=e.target.value; saveLocal(true); renderProgress(); });
  if(el("f_links_final")) el("f_links_final").addEventListener("input", e=>{ model.links=e.target.value; saveLocal(true); });
  if(el("f_assets")) el("f_assets").addEventListener("input", e=>{ model.assets=e.target.value; saveLocal(true); });
  if(el("f_status")) el("f_status").addEventListener("input", e=>{ model.status=e.target.value || "ready"; saveLocal(true); });
  if(el("f_version_final")) el("f_version_final").addEventListener("input", e=>{ model.version=e.target.value; saveLocal(true); });
  if(el("f_notes_final")) el("f_notes_final").addEventListener("input", e=>{ model.notes=e.target.value; saveLocal(true); });
}

/* --------------------- Settings --------------------- */
function renderSettings(){
  el("toolApiLabel").textContent = TOOL_API;
  el("courseApiLabel").textContent = COURSE_API;

  el("f_owner").value = model.owner || "";
  el("f_version").value = model.version || "v1";
  el("f_episodes").value = model.episodes || "8";
  el("f_duration").value = model.duration_min || "120";
  el("f_capacity").value = model.capacity || "20";
  el("f_type").value = model.type || "";

  const bind = (id, fn) => {
    const node = el(id);
    node.addEventListener("input", ()=>{ fn(node.value); saveLocal(true); });
  };
  bind("f_owner", v=> model.owner = v);
  bind("f_version", v=> model.version = v);
  bind("f_episodes", v=> model.episodes = v);
  bind("f_duration", v=> model.duration_min = v);
  bind("f_capacity", v=> model.capacity = v);
  bind("f_type", v=> model.type = v);
}

/* --------------------- AI prompt + TSV --------------------- */
function buildAIPrompt(){
  ensureId();
  const stateZh = STATE_MAP[model.state];
  const mainToolLine = `${model.main_tool_name||""}｜${model.main_tool_link||""}`.trim();
  const toolList = getSubToolsText() || (model.tool_list_with_links || "");
  const header = `你是「天使笑長」的協作夥伴。請用溫柔、清楚、不說教的語氣，幫我把課程從「${stateZh}」往下一階段完成。`;

  const block0 = [
    "0｜已輸入資料（請以此為準，不要改名、不重問）",
    `課程名稱：${model.title}`,
    `類型：${model.type}`,
    `對象：${model.audience}`,
    `集數/時長/人數：${model.episodes}集｜${model.duration_min}分鐘｜${model.capacity}人`,
    `關鍵痛點/標籤：${model.tags}`,
    `主工具：${mainToolLine}`,
    `副工具：${toolList}`,
    `核心流程架構：${model.framework_text}`,
    `結尾定錨句：${model.closing_line}`
  ].join("\n");

  const block1 = [
    "1｜請你輸出三份成果（務必分段標題）",
    "A) 活動/課程規劃（定位、目標、節律、適用場域）",
    "B) 詳細設計內容（每集內容、現場流程、練習、作業）",
    "C) 回饋與追蹤方案（每週追蹤、回饋題、工具使用節律）"
  ].join("\n");

  const block2 = [
    "2｜依目前狀態輸出格式（很重要）",
    `若 ${stateZh}=發想：請先產出「8集一句話大綱」與「最小可行練習」，不要寫太長。`,
    `若 ${stateZh}=草稿：請補齊每集「目標/工具/練習/作業」，可直接拿去試教。`,
    `若 ${stateZh}=完稿：請產出「對外提案版」＋「PPT大綱」＋「逐頁講稿」＋「口播稿」＋「演說/主持稿」。`
  ].join("\n");

  const block3 = [
    "3｜最後請再輸出：表單橫向一列（可貼入）",
    "請依下列表頭輸出一列（用 tab 分隔）：",
    "{id, title, type, status, version, owner, audience, duration_min, capacity, tags, summary, objectives, outline, materials, links, assets, notes, created_at, updated_at}",
    "若 發想：summary/objectives/outline 可短版",
    "若 草稿：summary/objectives/outline 完整版",
    "若 完稿：全部欄位給可上架的定稿版（status 預設 ready）"
  ].join("\n");

  return [header,"",block0,"",block1,"",block2,"",block3].join("\n");
}

function sanitizeTSVCell(v){
  const s = String(v ?? "");
  return s.replaceAll("\t"," ").replaceAll("\r\n","\n").replaceAll("\r","\n").replaceAll("\n","\\n");
}
function buildRowObject(){
  ensureId();
  if(!model.created_at) model.created_at = nowISO();
  model.updated_at = nowISO();

  // conservative defaults
  const state = model.state;
  const status = state==="final" ? (model.status || "ready") : (model.status || "ready");
  const summary = model.summary || (state==="idea" ? `發想：${model.title}` : state==="draft" ? `草稿：可試教｜${model.title}` : `完稿：可對外提案｜${model.title}`);
  const outline = model.outline || (state==="idea" ? (model.framework_text || "") : "");
  const objectives = model.objectives || "";
  const materials = model.materials || "";
  rebuildLinksFromTools();

  return {
    id: model.id,
    title: model.title,
    type: model.type,
    status,
    version: model.version || "v1",
    owner: model.owner,
    audience: model.audience,
    duration_min: model.duration_min,
    capacity: model.capacity,
    tags: model.tags,
    summary,
    objectives,
    outline,
    materials,
    links: model.links || "",
    assets: model.assets || "",
    notes: model.notes || "",
    created_at: model.created_at,
    updated_at: model.updated_at
  };
}
function buildTSVRow(){
  const row = buildRowObject();
  const cols = HEADERS.map(h => row[h] ?? "");
  return cols.map(sanitizeTSVCell).join("\t");
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

/* --------------------- API write (best effort) --------------------- */
async function tryPostJSON(payload){
  const res = await fetch(COURSE_API, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  return res;
}
async function tryPostForm(payload){
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([k,v])=> params.set(k, typeof v==="string" ? v : JSON.stringify(v)));
  const res = await fetch(COURSE_API, {
    method:"POST",
    headers: {"Content-Type":"application/x-www-form-urlencoded"},
    body: params.toString()
  });
  return res;
}
async function tryGet(payload){
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([k,v])=> params.set(k, typeof v==="string" ? v : JSON.stringify(v)));
  const url = COURSE_API + "?" + params.toString();
  const res = await fetch(url, { method:"GET" });
  return res;
}

async function sendToApi(){
  const sheet = TABLE_MAP[model.state]; // ideas/drafts/final
  const rowObj = buildRowObject();
  const payloads = [
    { action:"append", sheet, row: rowObj },
    { action:"appendRow", sheet, row: rowObj },
    { action:"add", sheet, data: rowObj },
    { sheet, row: rowObj },
    { tab: sheet, row: rowObj }
  ];

  toast("送出中…");
  for (const p of payloads){
    for (const fn of [tryPostJSON, tryPostForm, tryGet]){
      try{
        const res = await fn(p);
        if(res.ok){
          let text = "";
          try{ text = await res.text(); }catch(e){}
          toast("已寫入試算表 ✓");
          return;
        }
      }catch(e){ /* continue */ }
    }
  }

  toast("送出失敗（改用 TSV 貼回）");
  // as best effort, also copy TSV automatically
  const ok = await copyText(buildTSVRow());
  if(ok) toast("已改複製 TSV（貼回表格）");
}

/* --------------------- Export --------------------- */
function exportJSON(){
  ensureId();
  if(!model.created_at) model.created_at = nowISO();
  model.updated_at = nowISO();
  const blob = new Blob([JSON.stringify(model,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${model.id || "course"}-${model.state}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/* --------------------- Manual tool import (fallback) --------------------- */
function parseTSVTools(text){
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return [];
  // detect header
  let start = 0;
  const first = lines[0].toLowerCase();
  if(first.includes("toolcode") || first.includes("name") || first.includes("link")){
    start = 1;
  }
  const out = [];
  for(let i=start;i<lines.length;i++){
    const cols = lines[i].split("\t");
    // toolCode, name, link, category, tags, summary
    const raw = {
      toolCode: cols[0]||"",
      name: cols[1]||"",
      link: cols[2]||"",
      category: cols[3]||"",
      tags: cols[4]||"",
      summary: cols[5]||""
    };
    out.push(normalizeTool(raw));
  }
  return out;
}
function applyImportedTools(list){
  tools = (list||[]).map(normalizeTool);
  saveToolsCache(tools);
  toast(`已套用工具（${tools.length}）`);
  renderAll();
}

function bindDebugTools(){
  const btn = document.getElementById("btnImportTools");
  if(btn){
    btn.addEventListener("click", ()=>{
      const ta = document.getElementById("dbg_tool_import");
      const text = (ta?.value||"").trim();
      if(!text){ toast("請先貼入 JSON 或 TSV"); return; }
      // Try JSON
      try{
        const j = JSON.parse(text);
        const arr = Array.isArray(j) ? j : (j.data || j.items || j.tools || j.rows || []);
        if(Array.isArray(arr) && arr.length){
          applyImportedTools(arr);
          return;
        }
      }catch(e){}
      // Try TSV
      const parsed = parseTSVTools(text);
      if(parsed.length){
        applyImportedTools(parsed);
        return;
      }
      toast("匯入失敗：請貼 JSON 陣列或 TSV");
    });
  }
  const btn2 = document.getElementById("btnClearToolsCache");
  if(btn2){
    btn2.addEventListener("click", ()=>{
      localStorage.removeItem(LS_TOOLS_KEY);
      tools = [];
      toast("已清空工具快取");
      renderAll();
    });
  }
}


/* --------------------- Wire up --------------------- */
function bindTop(){
  document.querySelectorAll(".pill").forEach(b=> b.addEventListener("click", ()=> setState(b.dataset.state)));
  el("btnReloadTools").addEventListener("click", syncTools);
  el("btnToggleSettings").addEventListener("click", ()=>{
    const card = el("settingsCard");
    card.style.display = (card.style.display==="none" ? "block" : "none");
  });
}
function bindBottom(){
  el("btnCopyAI").addEventListener("click", async ()=>{
    const ok = await copyText(buildAIPrompt());
    toast(ok ? "AI 指令已複製 ✓" : "複製失敗（可長按）");
  });
  el("btnCopyTSV").addEventListener("click", async ()=>{
    const ok = await copyText(buildTSVRow());
    toast(ok ? "TSV 已複製 ✓" : "複製失敗（可長按）");
  });
  el("btnSendApi").addEventListener("click", sendToApi);
  el("btnSaveLocal").addEventListener("click", ()=> saveLocal(false));
  el("btnExportJson").addEventListener("click", exportJSON);
}

function renderAll(){
  renderProgress();
  renderSettings();
  renderSteps();
}

function init(){
  // label APIs
  el("toolApiLabel").textContent = TOOL_API;
  el("courseApiLabel").textContent = COURSE_API;

  bindTop();
  bindBottom();
  bindDebugTools();
  tools = loadToolsCache().map(normalizeTool);
  renderAll();
  // sync tools in background
  syncTools();
}
init();
