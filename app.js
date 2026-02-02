/* Angel｜課程設計工作台 v1
   - 發想/草稿/完稿同頁 Wizard
   - 工具庫管理（本機可增刪 + API 同步）
   - 設計課程：主工具單選 / 副工具多選（modal）
   - 一鍵複製：AI 指令（通用 ChatGPT/Gemini）
   - 一鍵複製：TSV 一列（依狀態）
   - localStorage 草稿 + JSON 匯出備份
*/

const DEFAULTS = {
  apiCourse: "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec",
  apiTools:  "https://script.google.com/macros/s/AKfycbwecHTILAMuk5Izr_yF9wfce_qNjxuy28XuvpDzK0LZ4Wszmw7zI3xve8jeLghzveWbXA/exec",
  token: "",
  owner: "天使笑長",
  episodes: "8",
  duration_min: "120",
  capacity: "20",
  version: "v1.0"
};

const LS = {
  settings: "angel_course_workbench_settings_v1",
  draft:    "angel_course_workbench_draft_v1",
  tools:    "angel_course_workbench_tools_cache_v1",
  finals:   "angel_course_workbench_final_cache_v1"
};

const COLS = ["id","title","type","status","version","owner","audience","duration_min","capacity","tags","summary","objectives","outline","materials","links","assets","notes","created_at","updated_at"];

const STATE_META = {
  idea:  { label: "發想", sheet: "ideas"  },
  draft: { label: "草稿", sheet: "drafts" },
  final: { label: "完稿", sheet: "final"  }
};

// ---------- Utilities ----------
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const nowISO = () => new Date().toISOString();
const uid = () => "C" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 1600);
}

function safeJsonParse(s, fallback){
  try{ return JSON.parse(s); }catch(e){ return fallback; }
}

function saveLS(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }
function loadLS(key, fallback){ return safeJsonParse(localStorage.getItem(key), fallback); }

function tsvEscapeCell(v){
  if (v === null || v === undefined) return "";
  let s = String(v);
  // keep single line TSV
  s = s.replace(/\r?\n/g, " ⏎ ");
  return s;
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    toast("已複製 ✅");
  }catch(e){
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("已複製 ✅");
  }
}

function downloadFile(filename, content, mime="application/json"){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

// ---------- API ----------
async function fetchJSON(url, opts={}){
  const res = await fetch(url, opts);
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error("HTTP " + res.status);
  if (ct.includes("application/json")) return await res.json();
  // GAS sometimes returns text/json
  const txt = await res.text();
  try { return JSON.parse(txt); } catch(e){ return { ok:false, message:"Non-JSON response", raw: txt }; }
}

function withToken(url){
  const s = getSettings();
  if (!s.token) return url;
  const u = new URL(url);
  u.searchParams.set("token", s.token);
  return u.toString();
}

// Best-effort write. If backend doesn't support, we keep local.
async function apiWrite(baseUrl, payload){
  const url = withToken(baseUrl);
  // Try POST JSON first
  try{
    return await fetchJSON(url, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
  }catch(e1){
    // Try GET with params
    try{
      const u = new URL(url);
      Object.entries(payload||{}).forEach(([k,v]) => u.searchParams.set(k, typeof v==="string"? v : JSON.stringify(v)));
      return await fetchJSON(u.toString());
    }catch(e2){
      return { ok:false, message:"API 寫入失敗（目前以本機保存為主）" };
    }
  }
}

// ---------- Data model ----------
function blankDraft(){
  return {
    id: uid(),
    state: "idea",
    title: "",
    type: "演講",
    audience: "",
    tags: "",
    closing_line: "",
    framework_text: "",
    objectives: "",
    weekly_rhythm: "",
    eight_detail: "",
    deliverables: "",
    feedback: "",
    summary_public: "",
    objectives_public: "",
    why_effective: "",
    outline_final: "",
    materials_final: "",
    links_final: "",
    assets: "",
    notes: "",
    version: "",
    status: "ready", // used for final output default
    main_tool: null, // {toolCode,title,link,category,tips}
    secondary_tools: [], // same shape
    episodes: "",
    duration_min: "",
    capacity: "",
    owner: "",
    updated_at: nowISO(),
    created_at: nowISO()
  };
}

function getSettings(){
  return Object.assign({}, DEFAULTS, loadLS(LS.settings, {}));
}

function getDraft(){
  const d = loadLS(LS.draft, null);
  if (!d) return blankDraft();
  return Object.assign(blankDraft(), d);
}

function setDraft(patch){
  const d = getDraft();
  const next = Object.assign({}, d, patch, { updated_at: nowISO() });
  saveLS(LS.draft, next);
  renderAll();
}

// ---------- Tools cache ----------
function getToolsCache(){ return loadLS(LS.tools, { updated_at:0, items:[] }); }
function setToolsCache(items){
  saveLS(LS.tools, { updated_at: Date.now(), items });
}

function normalizeTool(t){
  // Accept various shapes from API. We keep these keys.
  return {
    toolCode: t.toolCode || t.code || t.id || "",
    title: t.title || t.name || "",
    category: t.category || t.type || "",
    status: t.status || "active",
    link: t.link || t.url || "",
    summary: t.summary || t.core || "",
    steps: t.steps || t.howto || "",
    tips: t.tips || t.tip || "",
    pain: t.pain || t.painpoint || ""
  };
}

// ---------- Courses cache (final list) ----------
function getFinalCache(){ return loadLS(LS.finals, { updated_at:0, items:[] }); }
function setFinalCache(items){ saveLS(LS.finals, { updated_at: Date.now(), items }); }

// ---------- Wizard config ----------
const WIZARDS = {
  idea: [
    { key:"i1", title:"I-1｜一句話定義", desc:"快速成形：這堂課是什麼、為誰做、痛點是什麼。",
      fields:[
        { id:"title", label:"課名（title）", type:"text", placeholder:"例如：大人先穩定｜現場急救30秒" },
        { id:"audience", label:"對象（audience）", type:"text", placeholder:"例如：親子家庭 / 教師 / 家長" },
        { id:"tags", label:"標籤/痛點（tags）", type:"text", placeholder:"例如：#情緒急救 #反應太快 #關係修復" }
      ]
    },
    { key:"i2", title:"I-2｜結果感（結尾一句話）", desc:"一句話定錨：這堂課最後要把人帶去哪裡。",
      fields:[
        { id:"closing_line", label:"closing_line", type:"textarea", placeholder:"例如：孩子不需要你完美，他需要你回得來。" }
      ]
    },
    { key:"i3", title:"I-3｜工具配方", desc:"從工具庫勾選：主工具單選 / 副工具多選。",
      custom:"tools"
    },
    { key:"i4", title:"I-4｜粗架構", desc:"8 集一句話大綱（短版）。不求完整，先站穩。",
      fields:[
        { id:"framework_text", label:"8 集一句話大綱（framework_text）", type:"textarea", placeholder:"01 ...\n02 ...\n...\n08 ..." }
      ],
      footerButtons:[
        { id:"go-draft", text:"進草稿 →", action:"toDraft", style:"primary" }
      ]
    }
  ],
  draft: [
    { key:"d1", title:"D-1｜目標與節律", desc:"可試教版本：目標要清楚，節律要可操作。",
      fields:[
        { id:"objectives", label:"objectives（條列）", type:"textarea", placeholder:"- ...\n- ..." },
        { id:"weekly_rhythm", label:"每週節律（90/120/作業）", type:"textarea", placeholder:"例如：\n每堂 120 分：開場10 / 核心40 / 練習40 / 回收20 / 作業10" }
      ]
    },
    { key:"d2", title:"D-2｜八堂詳細版", desc:"每集：目標、工具、練習、作業（短表述）。",
      fields:[
        { id:"eight_detail", label:"八堂詳細版", type:"textarea", placeholder:"第1堂：目標...｜工具...｜練習...｜作業...\n..." }
      ]
    },
    { key:"d3", title:"D-3｜交付物與材料", desc:"練習單、提醒、講稿、指引、結業小抄…清單化。",
      fields:[
        { id:"deliverables", label:"交付物與材料", type:"textarea", placeholder:"- 練習單...\n- 提醒卡...\n- 講稿..." }
      ]
    },
    { key:"d4", title:"D-4｜回饋與追蹤", desc:"每週回饋題、追蹤方式、工具使用頻率建議。",
      fields:[
        { id:"feedback", label:"回饋與追蹤", type:"textarea", placeholder:"每週回饋題：...\n追蹤方式：...\n工具節律：..." }
      ],
      footerButtons:[
        { id:"go-final", text:"進完稿 →", action:"toFinal", style:"primary" }
      ]
    }
  ],
  final: [
    { key:"f1", title:"F-1｜正式提案版文案", desc:"可對外：summary、objectives、why effective（腦科學＋幸福教養一句話）。",
      fields:[
        { id:"summary_public", label:"summary（對外版）", type:"textarea", placeholder:"對外版摘要..." },
        { id:"objectives_public", label:"objectives（對外可讀版）", type:"textarea", placeholder:"- ...\n- ..." },
        { id:"why_effective", label:"why effective（一句話）", type:"textarea", placeholder:"例如：用可操作的微練習，讓前額葉回來接手，關係才能回到溫柔與清楚。" }
      ]
    },
    { key:"f2", title:"F-2｜課程設計定稿", desc:"outline（正式版）、materials、links（工具連結整理）。",
      fields:[
        { id:"outline_final", label:"outline（正式版）", type:"textarea", placeholder:"完整課綱..." },
        { id:"materials_final", label:"materials（清單）", type:"textarea", placeholder:"- PPT\n- 練習單\n- ..." }
      ],
      custom:"linksAuto"
    },
    { key:"f3", title:"F-3｜製作物生成清單", desc:"PPT 大綱、逐頁講稿、口播稿、演說/主持稿（可全要）。",
      fields:[
        { id:"materials_final", label:"（可加註）製作物需求", type:"textarea", placeholder:"PPT大綱｜逐頁講稿｜口播稿｜演說/主持稿..." }
      ]
    },
    { key:"f4", title:"F-4｜確認與封存", desc:"版本、封存筆記、檔案清單。完稿狀態預設 ready。",
      fields:[
        { id:"version", label:"version", type:"text", placeholder:"例如：v1.0" },
        { id:"notes", label:"notes", type:"textarea", placeholder:"封存備註..." },
        { id:"assets", label:"assets（檔案清單）", type:"textarea", placeholder:"- pptx ...\n- pdf ...\n- mp3 ..." }
      ]
    }
  ]
};

// ---------- Rendering ----------
function setPage(page){
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.page===page));
  $("#page-workbench").style.display = page==="workbench" ? "" : "none";
  $("#page-tools").style.display     = page==="tools" ? "" : "none";
  $("#page-final").style.display     = page==="final" ? "" : "none";
  if (page==="tools") renderToolsPage();
  if (page==="final") renderFinalPage();
}

function stateProgress(){
  const d = getDraft();
  const ideaDone = d.title && d.audience && (d.framework_text || d.closing_line);
  const draftDone = ideaDone && d.objectives && d.eight_detail;
  const finalDone = draftDone && d.summary_public && d.outline_final;
  return { ideaDone, draftDone, finalDone };
}

function renderBadges(){
  const d = getDraft();
  const p = stateProgress();

  const badge = (el, done, isCurrent) => {
    el.classList.remove("green","orange","gray");
    if (done){
      el.classList.add("green");
      el.textContent = "✅ " + el.textContent.replace(/^.*? /,"");
    }else if (isCurrent){
      el.classList.add("orange");
      el.textContent = "🟡 " + el.textContent.replace(/^.*? /,"");
    }else{
      el.classList.add("gray");
      el.textContent = "⬜ " + el.textContent.replace(/^.*? /,"");
    }
  };

  $("#badge-idea").textContent = "發想";
  $("#badge-draft").textContent = "草稿";
  $("#badge-final").textContent = "完稿";
  badge($("#badge-idea"), p.ideaDone, d.state==="idea");
  badge($("#badge-draft"), p.draftDone, d.state==="draft");
  badge($("#badge-final"), p.finalDone, d.state==="final");
}

function renderPills(){
  const d = getDraft();
  const meta = WIZARDS[d.state];
  const completed = [false,false,false,false];

  // simple completion heuristics per state
  if (d.state==="idea"){
    completed[0] = !!(d.title && d.audience && d.tags);
    completed[1] = !!d.closing_line;
    completed[2] = !!(d.main_tool || d.secondary_tools?.length);
    completed[3] = !!d.framework_text;
  }else if (d.state==="draft"){
    completed[0] = !!(d.objectives && d.weekly_rhythm);
    completed[1] = !!d.eight_detail;
    completed[2] = !!d.deliverables;
    completed[3] = !!d.feedback;
  }else{
    completed[0] = !!(d.summary_public && d.objectives_public && d.why_effective);
    completed[1] = !!(d.outline_final && d.materials_final);
    completed[2] = true; // it's a checklist step
    completed[3] = !!(d.version || getSettings().version);
  }

  ["#pill-s1","#pill-s2","#pill-s3","#pill-s4"].forEach((sel, i)=>{
    const el = $(sel);
    el.classList.remove("ok","doing","todo");
    if (completed[i]) el.classList.add("ok");
    else if (i===0 || completed.slice(0,i).every(Boolean)) el.classList.add("doing");
    else el.classList.add("todo");
    el.textContent = (i+1) + (completed[i] ? " ✅" : "");
  });
}

function inputFieldHTML(field, value){
  const v = value ?? "";
  if (field.type==="textarea"){
    return `<label>${field.label}</label><textarea data-bind="${field.id}" placeholder="${field.placeholder||""}">${escapeHtml(v)}</textarea>`;
  }
  if (field.type==="select"){
    return `<label>${field.label}</label><select data-bind="${field.id}">${(field.options||[]).map(o=>`<option value="${escapeAttr(o.value)}"${o.value===v?" selected":""}>${escapeHtml(o.label)}</option>`).join("")}</select>`;
  }
  return `<label>${field.label}</label><input data-bind="${field.id}" value="${escapeAttr(v)}" placeholder="${field.placeholder||""}" />`;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
function escapeAttr(s){ return escapeHtml(s); }

function renderWizard(){
  const d = getDraft();
  $("#state-select").value = d.state;
  $("#type-select").value = d.type || "演講";
  $("#state-label").textContent = STATE_META[d.state].label;

  const cards = WIZARDS[d.state];
  const wrap = $("#wizard-cards");
  wrap.innerHTML = cards.map((c, idx) => {
    let body = "";
    if (c.fields){
      body += c.fields.map(f => inputFieldHTML(f, d[f.id])).join("");
    }
    if (c.custom==="tools"){
      const main = d.main_tool ? `${d.main_tool.toolCode}｜${d.main_tool.title}` : "未選";
      const sec = (d.secondary_tools||[]).map(t=>`${t.toolCode}｜${t.title}`).join(" / ") || "未選";
      body += `
        <label>主工具（單選）</label>
        <div class="pill ok">${escapeHtml(main)}</div>
        <label>副工具（多選）</label>
        <div class="pill">${escapeHtml(sec)}</div>
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">
          <button class="btn primary" data-action="openToolPicker">打開工具勾選</button>
          <button class="btn" data-action="clearTools">清空工具選擇</button>
        </div>
      `;
    }
    if (c.custom==="linksAuto"){
      body += `
        <label>links（自動整理）</label>
        <textarea data-bind="links_final" placeholder="會自動塞入主工具與副工具的連結（你也可以手動補充）">${escapeHtml(linksFromTools(d))}</textarea>
        <small class="muted">小提醒：這裡會用「主工具＋副工具」自動生成 links。你也可以自己加上影片、表單、PDF 等連結。</small>
      `;
    }
    let footer = "";
    if (c.footerButtons){
      footer = `
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end">
          ${c.footerButtons.map(b => `<button class="btn ${b.style==="primary"?"primary":""}" data-action="${b.action}">${b.text}</button>`).join("")}
        </div>
      `;
    }
    return `
      <div class="card step-card" data-step="${c.key}">
        <h3>${c.title}</h3>
        <p>${c.desc}</p>
        ${body}
        ${footer}
      </div>
    `;
  }).join("");

  // Bind inputs
  $$("[data-bind]", wrap).forEach(el=>{
    el.addEventListener("input", ()=>{
      const key = el.getAttribute("data-bind");
      setDraft({ [key]: el.value });
    });
    el.addEventListener("change", ()=>{
      const key = el.getAttribute("data-bind");
      setDraft({ [key]: el.value });
    });
  });

  // Card buttons
  $$("[data-action]", wrap).forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const act = btn.getAttribute("data-action");
      if (act==="openToolPicker") openToolPicker();
      if (act==="clearTools") setDraft({ main_tool:null, secondary_tools:[] });
      if (act==="toDraft") { setDraft({ state:"draft" }); toast("已進入草稿"); }
      if (act==="toFinal") { setDraft({ state:"final" }); toast("已進入完稿"); }
    });
  });
}

function renderAll(){
  const d = getDraft();
  renderBadges();
  renderPills();
  renderWizard();
  // keep derived links in final step if empty
  if (d.state==="final" && (!d.links_final || d.links_final.trim()==="")){
    setDraft({ links_final: linksFromTools(d) });
  }
}

function linksFromTools(d){
  const lines = [];
  if (d.main_tool){
    lines.push(`主工具：${d.main_tool.title}（${d.main_tool.toolCode}） ${d.main_tool.link||""}`.trim());
  }
  if (d.secondary_tools && d.secondary_tools.length){
    d.secondary_tools.forEach(t=>{
      lines.push(`副工具：${t.title}（${t.toolCode}） ${t.link||""}`.trim());
    });
  }
  return lines.join("\n");
}

// ---------- Bottom outputs ----------
function aiPromptForState(){
  const s = getSettings();
  const d = getDraft();

  const STATE = STATE_META[d.state].label;
  const episodes = (d.episodes || s.episodes || "").toString().trim();
  const duration_min = (d.duration_min || s.duration_min || "").toString().trim();
  const capacity = (d.capacity || s.capacity || "").toString().trim();

  const mainToolName = d.main_tool ? d.main_tool.title : "";
  const mainToolLink = d.main_tool ? d.main_tool.link || "" : "";
  const toolListWithLinks = (d.secondary_tools||[]).map(t=>`${t.title}｜${t.link||""}`.trim()).join("\n") || "";

  const frameworkText = d.framework_text || d.eight_detail || d.outline_final || "";
  const closingLine = d.closing_line || "";

  return `你是「天使笑長」的協作夥伴。請用溫柔、清楚、不說教的語氣，幫我把課程從「${STATE}」往下一階段完成。  

0｜已輸入資料（請以此為準，不要改名、不重問）  
課程名稱：${d.title || ""}  
類型：${d.type || ""}  
對象：${d.audience || ""}  
集數/時長/人數：${episodes}集｜${duration_min}分鐘｜${capacity}人  
關鍵痛點/標籤：${d.tags || ""}  
主工具：${mainToolName}｜${mainToolLink}  
副工具：${toolListWithLinks}  
核心流程架構：${frameworkText}  
結尾定錨句：${closingLine}  

1｜請你輸出三份成果（務必分段標題）  
A) 活動/課程規劃（定位、目標、節律、適用場域）  
B) 詳細設計內容（每集內容、現場流程、練習、作業）  
C) 回饋與追蹤方案（每週追蹤、回饋題、工具使用節律）  

2｜依目前狀態輸出格式（很重要）  
若 ${STATE}=發想：請先產出「8集一句話大綱」與「最小可行練習」，不要寫太長。  
若 ${STATE}=草稿：請補齊每集「目標/工具/練習/作業」，可直接拿去試教。  
若 ${STATE}=完稿：請產出「對外提案版」＋「PPT大綱」＋「逐頁講稿」＋「口播稿」＋「演說/主持稿」。  

3｜最後請再輸出：表單橫向一列（可貼入）  
請依下列表頭輸出一列（用 tab 分隔）：  
{${COLS.join(", ")}}  

若 ${STATE}=發想：summary/objectives/outline 可短版  
若 ${STATE}=草稿：summary/objectives/outline 完整版  
若 ${STATE}=完稿：全部欄位給可上架的定稿版（status 預設 ready）`;
}

function tsvRowForState(){
  const s = getSettings();
  const d = getDraft();
  const now = nowISO();

  const base = {
    id: d.id || uid(),
    title: d.title || "",
    type: d.type || "",
    status: d.state==="final" ? (d.status || "ready") : (d.state==="draft" ? "draft" : "idea"),
    version: (d.version || s.version || DEFAULTS.version || "").trim(),
    owner: (d.owner || s.owner || "").trim(),
    audience: d.audience || "",
    duration_min: (d.duration_min || s.duration_min || "").toString().trim(),
    capacity: (d.capacity || s.capacity || "").toString().trim(),
    tags: d.tags || "",
    summary: "",
    objectives: "",
    outline: "",
    materials: "",
    links: "",
    assets: d.assets || "",
    notes: d.notes || "",
    created_at: d.created_at || now,
    updated_at: now
  };

  // Build per state
  if (d.state==="idea"){
    base.summary = d.closing_line || "";
    base.objectives = ""; // short
    base.outline = d.framework_text || "";
    base.materials = "";
    base.links = linksFromTools(d);
    base.notes = "";
  }
  if (d.state==="draft"){
    base.summary = (d.closing_line ? d.closing_line + "\n" : "") + "（草稿可試教）";
    base.objectives = (d.objectives || "") + (d.weekly_rhythm ? "\n\n節律：\n" + d.weekly_rhythm : "");
    base.outline = d.eight_detail || "";
    base.materials = d.deliverables || "";
    base.links = linksFromTools(d);
    base.notes = d.feedback || "";
  }
  if (d.state==="final"){
    base.summary = d.summary_public || "";
    base.objectives = d.objectives_public || "";
    base.outline = (d.outline_final || "") + (d.why_effective ? "\n\nWhy effective：\n" + d.why_effective : "");
    base.materials = d.materials_final || "";
    base.links = (d.links_final && d.links_final.trim() ? d.links_final : linksFromTools(d));
    base.assets = d.assets || "";
    base.notes = d.notes || "";
    base.status = "ready"; // enforce safest default
  }

  const cells = COLS.map(k => tsvEscapeCell(base[k] ?? ""));
  return cells.join("\t");
}

// ---------- Tool picker ----------
let toolPickerContext = { main:null, secondary:[] };

function openModal(id){
  const el = $("#"+id);
  el.classList.add("show");
}
function closeModal(id){
  const el = $("#"+id);
  el.classList.remove("show");
}

function openToolPicker(){
  const d = getDraft();
  toolPickerContext.main = d.main_tool ? d.main_tool.toolCode : null;
  toolPickerContext.secondary = (d.secondary_tools||[]).map(t=>t.toolCode);

  renderToolPicker();
  openModal("modal-tool-picker");
}

function renderToolPicker(){
  const tools = currentToolsFilteredForPicker();
  const cats = unique(tools.map(t=>t.category).filter(Boolean)).sort();
  const sel = $("#picker-category");
  sel.innerHTML = `<option value="">全部</option>` + cats.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  sel.value = $("#picker-category").value || "";

  // main/secondary current display
  $("#picker-main").innerHTML = toolPickerContext.main ? `<span class="pill ok">${escapeHtml(toolPickerContext.main)}</span>` : `<span class="pill todo">未選</span>`;
  $("#picker-secondary").innerHTML = toolPickerContext.secondary.length ? toolPickerContext.secondary.map(x=>`<span class="pill">${escapeHtml(x)}</span>`).join("") : `<span class="pill todo">未選</span>`;

  const tbody = $("#picker-table tbody");
  tbody.innerHTML = tools.map(t=>{
    const isMain = toolPickerContext.main===t.toolCode;
    const isSec = toolPickerContext.secondary.includes(t.toolCode);
    return `<tr>
      <td><button class="btn small ${isMain?"primary":""}" data-pick-main="${escapeAttr(t.toolCode)}">${isMain?"主✅":"設主"}</button></td>
      <td><button class="btn small ${isSec?"warn":""}" data-pick-sec="${escapeAttr(t.toolCode)}">${isSec?"副✅":"加副"}</button></td>
      <td class="mono">${escapeHtml(t.toolCode)}</td>
      <td>
        <div style="font-weight:700">${escapeHtml(t.title)}</div>
        <small class="muted">${escapeHtml(t.tips || t.summary || "")}</small>
      </td>
      <td>${escapeHtml(t.category||"")}</td>
    </tr>`;
  }).join("");

  $$("[data-pick-main]", tbody).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      toolPickerContext.main = btn.getAttribute("data-pick-main");
      renderToolPicker();
    });
  });
  $$("[data-pick-sec]", tbody).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const code = btn.getAttribute("data-pick-sec");
      const arr = toolPickerContext.secondary;
      const idx = arr.indexOf(code);
      if (idx>=0) arr.splice(idx,1);
      else arr.push(code);
      toolPickerContext.secondary = arr;
      renderToolPicker();
    });
  });
}

function currentToolsFilteredForPicker(){
  const cache = getToolsCache().items.map(normalizeTool);
  const q = ($("#picker-search").value || "").trim().toLowerCase();
  const cat = ($("#picker-category").value || "").trim();
  return cache.filter(t=>{
    if (cat && (t.category||"") !== cat) return false;
    if (!q) return true;
    const blob = `${t.toolCode} ${t.title} ${t.category} ${t.summary} ${t.tips}`.toLowerCase();
    return blob.includes(q);
  });
}

function applyToolPicker(){
  const tools = getToolsCache().items.map(normalizeTool);
  const byCode = new Map(tools.map(t=>[t.toolCode, t]));
  const main = toolPickerContext.main ? byCode.get(toolPickerContext.main) : null;
  const secondary = toolPickerContext.secondary
    .filter(code => code !== toolPickerContext.main)
    .map(code => byCode.get(code))
    .filter(Boolean);

  setDraft({
    main_tool: main ? pickToolShape(main) : null,
    secondary_tools: secondary.map(pickToolShape),
    links_final: linksFromTools(Object.assign(getDraft(), { main_tool: main?pickToolShape(main):null, secondary_tools: secondary.map(pickToolShape) }))
  });
  closeModal("modal-tool-picker");
  toast("工具已套用");
}

function pickToolShape(t){
  return {
    toolCode: t.toolCode,
    title: t.title,
    link: t.link,
    category: t.category,
    tips: t.tips
  };
}

function unique(arr){
  return Array.from(new Set(arr));
}

// ---------- Tools page ----------
let toolEditorMode = { editingCode: null };

function renderToolsPage(){
  const cache = getToolsCache().items.map(normalizeTool);
  const q = ($("#tool-search").value || "").trim().toLowerCase();
  const cat = ($("#tool-category-filter").value || "").trim();

  const filtered = cache.filter(t=>{
    if (cat && (t.category||"") !== cat) return false;
    if (!q) return true;
    const blob = `${t.toolCode} ${t.title} ${t.category} ${t.summary} ${t.tips}`.toLowerCase();
    return blob.includes(q);
  });

  // category filter options
  const cats = unique(cache.map(t=>t.category).filter(Boolean)).sort();
  const sel = $("#tool-category-filter");
  const current = sel.value || "";
  sel.innerHTML = `<option value="">全部</option>` + cats.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  sel.value = cats.includes(current) ? current : "";

  const tbody = $("#tools-table tbody");
  tbody.innerHTML = filtered.map(t=>`
    <tr>
      <td class="mono">${escapeHtml(t.toolCode)}</td>
      <td>
        <div style="font-weight:800">${escapeHtml(t.title)}</div>
        ${t.link? `<small><a href="${escapeAttr(t.link)}" target="_blank">Open</a></small>`:"<small class='muted'>（尚未填連結）</small>"}
        <div><small class="muted">${escapeHtml(t.tips || t.summary || "")}</small></div>
      </td>
      <td>${escapeHtml(t.category||"")}</td>
      <td>${escapeHtml(t.status||"")}</td>
      <td>
        <button class="btn small" data-edit-tool="${escapeAttr(t.toolCode)}">編修</button>
      </td>
    </tr>
  `).join("");

  $$("[data-edit-tool]", tbody).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const code = btn.getAttribute("data-edit-tool");
      openToolEditor(code);
    });
  });
}

function openToolEditor(code){
  const items = getToolsCache().items.map(normalizeTool);
  const t = items.find(x=>x.toolCode===code) || null;

  toolEditorMode.editingCode = code || null;
  $("#tool-editor-title").textContent = t ? `編修工具：${t.toolCode}` : "新增工具";

  $("#toolCode").value = t?.toolCode || "";
  $("#toolTitle").value = t?.title || "";
  $("#toolCategory").value = t?.category || "";
  $("#toolStatus").value = t?.status || "active";
  $("#toolLink").value = t?.link || "";
  $("#toolSummary").value = t?.summary || "";
  $("#toolSteps").value = t?.steps || "";
  $("#toolTips").value = t?.tips || "";

  $("#btn-tool-delete").style.display = t ? "" : "none";
  openModal("modal-tool-editor");
}

function saveToolLocal(){
  const code = $("#toolCode").value.trim();
  if (!code){ toast("toolCode 不能空"); return; }
  const tool = {
    toolCode: code,
    title: $("#toolTitle").value.trim(),
    category: $("#toolCategory").value.trim(),
    status: $("#toolStatus").value,
    link: $("#toolLink").value.trim(),
    summary: $("#toolSummary").value.trim(),
    steps: $("#toolSteps").value.trim(),
    tips: $("#toolTips").value.trim()
  };

  const cache = getToolsCache();
  const items = cache.items.map(normalizeTool);
  const idx = items.findIndex(t=>t.toolCode===code);
  if (idx>=0) items[idx] = Object.assign(items[idx], tool);
  else items.unshift(tool);

  setToolsCache(items);
  closeModal("modal-tool-editor");
  toast("已保存（本機）");
  renderToolsPage();
}

function deleteToolLocal(){
  const code = $("#toolCode").value.trim();
  const items = getToolsCache().items.map(normalizeTool).filter(t=>t.toolCode!==code);
  setToolsCache(items);
  closeModal("modal-tool-editor");
  toast("已刪除（本機）");
  renderToolsPage();
}

async function syncToolsFromAPI(){
  const s = getSettings();
  toast("同步工具庫…");
  try{
    const data = await fetchJSON(withToken(s.apiTools));
    const items = (data.items || data.data || data.tools || []).map(normalizeTool);
    if (Array.isArray(items)){
      // Merge: prefer API items, but keep local custom that are not in API
      const local = getToolsCache().items.map(normalizeTool);
      const map = new Map(items.map(t=>[t.toolCode, t]));
      local.forEach(t=>{
        if (!map.has(t.toolCode)) map.set(t.toolCode, t);
      });
      setToolsCache(Array.from(map.values()));
      toast("工具庫已更新 ✅");
      renderToolsPage();
    }else{
      toast("工具庫 API 格式不符，已保留本機");
    }
  }catch(e){
    toast("API 連線失敗，使用本機快取");
  }
}

async function pushToolToAPI(){
  const s = getSettings();
  const payload = {
    action: "upsertTool",
    tool: {
      toolCode: $("#toolCode").value.trim(),
      title: $("#toolTitle").value.trim(),
      category: $("#toolCategory").value.trim(),
      status: $("#toolStatus").value,
      link: $("#toolLink").value.trim(),
      summary: $("#toolSummary").value.trim(),
      steps: $("#toolSteps").value.trim(),
      tips: $("#toolTips").value.trim()
    }
  };
  const res = await apiWrite(s.apiTools, payload);
  if (res && res.ok){
    toast("已同步到 API ✅");
  }else{
    toast(res.message || "API 未支援寫入（已保留本機）");
  }
}

// ---------- Final list page ----------
function renderFinalPage(){
  const cache = getFinalCache().items || [];
  const q = ($("#final-search").value || "").trim().toLowerCase();
  const status = ($("#final-status-filter").value || "").trim();

  const filtered = cache.filter(it=>{
    if (status && (it.status||"") !== status) return false;
    if (!q) return true;
    const blob = `${it.id} ${it.title} ${it.tags||""} ${it.audience||""}`.toLowerCase();
    return blob.includes(q);
  });

  const tbody = $("#final-table tbody");
  tbody.innerHTML = filtered.map(it=>`
    <tr>
      <td class="mono">${escapeHtml(it.id||"")}</td>
      <td>
        <div style="font-weight:800">${escapeHtml(it.title||"")}</div>
        <small class="muted">${escapeHtml(it.audience||"")}</small>
      </td>
      <td>${escapeHtml(it.type||"")}</td>
      <td>${escapeHtml(it.status||"")}</td>
      <td>${escapeHtml(it.version||"")}</td>
      <td>
        <button class="btn small" data-load-final="${escapeAttr(it.id||"")}">載入到工作台</button>
      </td>
    </tr>
  `).join("");

  $$("[data-load-final]", tbody).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-load-final");
      const item = cache.find(x=>x.id===id);
      if (!item) return;
      // Map final fields back to draft
      const d = getDraft();
      setDraft(Object.assign({}, d, {
        id: item.id || d.id,
        title: item.title || "",
        type: item.type || "現場課程",
        audience: item.audience || "",
        tags: item.tags || "",
        state: "final",
        summary_public: item.summary || "",
        objectives_public: item.objectives || "",
        outline_final: item.outline || "",
        materials_final: item.materials || "",
        links_final: item.links || "",
        assets: item.assets || "",
        notes: item.notes || "",
        version: item.version || ""
      }));
      setPage("workbench");
      toast("已載入到工作台");
    });
  });
}

async function syncFinalsFromAPI(){
  const s = getSettings();
  toast("同步完稿課程…");
  try{
    const data = await fetchJSON(withToken(s.apiCourse));
    const items = (data.items || data.data || data.courses || []).map(x=>({
      id: x.id || "",
      title: x.title || "",
      type: x.type || "",
      status: x.status || "",
      version: x.version || "",
      owner: x.owner || "",
      audience: x.audience || "",
      duration_min: x.duration_min || "",
      capacity: x.capacity || "",
      tags: x.tags || "",
      summary: x.summary || "",
      objectives: x.objectives || "",
      outline: x.outline || "",
      materials: x.materials || "",
      links: x.links || "",
      assets: x.assets || "",
      notes: x.notes || "",
      created_at: x.created_at || "",
      updated_at: x.updated_at || ""
    }));
    setFinalCache(items);
    toast("完稿清單已更新 ✅");
    renderFinalPage();
  }catch(e){
    toast("API 連線失敗，使用本機快取");
  }
}

// ---------- Settings ----------
function openSettings(){
  const s = getSettings();
  $("#api-course").value = s.apiCourse;
  $("#api-tools").value = s.apiTools;
  $("#api-token").value = s.token || "";
  $("#owner").value = s.owner || "";
  $("#episodes").value = s.episodes || "";
  $("#capacity").value = s.capacity || "";
  $("#duration").value = s.duration_min || "";
  $("#default-version").value = s.version || "";
  openModal("modal-settings");
}

function saveSettings(){
  const next = {
    apiCourse: $("#api-course").value.trim(),
    apiTools: $("#api-tools").value.trim(),
    token: $("#api-token").value.trim(),
    owner: $("#owner").value.trim() || DEFAULTS.owner,
    episodes: $("#episodes").value.trim(),
    capacity: $("#capacity").value.trim(),
    duration_min: $("#duration").value.trim(),
    version: $("#default-version").value.trim()
  };
  saveLS(LS.settings, next);
  closeModal("modal-settings");
  toast("設定已保存 ✅");
  renderAll();
}

function clearCache(){
  localStorage.removeItem(LS.tools);
  localStorage.removeItem(LS.finals);
  toast("已清掉快取");
}

// ---------- Event wiring ----------
function wire(){
  // Tabs
  $$(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=> setPage(btn.dataset.page));
  });

  // State select
  $("#state-select").addEventListener("change", (e)=> setDraft({ state: e.target.value }));
  $("#type-select").addEventListener("change", (e)=> setDraft({ type: e.target.value }));

  // Bottom buttons
  $("#btn-copy-ai").addEventListener("click", ()=> copyText(aiPromptForState()));
  $("#btn-copy-tsv").addEventListener("click", ()=> copyText(tsvRowForState()));
  $("#btn-save-local").addEventListener("click", ()=>{
    const d = getDraft();
    saveLS(LS.draft, d);
    toast("已存本機草稿 ✅");
  });
  $("#btn-export-json").addEventListener("click", ()=>{
    const d = getDraft();
    const payload = {
      exported_at: nowISO(),
      settings: getSettings(),
      draft: d,
      tools_cache: getToolsCache(),
      final_cache: getFinalCache()
    };
    downloadFile(`angel-course-workbench-backup-${Date.now()}.json`, JSON.stringify(payload, null, 2));
    toast("已匯出 JSON ✅");
  });

  $("#btn-reset-draft").addEventListener("click", ()=>{
    saveLS(LS.draft, blankDraft());
    toast("已重置草稿");
    renderAll();
  });

  // Settings
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-save-settings").addEventListener("click", saveSettings);
  $("#btn-clear-cache").addEventListener("click", clearCache);

  // Modal close
  $$("[data-close]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      closeModal(btn.getAttribute("data-close"));
    });
  });
  $$(".modal-backdrop").forEach(backdrop=>{
    backdrop.addEventListener("click", (e)=>{
      if (e.target === backdrop) backdrop.classList.remove("show");
    });
  });

  // Tool picker events
  $("#btn-tool-picker-done").addEventListener("click", applyToolPicker);
  $("#picker-search").addEventListener("input", renderToolPicker);
  $("#picker-category").addEventListener("change", renderToolPicker);

  // Tools page
  $("#btn-tool-add").addEventListener("click", ()=> openToolEditor(null));
  $("#btn-tool-sync").addEventListener("click", syncToolsFromAPI);
  $("#tool-search").addEventListener("input", renderToolsPage);
  $("#tool-category-filter").addEventListener("change", renderToolsPage);

  // Tool editor actions
  $("#btn-tool-save").addEventListener("click", saveToolLocal);
  $("#btn-tool-delete").addEventListener("click", deleteToolLocal);
  $("#btn-tool-push-api").addEventListener("click", pushToolToAPI);

  // Final page
  $("#btn-final-sync").addEventListener("click", syncFinalsFromAPI);
  $("#final-search").addEventListener("input", renderFinalPage);
  $("#final-status-filter").addEventListener("change", renderFinalPage);
}

// ---------- Init ----------
async function init(){
  // service worker
  if ("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){}
  }

  // Ensure defaults settings exist
  const s = getSettings();
  saveLS(LS.settings, s);

  // Ensure a draft exists
  if (!localStorage.getItem(LS.draft)){
    saveLS(LS.draft, blankDraft());
  }

  // Tools: bootstrap cache if empty (so picker works even before API sync)
  const tcache = getToolsCache();
  if (!tcache.items || !tcache.items.length){
    setToolsCache([
      { toolCode:"EQ-02", title:"Angel｜五感覺察", category:"EQ", status:"active", link:"", tips:"把心回到感官，腦袋就安靜。" },
      { toolCode:"COM-01", title:"改變｜換一個反應", category:"COM", status:"active", link:"", tips:"先停一下，再選一個比較舒服的反應。" },
      { toolCode:"MIX-02", title:"幽默｜情緒急救包", category:"MIX", status:"active", link:"", tips:"先把氣氛降噪，關係才回得來。" },
      { toolCode:"EQ-03", title:"心懂OK蹦｜解碼幸福關係", category:"REL", status:"active", link:"", tips:"理解彼此不容易，才有修復的入口。" }
    ]);
  }

  wire();
  renderAll();
  renderToolsPage();
  renderFinalPage();
}

init();
