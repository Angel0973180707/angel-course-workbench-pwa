/* Angel｜Course Workbench v2 (no-mask, scroll-safe)
   - Wizard for Idea/Draft/Final (4 steps each)
   - One-click copy: AI prompt + TSV row
   - localStorage save + JSON export
*/

const LS_KEY = "angel_course_workbench_v2";

const STATE_MAP = {
  idea: "發想",
  draft: "草稿",
  final: "完稿",
};

const DEFAULT_DATA = () => ({
  state: "idea",
  // Common fields
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
  closing_line: "",
  framework_text: "",
  episodes: "8",

  // Tool (placeholders; next step will connect tool library)
  main_tool_name: "",
  main_tool_link: "",
  tool_list_with_links: "",

  // Draft/Final content
  summary: "",
  objectives: "",
  outline: "",
  materials: "",
  links: "",
  assets: "",
  notes: "",

  // Draft extras
  rhythm: "",
  feedback: "",

  created_at: "",
  updated_at: "",
});

let model = loadLocal() || DEFAULT_DATA();

const el = (id) => document.getElementById(id);

function nowISO() {
  return new Date().toISOString();
}

function ensureId() {
  if (!model.id) model.id = "C-" + Date.now();
}

function setState(next) {
  model.state = next;
  renderAll();
}

function setDot(dotEl, status) {
  dotEl.classList.remove("ok", "doing", "todo");
  dotEl.classList.add(status);
}

function computeProgress() {
  // Very conservative: if title exists => idea doing; if outline exists => draft doing; if summary+outline exist => final doing
  const ideaDone = !!model.title && !!model.audience && !!model.tags;
  const draftDone = !!model.objectives && !!model.outline;
  const finalDone = !!model.summary && !!model.outline && !!model.materials;

  return { ideaDone, draftDone, finalDone };
}

function renderProgress() {
  const { ideaDone, draftDone, finalDone } = computeProgress();

  // Dots: ok / doing / todo
  // current state gets doing unless already done
  const s = model.state;

  setDot(el("dotIdea"), ideaDone ? "ok" : (s === "idea" ? "doing" : "todo"));
  setDot(el("dotDraft"), draftDone ? "ok" : (s === "draft" ? "doing" : "todo"));
  setDot(el("dotFinal"), finalDone ? "ok" : (s === "final" ? "doing" : "todo"));

  el("stateLabel").textContent = STATE_MAP[s];
  el("stateLabelBottom").textContent = STATE_MAP[s];
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelector('.tab[data-tab="workbench"]').classList.add("active");

  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  el("panelWorkbench").classList.add("active");
}

function stepCard({ key, title, sub, bodyHtml }) {
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
  const toggle = () => wrapper.classList.toggle("open");
  hd.addEventListener("click", toggle);
  hd.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") toggle();
  });

  return wrapper;
}

function inputField({ id, label, placeholder = "", value = "", type = "text" }) {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" type="${type}" placeholder="${placeholder}" value="${escapeHtml(value)}" />
    </div>
  `;
}

function textareaField({ id, label, placeholder = "", value = "" }) {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <textarea id="${id}" placeholder="${placeholder}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

function selectField({ id, label, options, value }) {
  const opts = options
    .map(
      (o) =>
        `<option value="${o.value}" ${o.value === value ? "selected" : ""}>${o.label}</option>`
    )
    .join("");
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select id="${id}">${opts}</select>
    </div>
  `;
}

function renderSteps() {
  const area = el("stepsArea");
  area.innerHTML = "";

  const s = model.state;

  if (s === "idea") {
    area.appendChild(
      stepCard({
        key: "I1",
        title: "I-1｜一句話定義",
        sub: "課名、對象、關鍵痛點（先站穩，不求完整）",
        bodyHtml: `
          <div class="grid two">
            ${inputField({ id:"f_title", label:"課名（title）", placeholder:"例如：給親子的｜幸福教養體驗活動", value:model.title })}
            ${inputField({ id:"f_audience", label:"對象（audience）", placeholder:"例如：親子/家長/老師", value:model.audience })}
          </div>
          <div class="grid two">
            ${inputField({ id:"f_type", label:"類型（type）", placeholder:"例如：活動/課程/工作坊", value:model.type })}
            ${inputField({ id:"f_tags", label:"標籤/痛點（tags）", placeholder:"#情緒急救 #關係修復 #不打不罵", value:model.tags })}
          </div>
          <div class="hint">小提醒：這一步只要「說得出口」就好，先不要追求漂亮。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "I2",
        title: "I-2｜結果感（結尾一句話）",
        sub: "一句能定錨的話：讓這堂課有「回得來」的感覺",
        bodyHtml: `
          ${textareaField({ id:"f_closing", label:"結尾定錨句（closing_line）", placeholder:"例如：孩子不需要你完美，他需要你回得來。", value:model.closing_line })}
          <div class="hint">這句話會被帶進 AI 指令，幫你守住整堂課的靈魂。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "I3",
        title: "I-3｜工具配方（先手填，下一步接工具庫）",
        sub: "主工具單選 / 副工具多選（下一步會做「不遮罩勾選」）",
        bodyHtml: `
          <div class="grid two">
            ${inputField({ id:"f_main_tool_name", label:"主工具名稱（main_tool_name）", placeholder:"例如：Angel｜五感覺察 PWA", value:model.main_tool_name })}
            ${inputField({ id:"f_main_tool_link", label:"主工具連結（main_tool_link）", placeholder:"貼工具網址", value:model.main_tool_link })}
          </div>
          ${textareaField({ id:"f_tools_with_links", label:"副工具清單（tool_list_with_links）", placeholder:"每行一個：工具名｜連結", value:model.tool_list_with_links })}
          <div class="hint">下一步（2-2）我們會把「工具庫管理 API」接上，讓你用搜尋＋勾選完成。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "I4",
        title: "I-4｜粗架構（8 集一句話大綱）",
        sub: "先用最短句把 8 集站起來",
        bodyHtml: `
          ${textareaField({ id:"f_framework", label:"8 集一句話大綱（framework_text）", placeholder:"01 ...\\n02 ...\\n03 ...（到 08）", value:model.framework_text })}
          <div class="row">
            <button class="btn primary" id="btnGoDraft">進草稿 →</button>
          </div>
          <div class="hint">你不用一次寫好，能先寫出「方向」就很夠。</div>
        `,
      })
    );
  }

  if (s === "draft") {
    area.appendChild(
      stepCard({
        key: "D1",
        title: "D-1｜目標與節律",
        sub: "可試教、可內測：先把目標與每週節律說清楚",
        bodyHtml: `
          ${textareaField({ id:"f_objectives", label:"目標（objectives）", placeholder:"用條列：\\n- ...", value:model.objectives })}
          ${inputField({ id:"f_rhythm", label:"每週節律（rhythm）", placeholder:"例如：120 分鐘｜90 分鐘｜含作業", value:model.rhythm })}
          <div class="hint">這裡越清楚，AI 幫你補內容就越準。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "D2",
        title: "D-2｜八堂詳細版（短表述）",
        sub: "每集：目標、工具、練習、作業（可直接拿去試教）",
        bodyHtml: `
          ${textareaField({ id:"f_outline", label:"八堂詳細版（outline）", placeholder:"第1堂：目標｜工具｜練習｜作業\\n第2堂：...", value:model.outline })}
          <div class="hint">先寫「短表述」，不要寫作文；我們要可用、可調。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "D3",
        title: "D-3｜交付物與材料",
        sub: "練習單、提醒、講稿、指引、結業小抄…",
        bodyHtml: `
          ${textareaField({ id:"f_materials", label:"材料/交付物（materials）", placeholder:"用清單：\\n- 練習單...\\n- 提醒卡...", value:model.materials })}
          ${textareaField({ id:"f_links", label:"連結整理（links）", placeholder:"工具連結、素材連結…", value:model.links })}
          <div class="hint">下一步接工具庫後，links 會自動整理。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "D4",
        title: "D-4｜回饋與追蹤",
        sub: "每週回饋題、追蹤方式、工具使用頻率建議",
        bodyHtml: `
          ${textareaField({ id:"f_feedback", label:"回饋與追蹤（feedback）", placeholder:"每週 3 題回饋：\\n1) ...\\n2) ...\\n追蹤方式：...", value:model.feedback })}
          <div class="row">
            <button class="btn primary" id="btnGoFinal">進完稿 →</button>
          </div>
          <div class="hint">草稿完成後，我們才進完稿（對外提案版）。</div>
        `,
      })
    );
  }

  if (s === "final") {
    area.appendChild(
      stepCard({
        key: "F1",
        title: "F-1｜正式提案版文案",
        sub: "對外版 summary / objectives / why effective（一句腦科學＋幸福教養）",
        bodyHtml: `
          ${textareaField({ id:"f_summary", label:"對外版摘要（summary）", placeholder:"一段能對外提案的文字", value:model.summary })}
          ${textareaField({ id:"f_objectives_final", label:"對外可讀版目標（objectives）", placeholder:"條列、對外可讀", value:model.objectives })}
          ${textareaField({ id:"f_notes_why", label:"why effective（一句話）", placeholder:"腦科學＋幸福教養一句話", value:model.notes })}
          <div class="hint">這一塊是你對外的門面：短、清楚、有力。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "F2",
        title: "F-2｜課程設計定稿",
        sub: "正式版 outline / materials / links",
        bodyHtml: `
          ${textareaField({ id:"f_outline_final", label:"正式版流程（outline）", placeholder:"可上架版本", value:model.outline })}
          ${textareaField({ id:"f_materials_final", label:"材料清單（materials）", placeholder:"可上架版本", value:model.materials })}
          ${textareaField({ id:"f_links_final", label:"連結整理（links）", placeholder:"工具連結整理", value:model.links })}
          <div class="hint">完稿要「可直接交付」：任何人拿到都能照做。</div>
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "F3",
        title: "F-3｜製作物生成（由 AI 指令一鍵帶出）",
        sub: "PPT 大綱、逐頁講稿、口播稿、主持稿（可全要）",
        bodyHtml: `
          <div class="hint">
            這一步不用你手打。你按底部「一鍵複製｜AI 指令」，貼到 ChatGPT/Gemini，
            它會依「完稿」狀態輸出：提案版＋PPT＋逐頁講稿＋口播稿＋主持稿。
          </div>
          ${textareaField({ id:"f_assets", label:"assets（檔案清單）", placeholder:"例如：ppt/講稿/練習單/音檔…", value:model.assets })}
        `,
      })
    );

    area.appendChild(
      stepCard({
        key: "F4",
        title: "F-4｜確認與封存",
        sub: "version、status（預設 ready）、notes",
        bodyHtml: `
          <div class="grid two">
            ${inputField({ id:"f_version", label:"版本（version）", placeholder:"例如 v1 / v1.1", value:model.version })}
            ${selectField({
              id:"f_status",
              label:"狀態（status）",
              value:model.status || "ready",
              options:[
                {value:"ready", label:"ready（可上架）"},
                {value:"hold", label:"hold（暫緩）"},
                {value:"archived", label:"archived（封存）"}
              ]
            })}
          </div>
          ${textareaField({ id:"f_notes", label:"notes（備註）", placeholder:"封存說明、注意事項…", value:model.notes })}
          <div class="hint">完稿表只收成品：保守起見，status 預設 ready。</div>
        `,
      })
    );
  }

  bindInputs();
  bindStateJumpButtons();
}

function bindStateJumpButtons(){
  const btnGoDraft = document.getElementById("btnGoDraft");
  if (btnGoDraft) btnGoDraft.addEventListener("click", () => setState("draft"));

  const btnGoFinal = document.getElementById("btnGoFinal");
  if (btnGoFinal) btnGoFinal.addEventListener("click", () => setState("final"));
}

function bindInputs() {
  // Idea
  bindValue("f_title", "title");
  bindValue("f_audience", "audience");
  bindValue("f_type", "type");
  bindValue("f_tags", "tags");
  bindValue("f_closing", "closing_line");
  bindValue("f_main_tool_name", "main_tool_name");
  bindValue("f_main_tool_link", "main_tool_link");
  bindValue("f_tools_with_links", "tool_list_with_links");
  bindValue("f_framework", "framework_text");

  // Draft
  bindValue("f_objectives", "objectives");
  bindValue("f_rhythm", "rhythm");
  bindValue("f_outline", "outline");
  bindValue("f_materials", "materials");
  bindValue("f_links", "links");
  bindValue("f_feedback", "feedback");

  // Final
  bindValue("f_summary", "summary");
  bindValue("f_objectives_final", "objectives");
  bindValue("f_notes_why", "notes");
  bindValue("f_outline_final", "outline");
  bindValue("f_materials_final", "materials");
  bindValue("f_links_final", "links");
  bindValue("f_assets", "assets");
  bindValue("f_version", "version");
  bindSelect("f_status", "status");
  bindValue("f_notes", "notes");
}

function bindValue(inputId, field) {
  const node = document.getElementById(inputId);
  if (!node) return;

  const handler = () => {
    model[field] = node.value;
    model.updated_at = nowISO();
    renderProgress();
  };

  node.addEventListener("input", handler);
}

function bindSelect(selectId, field) {
  const node = document.getElementById(selectId);
  if (!node) return;
  node.addEventListener("change", () => {
    model[field] = node.value;
    model.updated_at = nowISO();
    renderProgress();
  });
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function buildAIPrompt() {
  ensureId();
  if (!model.created_at) model.created_at = nowISO();
  if (!model.updated_at) model.updated_at = nowISO();

  const stateZh = STATE_MAP[model.state];
  const toolList = model.tool_list_with_links || "";
  const mainToolLine = `${model.main_tool_name || ""}｜${model.main_tool_link || ""}`.trim();

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
    `結尾定錨句：${model.closing_line}`,
  ].join("\n");

  const block1 = [
    "1｜請你輸出三份成果（務必分段標題）",
    "A) 活動/課程規劃（定位、目標、節律、適用場域）",
    "B) 詳細設計內容（每集內容、現場流程、練習、作業）",
    "C) 回饋與追蹤方案（每週追蹤、回饋題、工具使用節律）",
  ].join("\n");

  const block2 = [
    "2｜依目前狀態輸出格式（很重要）",
    `若 ${stateZh}=發想：請先產出「8集一句話大綱」與「最小可行練習」，不要寫太長。`,
    `若 ${stateZh}=草稿：請補齊每集「目標/工具/練習/作業」，可直接拿去試教。`,
    `若 ${stateZh}=完稿：請產出「對外提案版」＋「PPT大綱」＋「逐頁講稿」＋「口播稿」＋「演說/主持稿」。`,
  ].join("\n");

  const block3 = [
    "3｜最後請再輸出：表單橫向一列（可貼入）",
    "請依下列表頭輸出一列（用 tab 分隔）：",
    "{id, title, type, status, version, owner, audience, duration_min, capacity, tags, summary, objectives, outline, materials, links, assets, notes, created_at, updated_at}",
    "若 發想：summary/objectives/outline 可短版",
    "若 草稿：summary/objectives/outline 完整版",
    "若 完稿：全部欄位給可上架的定稿版（status 預設 ready）",
  ].join("\n");

  return [header, "", block0, "", block1, "", block2, "", block3].join("\n");
}

function buildTSVRow() {
  ensureId();
  if (!model.created_at) model.created_at = nowISO();
  model.updated_at = nowISO();

  // per state: keep short/long
  let summary = model.summary || "";
  let objectives = model.objectives || "";
  let outline = model.outline || "";
  let materials = model.materials || "";
  let links = model.links || "";

  if (model.state === "idea") {
    // short
    summary = summary || `發想：${model.title}`.trim();
    objectives = objectives || "";
    outline = outline || model.framework_text || "";
    materials = materials || "";
  }

  if (model.state === "draft") {
    summary = summary || `草稿：可試教版本｜${model.title}`.trim();
    // keep objectives/outline as-is
  }

  if (model.state === "final") {
    // final must be ready-ish
    model.status = model.status || "ready";
    summary = summary || `完稿：可對外提案｜${model.title}`.trim();
  }

  // links: auto include main tool if present (simple)
  const mainToolLine = `${model.main_tool_name || ""} ${model.main_tool_link || ""}`.trim();
  if (mainToolLine && !links.includes(model.main_tool_link || "")) {
    links = [links, mainToolLine].filter(Boolean).join("\n");
  }

  const cols = [
    model.id,
    model.title,
    model.type,
    model.status || "ready",
    model.version || "v1",
    model.owner,
    model.audience,
    model.duration_min,
    model.capacity,
    model.tags,
    summary,
    objectives,
    outline,
    materials,
    links,
    model.assets,
    model.notes,
    model.created_at,
    model.updated_at,
  ];

  return cols.map(sanitizeTSVCell).join("\t");
}

function sanitizeTSVCell(v){
  const s = String(v ?? "");
  // keep tabs out; keep newlines allowed but best to replace with \n so pasting stays in one cell
  return s.replaceAll("\t"," ").replaceAll("\r\n","\n").replaceAll("\r","\n").replaceAll("\n","\\n");
}

async function copyToClipboard(text) {
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

function saveLocal() {
  ensureId();
  if (!model.created_at) model.created_at = nowISO();
  model.updated_at = nowISO();
  localStorage.setItem(LS_KEY, JSON.stringify(model));
  el("saveHint").textContent = "已存本機 ✓";
  setTimeout(() => (el("saveHint").textContent = ""), 1600);
}

function loadLocal() {
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    return null;
  }
}

function exportJson() {
  ensureId();
  if (!model.created_at) model.created_at = nowISO();
  model.updated_at = nowISO();

  const blob = new Blob([JSON.stringify(model, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${model.id || "course"}-${model.state}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function bindTopProgressButtons() {
  document.querySelectorAll(".pill").forEach((b) => {
    b.addEventListener("click", () => setState(b.dataset.state));
  });
}

function bindBottomButtons() {
  el("btnCopyAI").addEventListener("click", async () => {
    const text = buildAIPrompt();
    const ok = await copyToClipboard(text);
    el("saveHint").textContent = ok ? "AI 指令已複製 ✓" : "複製失敗（可改用長按）";
    setTimeout(() => (el("saveHint").textContent = ""), 1600);
  });

  el("btnCopyTSV").addEventListener("click", async () => {
    const text = buildTSVRow();
    const ok = await copyToClipboard(text);
    el("saveHint").textContent = ok ? "TSV 一列已複製 ✓" : "複製失敗（可改用長按）";
    setTimeout(() => (el("saveHint").textContent = ""), 1600);
  });

  el("btnSaveLocal").addEventListener("click", saveLocal);
  el("btnExportJson").addEventListener("click", exportJson);

  el("btnSettings").addEventListener("click", () => {
    alert("設定（下一步）：會加入 API 設定、預設 owner、預設時長/人數。");
  });
}

function renderAll() {
  renderTabs();
  renderProgress();
  renderSteps();
}

function init() {
  // default timestamps
  if (!model.created_at) model.created_at = "";
  if (!model.updated_at) model.updated_at = "";

  bindTopProgressButtons();
  bindBottomButtons();

  // tabs (only workbench now)
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      const name = t.dataset.tab;
      if (t.disabled) return;
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      t.classList.add("active");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      if (name === "workbench") el("panelWorkbench").classList.add("active");
      if (name === "tools") el("panelTools").classList.add("active");
      if (name === "finalList") el("panelFinalList").classList.add("active");
    });
  });

  renderAll();
}

init();