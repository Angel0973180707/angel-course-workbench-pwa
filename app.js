/* Angel Course Workbench v1 - app.js (Full Overwrite)
   Goals (v1):
   - 100% show tools list from GAS (?sheet=工具庫存管理&format=tools)
   - Tools picker: choose 1 primary + multi secondary (always reflects on UI)
   - AI prompt packed from form + tool details (copy)
   - Save / Load list (idea/draft/final) via GAS (mode=list|get|upsert)
*/

(() => {
  "use strict";

  // ===== localStorage keys =====
  const LS_API = "angel_course_api_url_v1";
  const LS_STATE = "angel_course_state_v1";
  const LS_LAST_ID = "angel_course_last_id_v1";
  const LS_TOOLS_CACHE = "angel_tools_cache_v1";

  // ===== states =====
  const STATES = [
    { key: "idea",  label: "發想", sheetHint: "發想" },
    { key: "draft", label: "草稿", sheetHint: "草稿" },
    { key: "final", label: "完稿", sheetHint: "幸福教養課程" },
  ];

  // ===== dom helpers =====
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ===== runtime =====
  let currentState = loadState_();
  let currentItem = null;

  let toolsCache = [];
  let toolsSelected = { primary: "", secondary: [] };

  // ===== ui message =====
  function setToastLine_(msg, isErr=false){
    const el = $("toastLine");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isErr ? "#b00020" : "";
  }

  function toast_(msg, isErr=false){
    setToastLine_(msg, isErr);
    // small floating toast
    let t = document.getElementById("__toast");
    if (!t){
      t = document.createElement("div");
      t.id = "__toast";
      t.style.position = "fixed";
      t.style.left = "50%";
      t.style.bottom = "18px";
      t.style.transform = "translateX(-50%)";
      t.style.padding = "10px 12px";
      t.style.borderRadius = "14px";
      t.style.boxShadow = "0 12px 40px rgba(0,0,0,.22)";
      t.style.zIndex = "9999";
      t.style.maxWidth = "92vw";
      t.style.fontSize = "14px";
      t.style.fontWeight = "900";
      t.style.opacity = "0";
      t.style.transition = "opacity .15s ease";
      document.body.appendChild(t);
    }
    t.style.background = isErr ? "#ffe8ea" : "#ecfff3";
    t.style.border = isErr ? "1px solid #ffb3bb" : "1px solid #bfe9c9";
    t.style.color = isErr ? "#7a0010" : "#0b4a1e";
    t.textContent = msg || "";
    requestAnimationFrame(() => (t.style.opacity = "1"));
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => (t.style.opacity = "0"), 2200);
  }

  // ===== api url =====
  function getApiUrl_(){
    return (localStorage.getItem(LS_API) || "").trim();
  }
  function setApiUrl_(url){
    localStorage.setItem(LS_API, String(url||"").trim());
  }
  function api_(query){
    const base = getApiUrl_();
    if (!base) throw new Error("尚未設定後臺 API（右上「設定」貼上 /exec）");
    const glue = base.includes("?") ? "&" : "?";
    return base + glue + String(query||"").replace(/^\?/, "");
  }
  function safeJson_(t){ try{ return JSON.parse(t); }catch{ return null; } }

  async function fetchJson_(url, opt){
    const res = await fetch(url, opt || {});
    const text = await res.text();
    const j = safeJson_(text);
    if (!j) throw new Error("後臺回傳不是 JSON：" + text.slice(0, 140));
    if (j.ok === false) throw new Error(j.error || "後臺錯誤");
    return j;
  }

  async function apiPing_(){ return await fetchJson_(api_("mode=ping")); }

  async function apiList_(state, q){
    const p = new URLSearchParams();
    p.set("mode", "list");
    p.set("state", state);
    if (q) p.set("q", q);
    p.set("limit", "300");
    return await fetchJson_(api_(p.toString()));
  }

  async function apiGet_(state, id){
    const p = new URLSearchParams();
    p.set("mode", "get");
    p.set("state", state);
    p.set("id", id);
    return await fetchJson_(api_(p.toString()));
  }

  async function apiUpsert_(state, item){
    const p = new URLSearchParams();
    p.set("mode", "upsert");
    p.set("state", state);
    return await fetchJson_(api_(p.toString()), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ item }),
    });
  }

  async function apiTools_(){
    const p = new URLSearchParams();
    p.set("sheet", "工具庫存管理");
    p.set("format", "tools");
    return await fetchJson_(api_(p.toString()));
  }

  // ===== state =====
  function loadState_(){
    const v = (localStorage.getItem(LS_STATE) || "idea").trim().toLowerCase();
    return STATES.some(s => s.key === v) ? v : "idea";
  }
  function setState_(state){
    currentState = state;
    localStorage.setItem(LS_STATE, state);
    qsa(".segBtn[data-state]").forEach(btn => {
      const on = btn.getAttribute("data-state") === state;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const st = STATES.find(s => s.key === state) || STATES[0];
    $("sheetHint").textContent = `目前狀態：${st.label}（寫入分頁：${st.sheetHint}）`;
  }

  // ===== form IO =====
  function val_(id){ return ($ (id)?.value || "").trim(); }
  function setVal_(id, v){ const el = $(id); if (el) el.value = (v===undefined||v===null) ? "" : String(v); }

  function readForm_(){
    const item = currentItem ? { ...currentItem } : {};
    // id: allow manual
    const manualId = val_("f_id");
    if (manualId) item.id = manualId;

    item.title = val_("f_title");
    const kind = val_("f_kind");
    item.kind = kind;
    item.kind_other = val_("f_kind_other");
    item.duration_min = val_("f_duration_min");
    item.total_duration = val_("f_total_duration");
    item.capacity = val_("f_capacity");
    item.location = val_("f_location");
    item.venue_type = val_("f_venue_type");
    item.core_concept = val_("f_core_concept");
    item.summary = val_("f_summary");

    // tools
    item.tools_primary = toolsSelected.primary || "";
    item.tools_secondary = (toolsSelected.secondary || []).join(", ");
    item.tools_text = buildToolsText_();

    // state
    item.status = currentState;
    item.owner = item.owner || "Angel";
    item.version = item.version || "v1";

    return item;
  }

  function writeForm_(item){
    currentItem = item ? { ...item } : null;

    setVal_("f_id", item?.id || "");
    setVal_("f_title", item?.title || "");
    setVal_("f_kind", item?.kind || "單場課程");
    setVal_("f_kind_other", item?.kind_other || "");
    setVal_("f_duration_min", item?.duration_min || "");
    setVal_("f_total_duration", item?.total_duration || "");
    setVal_("f_capacity", item?.capacity || "");
    setVal_("f_location", item?.location || "");
    setVal_("f_venue_type", item?.venue_type || "室內");
    setVal_("f_core_concept", item?.core_concept || "");
    setVal_("f_summary", item?.summary || "");

    toolsSelected.primary = String(item?.tools_primary || "").trim();
    toolsSelected.secondary = parseCsv_(String(item?.tools_secondary || ""));
    // never duplicate
    if (toolsSelected.primary){
      toolsSelected.secondary = toolsSelected.secondary.filter(x => x !== toolsSelected.primary);
    }
    renderToolsLines_();
    updatePreviews_();
  }

  function clearForm_(){
    currentItem = null;
    toolsSelected = { primary:"", secondary:[] };
    writeForm_({});
    localStorage.removeItem(LS_LAST_ID);
    toast_("已開新卡（尚未存檔）");
  }

  function parseCsv_(s){
    return String(s||"").split(",").map(x => x.trim()).filter(Boolean);
  }

  // ===== tools helpers =====
  function toolCode_(t){ return String(t.toolCode || t.id || "").trim(); }
  function toolName_(t){ return String(t.name || t.title || "").trim(); }

  function findTool_(code){
    const c = String(code||"").trim();
    return toolsCache.find(t => toolCode_(t) === c) || null;
  }

  function labelTool_(code){
    const t = findTool_(code);
    if (!t) return code ? `${code}` : "";
    const name = toolName_(t);
    return name ? `${code}｜${name}` : `${code}`;
  }

  function renderToolsLines_(){
    const main = toolsSelected.primary;
    const sec = toolsSelected.secondary || [];
    $("mainToolLine").textContent = main ? labelTool_(main) : "未選";
    $("subToolsLine").textContent = sec.length ? sec.map(labelTool_).join("；") : "未選";
  }

  function buildToolsText_(){
    const main = toolsSelected.primary;
    const sec = toolsSelected.secondary || [];
    const lines = [];
    if (main){
      const t = findTool_(main);
      lines.push(`主工具：${labelTool_(main)}`);
      if (t){
        const core = String(t.core||"").trim();
        const pain = String(t.pain_points||"").trim();
        if (core) lines.push(`主工具核心：${core}`);
        if (pain) lines.push(`主工具痛點：${pain}`);
      }
    }
    if (sec.length){
      lines.push(`副工具：${sec.map(labelTool_).join("；")}`);
    }
    return lines.join("\n");
  }

  async function ensureToolsLoaded_(){
    if (toolsCache && toolsCache.length) return toolsCache;

    // cache first
    const cached = safeJson_(localStorage.getItem(LS_TOOLS_CACHE) || "");
    if (cached && Array.isArray(cached) && cached.length){
      toolsCache = cached;
    }

    // always refresh once per session (keeps in sync)
    const data = await apiTools_();
    const raw = data.tools || [];
    toolsCache = raw.map(x => ({
      toolCode: x.toolCode || x.id || "",
      name: x.name || x.title || "",
      core: x.core || "",
      pain_points: x.pain_points || "",
      chapters: x.chapters || "",
      steps: x.steps || "",
      tips: x.tips || "",
      link: x.link || "",
      category: x.category || "",
      video_title: x.video_title || "",
      video_link: x.video_link || "",
      status: x.status || "",
    })).filter(t => toolCode_(t) || toolName_(t));

    localStorage.setItem(LS_TOOLS_CACHE, JSON.stringify(toolsCache));
    return toolsCache;
  }

  // ===== tool picker modal =====
  function openToolsPicker_(){
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,.50)";
    overlay.style.zIndex = "9998";

    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.left = "50%";
    modal.style.top = "50%";
    modal.style.transform = "translate(-50%,-50%)";
    modal.style.width = "min(980px, 94vw)";
    modal.style.maxHeight = "82vh";
    modal.style.overflow = "auto";
    modal.style.background = "#fff";
    modal.style.borderRadius = "18px";
    modal.style.boxShadow = "0 18px 70px rgba(0,0,0,.35)";
    modal.style.padding = "14px";
    modal.style.zIndex = "9999";
    modal.style.color = "#111";
    modal.style.opacity = "1";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "10px";
    header.innerHTML = `
      <div style="font-weight:900; font-size:16px;">工具勾選</div>
      <div style="font-size:12px; color:#475569;">主工具只能選 1 個，副工具可多選</div>
      <div style="margin-left:auto; display:flex; gap:8px;">
        <button type="button" id="__tClose" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(15,23,42,.14);background:#fff;font-weight:900;">關閉</button>
        <button type="button" id="__tApply" style="padding:10px 12px;border-radius:12px;border:none;background:#0c2a16;color:#fff;font-weight:900;">套用</button>
      </div>
    `;

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "搜尋工具（代碼/名稱/分類/痛點）";
    search.style.width = "100%";
    search.style.margin = "10px 0";
    search.style.padding = "12px 12px";
    search.style.border = "1px solid rgba(0,0,0,.18)";
    search.style.borderRadius = "12px";
    search.style.color = "#111";

    const table = document.createElement("div");
    table.id = "__toolTable";

    const style = document.createElement("style");
    style.textContent = `
      #__toolTable{ color:#111 !important; }
      .tgHead,.tgRow{ 
        display:grid;
        grid-template-columns: 44px 44px 150px 1.4fr 1fr 90px;
        gap:10px;
        align-items:center;
        padding:10px 8px;
        border-bottom:1px solid rgba(15,23,42,.10);
        background:#fff;
      }
      .tgHead{
        position:sticky; top:0; z-index:2;
        font-size:12px; font-weight:900;
      }
      .tgRow:hover{ background: rgba(0,0,0,.04); }
      .tName{ font-weight:900; }
      .tMuted{ color:#475569; font-size:12px; font-weight:800; }
      .tChip{
        display:inline-block;
        padding:6px 10px;
        border-radius:999px;
        border:1px solid rgba(15,23,42,.14);
        background:#f1f5f9;
        font-size:12px; font-weight:900;
      }
      .tLink{ color:#0b5cff; font-weight:900; text-decoration:none; }
      .tgRow input{ width:20px; height:20px; accent-color:#0b5cff; }
      @media (max-width: 740px){
        .tgHead,.tgRow{ grid-template-columns: 44px 44px 140px 1fr 1fr; }
        .hideSm{ display:none; }
      }
    `;
    document.head.appendChild(style);

    function render_(kw){
      const keyword = String(kw||"").trim().toLowerCase();
      const list = toolsCache.filter(t => {
        if (!keyword) return true;
        const hay = [t.toolCode, t.id, t.name, t.title, t.category, t.core, t.pain_points].map(x => String(x||"")).join(" ").toLowerCase();
        return hay.includes(keyword);
      });

      const primary = toolsSelected.primary;
      const secondary = new Set(toolsSelected.secondary || []);

      table.innerHTML = `
        <div class="tgHead">
          <div>主</div><div>副</div><div>代碼</div><div>名稱</div><div>分類</div><div class="hideSm">連結</div>
        </div>
        ${list.map(t => {
          const code = toolCode_(t);
          const name = toolName_(t);
          const cat = String(t.category||"").trim();
          const link = String(t.link||"").trim();
          const pChecked = (primary === code) ? "checked" : "";
          const sChecked = secondary.has(code) ? "checked" : "";
          return `
            <div class="tgRow">
              <div><input type="radio" name="__primary" value="${escAttr_(code)}" ${pChecked}></div>
              <div><input type="checkbox" class="__sec" value="${escAttr_(code)}" ${sChecked}></div>
              <div><span class="tChip">${escHtml_(code)}</span></div>
              <div class="tName">${escHtml_(name)}</div>
              <div class="tMuted">${escHtml_(cat)}</div>
              <div class="hideSm">${link ? `<a class="tLink" href="${escAttr_(link)}" target="_blank" rel="noopener">開啟</a>` : ""}</div>
            </div>
          `;
        }).join("")}
      `;

      qsa('input[name="__primary"]', table).forEach(r => {
        r.addEventListener("change", () => {
          toolsSelected.primary = r.value;
        });
      });

      qsa(".__sec", table).forEach(c => {
        c.addEventListener("change", () => {
          const v = c.value;
          const set = new Set(toolsSelected.secondary || []);
          if (c.checked) set.add(v); else set.delete(v);
          toolsSelected.secondary = Array.from(set);
        });
      });
    }

    function close_(){
      style.remove();
      overlay.remove();
    }

    function apply_(){
      if (toolsSelected.primary){
        toolsSelected.secondary = (toolsSelected.secondary || []).filter(x => x !== toolsSelected.primary);
      }
      renderToolsLines_();
      updatePreviews_();
      toast_("工具已套用 ✅");
      close_();
    }

    overlay.addEventListener("click", (e)=>{ if (e.target === overlay) close_(); });

    modal.appendChild(header);
    modal.appendChild(search);
    modal.appendChild(table);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector("#__tClose").addEventListener("click", close_);
    modal.querySelector("#__tApply").addEventListener("click", apply_);
    search.addEventListener("input", ()=>render_(search.value));

    render_("");
    search.focus();
  }

  // ===== AI + TSV =====
  function buildAiPrompt_(item){
    const st = STATES.find(s => s.key === currentState)?.label || currentState;
    const main = toolsSelected.primary ? labelTool_(toolsSelected.primary) : "(未選)";
    const sec = (toolsSelected.secondary||[]).length ? toolsSelected.secondary.map(labelTool_).join("；") : "(未選)";

    const toolInfo = buildToolsInfoBlock_();

    return [
      "你是「天使笑長」的協作夥伴。",
      "請用溫柔、清楚、不說教、可直接說出口的語氣，協助我把以下內容完成『課程簡案』與『課程詳案』。",
      "",
      `【目前狀態】${st}`,
      `【課程主題】${item.title || ""}`,
      `【形式】${item.kind || ""}${item.kind === "其他" && item.kind_other ? "（" + item.kind_other + "）" : ""}`,
      `【時數】單堂：${item.duration_min || ""}｜總時數：${item.total_duration || ""}`,
      `【人數】${item.capacity || ""}`,
      `【地點】${item.location || ""}（${item.venue_type || ""}）`,
      `【核心概念】${item.core_concept || ""}`,
      `【活動簡述】${item.summary || ""}`,
      "",
      `【主工具】${main}`,
      `【副工具】${sec}`,
      toolInfo ? "" : "",
      toolInfo ? "【工具細節（供你組進流程）】\n" + toolInfo : "",
      "",
      "【請輸出】",
      "A) 課程簡案（對外版）：目的、亮點、流程（分段/時間）、成效、適合對象、可帶走什麼",
      "B) 課程詳案（教案版）：逐段教學目標、引導語、互動提問、注意事項、備案（孩子炸裂/家長焦慮）",
      "C) PPT 大綱：逐頁『頁名 + 重點 3-5 點 + 口說稿一句話』",
      "D) 30 秒招生文案（2 版本：溫柔版/有力版）",
    ].filter(Boolean).join("\n");
  }

  function buildToolsInfoBlock_(){
    const codes = [];
    if (toolsSelected.primary) codes.push(toolsSelected.primary);
    (toolsSelected.secondary||[]).forEach(c => { if (!codes.includes(c)) codes.push(c); });
    const blocks = codes.map(code => {
      const t = findTool_(code);
      if (!t) return "";
      const name = toolName_(t);
      const cat = String(t.category||"").trim();
      const core = String(t.core||"").trim();
      const pain = String(t.pain_points||"").trim();
      const steps = String(t.steps||"").trim();
      const tips = String(t.tips||"").trim();
      const link = String(t.link||"").trim();
      return [
        `- ${code}${name ? "｜"+name : ""}${cat ? "（"+cat+"）" : ""}`,
        core ? `  核心：${core}` : "",
        pain ? `  痛點：${pain}` : "",
        steps ? `  步驟：${steps}` : "",
        tips ? `  提示語：${tips}` : "",
        link ? `  連結：${link}` : "",
      ].filter(Boolean).join("\n");
    }).filter(Boolean);
    return blocks.join("\n\n");
  }

  function buildTsvLine_(item){
    // a single TSV line that you can paste back to sheet if needed
    const cols = [
      item.id || "",
      item.title || "",
      item.kind || "",
      item.kind === "其他" ? (item.kind_other||"") : "",
      item.duration_min || "",
      item.total_duration || "",
      item.capacity || "",
      item.location || "",
      item.venue_type || "",
      item.core_concept || "",
      toolsSelected.primary || "",
      (toolsSelected.secondary||[]).join(", "),
      item.summary || "",
      currentState,
    ];
    return cols.map(c => String(c||"").replaceAll("\t"," ").replaceAll("\n"," ")).join("\t");
  }

  async function copyText_(text){
    const t = String(text||"");
    try{
      await navigator.clipboard.writeText(t);
      toast_("已複製到剪貼簿 ✅");
    }catch{
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast_("已複製到剪貼簿 ✅");
    }
  }

  function updatePreviews_(){
    const item = readForm_();
    $("aiPreview").value = buildAiPrompt_(item);
    $("tsvPreview").value = buildTsvLine_(item);
  }

  // ===== list =====
  function renderList_(items){
    const list = $("list");
    if (!list) return;
    if (!items.length){
      list.innerHTML = `<div class="hint">目前這個狀態沒有資料。</div>`;
      return;
    }
    list.innerHTML = items.map(it => {
      const title = escHtml_(String(it.title || it.id || "(未命名)"));
      const id = escAttr_(String(it.id || ""));
      const updated = escHtml_(String(it.updated_at || ""));
      const kind = escHtml_(String(it.kind || ""));
      return `
        <button type="button" class="itemBtn" data-id="${id}">
          <div class="itemTitle">${title}</div>
          <div class="itemMeta">
            <span class="chip">${escHtml_(stateLabel_(currentState))}</span>
            ${kind ? `<span class="chip">${kind}</span>` : ""}
            ${updated ? `<span>${updated}</span>` : ""}
          </div>
        </button>
      `;
    }).join("");

    qsa(".itemBtn[data-id]", list).forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        await loadItem_(id);
      });
    });
  }

  function stateLabel_(key){
    const st = STATES.find(s => s.key === key);
    return st ? st.label : key;
  }

  async function reloadList_(){
    const list = $("list");
    if (list) list.innerHTML = `<div class="hint">讀取中…</div>`;
    try{
      const q = ($("q")?.value || "").trim();
      const data = await apiList_(currentState, q);
      renderList_(data.items || []);
      toast_("清單已同步 ✅");
    }catch(err){
      if (list) list.innerHTML = `<div class="hint">讀取失敗：${escHtml_(String(err))}</div>`;
      toast_(String(err), true);
    }
  }

  async function loadItem_(id){
    try{
      const data = await apiGet_(currentState, id);
      const item = data.item;
      if (!item) throw new Error("後臺沒有回傳 item");
      writeForm_(item);
      localStorage.setItem(LS_LAST_ID, String(item.id||"").trim());
      toast_("已載入：" + (item.title || item.id));
    }catch(err){
      toast_(String(err), true);
    }
  }

  // ===== bindings =====
  function bind_(){
    // state tabs
    qsa(".segBtn[data-state]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const st = btn.getAttribute("data-state");
        if (!st) return;
        setState_(st);
        await reloadList_();
        // do not auto-load old id across states
      });
    });

    // settings
    $("btnSettings")?.addEventListener("click", async () => {
      const cur = getApiUrl_();
      const url = prompt("貼上你的 GAS Web App URL（/exec）", cur || "");
      if (url === null) return;
      setApiUrl_(url.trim());
      try{
        const ping = await apiPing_();
        toast_("後臺連線成功：" + (ping.spreadsheet || ""));
      }catch(err){
        toast_("API 連線失敗：" + String(err), true);
      }
    });

    // new / save
    $("btnNew")?.addEventListener("click", clearForm_);

    $("btnSave")?.addEventListener("click", async () => {
      try{
        const item = readForm_();
        if (!item.title) return toast_("主題先寫一下，才好存。", true);
        if (!toolsSelected.primary) return toast_("請先選「主工具」再存。", true);

        const res = await apiUpsert_(currentState, item);
        const saved = res.item || item;
        writeForm_(saved);
        toast_("已存回後臺 ✅");
        await reloadList_();
      }catch(err){
        toast_("存檔失敗：" + String(err), true);
      }
    });

    // list reload/search
    $("btnReload")?.addEventListener("click", reloadList_);
    $("btnSearch")?.addEventListener("click", reloadList_);
    $("q")?.addEventListener("keydown", (e)=>{ if (e.key === "Enter") reloadList_(); });

    // tools
    $("btnPickTools")?.addEventListener("click", async () => {
      try{
        await ensureToolsLoaded_();
        openToolsPicker_();
      }catch(err){
        toast_(String(err), true);
      }
    });

    // AI copy
    $("btnCopyAI")?.addEventListener("click", async () => {
      updatePreviews_();
      await copyText_($("aiPreview").value || "");
    });

    $("btnCopyTSV")?.addEventListener("click", async () => {
      updatePreviews_();
      await copyText_($("tsvPreview").value || "");
    });

    // update previews on input change
    const watchIds = ["f_title","f_id","f_kind","f_kind_other","f_duration_min","f_total_duration","f_capacity","f_location","f_venue_type","f_core_concept","f_summary"];
    watchIds.forEach(id => {
      $(id)?.addEventListener("input", updatePreviews_);
      $(id)?.addEventListener("change", updatePreviews_);
    });
  }

  // ===== html escape =====
  function escHtml_(s){
    return String(s||"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
  }
  function escAttr_(s){ return escHtml_(s).replaceAll("`","&#96;"); }

  // ===== init =====
  async function init_(){
    setState_(currentState);
    bind_();
    writeForm_({}); // clears + renders tools lines

    // if api exists, ping + preload tools silently
    try{
      if (getApiUrl_()){
        await apiPing_();
        // preload tools so picker is instant
        ensureToolsLoaded_().catch(()=>{});
      }
    }catch{}

    await reloadList_();

    // restore last item (same state only)
    const lastId = (localStorage.getItem(LS_LAST_ID) || "").trim();
    if (lastId){
      // try load from current state
      try{ await loadItem_(lastId); }catch{}
    }

    updatePreviews_();
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init_);
  }else{
    init_();
  }
})();
