/* Angel Course Editor PWA - Full Overwrite
   Direct edit + save to backend (Idea/Draft/Final)
*/

const COURSE_API_BASE = "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec";

const STATE_LABEL = { idea:"發想", draft:"草稿", final:"完稿" };

// local keys
const LS_WORK = "angel_course_editor_current";
const LS_LOCAL_DRAFT = "angel_course_editor_localdraft";

let currentState = "idea";
let currentId = ""; // backend id after first save
let lastSavedAt = 0;

const el = (id) => document.getElementById(id);

const fields = [
  "title","kind","kind_other","audience","tags",
  "module_sessions","session_minutes","single_duration",
  "capacity","version",
  "summary","objectives","outline","materials","links","notes"
];

function setApiStatus(msg){ el("apiStatus").textContent = msg; }

function setChips(){
  el("chipState").textContent = STATE_LABEL[currentState] || "發想";
  el("chipId").textContent = currentId ? `ID：${currentId}` : "未存檔";
  el("btnDelete").disabled = !currentId;
}

function toggleKindOther(){
  const v = el("kind").value;
  el("kindOtherWrap").style.display = (v === "其他") ? "" : "none";
  if (v !== "其他") el("kind_other").value = "";
}

function getPayload(){
  const obj = {};
  fields.forEach(k => obj[k] = (el(k).value || "").trim());
  // map to backend columns (keep your existing schema; add extras as needed)
  const nowIso = new Date().toISOString();

  const payload = {
    id: currentId || "",
    title: obj.title,
    kind: obj.kind,
    kind_other: obj.kind_other,
    audience: obj.audience,
    tags: obj.tags,

    module_sessions: obj.module_sessions,
    session_minutes: obj.session_minutes,
    single_duration: obj.single_duration,

    capacity: obj.capacity,
    version: obj.version,

    summary: obj.summary,
    objectives: obj.objectives,
    outline: obj.outline,
    materials: obj.materials,
    links: normalizeLinks_(obj.links),

    notes: obj.notes,
    updated_at: nowIso
  };

  // conservative defaults
  if (!payload.status){
    payload.status = (currentState === "final") ? "ready" : currentState;
  }
  payload.type = payload.type || ""; // keep if backend expects
  return payload;
}

function setFormFromItem(item){
  if (!item) return;
  currentId = String(item.id || "").trim();
  // best-effort map
  el("title").value = item.title || "";
  el("kind").value = item.kind || "演講";
  el("kind_other").value = item.kind_other || "";
  el("audience").value = item.audience || "";
  el("tags").value = item.tags || "";
  el("module_sessions").value = item.module_sessions || "";
  el("session_minutes").value = item.session_minutes || "";
  el("single_duration").value = item.single_duration || "";
  el("capacity").value = item.capacity || "";
  el("version").value = item.version || "";
  el("summary").value = item.summary || "";
  el("objectives").value = item.objectives || "";
  el("outline").value = item.outline || "";
  el("materials").value = item.materials || "";
  el("links").value = denormalizeLinks_(item.links || "");
  el("notes").value = item.notes || item.script || "";
  toggleKindOther();
  setChips();
}

function clearForm(){
  currentId = "";
  fields.forEach(k => { el(k).value = ""; });
  el("kind").value = "演講";
  toggleKindOther();
  setChips();
  setApiStatus("尚未連線");
}

function saveWorkInMemory(){
  const snap = {
    state: currentState,
    id: currentId,
    values: {}
  };
  fields.forEach(k => snap.values[k] = el(k).value);
  localStorage.setItem(LS_WORK, JSON.stringify(snap));
}

function restoreWorkFromMemory(){
  try{
    const raw = localStorage.getItem(LS_WORK);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (!snap || !snap.values) return false;
    currentState = snap.state || "idea";
    currentId = snap.id || "";
    setStateUI(currentState);
    fields.forEach(k => el(k).value = snap.values[k] ?? "");
    toggleKindOther();
    setChips();
    return true;
  }catch(e){ return false; }
}

function setStateUI(state){
  currentState = state;
  document.querySelectorAll(".pill").forEach(btn=>{
    const s = btn.getAttribute("data-state");
    const selected = (s === state);
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  });
  setChips();
  saveWorkInMemory();
}

async function apiPing(){
  try{
    const url = `${COURSE_API_BASE}?mode=ping`;
    const r = await fetch(url, { method:"GET", cache:"no-store" });
    const j = await r.json();
    if (j && j.ok){
      setApiStatus("後臺連線 OK");
      return true;
    }
    setApiStatus("後臺回覆異常");
    return false;
  }catch(err){
    setApiStatus("後臺連線失敗（可能是網路或權限）");
    return false;
  }
}

async function apiSave(){
  const payload = getPayload();

  setApiStatus("儲存中…");
  try{
    const url = `${COURSE_API_BASE}?mode=save&state=${encodeURIComponent(currentState)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();

    if (j && j.ok){
      // accept id from backend
      const newId = (j.id || (j.item && j.item.id) || payload.id || "").toString().trim();
      if (newId) currentId = newId;
      setChips();
      saveWorkInMemory();
      lastSavedAt = Date.now();
      setApiStatus(`已存回後臺（${STATE_LABEL[currentState]}）`);
      return true;
    } else {
      setApiStatus(`儲存失敗：${(j && (j.error || j.message)) ? (j.error || j.message) : "未知原因"}`);
      return false;
    }
  }catch(err){
    setApiStatus("儲存失敗（可能被瀏覽器阻擋或後臺權限）");
    return false;
  }
}

async function apiLoadById(id){
  if (!id) return;
  setApiStatus("載入中…");
  try{
    const url = `${COURSE_API_BASE}?mode=get&state=${encodeURIComponent(currentState)}&id=${encodeURIComponent(id)}`;
    const r = await fetch(url, { method:"GET", cache:"no-store" });
    const j = await r.json();
    if (j && j.ok && j.item){
      setFormFromItem(j.item);
      setApiStatus("已載入");
      saveWorkInMemory();
      return true;
    }
    setApiStatus("找不到這個 ID（或狀態選錯）");
    return false;
  }catch(err){
    setApiStatus("載入失敗");
    return false;
  }
}

async function apiDelete(){
  if (!currentId) return;
  const ok = confirm("確定要刪除後臺這筆資料？（無法復原）");
  if (!ok) return;

  setApiStatus("刪除中…");
  try{
    const url = `${COURSE_API_BASE}?mode=delete&state=${encodeURIComponent(currentState)}&id=${encodeURIComponent(currentId)}`;
    const r = await fetch(url, { method:"GET", cache:"no-store" });
    const j = await r.json();
    if (j && j.ok){
      setApiStatus("已刪除");
      clearForm();
      return true;
    }
    setApiStatus("刪除失敗");
    return false;
  }catch(err){
    setApiStatus("刪除失敗");
    return false;
  }
}

// helpers: normalize links (one per line, trim)
function normalizeLinks_(text){
  const s = String(text || "");
  const lines = s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  return lines.join("\n");
}
function denormalizeLinks_(text){
  return String(text || "").replace(/\r\n/g,"\n");
}

// local draft tools
function localSave(){
  const snap = { ts: new Date().toISOString(), state: currentState, id: currentId, values:{} };
  fields.forEach(k => snap.values[k] = el(k).value);
  localStorage.setItem(LS_LOCAL_DRAFT, JSON.stringify(snap));
  setApiStatus("已存本機草稿");
}
function localLoad(){
  try{
    const raw = localStorage.getItem(LS_LOCAL_DRAFT);
    if (!raw) { setApiStatus("本機沒有草稿"); return; }
    const snap = JSON.parse(raw);
    if (!snap || !snap.values) return;
    currentState = snap.state || currentState;
    currentId = snap.id || "";
    setStateUI(currentState);
    fields.forEach(k => el(k).value = snap.values[k] ?? "");
    toggleKindOther();
    setChips();
    setApiStatus("已載入本機草稿");
  }catch(e){
    setApiStatus("本機草稿讀取失敗");
  }
}
function exportJson(){
  const data = {
    exported_at: new Date().toISOString(),
    state: currentState,
    id: currentId,
    item: getPayload(),
    values: Object.fromEntries(fields.map(k=>[k, el(k).value]))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `angel-course-${currentState}-${currentId || "new"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setApiStatus("已匯出 JSON");
}

// autosave to local work (not backend) when typing
function bindAutosave(){
  fields.forEach(k=>{
    el(k).addEventListener("input", ()=>{
      saveWorkInMemory();
      // keep it quiet; only show if long time
    });
  });
}

function init(){
  // state pills
  document.querySelectorAll(".pill").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setStateUI(btn.getAttribute("data-state"));
    });
  });

  el("kind").addEventListener("change", toggleKindOther);

  el("btnNew").addEventListener("click", ()=>{
    const ok = confirm("要開始一份新文件嗎？（目前內容不會自動上傳後臺，建議先存本機或存回後臺）");
    if (!ok) return;
    clearForm();
    saveWorkInMemory();
  });

  el("btnLoad").addEventListener("click", async ()=>{
    const id = prompt("請貼上要載入的 ID（會從目前狀態的分頁載入）", currentId || "");
    if (!id) return;
    await apiLoadById(id.trim());
  });

  el("btnSave").addEventListener("click", async ()=>{
    await apiPing();
    await apiSave();
  });

  el("btnDelete").addEventListener("click", apiDelete);

  el("btnLocalSave").addEventListener("click", localSave);
  el("btnLocalLoad").addEventListener("click", localLoad);
  el("btnExport").addEventListener("click", exportJson);

  bindAutosave();

  // restore previous work if any
  const restored = restoreWorkFromMemory();
  if (!restored){
    setStateUI("idea");
    setChips();
  }
  toggleKindOther();

  apiPing();

  // SW
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

document.addEventListener("DOMContentLoaded", init);
