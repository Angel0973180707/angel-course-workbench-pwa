/**
 * Angel Course Workbench API (GAS) - Full Overwrite (Stable Spreadsheet ID)
 * Spreadsheet: 幸福教養課程管理（含四分頁）
 *
 * Sheets:
 * 1) 幸福教養課程   (final)
 * 2) 草稿         (draft)
 * 3) 發想         (idea)
 * 4) 工具庫存管理   (tools, read only)
 *
 * Deploy:
 * - Execute as: Me
 * - Who has access: Anyone
 */

// ✅ 固定指向你的試算表（最穩）
const SPREADSHEET_ID = "1KFRAl2XIUlmIT8Bmi6Qwnmow9GQ-xjfj2CMHEhmMzUU";

const SHEET_BY_STATE = {
  idea:  "發想",
  draft: "草稿",
  final: "幸福教養課程",
};

const BASE_HEADERS = [
  "id","title","type","status","version","owner","audience","duration_min","capacity","tags",
  "summary","objectives","outline","materials","links","assets","notes","created_at","updated_at",
];

function doGet(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const mode = String(p.mode || "").trim().toLowerCase();

    // ===== tools export =====
    if (p.sheet && String(p.format || "").toLowerCase() === "tools") {
      const ss = getSS_();
      const sheetName = resolveSheetName_(p.sheet);
      const sh = ss.getSheetByName(sheetName);
      if (!sh) return json_({ ok:false, error:"Sheet not found: " + sheetName, sheets: listSheets_(ss) });

      const tools = sheetToObjects_(sh);
      return json_({ ok:true, sheet: sheetName, count: tools.length, tools });
    }

    // ===== ping =====
    if (mode === "ping") {
      const ss = getSS_();
      return json_({ ok:true, time: new Date().toISOString(), spreadsheet: ss.getName(), id: SPREADSHEET_ID });
    }

    // ===== list sheets =====
    if (mode === "sheets" || mode === "listsheets" || mode === "list_sheets") {
      const ss = getSS_();
      return json_({ ok:true, spreadsheet: ss.getName(), sheets: listSheets_(ss) });
    }

    // ===== list =====
    if (mode === "list") {
      const state = normalizeState_(p.state || "idea");
      const sh = getStateSheet_(state);
      const q = String(p.q || "").trim().toLowerCase();
      const limit = clampInt_(p.limit, 1, 1000, 300);

      const items = sheetToObjects_(sh);
      const filtered = q
        ? items.filter(it => {
            const hay = `${it.id||""} ${it.title||""} ${it.tags||""} ${it.summary||""}`.toLowerCase();
            return hay.includes(q);
          })
        : items;

      filtered.sort((a,b)=> String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
      return json_({ ok:true, state, sheet: sh.getName(), count: filtered.length, items: filtered.slice(0, limit) });
    }

    // ===== get =====
    if (mode === "get") {
      const state = normalizeState_(p.state || "idea");
      const id = String(p.id || "").trim();
      if (!id) return json_({ ok:false, error:"missing id" });

      const sh = getStateSheet_(state);
      const found = findById_(sh, id);
      if (!found) return json_({ ok:false, error:"not found", id, state, sheet: sh.getName() });

      return json_({ ok:true, state, sheet: sh.getName(), item: found.obj });
    }

    // ===== delete =====
    if (mode === "delete") {
      const state = normalizeState_(p.state || "idea");
      const id = String(p.id || "").trim();
      if (!id) return json_({ ok:false, error:"missing id" });

      const sh = getStateSheet_(state);
      const found = findByIdRow_(sh, id);
      if (!found) return json_({ ok:false, error:"not found", id });

      sh.deleteRow(found.rowIndex);
      return json_({ ok:true, action:"deleted", state, sheet: sh.getName(), id });
    }

    // ===== promote =====
    if (mode === "promote") {
      const from = normalizeState_(p.from);
      const to = normalizeState_(p.to);
      const id = String(p.id || "").trim();
      const overwrite = String(p.overwrite || "0") === "1";
      if (!from || !to || !id) return json_({ ok:false, error:"missing from/to/id" });
      if (from === to) return json_({ ok:false, error:"from and to are the same" });

      const fromSh = getStateSheet_(from);
      const toSh = getStateSheet_(to);

      const src = findById_(fromSh, id);
      if (!src) return json_({ ok:false, error:"source not found", from, id });

      const item = { ...src.obj };
      item.status = to;
      item.updated_at = new Date().toISOString();

      const result = upsert_(toSh, item, { overwrite });
      return json_({ ok:true, action: result.action, from, to, id: item.id });
    }

    return json_({ ok:false, error:"unknown mode", hint:"mode=ping|sheets|list|get|delete|promote or ?sheet=tools&format=tools" });

  } catch(err) {
    return json_({ ok:false, error: String(err), stack: err && err.stack ? String(err.stack) : "" });
  }
}

function doPost(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const mode = String(p.mode || "upsert").trim().toLowerCase();
    if (mode !== "upsert" && mode !== "save") return json_({ ok:false, error:"unknown mode" });

    const state = normalizeState_(p.state || "idea");
    const sh = getStateSheet_(state);

    const payload = parseBody_(e);
    const item = payload.item ? payload.item : payload;
    if (!item) return json_({ ok:false, error:"missing item" });

    const now = new Date().toISOString();
    if (!item.id) item.id = genId_();
    if (!item.created_at) item.created_at = now;
    item.updated_at = now;
    item.status = state;

    const result = upsert_(sh, item, { overwrite: true });
    return json_({ ok:true, action: result.action, state, sheet: sh.getName(), id: item.id, item });

  } catch(err) {
    return json_({ ok:false, error: String(err), stack: err && err.stack ? String(err.stack) : "" });
  }
}

/* ================= helpers ================= */

function getSS_(){
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e){
  // supports application/json, text/plain(json), form-urlencoded
  try{
    const raw = e && e.postData && e.postData.contents ? String(e.postData.contents).trim() : "";
    if (raw && (raw[0] === "{" || raw[0] === "[")) return JSON.parse(raw);
  } catch(_){}
  const p = (e && e.parameter) ? e.parameter : {};
  if (p.item) { try { return { item: JSON.parse(p.item) }; } catch(_){} }
  return p;
}

function normalizeState_(s){
  const v = String(s || "").trim().toLowerCase();
  if (v === "idea" || v === "draft" || v === "final") return v;
  if (v === "發想") return "idea";
  if (v === "草稿") return "draft";
  if (v === "幸福教養課程" || v === "幸福教養課程管理" || v === "完稿") return "final";
  return "idea";
}

function getStateSheet_(state){
  const ss = getSS_();
  const name = SHEET_BY_STATE[state];
  if (!name) throw new Error("unknown state: " + state);

  let sh = ss.getSheetByName(name);
  if (!sh){
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,BASE_HEADERS.length).setValues([BASE_HEADERS]);
  }
  ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sh){
  const lastCol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v||"").trim());
  const missing = BASE_HEADERS.filter(h => !headers.includes(h));
  if (missing.length){
    sh.getRange(1, lastCol+1, 1, missing.length).setValues([missing]);
  }
}

function sheetToObjects_(sh){
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(1, sh.getLastColumn());
  if (lastRow < 2) return [];

  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v||"").trim());
  const rows = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  return rows.map(r => rowToObj_(headers, r)).filter(o => (o.id || o.title));
}

function rowToObj_(headers, row){
  const obj = {};
  headers.forEach((h,i)=> { if(h) obj[h] = row[i]; });
  obj.id = String(obj.id || "").trim();
  obj.title = String(obj.title || "").trim();
  obj.tags = String(obj.tags || "").trim();
  return obj;
}

function findById_(sh, id){
  const found = findByIdRow_(sh, id);
  return found ? { obj: found.obj } : null;
}

function findByIdRow_(sh, id){
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(1, sh.getLastColumn());
  if (lastRow < 2) return null;

  const values = sh.getRange(1,1,lastRow,lastCol).getValues();
  const headers = values[0].map(v => String(v||"").trim());
  const idIdx = headers.indexOf("id");
  if (idIdx === -1) throw new Error("missing id column");

  const target = String(id || "").trim();
  for (let r=1; r<values.length; r++){
    const cell = String(values[r][idIdx] || "").trim();
    if (cell === target){
      return { rowIndex: r+1, obj: rowToObj_(headers, values[r]) };
    }
  }
  return null;
}

function upsert_(sh, item, opt){
  opt = opt || {};
  ensureHeaders_(sh);

  // extend headers for new keys
  let headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(v => String(v||"").trim());
  const keys = Object.keys(item || {});
  const missing = keys.filter(k => !headers.includes(k));
  if (missing.length){
    const lastCol = sh.getLastColumn();
    sh.getRange(1, lastCol+1, 1, missing.length).setValues([missing]);
    headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(v => String(v||"").trim());
  }

  const found = findByIdRow_(sh, item.id);
  const row = headers.map(h => (item[h] !== undefined ? item[h] : (found ? found.obj[h] : "")));

  if (found){
    sh.getRange(found.rowIndex, 1, 1, headers.length).setValues([row]);
    return { action: "update" };
  } else {
    sh.appendRow(row);
    return { action: "insert" };
  }
}

function genId_(){
  const ts = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd-HHmmss");
  const rnd = Math.floor(Math.random()*900+100);
  return "C-" + ts + "-" + rnd;
}

function clampInt_(v, min, max, def){
  const n = parseInt(v,10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function listSheets_(ss){
  return ss.getSheets().map(s => s.getName());
}

function resolveSheetName_(name){
  const v = String(name || "").trim();
  if (!v) return v;
  const lower = v.toLowerCase();
  if (lower === "tools" || lower === "tool" || lower === "tool_inventory") return "工具庫存管理";
  return v;
}