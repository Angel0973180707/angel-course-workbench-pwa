/* ========= Angel Course Workbench (Frontend) =========
 * app.js - Full overwrite
 * Goal: tools list ALWAYS shows (auto-heal tools API + multi-candidate fetch)
 */

"use strict";

/* =========================
   0) API Defaults (Hard)
========================= */

const DEFAULT_COURSE_API =
  "https://script.google.com/macros/s/AKfycbw6F3CLm7XR1ONP4_2ryRzdN8T2mJ48UGHbntGzECs77UtRbEM59PLwk9GJ7h4SMjmjKg/exec";

const DEFAULT_TOOLS_API =
  "https://script.google.com/macros/s/AKfycbw6F3CLm7XR1ONP4_2ryRzdN8T2mJ48UGHbntGzECs77UtRbEM59PLwk9GJ7h4SMjmjKg/exec?sheet=%E5%B7%A5%E5%85%B7%E5%BA%AB%E5%AD%98%E7%AE%A1%E7%90%86&format=tools";

/* =========================
   1) DOM Helpers
========================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  (children || []).forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}

function toast(msg) {
  const n = $("#toast");
  if (!n) return alert(msg);
  n.textContent = msg;
  n.classList.add("show");
  setTimeout(() => n.classList.remove("show"), 2200);
}

/* =========================
   2) Settings (auto-heal)
========================= */

function readSettings(){
  const saved = JSON.parse(localStorage.getItem("angelCourseWB.settings") || "{}");
  let courseApi = saved.courseApi || DEFAULT_COURSE_API;
  let toolsApi  = saved.toolsApi  || DEFAULT_TOOLS_API;

  // auto-heal: if user previously saved a base exec url, make it a tools endpoint
  try {
    const tu = new URL(toolsApi);
    // if it's the same as course api (no params), add required params
    if (!tu.searchParams.get("format")) tu.searchParams.set("format","tools");
    if (!tu.searchParams.get("sheet")) tu.searchParams.set("sheet","工具庫存管理");
    // normalize common mistakes
    const sheet = tu.searchParams.get("sheet");
    if (sheet && sheet.toLowerCase() === "tools") tu.searchParams.set("sheet","工具庫存管理");
    toolsApi = tu.toString();
  } catch(_) {
    toolsApi = DEFAULT_TOOLS_API;
  }

  // if courseApi is not a valid URL, fallback to default
  try { new URL(courseApi); } catch(_) { courseApi = DEFAULT_COURSE_API; }

  return { courseApi, toolsApi };
}

function writeSettings(next) {
  const cur = readSettings();
  const merged = { ...cur, ...(next || {}) };
  localStorage.setItem("angelCourseWB.settings", JSON.stringify(merged));
  return merged;
}

/* =========================
   3) API helpers
========================= */

async function apiGet(url) {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const json = await res.json();
  return json;
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return json;
}

/* =========================
   4) Tools normalize
========================= */

// Your backend may return:
// - {toolCode,name,link,category,...}
// or
// - {id,title,link,category,...}
// We normalize into:
// { toolCode, name, link, category, core, pain_points, chapters, steps, tips, video_title, video_link, status }

function normalizeTool(t = {}) {
  const toolCode = String(t.toolCode || t.id || t.code || "").trim();
  const name = String(t.name || t.title || "").trim();
  const link = String(t.link || t.url || "").trim();
  const category = String(t.category || t.type || "").trim();

  return {
    toolCode,
    name,
    link,
    category,
    core: String(t.core || "").trim(),
    pain_points: String(t.pain_points || t.painPoints || "").trim(),
    chapters: String(t.chapters || "").trim(),
    steps: String(t.steps || "").trim(),
    tips: String(t.tips || "").trim(),
    video_title: String(t.video_title || t.videoTitle || "").trim(),
    video_link: String(t.video_link || t.videoLink || "").trim(),
    status: String(t.status || "").trim(),
    _raw: t,
  };
}

/* =========================
   5) Tools fetch (guaranteed)
========================= */

async function toolsFetchAll(){
  const { toolsApi, courseApi } = readSettings();

  // Build a small set of candidate URLs.
  // This makes the tool list "always show up" even if a stored URL is wrong or missing params.
  const candidates = [];
  const pushCandidate = (u)=>{
    if(!u) return;
    const s = String(u);
    if(!candidates.includes(s)) candidates.push(s);
  };

  // 1) use saved toolsApi first
  pushCandidate(toolsApi);

  // 2) derive from courseApi (same exec, with tools params)
  try{
    const base = new URL(courseApi);
    base.search = "";
    const u = new URL(base.toString());
    u.searchParams.set("sheet","工具庫存管理");
    u.searchParams.set("format","tools");
    pushCandidate(u.toString());

    const u2 = new URL(base.toString());
    u2.searchParams.set("sheet","tools");
    u2.searchParams.set("format","tools");
    pushCandidate(u2.toString());
  }catch(_){}

  // 3) ultimate fallback: hard-coded default
  pushCandidate(DEFAULT_TOOLS_API);

  let lastErr = null;
  for(const url of candidates){
    try{
      const res = await fetch(url, { method:"GET", cache:"no-store" });
      const json = await res.json();
      if(json && json.ok){
        const raw = Array.isArray(json.tools) ? json.tools : (Array.isArray(json.items) ? json.items : []);
        if(raw && raw.length){
          // normalize to expected fields
          const normalized = raw.map(normalizeTool).filter(t=>t.toolCode && t.name);
          if(normalized.length){
            return { ok:true, tools: normalized, source:url, rawCount: raw.length };
          }
        }
        // ok but empty → continue trying next candidate
        lastErr = new Error("tools empty from: "+url);
        continue;
      }
      lastErr = new Error((json && json.error) ? json.error : ("tools fetch failed: "+url));
    }catch(err){
      lastErr = err;
    }
  }
  return { ok:false, error: String(lastErr || "tools fetch failed") };
}

/* =========================
   6) Course editor state
========================= */

const state = {
  tools: [],
  toolsLoaded: false,
  mainTool: null,
  subTools: [],
};

function setMainToolDisplay() {
  const line = $("#mainToolLine");
  if (!line) return;
  if (!state.mainTool) {
    line.textContent = "（尚未選擇）";
    return;
  }
  line.textContent = `${state.mainTool.toolCode}｜${state.mainTool.name}`;
}

function setSubToolsDisplay() {
  const line = $("#subToolsLine");
  if (!line) return;
  if (!state.subTools.length) {
    line.textContent = "（尚未選擇）";
    return;
  }
  line.textContent = state.subTools.map((t) => `${t.toolCode}｜${t.name}`).join("；");
}

/* =========================
   7) Tools modal UI
========================= */

function openModal() {
  const m = $("#toolModal");
  if (!m) return;
  m.classList.add("open");
  m.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const m = $("#toolModal");
  if (!m) return;
  m.classList.remove("open");
  m.setAttribute("aria-hidden", "true");
}

function fillToolFilters(tools) {
  const catSel = $("#toolFilterCategory");
  if (!catSel) return;
  const cats = Array.from(new Set(tools.map((t) => t.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  catSel.innerHTML = "";
  catSel.appendChild(el("option", { value: "" }, ["全部分類"]));
  cats.forEach((c) => catSel.appendChild(el("option", { value: c }, [c])));
}

function renderToolList() {
  const list = $("#toolList");
  if (!list) return;

  const q = String($("#toolSearch")?.value || "").trim().toLowerCase();
  const cat = String($("#toolFilterCategory")?.value || "").trim();

  let items = state.tools.slice();
  if (cat) items = items.filter((t) => t.category === cat);
  if (q) {
    items = items.filter((t) => {
      const hay = `${t.toolCode} ${t.name} ${t.core} ${t.pain_points} ${t.category}`.toLowerCase();
      return hay.includes(q);
    });
  }

  list.innerHTML = "";

  if (!items.length) {
    list.appendChild(el("div", { class: "tool-empty" }, ["（沒有可顯示的工具）"]));
    return;
  }

  items.forEach((t) => {
    const row = el("div", { class: "tool-row" }, [
      el("label", { class: "tool-check" }, [
        el("input", { type: "checkbox", "data-code": t.toolCode }),
        el("span", { class: "tool-title" }, [`${t.toolCode}｜${t.name}`]),
      ]),
      el("div", { class: "tool-meta" }, [
        t.category ? el("span", { class: "chip" }, [t.category]) : el("span", { class: "chip ghost" }, ["未分類"]),
        t.link ? el("a", { class: "tool-link", href: t.link, target: "_blank", rel: "noopener" }, ["開啟"]) : el("span", { class: "muted" }, [""]),
      ]),
    ]);

    // pre-check existing selections
    const input = row.querySelector("input");
    const selected =
      (state.mainTool && state.mainTool.toolCode === t.toolCode) ||
      state.subTools.some((s) => s.toolCode === t.toolCode);
    input.checked = !!selected;

    list.appendChild(row);
  });
}

function applyToolSelectionFromModal() {
  // gather checked
  const checked = $$("#toolList input[type='checkbox']:checked")
    .map((i) => String(i.getAttribute("data-code") || "").trim())
    .filter(Boolean);

  const byCode = new Map(state.tools.map((t) => [t.toolCode, t]));
  const picked = checked.map((c) => byCode.get(c)).filter(Boolean);

  // choose main tool = first picked, sub tools = rest
  state.mainTool = picked[0] || null;
  state.subTools = picked.slice(1);

  setMainToolDisplay();
  setSubToolsDisplay();
  closeModal();
}

/* =========================
   8) Load tools on demand
========================= */

async function ensureToolsLoaded(force = false) {
  if (state.toolsLoaded && !force) return true;

  const hint = $("#toolsHint");
  if (hint) hint.textContent = "正在同步工具庫…";

  const result = await toolsFetchAll();
  if (!result.ok) {
    if (hint) hint.textContent = "工具庫同步失敗（可再試一次）";
    toast("工具庫抓取失敗：" + result.error);
    state.toolsLoaded = false;
    state.tools = [];
    fillToolFilters([]);
    renderToolList();
    return false;
  }

  state.tools = result.tools;
  state.toolsLoaded = true;

  if (hint) hint.textContent = `工具庫已同步：${state.tools.length} 項`;

  fillToolFilters(state.tools);
  renderToolList();
  return true;
}

/* =========================
   9) Editor save (course)
========================= */

function collectCourseForm() {
  // basic fields (minimal; keep compatible with your backend headers)
  const item = {};

  item.title = String($("#fTitle")?.value || "").trim();
  item.type = String($("#fType")?.value || "").trim();
  item.audience = String($("#fAudience")?.value || "").trim();
  item.duration_min = String($("#fDuration")?.value || "").trim();
  item.capacity = String($("#fCapacity")?.value || "").trim();
  item.tags = String($("#fTags")?.value || "").trim();
  item.summary = String($("#fSummary")?.value || "").trim();
  item.objectives = String($("#fObjectives")?.value || "").trim();
  item.outline = String($("#fOutline")?.value || "").trim();
  item.materials = String($("#fMaterials")?.value || "").trim();
  item.links = String($("#fLinks")?.value || "").trim();
  item.notes = String($("#fNotes")?.value || "").trim();

  // tools selection saved in fields that are easy to parse later
  item.main_tool = state.mainTool ? `${state.mainTool.toolCode}｜${state.mainTool.name}｜${state.mainTool.link || ""}` : "";
  item.sub_tools = state.subTools
    .map((t) => `${t.toolCode}｜${t.name}｜${t.link || ""}`)
    .join("\n");

  // ai prompts (if your form has these)
  item.ai_name = String($("#aiName")?.value || "").trim();
  item.ai_content = String($("#aiContent")?.value || "").trim();
  item.ai_flow = String($("#aiFlow")?.value || "").trim();
  item.ai_kpi = String($("#aiKpi")?.value || "").trim();
  item.ai_brief = String($("#aiBrief")?.value || "").trim();
  item.ai_detail = String($("#aiDetail")?.value || "").trim();
  item.ai_slides = String($("#aiSlides")?.value || "").trim();

  // id (if editing an existing item)
  item.id = String($("#fId")?.value || "").trim();

  return item;
}

async function saveCourseToBackend(stateName = "final") {
  const { courseApi } = readSettings();
  const item = collectCourseForm();

  if (!item.title) {
    toast("先填一下主題（title）就好。");
    return;
  }

  const url = new URL(courseApi);
  url.searchParams.set("mode", "upsert");
  url.searchParams.set("state", stateName);

  const res = await apiPost(url.toString(), { item });
  if (!res || !res.ok) {
    toast("存檔失敗：" + (res?.error || "unknown"));
    return;
  }

  // write back id
  if ($("#fId")) $("#fId").value = res.id || item.id || "";
  toast("已存回後臺 ✅");
}

/* =========================
   10) Bind events
========================= */

function bindSettingsUI() {
  const { courseApi, toolsApi } = readSettings();

  if ($("#courseApiUrl")) $("#courseApiUrl").value = courseApi;
  if ($("#toolsApiUrl")) $("#toolsApiUrl").value = toolsApi;

  $("#btnSaveApi")?.addEventListener("click", () => {
    const nextCourse = String($("#courseApiUrl")?.value || "").trim() || DEFAULT_COURSE_API;
    const nextTools = String($("#toolsApiUrl")?.value || "").trim() || DEFAULT_TOOLS_API;
    writeSettings({ courseApi: nextCourse, toolsApi: nextTools });
    toast("API 已更新");
  });

  $("#btnPingApi")?.addEventListener("click", async () => {
    try {
      const { courseApi } = readSettings();
      const u = new URL(courseApi);
      u.searchParams.set("mode", "ping");
      const res = await apiGet(u.toString());
      if (res.ok) toast("後臺連線 OK ✅");
      else toast("後臺回應：" + (res.error || "unknown"));
    } catch (e) {
      toast("Ping 失敗：" + String(e));
    }
  });

  $("#btnSyncTools")?.addEventListener("click", async () => {
    await ensureToolsLoaded(true);
  });
}

function bindToolsUI() {
  $("#btnPickTools")?.addEventListener("click", async () => {
    const ok = await ensureToolsLoaded(false);
    if (!ok) return;
    openModal();
  });

  $("#toolModalClose")?.addEventListener("click", closeModal);
  $("#toolCancel")?.addEventListener("click", closeModal);

  $("#toolSearch")?.addEventListener("input", renderToolList);
  $("#toolFilterCategory")?.addEventListener("change", renderToolList);

  $("#toolApply")?.addEventListener("click", applyToolSelectionFromModal);
}

function bindSaveUI() {
  $("#btnSaveFinal")?.addEventListener("click", () => saveCourseToBackend("final"));
  $("#btnSaveDraft")?.addEventListener("click", () => saveCourseToBackend("draft"));
  $("#btnSaveIdea")?.addEventListener("click", () => saveCourseToBackend("idea"));
}

/* =========================
   11) Boot
========================= */

document.addEventListener("DOMContentLoaded", async () => {
  bindSettingsUI();
  bindToolsUI();
  bindSaveUI();

  // show placeholders
  setMainToolDisplay();
  setSubToolsDisplay();

  // optional: preload tools silently (won't block UI)
  // If you prefer "only load when user clicks", comment the line below.
  ensureToolsLoaded(false);
});