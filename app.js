/* Angel Course Workbench (Frontend) - app.js (Full Overwrite)
 * Goal: 100% render tools + selectable + state switching + save to GAS backend
 * Requires HTML ids already in your index.html:
 * btnSettings, sheetHint, lastMsg, searchInput, btnSearch, btnNew, btnRefresh,
 * list, formTitle, formType, formAudience, formDuration, formCapacity, formLocation,
 * formCore, formTags, formSummary, formObjectives, formOutline, formMaterials,
 * formLinks, formAssets, formNotes,
 * btnPickTools, toolsChosen,
 * btnAi, btnCopyTSV, btnSave, btnDelete,
 * btnPromote, promoteTo,
 * btnModuleBuilder, modulePanel, moduleList, moduleTitle, moduleSummary, moduleDuration, btnBuildModule, btnCloseModule
 */

(() => {
  "use strict";

  /* =========================
   * 0) Config / State
   * ========================= */
  const LS_KEY_API = "angel_course_api_url";
  const LS_KEY_STATE = "angel_course_state";
  const LS_KEY_LAST_ID = "angel_course_last_id";
  const LS_KEY_TOOLS_CACHE = "angel_tools_cache_v1";

  const STATES = [
    { key: "idea",  label: "發想", sheetHint: "發想" },
    { key: "draft", label: "草稿", sheetHint: "草稿" },
    { key: "final", label: "完稿", sheetHint: "幸福教養課程" },
  ];

  let currentState = loadState_();
  let currentItem = null;
  let toolsCache = null;
  let toolsSelected = { primary: null, secondary: [] };

  /* =========================
   * 1) DOM helpers
   * ========================= */
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setMsg(msg, isError = false) {
    const el = $("lastMsg");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "";
  }

  function toast_(msg, isError = false) {
    setMsg(msg, isError);
    let t = $("__toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "__toast";
      t.style.position = "fixed";
      t.style.left = "50%";
      t.style.bottom = "18px";
      t.style.transform = "translateX(-50%)";
      t.style.padding = "10px 12px";
      t.style.borderRadius = "12px";
      t.style.boxShadow = "0 10px 30px rgba(0,0,0,.12)";
      t.style.zIndex = "9999";
      t.style.maxWidth = "92vw";
      t.style.fontSize = "14px";
      t.style.lineHeight = "1.4";
      t.style.opacity = "0";
      t.style.transition = "opacity .15s ease";
      document.body.appendChild(t);
    }
    t.style.background = isError ? "#ffe8ea" : "#ecfff3";
    t.style.border = isError ? "1px solid #ffb3bb" : "1px solid #bfe9c9";
    t.style.color = isError ? "#7a0010" : "#0b4a1e";
    t.textContent = msg || "";
    requestAnimationFrame(() => (t.style.opacity = "1"));
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => (t.style.opacity = "0"), 2200);
  }

  function safeJson_(t) { try { return JSON.parse(t); } catch { return null; } }

  /* =========================
   * 2) API helpers
   * ========================= */
  function getApiUrl_() {
    return (localStorage.getItem(LS_KEY_API) || "").trim();
  }
  function setApiUrl_(url) {
    localStorage.setItem(LS_KEY_API, String(url || "").trim());
  }
  function api_(pathAndQuery) {
    const base = getApiUrl_();
    if (!base) throw new Error("尚未設定後臺 API（請點右上設定）");
    const glue = base.includes("?") ? "&" : "?";
    return base + glue + pathAndQuery.replace(/^\?/, "");
  }

  async function fetchJson_(url, opt) {
    const res = await fetch(url, opt || {});
    const text = await res.text();
    const j = safeJson_(text);
    if (!j) throw new Error("後臺回傳不是 JSON：" + text.slice(0, 120));
    if (j.ok === false) throw new Error(j.error || "後臺錯誤");
    return j;
  }

  async function apiPing_() { return await fetchJson_(api_("mode=ping")); }

  async function apiList_(state, q) {
    const p = new URLSearchParams();
    p.set("mode", "list");
    p.set("state", state);
    if (q) p.set("q", q);
    p.set("limit", "300");
    return await fetchJson_(api_(p.toString()));
  }

  async function apiGet_(state, id) {
    const p = new URLSearchParams();
    p.set("mode", "get");
    p.set("state", state);
    p.set("id", id);
    return await fetchJson_(api_(p.toString()));
  }

  async function apiUpsert_(state, item) {
    const p = new URLSearchParams();
    p.set("mode", "upsert");
    p.set("state", state);
    return await fetchJson_(api_(p.toString()), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ item }),
    });
  }

  async function apiDelete_(state, id) {
    const p = new URLSearchParams();
    p.set("mode", "delete");
    p.set("state", state);
    p.set("id", id);
    return await fetchJson_(api_(p.toString()));
  }

  async function apiPromote_(from, to, id, overwrite = true) {
    const p = new URLSearchParams();
    p.set("mode", "promote");
    p.set("from", from);
    p.set("to", to);
    p.set("id", id);
    if (overwrite) p.set("overwrite", "1");
    return await fetchJson_(api_(p.toString()));
  }

  async function apiTools_() {
    const p = new URLSearchParams();
    p.set("sheet", "工具庫存管理");
    p.set("format", "tools");
    return await fetchJson_(api_(p.toString()));
  }

  /* =========================
   * 3) State + UI wiring
   * ========================= */
  function loadState_() {
    const v = (localStorage.getItem(LS_KEY_STATE) || "idea").trim().toLowerCase();
    return STATES.some(s => s.key === v) ? v : "idea";
  }
  function saveState_(state) { localStorage.setItem(LS_KEY_STATE, state); }

  function setStateUI_(state) {
    currentState = state;
    saveState_(state);
    qsa(".segBtn[data-state]").forEach(btn => {
      const on = btn.getAttribute("data-state") === state;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const st = STATES.find(s => s.key === state) || STATES[0];
    const hint = $("sheetHint");
    if (hint) hint.textContent = `目前狀態：${st.label}（寫入分頁：${st.sheetHint}）`;
    setMsg("");
  }

  function bindStateButtons_() {
    qsa(".segBtn[data-state]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const state = btn.getAttribute("data-state");
        if (!state) return;
        setStateUI_(state);
        await reloadList_();
      });
    });
  }

  /* =========================
   * 4) Form read/write
   * ========================= */
  function readForm_() {
    const item = currentItem ? { ...currentItem } : {};
    item.title = ($("formTitle")?.value || "").trim();
    item.type = ($("formType")?.value || "").trim();
    item.audience = ($("formAudience")?.value || "").trim();
    item.duration_min = ($("formDuration")?.value || "").trim();
    item.capacity = ($("formCapacity")?.value || "").trim();
    item.location = ($("formLocation")?.value || "").trim();
    item.core = ($("formCore")?.value || "").trim();
    item.tags = ($("formTags")?.value || "").trim();
    item.summary = ($("formSummary")?.value || "").trim();
    item.objectives = ($("formObjectives")?.value || "").trim();
    item.outline = ($("formOutline")?.value || "").trim();
    item.materials = ($("formMaterials")?.value || "").trim();
    item.links = ($("formLinks")?.value || "").trim();
    item.assets = ($("formAssets")?.value || "").trim();
    item.notes = ($("formNotes")?.value || "").trim();

    item.tools_primary = toolsSelected.primary || "";
    item.tools_secondary = (toolsSelected.secondary || []).join(", ");
    item.tools_text = buildToolsText_();

    item.status = currentState;
    item.owner = item.owner || "Angel";
    item.version = item.version || "v1";
    return item;
  }

  function writeForm_(item) {
    currentItem = item ? { ...item } : null;
    const safe = (v) => (v === undefined || v === null) ? "" : String(v);

    $("formTitle").value = safe(item?.title);
    $("formType").value = safe(item?.type);
    $("formAudience").value = safe(item?.audience);
    $("formDuration").value = safe(item?.duration_min);
    $("formCapacity").value = safe(item?.capacity);
    $("formLocation").value = safe(item?.location);
    $("formCore").value = safe(item?.core);
    $("formTags").value = safe(item?.tags);
    $("formSummary").value = safe(item?.summary);
    $("formObjectives").value = safe(item?.objectives);
    $("formOutline").value = safe(item?.outline);
    $("formMaterials").value = safe(item?.materials);
    $("formLinks").value = safe(item?.links);
    $("formAssets").value = safe(item?.assets);
    $("formNotes").value = safe(item?.notes);

    toolsSelected.primary = safe(item?.tools_primary) || null;
    toolsSelected.secondary = parseCsv_(safe(item?.tools_secondary));
    renderToolsChosen_();

    const promote = $("promoteTo");
    if (promote) promote.value = currentState === "idea" ? "draft" : (currentState === "draft" ? "final" : "final");
  }

  function clearForm_() {
    currentItem = null;
    toolsSelected = { primary: null, secondary: [] };
    writeForm_({});
    localStorage.removeItem(LS_KEY_LAST_ID);
  }

  function parseCsv_(s) {
    return String(s || "").split(",").map(x => x.trim()).filter(Boolean);
  }

  /* =========================
   * 5) List render / click
   * ========================= */
  async function reloadList_() {
    const list = $("list");
    if (!list) return;
    list.innerHTML = `<div class="muted">讀取中…</div>`;
    try {
      const q = ($("searchInput")?.value || "").trim();
      const data = await apiList_(currentState, q);
      const items = data.items || [];
      if (!items.length) {
        list.innerHTML = `<div class="muted">目前這個狀態沒有資料。</div>`;
        return;
      }
      list.innerHTML = items.map(renderCard_).join("");
      qsa("[data-card-id]", list).forEach(el => {
        el.addEventListener("click", async () => {
          const id = el.getAttribute("data-card-id");
          if (!id) return;
          await loadItem_(id);
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="muted">讀取失敗：${escapeHtml_(String(err))}</div>`;
      toast_(String(err), true);
    }
  }

  function renderCard_(it) {
    const title = escapeHtml_(String(it.title || it.id || "(未命名)"));
    const tags = escapeHtml_(String(it.tags || ""));
    const summary = escapeHtml_(String(it.summary || ""));
    const updated = escapeHtml_(String(it.updated_at || ""));
    return `
      <button class="cardItem" type="button" data-card-id="${escapeAttr_(it.id || "")}">
        <div class="cardTitle">${title}</div>
        <div class="cardMeta">
          <span class="chip">${escapeHtml_(stateLabel_(currentState))}</span>
          ${tags ? `<span class="chip ghost">${tags}</span>` : ""}
          ${updated ? `<span class="muted">${updated}</span>` : ""}
        </div>
        ${summary ? `<div class="cardSummary">${summary}</div>` : ""}
      </button>
    `;
  }

  function stateLabel_(state) {
    const st = STATES.find(s => s.key === state);
    return st ? st.label : state;
  }

  async function loadItem_(id) {
    try {
      const data = await apiGet_(currentState, id);
      const item = data.item;
      if (!item) throw new Error("後臺沒有回傳 item");
      writeForm_(item);
      localStorage.setItem(LS_KEY_LAST_ID, String(item.id || "").trim());
      toast_("已載入：" + (item.title || item.id));
    } catch (err) {
      toast_(String(err), true);
    }
  }

  /* =========================
   * 6) Tools picker (100% show)
   * ========================= */
  function buildToolsText_() {
    const p = toolsSelected.primary;
    const s = toolsSelected.secondary;
    const pName = p ? findToolName_(p) : "";
    const sNames = (s || []).map(code => findToolName_(code)).filter(Boolean);

    const lines = [];
    if (p) lines.push(`主工具：${p}｜${pName}`);
    if (sNames.length) lines.push(`副工具：${s.map((c,i)=>`${c}｜${sNames[i]||""}`.trim()).join("；")}`);
    return lines.join("\n");
  }

  function findToolName_(code) {
    const list = toolsCache || [];
    const t = list.find(x => String(x.toolCode||x.id||"").trim() === String(code||"").trim())
           || list.find(x => String(x.id||"").trim() === String(code||"").trim());
    return t ? String(t.name||t.title||"").trim() : "";
  }

  function renderToolsChosen_() {
    const box = $("toolsChosen");
    if (!box) return;

    const p = toolsSelected.primary;
    const pName = p ? findToolName_(p) : "";
    const sec = toolsSelected.secondary || [];

    const secHtml = sec.length
      ? sec.map(code => `<span class="chip ghost">${escapeHtml_(code)}${findToolName_(code) ? "｜"+escapeHtml_(findToolName_(code)) : ""}</span>`).join(" ")
      : `<span class="muted">尚未選副工具</span>`;

    box.innerHTML = `
      <div class="toolsChosenRow">
        <div class="muted">主工具</div>
        <div>${p ? `<span class="chip">${escapeHtml_(p)}${pName ? "｜"+escapeHtml_(pName) : ""}</span>` : `<span class="muted">尚未選主工具</span>`}</div>
      </div>
      <div class="toolsChosenRow" style="margin-top:8px;">
        <div class="muted">副工具</div>
        <div class="chipWrap">${secHtml}</div>
      </div>
    `;
  }

  function openToolsPicker_() {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,.35)";
    overlay.style.zIndex = "9998";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close_(); });

    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.left = "50%";
    modal.style.top = "50%";
    modal.style.transform = "translate(-50%,-50%)";
    modal.style.width = "min(920px, 92vw)";
    modal.style.maxHeight = "80vh";
    modal.style.overflow = "auto";
    modal.style.background = "#fff";
    modal.style.borderRadius = "18px";
    modal.style.boxShadow = "0 18px 60px rgba(0,0,0,.22)";
    modal.style.padding = "14px";
    modal.style.zIndex = "9999";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "10px";
    header.innerHTML = `
      <div style="font-weight:800;">工具勾選</div>
      <div class="muted" style="font-size:12px;">主工具只能選 1 個，副工具可多選</div>
      <div style="margin-left:auto; display:flex; gap:8px;">
        <button class="btn" type="button" id="__toolClose">關閉</button>
        <button class="btn primary" type="button" id="__toolApply">套用</button>
      </div>
    `;

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "搜尋工具（代碼/名稱/分類/痛點）";
    search.style.width = "100%";
    search.style.margin = "10px 0";
    search.style.padding = "10px 12px";
    search.style.border = "1px solid rgba(0,0,0,.12)";
    search.style.borderRadius = "12px";

    const table = document.createElement("div");
    table.id = "__toolTable";

    function render_(keyword) {
      const kw = String(keyword || "").trim().toLowerCase();
      const list = (toolsCache || []).filter(t => {
        if (!kw) return true;
        const hay = [t.toolCode, t.id, t.name, t.title, t.category, t.core, t.pain_points]
          .map(x => String(x || "")).join(" ").toLowerCase();
        return hay.includes(kw);
      });

      const primary = toolsSelected.primary;
      const secondary = new Set(toolsSelected.secondary || []);

      table.innerHTML = `
        <div class="toolGridHead">
          <div>主</div><div>副</div><div>代碼</div><div>名稱</div><div>分類</div>
          <div class="hideSm">核心</div><div class="hideSm">連結</div>
        </div>
        ${list.map(t => {
          const code = String(t.toolCode || t.id || "").trim();
          const name = String(t.name || t.title || "").trim();
          const cat = String(t.category || "").trim();
          const core = String(t.core || "").trim();
          const link = String(t.link || "").trim();

          const pChecked = primary === code ? "checked" : "";
          const sChecked = secondary.has(code) ? "checked" : "";

          return `
            <div class="toolGridRow" data-tool-code="${escapeAttr_(code)}">
              <div><input type="radio" name="__primaryTool" value="${escapeAttr_(code)}" ${pChecked}></div>
              <div><input type="checkbox" class="__secondaryTool" value="${escapeAttr_(code)}" ${sChecked}></div>
              <div><span class="chip ghost">${escapeHtml_(code)}</span></div>
              <div style="font-weight:700;">${escapeHtml_(name)}</div>
              <div class="muted">${escapeHtml_(cat)}</div>
              <div class="muted hideSm">${escapeHtml_(core)}</div>
              <div class="hideSm">${link ? `<a href="${escapeAttr_(link)}" target="_blank" rel="noopener">開啟</a>` : ""}</div>
            </div>
          `;
        }).join("")}
      `;

      qsa('input[name="__primaryTool"]', table).forEach(r => {
        r.addEventListener("change", () => { toolsSelected.primary = r.value; });
      });
      qsa(".__secondaryTool", table).forEach(c => {
        c.addEventListener("change", () => {
          const v = c.value;
          const arr = new Set(toolsSelected.secondary || []);
          if (c.checked) arr.add(v); else arr.delete(v);
          toolsSelected.secondary = Array.from(arr);
        });
      });
    }

    modal.appendChild(header);
    modal.appendChild(search);
    modal.appendChild(table);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const style = document.createElement("style");
    style.textContent = `
      .toolGridHead, .toolGridRow{
        display:grid;
        grid-template-columns: 34px 34px 120px 1.4fr 1fr 1.2fr 80px;
        gap:10px; align-items:center;
        padding:10px 8px;
        border-bottom:1px solid rgba(0,0,0,.06);
      }
      .toolGridHead{ position:sticky; top:0; background:#fff; z-index:2; font-size:12px; color:#555; font-weight:800; }
      .toolGridRow:hover{ background: rgba(0,0,0,.03); }
      @media (max-width: 740px){
        .hideSm{ display:none; }
        .toolGridHead, .toolGridRow{ grid-template-columns: 34px 34px 110px 1fr 1fr; }
      }
    `;
    document.head.appendChild(style);

    function close_() { style.remove(); overlay.remove(); }
    function apply_() {
      if (toolsSelected.primary) {
        toolsSelected.secondary = (toolsSelected.secondary || []).filter(x => x !== toolsSelected.primary);
      }
      renderToolsChosen_();
      close_();
      toast_("工具已套用");
    }

    qs("#__toolClose", modal).addEventListener("click", close_);
    qs("#__toolApply", modal).addEventListener("click", apply_);
    search.addEventListener("input", () => render_(search.value));

    render_("");
    search.focus();
  }

  async function ensureToolsLoaded_() {
    if (toolsCache && toolsCache.length) return toolsCache;

    const cached = safeJson_(localStorage.getItem(LS_KEY_TOOLS_CACHE) || "");
    if (cached && Array.isArray(cached) && cached.length) {
      toolsCache = cached;
      renderToolsChosen_();
    }

    const data = await apiTools_();
    const raw = data.tools || [];
    toolsCache = raw.map(x => ({
      toolCode: x.toolCode || x.id || "",
      name: x.name || x.title || "",
      core: x.core || "",
      pain_points: x.pain_points || "",
      category: x.category || "",
      link: x.link || "",
      chapters: x.chapters || "",
      steps: x.steps || "",
      tips: x.tips || "",
      video_title: x.video_title || "",
      video_link: x.video_link || "",
      status: x.status || "",
    })).filter(t => String(t.toolCode || "").trim() || String(t.name || "").trim());

    localStorage.setItem(LS_KEY_TOOLS_CACHE, JSON.stringify(toolsCache));
    renderToolsChosen_();
    return toolsCache;
  }

  /* =========================
   * 7) AI + TSV
   * ========================= */
  function buildAiPrompt_(item) {
    const pTool = toolsSelected.primary ? `${toolsSelected.primary}｜${findToolName_(toolsSelected.primary)}` : "(未選)";
    const sTools = (toolsSelected.secondary || []).map(c => `${c}｜${findToolName_(c)}`).join("；") || "(未選)";

    return [
      "你是「天使笑長」的協作夥伴。",
      "請用溫柔、清楚、不說教的語氣，協助把以下課程從「完稿」往下一階段完成。",
      "",
      "【已輸入資料（請以此為準，不要改名、不重問）】",
      `課程名稱：${item.title || "未訂"}`,
      `類型：${item.type || ""}`,
      `對象：${item.audience || ""}`,
      `時長/人數：${item.duration_min || ""}分鐘｜${item.capacity || ""}人`,
      `關鍵痛點/標籤：${item.tags || ""}`,
      `主工具：${pTool}`,
      `副工具：${sTools}`,
      `核心概念：${item.core || ""}`,
      `活動簡述：${item.summary || ""}`,
      "",
      "【請輸出】",
      "A) 活動/課程規劃（定位、目標、節律、適用場域）",
      "B) 詳細設計內容（每堂/每場內容、現場流程、練習、作業、教材）",
      "C) 回饋與追蹤方案（每週追蹤、回饋題、工具使用節律）",
      "",
      "【再加做一件事】",
      "把「詳案」轉成簡報：請輸出 PPT 大綱（逐頁標題＋每頁要講的重點），並附上逐頁口說稿。",
    ].join("\n");
  }

  async function copyText_(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast_("已複製到剪貼簿");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast_("已複製到剪貼簿");
    }
  }

  function buildTSVRow_(item) {
    const headers = [
      "id","title","type","status","version","owner","audience","duration_min","capacity","tags",
      "summary","objectives","outline","materials","links","assets","notes","created_at","updated_at"
    ];
    const vals = headers.map(h => {
      const v = item[h] === undefined || item[h] === null ? "" : String(item[h]);
      return v.replace(/\t/g, " ").replace(/\r?\n/g, " / ");
    });
    return vals.join("\t");
  }

  /* =========================
   * 8) Module Builder
   * ========================= */
  async function openModuleBuilder_() {
    const panel = $("modulePanel");
    if (!panel) return;
    panel.style.display = "block";

    $("moduleList").innerHTML = `<div class="muted">讀取完稿清單中…</div>`;
    try {
      const data = await apiList_("final", "");
      const items = data.items || [];
      if (!items.length) {
        $("moduleList").innerHTML = `<div class="muted">完稿目前沒有資料。</div>`;
        return;
      }
      $("moduleList").innerHTML = items.map(it => {
        const id = escapeAttr_(it.id || "");
        const t = escapeHtml_(it.title || it.id || "(未命名)");
        const d = escapeHtml_(String(it.duration_min || ""));
        const tag = escapeHtml_(String(it.tags || ""));
        return `
          <label class="moduleRow">
            <input type="checkbox" value="${id}">
            <div>
              <div style="font-weight:800;">${t}</div>
              <div class="muted">${d ? d+" 分鐘" : ""} ${tag ? "｜"+tag : ""}</div>
            </div>
          </label>
        `;
      }).join("");

      $("btnBuildModule").onclick = async () => {
        const checked = qsa('input[type="checkbox"]', $("moduleList")).filter(c => c.checked).map(c => c.value);
        if (!checked.length) return toast_("先勾選要組合的單場", true);

        const details = [];
        for (const id of checked) {
          const r = await apiGet_("final", id);
          if (r.item) details.push(r.item);
        }

        const total = details.reduce((acc, it) => acc + (parseInt(it.duration_min, 10) || 0), 0);
        $("moduleDuration").value = String(total || "");
        const title = ($("moduleTitle").value || "").trim() || "模組課程（未命名）";
        const summary = ($("moduleSummary").value || "").trim();

        const outline = details.map((it, idx) => {
          const nm = it.title || it.id;
          const dd = it.duration_min ? `${it.duration_min}min` : "";
          return `${idx+1}. ${nm}${dd ? "（"+dd+"）" : ""}`;
        }).join("\n");

        const moduleItem = {
          title,
          type: "模組課程",
          audience: "家長",
          duration_min: total,
          capacity: 20,
          tags: "模組課程, 由單場組合",
          summary: summary || "由多個完稿單場組合而成的模組課程。",
          outline,
          materials: "組合來源：\n" + details.map(it => `- ${it.id}｜${it.title || ""}`).join("\n"),
          links: details.map(it => it.links).filter(Boolean).join("\n"),
          notes: "本模組由前臺勾選組合生成。",
          tools_primary: toolsSelected.primary || "",
          tools_secondary: (toolsSelected.secondary || []).join(", "),
        };

        const saved = await apiUpsert_("final", moduleItem);
        toast_("模組已存入完稿：" + (saved.id || ""));
        await reloadList_();
      };

    } catch (err) {
      $("moduleList").innerHTML = `<div class="muted">讀取失敗：${escapeHtml_(String(err))}</div>`;
      toast_(String(err), true);
    }
  }

  function closeModuleBuilder_() {
    const panel = $("modulePanel");
    if (!panel) return;
    panel.style.display = "none";
  }

  /* =========================
   * 9) Events
   * ========================= */
  function bindEvents_() {
    $("btnSettings")?.addEventListener("click", async () => {
      const cur = getApiUrl_();
      const url = prompt("貼上你的 GAS Web App URL（/exec）", cur || "");
      if (url === null) return;
      setApiUrl_(url.trim());
      toast_("已儲存 API");
      try {
        const ping = await apiPing_();
        toast_("後臺連線成功：" + (ping.spreadsheet || ""));
      } catch (err) {
        toast_("API 可能還沒部署成功：" + String(err), true);
      }
    });

    $("btnSearch")?.addEventListener("click", reloadList_);
    $("searchInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") reloadList_();
    });

    $("btnRefresh")?.addEventListener("click", reloadList_);

    $("btnNew")?.addEventListener("click", () => {
      clearForm_();
      toast_("已開新卡（尚未存檔）");
    });

    $("btnPickTools")?.addEventListener("click", async () => {
      try {
        await ensureToolsLoaded_();
        openToolsPicker_();
      } catch (err) {
        toast_(String(err), true);
      }
    });

    $("btnAi")?.addEventListener("click", async () => {
      const item = readForm_();
      const promptText = buildAiPrompt_(item);
      await copyText_(promptText);
    });

    $("btnCopyTSV")?.addEventListener("click", async () => {
      const item = readForm_();
      const tsv = buildTSVRow_(item);
      await copyText_(tsv);
    });

    $("btnSave")?.addEventListener("click", async () => {
      try {
        const item = readForm_();
        if (!item.title) return toast_("主題（課程名稱）先寫一下，才好存。", true);

        if (!item.materials && item.tools_text) item.materials = item.tools_text;

        const res = await apiUpsert_(currentState, item);
        const saved = res.item || item;
        writeForm_(saved);
        toast_("已存到後臺 ✅");
        await reloadList_();
      } catch (err) {
        toast_("存檔失敗：" + String(err), true);
      }
    });

    $("btnDelete")?.addEventListener("click", async () => {
      const id = String(currentItem?.id || "").trim();
      if (!id) return toast_("目前沒有可刪的 id", true);
      if (!confirm("確定刪除這筆？（" + id + "）")) return;
      try {
        await apiDelete_(currentState, id);
        toast_("已刪除");
        clearForm_();
        await reloadList_();
      } catch (err) {
        toast_(String(err), true);
      }
    });

    $("btnPromote")?.addEventListener("click", async () => {
      const id = String(currentItem?.id || "").trim();
      if (!id) return toast_("先載入或存一筆資料，才有 id 可以送審/升級。", true);
      const to = $("promoteTo")?.value || "";
      if (!to) return toast_("請先選要移到哪個狀態", true);

      try {
        await apiPromote_(currentState, to, id, true);
        toast_("已移動：" + stateLabel_(currentState) + " → " + stateLabel_(to));
        setStateUI_(to);
        await reloadList_();
        await loadItem_(id);
      } catch (err) {
        toast_(String(err), true);
      }
    });

    $("btnModuleBuilder")?.addEventListener("click", openModuleBuilder_);
    $("btnCloseModule")?.addEventListener("click", closeModuleBuilder_);
  }

  /* =========================
   * 10) Utils
   * ========================= */
  function escapeHtml_(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  function escapeAttr_(s) { return escapeHtml_(s).replaceAll("`", "&#96;"); }

  /* =========================
   * 11) Init
   * ========================= */
  async function init_() {
    setStateUI_(currentState);
    bindStateButtons_();
    bindEvents_();
    renderToolsChosen_();

    const promote = $("promoteTo");
    if (promote) {
      promote.innerHTML = `
        <option value="draft">草稿</option>
        <option value="final">完稿</option>
      `;
    }

    try { if (getApiUrl_()) await apiPing_(); } catch {}
    await reloadList_();

    const lastId = (localStorage.getItem(LS_KEY_LAST_ID) || "").trim();
    if (lastId) { try { await loadItem_(lastId); } catch {} }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init_);
  } else {
    init_();
  }

})();