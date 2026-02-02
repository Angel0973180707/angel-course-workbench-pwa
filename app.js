// Angel｜課程設計工作台（API Debug 強化版）
// 目標：把「工具庫存管理 API」回傳任何格式，都盡量解析成 tools[]，並提供「原始回應」給你截圖定位。

const CONFIG = {
  toolsApi: "https://script.google.com/macros/s/AKfycbwecHTILAMuk5Izr_yF9wfce_qNjxuy28XuvpDzK0LZ4Wszmw7zI3xve8jeLghzveWbXA/exec",
  courseApi: "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec",
  lsKey: "angel_course_workbench_v2",
  lsTools: "angel_tools_cache_v2",
};

const $ = (id) => document.getElementById(id);

let state = "idea";
let model = {
  title: "",
  type: "活動",
  audience: "",
  tags: "",
  closing_line: "",
  framework_text: "",
  duration_min: 120,
  capacity: 20,
  main_tool: null,
  side_tools: [],
};

let tools = [];
let lastToolsRaw = "";
let pickerMode = "main"; // main | side

function setSmallStatus(msg=""){
  $("smallStatus").textContent = msg ? `｜${msg}` : "";
}

function toast(msg){
  setSmallStatus(msg);
  setTimeout(()=>setSmallStatus(""), 2600);
}

function safeText(v){ return (v ?? "").toString().trim(); }

function parsePrefix(code){
  const m = safeText(code).match(/^([A-Z]+)[-_]/);
  return m ? m[1] : "";
}

function normalizeTool(t){
  // 支援你表頭：toolCode name core pain_points chapters steps tips link category video_title video_link status
  const toolCode = safeText(t.toolCode ?? t.code ?? t.id ?? t.tool_code);
  const name = safeText(t.name ?? t.title ?? t.toolName);
  const core = safeText(t.core ?? t.summary ?? t.core_function ?? t.coreFunction);
  const pain_points = safeText(t.pain_points ?? t.painPoints ?? t.tags ?? t.keywords);
  const steps = safeText(t.steps ?? t.flow ?? t.howto);
  const tips = safeText(t.tips ?? t.tip ?? t.note);
  const link = safeText(t.link ?? t.url ?? t.href);
  const category = safeText(t.category ?? t.type ?? t.group);
  const status = safeText(t.status ?? "active") || "active";
  const video_title = safeText(t.video_title ?? t.videoTitle);
  const video_link = safeText(t.video_link ?? t.videoLink);

  const prefix = parsePrefix(toolCode);

  return {
    toolCode, name, core, pain_points, steps, tips, link, category,
    video_title, video_link, status, prefix
  };
}

function uniqBy(arr, keyFn){
  const map = new Map();
  arr.forEach(x=>{
    const k = keyFn(x);
    if(!k) return;
    if(!map.has(k)) map.set(k, x);
  });
  return [...map.values()];
}

function parseTSVText(tsv){
  const text = (tsv || "").trim();
  if(!text) return [];
  const lines = text.split(/\r?\n/).filter(l => l.trim().length>0);
  if(lines.length < 2) return [];

  const header = lines[0].split("\t").map(h=>h.trim());
  const out = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split("\t");
    // 如果這行幾乎都是空的，略過
    const nonEmpty = cols.filter(c => (c||"").trim().length>0).length;
    if(nonEmpty <= 1) continue;

    const obj = {};
    header.forEach((h, idx) => obj[h] = cols[idx] ?? "");
    out.push(obj);
  }
  return out;
}

function parseRows2D(rows){
  // rows: [ [header...], [row...], ... ]
  if(!Array.isArray(rows) || rows.length < 2) return [];
  const header = rows[0].map(h=>safeText(h));
  const out = [];
  for(let i=1;i<rows.length;i++){
    const r = rows[i] || [];
    const nonEmpty = r.filter(c => safeText(c).length>0).length;
    if(nonEmpty <= 1) continue;
    const obj = {};
    header.forEach((h, idx) => obj[h] = r[idx] ?? "");
    out.push(obj);
  }
  return out;
}

function extractToolsFromAny(payload){
  // 回傳 {tools, note}
  // 1) 直接是陣列
  if(Array.isArray(payload)) return {tools: payload, note:"payload=array"};
  // 2) JSON 物件內常見欄位
  if(payload && typeof payload === "object"){
    const keysTry = ["tools","items","data","rows","result","records"];
    for(const k of keysTry){
      if(payload[k] != null){
        // rows 可能是二維
        if(k === "rows" && Array.isArray(payload[k]) && Array.isArray(payload[k][0])){
          return {tools: parseRows2D(payload[k]), note:`payload.${k}=rows2D`};
        }
        return {tools: payload[k], note:`payload.${k}`};
      }
    }
  }
  return {tools: [], note:"no_match"};
}

async function fetchToolsFromApi(){
  // 依序嘗試不同 action，因為 Apps Script 常用 action 做路由
  const urls = [
    CONFIG.toolsApi,
    `${CONFIG.toolsApi}?action=list_tools`,
    `${CONFIG.toolsApi}?action=tools`,
    `${CONFIG.toolsApi}?action=list`,
    `${CONFIG.toolsApi}?action=ping`,
  ];

  let lastErr = "";
  for(const url of urls){
    try{
      const res = await fetch(url, {cache:"no-store"});
      const txt = await res.text();
      lastToolsRaw = `URL: ${url}\nHTTP: ${res.status}\n\n` + txt;

      // 先嘗試 JSON
      let parsed = null;
      try{
        parsed = JSON.parse(txt);
      }catch(e){
        parsed = null;
      }

      let rows = [];
      let note = "";

      if(parsed){
        const ex = extractToolsFromAny(parsed);
        rows = ex.tools;
        note = ex.note;
      }else{
        // 可能是 TSV 純文字
        const tsvRows = parseTSVText(txt);
        if(tsvRows.length){
          rows = tsvRows;
          note = "tsv_text";
        }
      }

      // rows 可能是二維陣列（header + rows）
      if(Array.isArray(rows) && rows.length && Array.isArray(rows[0])){
        rows = parseRows2D(rows);
        note = note + "+rows2D";
      }

      // rows 可能還是物件陣列
      if(Array.isArray(rows) && rows.length){
        const norm = rows.map(normalizeTool)
          .filter(t => t.toolCode && t.name && (t.status || "active") !== "deleted");
        const dedup = uniqBy(norm, t => t.toolCode);
        if(dedup.length){
          return {ok:true, tools: dedup, note, url};
        }
      }

      // 如果是 ping 就直接結束（避免誤判）
      lastErr = `解析為 0 筆（${note}）`;
    }catch(err){
      lastErr = String(err);
      continue;
    }
  }
  return {ok:false, tools:[], note:lastErr, url:"(all tried)"};
}

function renderTools(){
  const q = safeText($("toolSearch").value).toLowerCase();
  const prefix = $("toolPrefix").value;
  const cat = $("toolCategory").value;

  const filtered = tools.filter(t=>{
    if(t.status && t.status.toLowerCase() !== "active") return false;
    if(prefix && t.prefix !== prefix) return false;
    if(cat && safeText(t.category) !== cat) return false;
    if(!q) return true;
    const hay = `${t.toolCode} ${t.name} ${t.core} ${t.pain_points} ${t.category}`.toLowerCase();
    return hay.includes(q);
  });

  $("toolsCount").textContent = `目前：${filtered.length} / 全部：${tools.length}`;
  const list = $("toolsList");
  list.innerHTML = "";
  if(!tools.length){
    list.innerHTML = `<div class="card"><div class="hint">工具清單目前是 0。請先按「同步工具庫」，再點「查看 API 原始回應」看看回來的是什麼。</div></div>`;
    return;
  }
  if(!filtered.length){
    list.innerHTML = `<div class="card"><div class="hint">有同步到工具，但目前篩選條件下為 0。請清空搜尋/篩選再試。</div></div>`;
    return;
  }

  filtered.forEach(t=>{
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="itemCode">${escapeHtml(t.toolCode)}</div>
          <div class="itemName">${escapeHtml(t.name)}</div>
          <div class="itemMeta">${escapeHtml(t.core || "")}</div>
          <div class="itemMeta">${escapeHtml(t.pain_points || "")}</div>
          <div class="itemMeta">${escapeHtml(t.category || "")}</div>
        </div>
      </div>
      <div class="itemBtns">
        ${t.link ? `<a class="smallBtn" href="${escapeAttr(t.link)}" target="_blank" rel="noopener">開啟工具</a>` : ""}
        <button class="smallBtn" data-use-main="${escapeAttr(t.toolCode)}">設為主工具</button>
        <button class="smallBtn" data-add-side="${escapeAttr(t.toolCode)}">加入副工具</button>
      </div>
    `;
    list.appendChild(el);
  });

  // Bind quick actions
  list.querySelectorAll("[data-use-main]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const code = btn.getAttribute("data-use-main");
      const t = tools.find(x=>x.toolCode===code);
      if(t){ model.main_tool = t; syncToolViews(); toast("已設為主工具"); }
    });
  });
  list.querySelectorAll("[data-add-side]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const code = btn.getAttribute("data-add-side");
      const t = tools.find(x=>x.toolCode===code);
      if(t){
        if(!model.side_tools.some(x=>x.toolCode===code)){
          model.side_tools.push(t);
          syncToolViews();
          toast("已加入副工具");
        }else{
          toast("副工具已存在");
        }
      }
    });
  });

  buildCategoryOptions();
}

function buildCategoryOptions(){
  const cats = uniqBy(tools.map(t=>safeText(t.category)).filter(Boolean), x=>x).sort();
  const sel1 = $("toolCategory");
  const sel2 = $("pickerCategory");
  const baseOpts = `<option value="">全部分類</option>` + cats.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  sel1.innerHTML = baseOpts;
  sel2.innerHTML = baseOpts;
}

function syncToolViews(){
  $("mainToolView").textContent = model.main_tool ? `${model.main_tool.toolCode}｜${model.main_tool.name}` : "（尚未選）";
  $("sideToolView").textContent = model.side_tools.length
    ? model.side_tools.map(t=>`${t.toolCode}｜${t.name}`).join("；")
    : "（尚未選）";
}

function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

function switchTab(tab){
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===tab));
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  $(`tab-${tab}`).classList.add("active");
}

function setState(next){
  state = next;
  $("stateBadge").textContent = next === "idea" ? "發想" : next === "draft" ? "草稿" : "完稿";
  document.querySelectorAll(".pill").forEach(p=>{
    p.classList.toggle("active", p.dataset.state===next);
  });
}

function readIdeaInputs(){
  model.title = safeText($("f_title").value);
  model.audience = safeText($("f_audience").value);
  model.tags = safeText($("f_tags").value);
  model.closing_line = safeText($("f_closing").value);
  model.framework_text = safeText($("f_framework").value);
}

function buildAiPrompt(){
  readIdeaInputs();
  const mainName = model.main_tool?.name || "";
  const mainLink = model.main_tool?.link || "";
  const sideList = model.side_tools.map(t=>`${t.name}｜${t.link}`).join("\n") || "";
  const stateName = state==="idea" ? "發想" : state==="draft" ? "草稿" : "完稿";

  return `你是「天使笑長」的協作夥伴。請用溫柔、清楚、不說教的語氣，幫我把課程從「${stateName}」往下一階段完成。

0｜已輸入資料（請以此為準，不要改名、不重問）
課程名稱：${model.title}
類型：${model.type}
對象：${model.audience}
集數/時長/人數：8集｜${model.duration_min}分鐘｜${model.capacity}人
關鍵痛點/標籤：${model.tags}
主工具：${mainName}｜${mainLink}
副工具：${sideList}
核心流程架構：${model.framework_text}
結尾定錨句：${model.closing_line}

1｜請你輸出三份成果（務必分段標題）
A) 活動/課程規劃（定位、目標、節律、適用場域）
B) 詳細設計內容（每集內容、現場流程、練習、作業）
C) 回饋與追蹤方案（每週追蹤、回饋題、工具使用節律）

2｜依目前狀態輸出格式（很重要）
若 ${stateName}=發想：請先產出「8集一句話大綱」與「最小可行練習」，不要寫太長。
若 ${stateName}=草稿：請補齊每集「目標/工具/練習/作業」，可直接拿去試教。
若 ${stateName}=完稿：請產出「對外提案版」＋「PPT大綱」＋「逐頁講稿」＋「口播稿」＋「演說/主持稿」。

3｜最後請再輸出：表單橫向一列（可貼入）
請依下列表頭輸出一列（用 tab 分隔）：
{id, title, type, status, version, owner, audience, duration_min, capacity, tags, summary, objectives, outline, materials, links, assets, notes, created_at, updated_at}

若 ${stateName}=發想：summary/objectives/outline 可短版
若 ${stateName}=草稿：summary/objectives/outline 完整版
若 ${stateName}=完稿：全部欄位給可上架的定稿版（status 預設 ready）`;
}

function nowISO(){
  const d = new Date();
  return d.toISOString();
}

function buildTSVRow(){
  readIdeaInputs();
  const id = "";
  const status = state==="final" ? "ready" : "";
  const version = "";
  const owner = "";
  const links = [
    model.main_tool?.link ? `${model.main_tool.name}｜${model.main_tool.link}` : "",
    ...model.side_tools.map(t=>`${t.name}｜${t.link}`)
  ].filter(Boolean).join("\n");

  const cols = [
    id, model.title, model.type, status, version, owner, model.audience,
    String(model.duration_min), String(model.capacity), model.tags,
    "", "", model.framework_text, "", links, "", "", nowISO(), nowISO()
  ];
  return cols.join("\t");
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    toast("已複製到剪貼簿");
  }catch(e){
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast("已複製（備援）");
  }
}

function saveLocal(){
  readIdeaInputs();
  const data = {state, model, savedAt: nowISO()};
  localStorage.setItem(CONFIG.lsKey, JSON.stringify(data));
  toast("已存本機草稿");
}
function loadLocal(){
  try{
    const raw = localStorage.getItem(CONFIG.lsKey);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(data?.model){
      model = {...model, ...data.model};
      state = data.state || state;
      applyModelToUI();
      toast("已載入本機草稿");
    }
  }catch(e){}
}

function applyModelToUI(){
  $("f_title").value = model.title || "";
  $("f_audience").value = model.audience || "";
  $("f_tags").value = model.tags || "";
  $("f_closing").value = model.closing_line || "";
  $("f_framework").value = model.framework_text || "";
  syncToolViews();
  setState(state);
}

function exportJSON(){
  readIdeaInputs();
  const payload = {state, model, toolsCount: tools.length, exportedAt: nowISO()};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `angel-course-workbench-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function openModal(id){ $(id).classList.remove("hidden"); }
function closeModal(id){ $(id).classList.add("hidden"); }

function openPicker(mode){
  pickerMode = mode; // main or side
  if(!tools.length){
    toast("工具庫是空的：請先去同步工具庫");
    switchTab("tools");
    return;
  }
  $("pickerTitle").textContent = mode === "main" ? "選主工具（單選）" : "選副工具（多選）";
  $("pickerSearch").value = "";
  $("pickerPrefix").value = "";
  $("pickerCategory").value = "";
  renderPicker();
  openModal("pickerModal");
}

function renderPicker(){
  const q = safeText($("pickerSearch").value).toLowerCase();
  const prefix = $("pickerPrefix").value;
  const cat = $("pickerCategory").value;

  const filtered = tools.filter(t=>{
    if(t.status && t.status.toLowerCase() !== "active") return false;
    if(prefix && t.prefix !== prefix) return false;
    if(cat && safeText(t.category) !== cat) return false;
    if(!q) return true;
    const hay = `${t.toolCode} ${t.name} ${t.core} ${t.pain_points} ${t.category}`.toLowerCase();
    return hay.includes(q);
  });

  const list = $("pickerList");
  list.innerHTML = "";
  if(!filtered.length){
    list.innerHTML = `<div class="hint">找不到符合的工具（請清空搜尋/篩選）</div>`;
    return;
  }

  filtered.forEach(t=>{
    const checked = (pickerMode==="main")
      ? (model.main_tool?.toolCode === t.toolCode)
      : (model.side_tools.some(x=>x.toolCode===t.toolCode));

    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="itemCode">${escapeHtml(t.toolCode)}</div>
          <div class="itemName">${escapeHtml(t.name)}</div>
          <div class="itemMeta">${escapeHtml(t.core || "")}</div>
          <div class="itemMeta">${escapeHtml(t.category || "")}</div>
        </div>
        <div><input type="${pickerMode==="main"?"radio":"checkbox"}" name="pick" ${checked?"checked":""} /></div>
      </div>
    `;
    row.addEventListener("click", (e)=>{
      const input = row.querySelector("input");
      if(!input) return;
      if(pickerMode==="main"){
        model.main_tool = t;
        // 切換 radio
        document.querySelectorAll("#pickerList input[type=radio]").forEach(x=>x.checked=false);
        input.checked = true;
      }else{
        input.checked = !input.checked;
        if(input.checked){
          if(!model.side_tools.some(x=>x.toolCode===t.toolCode)) model.side_tools.push(t);
        }else{
          model.side_tools = model.side_tools.filter(x=>x.toolCode!==t.toolCode);
        }
      }
      syncToolViews();
    });
    list.appendChild(row);
  });
}

function importTSVApply(){
  const txt = $("importText").value;
  const rows = parseTSVText(txt);
  if(!rows.length){
    toast("TSV 解析失敗：請確認含表頭且用 tab 分隔");
    return;
  }
  const norm = rows.map(normalizeTool).filter(t=>t.toolCode && t.name);
  tools = uniqBy(norm, t=>t.toolCode);
  localStorage.setItem(CONFIG.lsTools, JSON.stringify({savedAt:nowISO(), tools}));
  buildCategoryOptions();
  renderTools();
  toast(`已匯入：${tools.length} 筆`);
  closeModal("importModal");
}

async function syncTools(){
  toast("同步中…");
  const ret = await fetchToolsFromApi();
  if(!ret.ok){
    $("toolsCount").textContent = "同步失敗或解析為 0 筆";
    // 仍嘗試使用本機快取
    const cached = localStorage.getItem(CONFIG.lsTools);
    if(cached){
      try{
        const obj = JSON.parse(cached);
        if(obj?.tools?.length){
          tools = obj.tools;
          buildCategoryOptions();
          renderTools();
          toast(`API 解析為 0，已改用本機快取：${tools.length} 筆`);
          return;
        }
      }catch(e){}
    }
    toast("API 解析為 0：請開「API 原始回應」截圖給我");
    return;
  }
  tools = ret.tools;
  localStorage.setItem(CONFIG.lsTools, JSON.stringify({savedAt:nowISO(), tools}));
  buildCategoryOptions();
  renderTools();
  toast(`✅ 工具庫已同步：${tools.length} 筆`);
}

function bind(){
  // Tabs
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>switchTab(btn.dataset.tab));
  });

  // State pills
  document.querySelectorAll(".pill").forEach(btn=>{
    btn.addEventListener("click", ()=>setState(btn.dataset.state));
  });

  // Workbench buttons
  $("btnPickMain").addEventListener("click", ()=>openPicker("main"));
  $("btnPickSide").addEventListener("click", ()=>openPicker("side"));
  $("pickerClose").addEventListener("click", ()=>closeModal("pickerModal"));
  $("pickerConfirm").addEventListener("click", ()=>{ closeModal("pickerModal"); toast("已套用工具"); });

  $("pickerSearch").addEventListener("input", renderPicker);
  $("pickerPrefix").addEventListener("change", renderPicker);
  $("pickerCategory").addEventListener("change", renderPicker);

  $("btnCopyAI").addEventListener("click", ()=>copyText(buildAiPrompt()));
  $("btnCopyTSV").addEventListener("click", ()=>copyText(buildTSVRow()));
  $("btnSaveLocal").addEventListener("click", saveLocal);
  $("btnExportJSON").addEventListener("click", exportJSON);

  $("btnToDraft").addEventListener("click", ()=>{
    // 簡單門檻
    readIdeaInputs();
    if(!model.title){ toast("先填課名"); return; }
    if(!model.audience){ toast("先填對象"); return; }
    setState("draft");
    toast("已進草稿（下一步會補上草稿四步驟）");
  });

  $("btnResetIdea").addEventListener("click", ()=>{
    $("f_title").value = "";
    $("f_audience").value = "";
    $("f_tags").value = "";
    $("f_closing").value = "";
    $("f_framework").value = "";
    model.main_tool = null;
    model.side_tools = [];
    syncToolViews();
    toast("已清空發想欄位");
  });

  // Tools page
  $("btnSyncTools").addEventListener("click", syncTools);
  $("toolSearch").addEventListener("input", renderTools);
  $("toolPrefix").addEventListener("change", renderTools);
  $("toolCategory").addEventListener("change", renderTools);

  // Debug
  $("btnOpenDebug").addEventListener("click", ()=>{
    $("debugText").value = lastToolsRaw || "(尚未拉取 API。請先按「同步工具庫」。)";
    openModal("debugModal");
  });
  $("debugClose").addEventListener("click", ()=>closeModal("debugModal"));
  $("debugCopy").addEventListener("click", ()=>copyText($("debugText").value));

  // Import TSV
  $("btnOpenImport").addEventListener("click", ()=>openModal("importModal"));
  $("importClose").addEventListener("click", ()=>closeModal("importModal"));
  $("importApply").addEventListener("click", importTSVApply);

  // Settings button (暫留)
  $("btnSettings").addEventListener("click", ()=>{
    toast("設定：下一步會把 API URL、版本號、快取清除放進來");
  });

  // Close modal by tapping background
  ["pickerModal","debugModal","importModal"].forEach(id=>{
    $(id).addEventListener("click", (e)=>{
      if(e.target === $(id)) closeModal(id);
    });
  });
}

function tryLoadToolsCache(){
  const cached = localStorage.getItem(CONFIG.lsTools);
  if(!cached) return;
  try{
    const obj = JSON.parse(cached);
    if(obj?.tools?.length){
      tools = obj.tools;
      buildCategoryOptions();
      renderTools();
      toast(`已載入工具快取：${tools.length} 筆`);
    }
  }catch(e){}
}

(function init(){
  bind();
  loadLocal();
  tryLoadToolsCache();
  setState("idea");
  renderTools();
})();
