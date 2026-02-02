
// Angel Course Workbench v4
// Fixes:
// 1) Tool library sync is global (fetch once, cache, shared across states)
// 2) Idea stage includes course kind + rhythm (dropdown + dynamic fields)
// 3) Idea & Draft AI prompts both request full course plan incl. materials + homework
// 4) TSV copy auto-cleans line breaks
// 5) API write: best-effort; fallback to TSV (auto copy)

const TOOL_API = "https://script.google.com/macros/s/AKfycbwecHTILAMuk5Izr_yF9wfce_qNjxuy28XuvpDzK0LZ4Wszmw7zI3xve8jeLghzveWbXA/exec";
const COURSE_API = "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec";

const LS_KEY = "angel_course_workbench_v4";
const LS_TOOLS_KEY = "angel_tools_cache_v2";
const LS_TOOLS_AT = "angel_tools_cache_at_v2";

const STATE_LABEL = { idea: "發想", draft: "草稿", final: "完稿" };
const SHEET_MAP  = { idea: "發想", draft: "草稿", final: "幸福教養課程管理" };

const HEADERS = ["id","title","type","status","version","owner","audience","duration_min","capacity","tags","summary","objectives","outline","materials","links","assets","notes","created_at","updated_at"];

const $ = (id) => document.getElementById(id);

function nowISO(){ return new Date().toISOString(); }
function toast(msg){
  const t = $("toast");
  if(!t) return;
  t.textContent = msg;
  window.clearTimeout(toast._tm);
  toast._tm = window.setTimeout(()=> t.textContent="", 1800);
}
function esc(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }
function cleanForTSV(s){
  // user request: auto clean line breaks when copy
  return String(s??"")
    .replace(/\r\n/g,"\n")
    .replace(/[\r\n]+/g," ⏎ ")
    .replace(/\t/g,"  "); // keep tsv safe
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
    duration_min: "120",    // single session minutes or single event minutes
    capacity: "20",
    tags: "",
    summary: "",
    objectives: "",
    outline: "",
    materials: "",
    links: "",
    assets: "",
    notes: "",
    created_at: "",
    updated_at: "",

    // Idea / structure
    course_kind: "module", // module/lecture/class/activity/other
    course_kind_other: "",
    sessions_count: "8",   // module sessions
    per_session_min: "120",
    days: "1",
    hours_total: "2",
    closing_line: "",
    framework_text: "",
    rhythm_text: "",

    // tools
    main_tool_code: "",
    main_tool_name: "",
    main_tool_link: "",
    sub_tools: [] // [{toolCode,name,link,category}]
  };
}

function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return defaultModel();
    const m = Object.assign(defaultModel(), JSON.parse(raw));
    return m;
  }catch(_){ return defaultModel(); }
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

/* -------------------- Tool library (global) -------------------- */
let tools = [];
let toolsReady = false;

function normalizeToolObject(raw){
  if(!raw || typeof raw !== "object") return { toolCode:"", name:"", link:"", category:"", status:"", raw };
  const toolCode = raw.toolCode ?? raw.code ?? raw.id ?? raw.tool_id ?? "";
  const name = raw.name ?? raw.title ?? raw.toolName ?? "";
  const link = raw.link ?? raw.url ?? raw.href ?? "";
  const category = raw.category ?? raw.type ?? raw.class ?? "";
  const status = raw.status ?? "";
  const tags = raw.tags ?? raw.keyword ?? raw.keywords ?? "";
  const core = raw.core ?? raw.summary ?? raw.desc ?? "";
  const pain = raw.pain_points ?? raw.painPoints ?? raw.pain ?? "";
  return { toolCode, name, link, category, status, tags, core, pain, raw };
}

function rowsToObjects(headers, rows){
  const hs = (headers||[]).map(h=>String(h||"").trim());
  return (rows||[]).map(r=>{
    const obj = {};
    if(Array.isArray(r)){
      hs.forEach((h,i)=> obj[h] = r[i]);
    }else if(typeof r==="object" && r){
      // sometimes row is already object
      Object.assign(obj, r);
    }
    return obj;
  });
}

function extractArrayFromAnyPayload(j){
  if(!j) return [];
  // direct array
  if(Array.isArray(j)) return j;
  // common wrappers
  if(Array.isArray(j.data)) return j.data;
  if(Array.isArray(j.items)) return j.items;
  if(Array.isArray(j.rows) && Array.isArray(j.headers)){
    return rowsToObjects(j.headers, j.rows);
  }
  if(j.data && Array.isArray(j.data.rows) && Array.isArray(j.data.headers)){
    return rowsToObjects(j.data.headers, j.data.rows);
  }
  // Google Visualization style? {table:{cols, rows}}
  if(j.table && Array.isArray(j.table.rows) && Array.isArray(j.table.cols)){
    const headers = j.table.cols.map(c=>c.label||c.id||"");
    const rows = j.table.rows.map(rr=> rr.c ? rr.c.map(c=>c ? c.v : "") : []);
    return rowsToObjects(headers, rows);
  }
  return [];
}

function loadToolsCache(){
  try{
    const raw = localStorage.getItem(LS_TOOLS_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return (arr||[]).map(normalizeToolObject).filter(t=>t.toolCode||t.name);
  }catch(_){ return []; }
}
function saveToolsCache(list){
  try{
    localStorage.setItem(LS_TOOLS_KEY, JSON.stringify(list.map(t=>t.raw ?? t)));
    localStorage.setItem(LS_TOOLS_AT, nowISO());
  }catch(_){}
}

async function syncToolsOnce(force=false){
  // already ready and not forcing
  if(toolsReady && !force) return;
  // try cache first so UI never empty
  tools = loadToolsCache();
  if(tools.length){
    toolsReady = true;
    renderToolLists(); // can render immediately
  }

  try{
    const res = await fetch(TOOL_API, { method:"GET", cache:"no-store" });
    const text = await res.text();
    let j = null;
    try{ j = JSON.parse(text); }catch(_){ j = null; }
    const arr = extractArrayFromAnyPayload(j);
    const normalized = arr.map(normalizeToolObject).filter(t=>t.toolCode||t.name);
    if(normalized.length){
      tools = normalized;
      saveToolsCache(normalized);
      toolsReady = true;
      toast(`工具庫已更新 ✓（${tools.length}）`);
      renderToolLists();
      return;
    }
    // if API returns plain text, keep cache
    if(tools.length){
      toolsReady = true;
      toast(`工具庫快取 ✓（${tools.length}）`);
    }else{
      toast("工具庫同步失敗（API 回傳格式不符）");
    }
  }catch(err){
    if(tools.length){
      toolsReady = true;
      toast(`工具庫離線快取 ✓（${tools.length}）`);
    }else{
      toast("工具庫同步失敗（網路/權限）");
    }
  }
}

/* -------------------- UI rendering -------------------- */
function setDot(dot, status){
  dot.classList.remove("ok","doing","todo");
  dot.classList.add(status);
}
function computeDone(){
  const ideaDone = !!model.title && !!model.audience && !!model.tags && !!model.closing_line;
  const draftDone = !!model.objectives && !!model.outline && !!model.materials;
  const finalDone = !!model.summary && !!model.outline && !!model.materials;
  return { ideaDone, draftDone, finalDone };
}
function renderProgress(){
  const { ideaDone, draftDone, finalDone } = computeDone();
  setDot($("dotIdea"), ideaDone ? "ok" : (model.state==="idea" ? "doing":"todo"));
  setDot($("dotDraft"), draftDone ? "ok" : (model.state==="draft" ? "doing":"todo"));
  setDot($("dotFinal"), finalDone ? "ok" : (model.state==="final" ? "doing":"todo"));
  $("stateLabel").textContent = STATE_LABEL[model.state];
  $("stateLabelBottom").textContent = STATE_LABEL[model.state];
  $("apiHint").textContent = `送出會寫入：${SHEET_MAP[model.state]}（若 API 失敗，你仍可用 TSV 貼回表格）`;
}

function stepCard(title, sub, inner){
  const sec = document.createElement("section");
  sec.className = "step open";
  sec.innerHTML = `
    <div class="step-hd" role="button" tabindex="0">
      <div>
        <div class="step-title">${esc(title)}</div>
        <div class="step-sub">${esc(sub||"")}</div>
      </div>
      <div class="chev">⌄</div>
    </div>
    <div class="step-bd">${inner}</div>
  `;
  const hd = sec.querySelector(".step-hd");
  const toggle = ()=> sec.classList.toggle("open");
  hd.addEventListener("click", toggle);
  hd.addEventListener("keydown", (e)=>{ if(e.key==="Enter"||e.key===" ") toggle(); });
  return sec;
}

function kindLabel(){
  const map = { module:"模組課程", lecture:"演講", class:"單場課程", activity:"單場活動", other:"其他" };
  const k = model.course_kind || "module";
  return k==="other" ? (model.course_kind_other || "其他") : (map[k]||k);
}

function renderSteps(){
  const area = $("stepsArea");
  area.innerHTML = "";

  if(model.state==="idea"){
    // I-1 definition + kind/rhythm
    const kindSelect = `
      <div class="field">
        <label>課程形式（下拉選單）</label>
        <select id="i_kind">
          <option value="lecture"${model.course_kind==="lecture"?" selected":""}>演講</option>
          <option value="module"${model.course_kind==="module"?" selected":""}>模組課程</option>
          <option value="class"${model.course_kind==="class"?" selected":""}>單場課程</option>
          <option value="activity"${model.course_kind==="activity"?" selected":""}>單場活動</option>
          <option value="other"${model.course_kind==="other"?" selected":""}>其他（手動輸入）</option>
        </select>
      </div>
      <div class="field" id="i_kind_other_wrap" style="display:${model.course_kind==="other"?"block":"none"}">
        <label>其他形式（手動輸入）</label>
        <input id="i_kind_other" placeholder="例如：線上直播／工作坊／親師座談…" value="${esc(model.course_kind_other)}"/>
      </div>
    `;

    const rhythmBlock = `
      <div class="grid two">
        <div class="field" id="i_single_wrap" style="display:${model.course_kind==="module"?"none":"block"}">
          <label>時間｜單場（分鐘，自填）</label>
          <input id="i_single_min" placeholder="例如 60 / 90 / 120" value="${esc(model.duration_min)}" />
        </div>
        <div class="field" id="i_capacity_wrap">
          <label>人數（capacity）</label>
          <input id="i_capacity" placeholder="例如 20" value="${esc(model.capacity)}"/>
        </div>
      </div>

      <div class="grid two" id="i_module_wrap" style="display:${model.course_kind==="module"?"grid":"none"}">
        <div class="field">
          <label>模組｜幾堂</label>
          <input id="i_sessions" placeholder="例如 6 / 8 / 10" value="${esc(model.sessions_count)}"/>
        </div>
        <div class="field">
          <label>模組｜每堂時間（分鐘，自填）</label>
          <input id="i_per_session" placeholder="例如 90 / 120" value="${esc(model.per_session_min)}"/>
        </div>
      </div>

      <div class="grid two" id="i_days_hours_wrap" style="display:${model.course_kind==="module"?"grid":"none"}">
        <div class="field">
          <label>模組｜天數（可填 1）</label>
          <input id="i_days" placeholder="1" value="${esc(model.days)}"/>
        </div>
        <div class="field">
          <label>模組｜總時數（小時，自填）</label>
          <input id="i_hours_total" placeholder="例如 6 / 12" value="${esc(model.hours_total)}"/>
        </div>
      </div>

      <div class="field">
        <label>節律/結構提醒（可簡短）</label>
        <textarea id="i_rhythm" placeholder="例如：每堂 10暖身→30核心→30練習→20作業/回饋">${esc(model.rhythm_text)}</textarea>
      </div>
    `;

    const card1 = stepCard("I-1｜一句話定義 + 形式與節律", "先把骨架站穩：這堂課是什麼、為誰做、怎麼走", `
      <div class="field">
        <label>課名（title）</label>
        <input id="i_title" placeholder="例如：幸福教養｜情緒急救到關係修復" value="${esc(model.title)}"/>
      </div>
      <div class="grid two">
        <div class="field">
          <label>對象（audience）</label>
          <input id="i_audience" placeholder="親子 / 家長 / 老師 / 青少年…" value="${esc(model.audience)}"/>
        </div>
        <div class="field">
          <label>關鍵痛點/標籤（tags）</label>
          <input id="i_tags" placeholder="#情緒很滿 #親子卡住 #反應太快…" value="${esc(model.tags)}"/>
        </div>
      </div>
      <div class="grid two">
        <div class="field">
          <label>類型/平台（type）</label>
          <input id="i_type" placeholder="現場 / 線上 / 校園 / 親子活動…" value="${esc(model.type)}"/>
        </div>
        <div class="field">
          <label>版本（version）</label>
          <input id="i_version" placeholder="v1 / v1.1" value="${esc(model.version)}"/>
        </div>
      </div>
      ${kindSelect}
      ${rhythmBlock}
    `);

    const card2 = stepCard("I-2｜結果感（結尾定錨句）", "一句話把幸福感鎖回來", `
      <div class="field">
        <label>closing_line（結尾一句話）</label>
        <textarea id="i_closing" placeholder="例如：孩子不需要你完美，他需要你回得來。">${esc(model.closing_line)}</textarea>
      </div>
    `);

    const card3 = stepCard("I-3｜工具配方（勾選）", "主工具單選 / 副工具多選（全工作台共用同一份工具庫）", toolPickerHtml());

    const card4 = stepCard("I-4｜粗架構", "先有骨架，再往下長（這裡可寫得很短）", `
      <div class="field">
        <label>核心流程架構（framework_text）</label>
        <textarea id="i_framework" placeholder="例如：情緒急救→翻譯行為→關係修復→帶回日常">${esc(model.framework_text)}</textarea>
      </div>
      <div class="field" id="i_outline_wrap">
        <label>${model.course_kind==="module" ? "模組：每堂一句話大綱" : "單場：流程大綱（段落即可）"}</label>
        <textarea id="i_outline" placeholder="${model.course_kind==="module" ? "第1堂…\n第2堂…\n（寫到幾堂即可）" : "開場→情緒急救→核心活動→帶回日常→收束"}">${esc(model.outline)}</textarea>
      </div>
      <div class="row">
        <button class="btn" id="btnToDraft">進草稿 →</button>
      </div>
    `);

    area.append(card1, card2, card3, card4);

  } else if(model.state==="draft"){
    const card1 = stepCard("D-1｜目標與節律", "可試教版本：把目的、節律、作業感建立起來", `
      <div class="field">
        <label>objectives（條列）</label>
        <textarea id="d_objectives" placeholder="• 學會 30 秒急救\n• 能說出一段不傷人的回話…">${esc(model.objectives)}</textarea>
      </div>
      <div class="field">
        <label>節律補充（承接發想，可再細一點）</label>
        <textarea id="d_rhythm" placeholder="例如：每堂 10暖身→30核心→30練習→20作業/回饋">${esc(model.rhythm_text)}</textarea>
      </div>
      <div class="mini">形式：${esc(kindLabel())}｜模組堂數：${esc(model.sessions_count)}｜每堂分鐘：${esc(model.per_session_min)}｜單場分鐘：${esc(model.duration_min)}</div>
    `);

    const card2 = stepCard("D-2｜詳細設計內容", "每堂/單場：目標→工具→練習→作業（可直接試教）", `
      <div class="field">
        <label>outline（可直接試教版）</label>
        <textarea id="d_outline" placeholder="第1堂：目標… 工具… 練習… 作業…\n第2堂：...">${esc(model.outline)}</textarea>
      </div>
    `);

    const card3 = stepCard("D-3｜教材與作業清單", "你要的：教材＋作業內容（草稿也要完整）", `
      <div class="field">
        <label>materials（教材/講義/提醒卡/PPT）</label>
        <textarea id="d_materials" placeholder="• PPT：…\n• 練習單：…\n• 作業卡：…">${esc(model.materials)}</textarea>
      </div>
      <div class="field">
        <label>notes（作業/交付物補充）</label>
        <textarea id="d_notes" placeholder="每週作業說明、結業小抄、交付物格式…">${esc(model.notes)}</textarea>
      </div>
    `);

    const card4 = stepCard("D-4｜工具與連結整理", "主/副工具已選就會自動整理 links", `
      ${toolSummaryHtml()}
      <div class="row">
        <button class="btn" id="btnToFinal">進完稿 →</button>
      </div>
    `);

    area.append(card1, card2, card3, card4);

  } else {
    const card1 = stepCard("F-1｜對外提案版文案", "完稿：可對外、可上架、可進正式表", `
      <div class="field">
        <label>summary（對外版）</label>
        <textarea id="f_summary" placeholder="對外介紹：這堂課解決什麼、適合誰、帶走什麼">${esc(model.summary)}</textarea>
      </div>
      <div class="field">
        <label>objectives（對外可讀版）</label>
        <textarea id="f_objectives" placeholder="• …">${esc(model.objectives)}</textarea>
      </div>
    `);
    const card2 = stepCard("F-2｜設計定稿", "把 outline/materials/links 整理成可交付版本", `
      <div class="field">
        <label>outline（正式版）</label>
        <textarea id="f_outline" placeholder="">${esc(model.outline)}</textarea>
      </div>
      <div class="field">
        <label>materials（清單）</label>
        <textarea id="f_materials" placeholder="">${esc(model.materials)}</textarea>
      </div>
      <div class="field">
        <label>links（工具連結整理）</label>
        <textarea id="f_links" placeholder="">${esc(model.links)}</textarea>
      </div>
    `);
    const card3 = stepCard("F-3｜製作物清單（可全要）", "PPT 大綱／逐頁講稿／口播稿／主持稿…先列清單即可", `
      <div class="field">
        <label>assets（檔案清單）</label>
        <textarea id="f_assets" placeholder="PPT、講稿、口播稿、海報、報名表…">${esc(model.assets)}</textarea>
      </div>
    `);
    const card4 = stepCard("F-4｜確認與封存", "status 預設 ready（保守）", `
      <div class="grid two">
        <div class="field">
          <label>status</label>
          <input id="f_status" value="${esc(model.status||"ready")}" />
        </div>
        <div class="field">
          <label>notes</label>
          <input id="f_notes" value="${esc(model.notes)}" placeholder="備註/封存"/>
        </div>
      </div>
      ${toolSummaryHtml()}
    `);
    area.append(card1, card2, card3, card4);
  }

  bindStepInputs();
}

function toolSummaryHtml(){
  const main = model.main_tool_name ? `${esc(model.main_tool_name)}｜${esc(model.main_tool_link)}` : "（尚未選）";
  const subs = (model.sub_tools||[]).map(t=>`${esc(t.name)}｜${esc(t.link)}`).join("\n");
  return `
    <div class="field">
      <label>主工具</label>
      <textarea readonly>${main}</textarea>
    </div>
    <div class="field">
      <label>副工具</label>
      <textarea readonly>${subs}</textarea>
    </div>
  `;
}

function toolPickerHtml(){
  return `
    <div class="tool-box">
      <div class="grid two">
        <div class="field">
          <label>搜尋</label>
          <input id="toolSearch" placeholder="輸入關鍵字：MIX / 五感 / 情緒…" />
        </div>
        <div class="field">
          <label>前綴</label>
          <select id="toolPrefix">
            <option value="ALL">全部</option>
            <option value="MIX">MIX</option>
            <option value="EQ">EQ</option>
            <option value="COM">COM</option>
            <option value="ACT">ACT</option>
            <option value="REL">REL</option>
            <option value="KIDS">KIDS</option>
          </select>
        </div>
      </div>
      <div class="grid two">
        <div class="field">
          <label>分類</label>
          <select id="toolCategory"><option value="ALL">全部</option></select>
        </div>
        <div class="mini" id="toolStatusMini">（工具庫：尚未同步）</div>
      </div>

      <div class="tool-lists">
        <div class="tool-col">
          <div class="tool-title">主工具（單選）</div>
          <div id="mainToolList" class="tool-list"></div>
        </div>
        <div class="tool-col">
          <div class="tool-title">副工具（多選）</div>
          <div id="subToolList" class="tool-list"></div>
        </div>
      </div>
    </div>
  `;
}

function filterTools(all, q, prefix, category){
  const qq = (q||"").trim().toLowerCase();
  return (all||[]).filter(t=>{
    if(t.status && String(t.status).toLowerCase()!=="active") return false;
    const hay = [t.toolCode,t.name,t.category,t.tags,t.core,t.pain,t.link].join(" ").toLowerCase();
    const okQ = !qq || hay.includes(qq);
    const okPrefix = (prefix==="ALL") || (String(t.toolCode||"").toUpperCase().startsWith(prefix));
    const okCat = (category==="ALL") || (String(t.category||"")===category);
    return okQ && okPrefix && okCat;
  });
}

function toolItemHtml(t, mode){
  const code = esc(t.toolCode||"");
  const name = esc(t.name||"");
  const cat = esc(t.category||"");
  const link = esc(t.link||"");
  const key = mode==="main" ? "main" : "sub";
  const checkedMain = (mode==="main" && model.main_tool_code===t.toolCode) ? "checked" : "";
  const checkedSub = (mode==="sub" && (model.sub_tools||[]).some(x=>x.toolCode===t.toolCode)) ? "checked" : "";
  const input = mode==="main"
    ? `<input type="radio" name="mainTool" ${checkedMain} data-toolcode="${code}" data-name="${name}" data-link="${link}" data-category="${cat}">`
    : `<input type="checkbox" ${checkedSub} data-toolcode="${code}" data-name="${name}" data-link="${link}" data-category="${cat}">`;
  return `
    <label class="tool-item">
      ${input}
      <div>
        <div class="t">${code}｜${name}</div>
        <div class="m">${cat}${link?`｜${link}`:""}</div>
      </div>
    </label>
  `;
}

function renderToolLists(){
  const all = toolsReady ? tools : loadToolsCache();
  const statusMini = $("toolStatusMini");
  if(statusMini){
    statusMini.textContent = all.length ? `（工具庫：${all.length}）` : "（工具庫：尚未同步）";
  }
  const q = $("toolSearch")?.value || "";
  const prefix = $("toolPrefix")?.value || "ALL";
  const cat = $("toolCategory")?.value || "ALL";

  // update category options once (from full list)
  const catSel = $("toolCategory");
  if(catSel && catSel.options.length<=1){
    const cats = Array.from(new Set(all.map(t=>t.category).filter(Boolean))).sort();
    cats.forEach(c=>{
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      catSel.appendChild(opt);
    });
  }

  const list = filterTools(all, q, prefix, cat).slice(0, 80);
  $("mainToolList").innerHTML = list.map(t=>toolItemHtml(t,"main")).join("") || `<div class="mini">（找不到）</div>`;
  $("subToolList").innerHTML  = list.map(t=>toolItemHtml(t,"sub")).join("")  || `<div class="mini">（找不到）</div>`;

  $("mainToolList").querySelectorAll("input[type=radio]").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      model.main_tool_code = inp.dataset.toolcode||"";
      model.main_tool_name = inp.dataset.name||"";
      model.main_tool_link = inp.dataset.link||"";
      rebuildLinksFromTools();
      saveLocal(true);
      toast("主工具已選 ✓");
    });
  });
  $("subToolList").querySelectorAll("input[type=checkbox]").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      const toolCode = inp.dataset.toolcode||"";
      const tool = { toolCode, name: inp.dataset.name||"", link: inp.dataset.link||"", category: inp.dataset.category||"" };
      const arr = model.sub_tools||[];
      const exists = arr.some(x=>x.toolCode===toolCode);
      if(inp.checked && !exists) arr.push(tool);
      if(!inp.checked && exists) model.sub_tools = arr.filter(x=>x.toolCode!==toolCode);
      else model.sub_tools = arr;
      rebuildLinksFromTools();
      saveLocal(true);
      toast("副工具已更新 ✓");
    });
  });
}

function rebuildLinksFromTools(){
  const lines = [];
  if(model.main_tool_name && model.main_tool_link){
    lines.push(`${model.main_tool_name}｜${model.main_tool_link}`);
  }
  (model.sub_tools||[]).forEach(t=>{
    if(t.name && t.link) lines.push(`${t.name}｜${t.link}`);
  });
  // merge with existing manual links (keep)
  const manual = String(model.links||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const merged = Array.from(new Set([...lines, ...manual]));
  model.links = merged.join("\n");
}

/* -------------------- Build row object / TSV -------------------- */
function buildMetaNotes(){
  // store extended structure without changing headers
  const meta = {
    kind: kindLabel(),
    sessions_count: model.sessions_count,
    per_session_min: model.per_session_min,
    single_min: model.duration_min,
    days: model.days,
    hours_total: model.hours_total,
    rhythm: model.rhythm_text
  };
  const metaLine = "[meta] " + JSON.stringify(meta);
  const old = String(model.notes||"").split(/\r?\n/).filter(l=>!l.startsWith("[meta]"));
  return [metaLine, ...old].join("\n").trim();
}

function buildRowObject(){
  ensureId();
  if(!model.created_at) model.created_at = nowISO();
  model.updated_at = nowISO();

  const row = {
    id: model.id,
    title: model.title,
    type: model.type,
    status: (model.state==="final") ? (model.status||"ready") : (model.state==="draft" ? "draft" : "idea"),
    version: model.version,
    owner: model.owner,
    audience: model.audience,
    duration_min: (model.course_kind==="module" ? (model.per_session_min||model.duration_min) : (model.duration_min||"")),
    capacity: model.capacity,
    tags: model.tags,
    summary: model.summary,
    objectives: model.objectives,
    outline: model.outline,
    materials: model.materials,
    links: model.links,
    assets: model.assets,
    notes: buildMetaNotes(),
    created_at: model.created_at,
    updated_at: model.updated_at
  };
  return row;
}

function buildTSVRow(){
  const row = buildRowObject();
  const cells = HEADERS.map(h => cleanForTSV(row[h] ?? ""));
  return cells.join("\t");
}

/* -------------------- Copy helpers -------------------- */
async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(_){
    // fallback
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    }catch(_2){ return false; }
  }
}

/* -------------------- AI prompt -------------------- */
function toolListWithLinks(){
  const list = (model.sub_tools||[])
    .map(t=>`${t.name||""}｜${t.link||""}`.trim())
    .filter(Boolean)
    .join("\n");
  return list;
}

function makeAiPrompt(){
  const stateName = STATE_LABEL[model.state];
  const kind = kindLabel();
  const sessionsInfo = (model.course_kind==="module")
    ? `${model.sessions_count}堂｜每堂${model.per_session_min}分鐘｜天數${model.days}｜總時數${model.hours_total}小時`
    : `單場${model.duration_min}分鐘`;
  const toolList = toolListWithLinks();

  const stateHint =
    model.state==="idea"
      ? "你正在從『發想』往『草稿』：請把骨架補成可試教版本，並同時補齊教材與作業（可先給最小可行版）。"
      : (model.state==="draft"
          ? "你正在從『草稿』往『完稿』：請把內容改成可對外提案/可上架的定稿版，教材與作業要完整清楚。"
          : "你已在『完稿』：請輸出可直接交付的成品，並整理檔案清單。");

  const stateFormat =
    model.state==="idea"
      ? "若狀態=發想：請先產出『模組每堂/單場流程大綱』＋『每堂/單場練習與作業（最小可行版）』＋『教材清單（最小可行版）』。"
      : (model.state==="draft"
          ? "若狀態=草稿：請補齊每堂/單場『目標/工具/練習/作業』，並給出可直接試教的教材清單與作業說明。"
          : "若狀態=完稿：請產出『對外提案版』＋『PPT大綱』＋『逐頁講稿』＋『口播稿』＋『演說/主持稿』。");

  return `你是「天使笑長」的協作夥伴。請用溫柔、清楚、不說教的語氣，幫我把課程從「${stateName}」往下一階段完成。\n\n` +
`0｜已輸入資料（請以此為準，不要改名、不重問）\n` +
`課程名稱：${model.title}\n` +
`類型：${model.type}\n` +
`對象：${model.audience}\n` +
`形式：${kind}\n` +
`集數/時數/人數：${sessionsInfo}｜${model.capacity}人\n` +
`關鍵痛點/標籤：${model.tags}\n` +
`主工具：${model.main_tool_name}｜${model.main_tool_link}\n` +
`副工具：${toolList}\n` +
`核心流程架構：${model.framework_text}\n` +
`結尾定錨句：${model.closing_line}\n\n` +
`★ 提醒：${stateHint}\n\n` +
`1｜請你輸出三份成果（務必分段標題；教材＋作業要完整）\n` +
`A) 活動/課程規劃（定位、目標、節律、適用場域）\n` +
`B) 詳細設計內容（每堂/單場內容、現場流程、練習、作業）\n` +
`C) 教材與作業包（教材清單＋作業說明＋交付物格式）\n\n` +
`2｜依目前狀態輸出格式（很重要）\n` +
`${stateFormat}\n\n` +
`3｜最後請再輸出：表單橫向一列（可貼入）\n` +
`請依下列表頭輸出一列（用 tab 分隔）：\n` +
`{id, title, type, status, version, owner, audience, duration_min, capacity, tags, summary, objectives, outline, materials, links, assets, notes, created_at, updated_at}\n\n` +
`若狀態=發想：summary/objectives/outline 可短版，但教材與作業仍要有（最小可行版）。\n` +
`若狀態=草稿：summary/objectives/outline 完整可試教版，教材與作業完整。\n` +
`若狀態=完稿：全部欄位給可上架的定稿版（status 預設 ready）。\n`;
}
/* -------------------- API write / list load -------------------- */
async function tryPostJSON(payload){
  return fetch(COURSE_API, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
}
async function tryPostForm(payload){
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([k,v])=> params.set(k, typeof v==="string" ? v : JSON.stringify(v)));
  return fetch(COURSE_API, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body: params.toString() });
}
async function tryGet(payload){
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([k,v])=> params.set(k, typeof v==="string" ? v : JSON.stringify(v)));
  return fetch(COURSE_API + "?" + params.toString(), { method:"GET" });
}

async function sendToApi(){
  const sheet = SHEET_MAP[model.state];
  const rowObj = buildRowObject();
  const payloads = [
    { action:"append", sheet, row: rowObj },
    { action:"appendRow", sheet, row: rowObj },
    { action:"add", sheet, data: rowObj },
    { sheet, row: rowObj },
    { tab: sheet, row: rowObj }
  ];

  toast("送出中…");
  for(const p of payloads){
    for(const fn of [tryPostJSON, tryPostForm, tryGet]){
      try{
        const res = await fn(p);
        if(res && res.ok){
          toast("已寫入試算表 ✓");
          return true;
        }
      }catch(_){}
    }
  }

  toast("自動寫入失敗，已複製 TSV，請貼上");
  await copyText(buildTSVRow());
  return false;
}

function normalizeListPayload(j){
  const arr = extractArrayFromAnyPayload(j);
  if(arr && arr.length) return arr;
  return null;
}

async function fetchListFromCourseApi(sheetName){
  const n = sheetName || "";
  const candidates = [
    `${COURSE_API}?action=list&sheet=${encodeURIComponent(n)}`,
    `${COURSE_API}?action=getAll&sheet=${encodeURIComponent(n)}`,
    `${COURSE_API}?action=all&sheet=${encodeURIComponent(n)}`,
    `${COURSE_API}?sheet=${encodeURIComponent(n)}`,
    `${COURSE_API}?tab=${encodeURIComponent(n)}`
  ];
  for(const url of candidates){
    try{
      const res = await fetch(url, { method:"GET", cache:"no-store" });
      const text = await res.text();
      let j=null; try{ j=JSON.parse(text);}catch(_){ j=null; }
      const out = normalizeListPayload(j);
      if(out) return out;
    }catch(_){}
  }
  throw new Error("API 未回傳可解析的 JSON 清單");
}

function loadRowToModel(row){
  // row may be array-like or object-like; we treat object
  const r = (typeof row==="object" && row) ? row : {};
  model.id = r.id || model.id;
  model.title = r.title || model.title;
  model.type = r.type || model.type;
  model.status = r.status || model.status;
  model.version = r.version || model.version;
  model.owner = r.owner || model.owner;
  model.audience = r.audience || model.audience;
  model.duration_min = String(r.duration_min ?? model.duration_min);
  model.capacity = String(r.capacity ?? model.capacity);
  model.tags = r.tags || model.tags;
  model.summary = r.summary || model.summary;
  model.objectives = r.objectives || model.objectives;
  model.outline = r.outline || model.outline;
  model.materials = r.materials || model.materials;
  model.links = r.links || model.links;
  model.assets = r.assets || model.assets;
  model.notes = r.notes || model.notes;
  model.created_at = r.created_at || model.created_at;
  model.updated_at = r.updated_at || model.updated_at;
  saveLocal(true);
  renderAll();
  toast("已載入 ✓");
}

async function loadBackendList(){
  const area = $("apiListArea");
  area.innerHTML = `<div class="mini">載入中…</div>`;
  const sheet = SHEET_MAP[model.state];
  try{
    const list = await fetchListFromCourseApi(sheet);
    if(!Array.isArray(list) || !list.length){
      area.innerHTML = `<div class="mini">後臺沒有資料，或 API 未提供清單介面（仍可用 TSV 貼回）。</div>`;
      return;
    }
    area.innerHTML = list.slice(0,50).map((row,i)=>{
      const title = esc(row.title || row.id || `(第${i+1}筆)`);
      const sub = esc(`${row.type||""}｜${row.status||""}｜${row.updated_at||row.created_at||""}`.replace(/^｜+|｜+$/g,""));
      return `
        <div class="api-item">
          <div>
            <div class="t">${title}</div>
            <div class="m">${sub}</div>
          </div>
          <button class="btn" data-load="${i}">載入</button>
        </div>
      `;
    }).join("");

    area.querySelectorAll("[data-load]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const idx = Number(btn.getAttribute("data-load"));
        loadRowToModel(list[idx]);
      });
    });
    toast(`已載入 ${Math.min(list.length,50)} 筆`);
  }catch(err){
    area.innerHTML = `<div class="mini">載入失敗：${esc(String(err))}</div>`;
  }
}

/* -------------------- Bind inputs -------------------- */
function bindStepInputs(){
  // Idea inputs
  const bind = (id, key, parser=(v)=>v)=> {
    const node = $(id);
    if(!node) return;
    node.addEventListener("input", ()=>{
      model[key] = parser(node.value);
      // dynamic show/hide
      if(id==="i_kind"){
        model.course_kind = node.value;
        if(model.course_kind!=="module"){
          // keep single duration in duration_min
          if(!model.duration_min) model.duration_min = node.value;
        }
        renderAll(); // re-render idea to update dynamic sections
        saveLocal(true);
        return;
      }
      saveLocal(true);
      renderProgress();
      // rebuild links if user edits manual links
      if(key==="links") rebuildLinksFromTools();
    });
  };

  bind("i_title","title");
  bind("i_audience","audience");
  bind("i_tags","tags");
  bind("i_type","type");
  bind("i_version","version");
  bind("i_kind","course_kind");
  bind("i_kind_other","course_kind_other");
  bind("i_single_min","duration_min");
  bind("i_capacity","capacity");
  bind("i_sessions","sessions_count");
  bind("i_per_session","per_session_min");
  bind("i_days","days");
  bind("i_hours_total","hours_total");
  bind("i_rhythm","rhythm_text");
  bind("i_closing","closing_line");
  bind("i_framework","framework_text");
  bind("i_outline","outline");

  // Draft inputs
  bind("d_objectives","objectives");
  bind("d_rhythm","rhythm_text");
  bind("d_outline","outline");
  bind("d_materials","materials");
  bind("d_notes","notes");

  // Final inputs
  bind("f_summary","summary");
  bind("f_objectives","objectives");
  bind("f_outline","outline");
  bind("f_materials","materials");
  bind("f_links","links");
  bind("f_assets","assets");
  bind("f_status","status");
  bind("f_notes","notes");

  // Tool picker events
  if($("toolSearch")){
    ["toolSearch","toolPrefix","toolCategory"].forEach(id=>{
      $(id).addEventListener("input", renderToolLists);
      $(id).addEventListener("change", renderToolLists);
    });
    renderToolLists();
  }

  // Buttons within steps
  const toDraft = $("btnToDraft");
  if(toDraft) toDraft.addEventListener("click", ()=>{ model.state="draft"; saveLocal(true); renderAll(); });
  const toFinal = $("btnToFinal");
  if(toFinal) toFinal.addEventListener("click", ()=>{ model.state="final"; saveLocal(true); renderAll(); });

  // When kind changes, show/hide other input
  const kindSel = $("i_kind");
  const otherWrap = $("i_kind_other_wrap");
  const moduleWrap = $("i_module_wrap");
  const singleWrap = $("i_single_wrap");
  const daysHours = $("i_days_hours_wrap");
  if(kindSel && otherWrap){
    otherWrap.style.display = (kindSel.value==="other") ? "block" : "none";
  }
  if(kindSel && moduleWrap && singleWrap){
    const isModule = kindSel.value==="module";
    moduleWrap.style.display = isModule ? "grid" : "none";
    daysHours.style.display = isModule ? "grid" : "none";
    singleWrap.style.display = isModule ? "none" : "block";
  }
}

function bindSettings(){
  // keep settings as optional quick edit, but values mirror model
  const setVal = (id, val)=>{ const n=$(id); if(n) n.value = val??""; };
  setVal("f_owner", model.owner);
  setVal("f_version", model.version);
  setVal("f_type", model.type);
  setVal("f_kind", model.course_kind==="other" ? "module" : model.course_kind); // keep simple
  setVal("f_sessions", model.sessions_count);
  setVal("f_duration", model.duration_min);
  setVal("f_days", model.days);
  setVal("f_hours", model.hours_total);
  setVal("f_capacity", model.capacity);

  const bind = (id, key)=>{
    const n=$(id); if(!n) return;
    n.addEventListener("input", ()=>{
      model[key] = n.value;
      saveLocal(true);
      renderAll();
    });
    n.addEventListener("change", ()=>{
      model[key] = n.value;
      saveLocal(true);
      renderAll();
    });
  };
  bind("f_owner","owner");
  bind("f_version","version");
  bind("f_type","type");
  bind("f_sessions","sessions_count");
  bind("f_duration","duration_min");
  bind("f_days","days");
  bind("f_hours","hours_total");
  bind("f_capacity","capacity");
}

/* -------------------- Render All -------------------- */
function renderAll(){
  renderProgress();
  renderSteps();
  $("toolApiLabel").textContent = TOOL_API;
  $("courseApiLabel").textContent = COURSE_API;
}

/* -------------------- Global events -------------------- */
function init(){
  // progress pills
  document.querySelectorAll(".pill").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      model.state = btn.dataset.state;
      saveLocal(true);
      renderAll();
    });
  });

  $("btnToggleSettings").addEventListener("click", ()=>{
    const card = $("settingsCard");
    card.style.display = (card.style.display==="none") ? "block" : "none";
  });

  $("btnReloadTools").addEventListener("click", async ()=>{
    await syncToolsOnce(true);
  });

  $("btnSaveLocal").addEventListener("click", ()=> saveLocal(false));

  $("btnCopyAI").addEventListener("click", async ()=>{
    const ok = await copyText(makeAiPrompt());
    toast(ok ? "AI 指令已複製 ✓" : "複製失敗");
  });

  $("btnCopyTSV").addEventListener("click", async ()=>{
    const ok = await copyText(buildTSVRow());
    toast(ok ? "TSV 已複製 ✓" : "複製失敗");
  });

  $("btnExportJson").addEventListener("click", ()=>{
    saveLocal(true);
    const blob = new Blob([JSON.stringify(model,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `angel-course-${model.id||"draft"}.json`;
    a.click();
    toast("已匯出 JSON ✓");
  });

  $("btnSendApi").addEventListener("click", async ()=>{
    saveLocal(true);
    await sendToApi();
  });

  $("btnLoadFromApi").addEventListener("click", async ()=>{
    await loadBackendList();
  });

  // initial render
  bindSettings();
  renderAll();

  // tool sync on start (non-blocking)
  syncToolsOnce(false);
}

window.addEventListener("DOMContentLoaded", init);
