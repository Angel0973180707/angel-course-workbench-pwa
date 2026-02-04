/**
 * Angel Course Workbench API (GAS) - Full Overwrite (Fix)
 * Sheets in your spreadsheet:
 * 1) 幸福教養課程   (final)
 * 2) 草稿         (draft)
 * 3) 發想         (idea)
 * 4) 工具庫存管理   (tools, read only)
 *
 * Deploy:
 * - Execute as: Me
 * - Who has access: Anyone
 *
 * Frontend uses:
 *   GET  ?mode=ping
 *   GET  ?mode=list&state=idea|draft|final&q=...
 *   GET  ?mode=get&state=...&id=...
 *   POST ?mode=upsert&state=...   body: { item: {...} }  (Content-Type json or text/plain)
 *   GET  ?mode=promote&from=...&to=...&id=...&overwrite=1
 *   GET  ?mode=delete&state=...&id=...
 *
 * Tools export:
 *   GET  ?sheet=tools&format=tools
 *   GET  ?sheet=工具庫存管理&format=tools
 */

const SHEET_BY_STATE = {
  idea: "發想",
  draft: "草稿",
  final: "幸福教養課程",
};

const BASE_HEADERS = [
  "id","title","type","status","version","owner","audience","duration_min","capacity","tags",
  "summary","objectives","outline","materials","links","assets","notes","created_at","updated_at",
  // extra columns allowed; will auto-extend
];

function doGet(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const mode = String(p.mode || "").trim().toLowerCase();

    // ===== tools export compatibility =====
    if (p.sheet && String(p.format || "").toLowerCase() === "tools") {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheetName = resolveSheetName_(p.sheet);
      const sh = ss.getSheetByName(sheetName);
      if (!sh) {
        return json({ ok:false, error:"Sheet not found: " + sheetName, hint:"Try ?mode=sheets to see sheet names." });
      }
      const items = sheetToObjects(sh);
      return json({ ok:true, sheet: sheetName, count: items.length, tools: items });
    }

    // ===== health check =====
    if(mode === "ping"){
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return json({ ok:true, time: new Date().toISOString(), spreadsheet: ss.getName() });
    }

    // ===== list sheets =====
    if (mode === "sheets" || mode === "listsheets" || mode === "list_sheets") {
      return json({ ok: true, sheets: listSheets_() });
    }

    // ===== list items =====
    if(mode === "list"){
      const state = String(p.state || "idea").trim();
      const sh = getStateSheet_(state);
      const q = String(p.q || "").toLowerCase().trim();
      const limit = Math.min(parseInt(p.limit || "300",10) || 300, 1000);

      const items = sheetToObjects(sh);
      const filtered = q ? items.filter(it=>{
        const hay = (String(it.id||"")+" "+String(it.title||"")+" "+String(it.tags||"")+" "+String(it.summary||"")).toLowerCase();
        return hay.indexOf(q) !== -1;
      }) : items;

      filtered.sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
      return json({ ok:true, state, sheet: sh.getName(), count: filtered.length, items: filtered.slice(0, limit) });
    }

    // ===== get one =====
    if(mode === "get"){
      const state = String(p.state || "idea").trim();
      const id = String(p.id || "").trim();
      if(!id) return json({ ok:false, error:"missing id" });

      const sh = getStateSheet_(state);
      const found = findById_(sh, id);
      if(!found.row) return json({ ok:false, error:"not found: "+id, state, sheet: sh.getName() });

      const item = rowToObject_(found.headers, found.values);
      return json({ ok:true, state, sheet: sh.getName(), item });
    }

    // ===== promote =====
    if(mode === "promote"){
      const from = String(p.from || "").trim();
      const to = String(p.to || "").trim();
      const id = String(p.id || "").trim();
      if(!from || !to || !id) return json({ ok:false, error:"missing from/to/id" });

      const fromSh = getStateSheet_(from);
      const toSh = getStateSheet_(to);
      const overwrite = String(p.overwrite || "0") === "1";

      const found = findById_(fromSh, id);
      if(!found.row) return json({ ok:false, error:"not found in "+from+": "+id });

      const item = rowToObject_(found.headers, found.values);
      item.status = to;
      item.updated_at = new Date().toISOString();

      upsert_(toSh, item, { overwrite });
      return json({ ok:true, id, from, to });
    }

    // ===== delete =====
    if(mode === "delete"){
      const state = String(p.state || "idea").trim();
      const id = String(p.id || "").trim();
      if(!id) return json({ ok:false, error:"missing id" });

      const sh = getStateSheet_(state);
      const found = findById_(sh, id);
      if(!found.row) return json({ ok:false, error:"not found: "+id });

      sh.deleteRow(found.row);
      return json({ ok:true, id, state, sheet: sh.getName() });
    }

    return json({ ok:false, error:"unknown mode", hint:"use mode=ping|sheets|list|get|promote|delete" });

  }catch(err){
    return json({ ok:false, error: String(err), stack: (err && err.stack) ? String(err.stack) : "" });
  }
}

function doPost(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const mode = String(p.mode || "").trim().toLowerCase();
    if(mode !== "upsert") return json({ ok:false, error:"unknown mode" });

    const state = String(p.state || "idea").trim();
    const sh = getStateSheet_(state);

    const payload = parseBody_(e);
    const item = (payload && payload.item) ? payload.item : payload;

    if(!item) return json({ ok:false, error:"missing item" });

    if(!item.id) item.id = genId_();
    const now = new Date().toISOString();
    if(!item.created_at) item.created_at = now;
    item.updated_at = now;
    item.status = state;

    const result = upsert_(sh, item, { overwrite:true });
    return json({ ok:true, action: result.action, id: item.id, state, sheet: sh.getName(), item });

  }catch(err){
    return json({ ok:false, error: String(err), stack: (err && err.stack) ? String(err.stack) : "" });
  }
}

/* ===== helpers ===== */

function json(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e){
  // supports: application/json, text/plain(json), x-www-form-urlencoded
  try{
    if (e && e.postData && e.postData.contents) {
      const raw = String(e.postData.contents || "").trim();
      if (!raw) return {};
      // if looks like JSON
      if (raw[0] === "{" || raw[0] === "[") return JSON.parse(raw);
    }
  }catch(_){}
  // fallback: form fields
  const p = (e && e.parameter) ? e.parameter : {};
  if (p.item) {
    try { return { item: JSON.parse(p.item) }; } catch(_){}
  }
  return p;
}

function getStateSheet_(state){
  const name = SHEET_BY_STATE[state];
  if(!name) throw new Error("unknown state: "+state);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,BASE_HEADERS.length).setValues([BASE_HEADERS]);
  }
  ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sh){
  const lastCol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v || "").trim());
  const missing = BASE_HEADERS.filter(h => headers.indexOf(h) === -1);
  if(missing.length){
    sh.getRange(1, lastCol+1, 1, missing.length).setValues([missing]);
  }
}

function sheetToObjects(sh){
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(1, sh.getLastColumn());
  if(lastRow < 2) return [];

  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v || "").trim());
  const data = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  return data.map(r => rowToObject_(headers, r)).filter(o => (o && (o.id || o.title)));
}

function rowToObject_(headers, row){
  const obj = {};
  headers.forEach((h,i)=> { if(h) obj[h] = row[i]; });
  return obj;
}

function findById_(sh, id){
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(1, sh.getLastColumn());
  if(lastRow < 2) return { row:null, headers:[], values:[] };

  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v || "").trim());
  const idIdx = headers.indexOf("id");
  if(idIdx === -1) throw new Error("missing id column");

  const idCol = idIdx + 1;
  const ids = sh.getRange(2, idCol, lastRow-1, 1).getValues().map(r => String(r[0] || "").trim());
  const idx = ids.indexOf(String(id).trim());
  if(idx === -1) return { row:null, headers, values:[] };

  const rowIndex = idx + 2;
  const rowValues = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return { row: rowIndex, headers, values: rowValues };
}

function upsert_(sh, item, opt){
  opt = opt || {};
  ensureHeaders_(sh);

  let headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(v => String(v || "").trim());

  // auto-extend columns for new keys
  const keys = Object.keys(item || {});
  const missing = keys.filter(k => headers.indexOf(k) === -1);
  if(missing.length){
    const lastCol = sh.getLastColumn();
    sh.getRange(1, lastCol+1, 1, missing.length).setValues([missing]);
    headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(v => String(v || "").trim());
  }

  const found = findById_(sh, String(item.id || "").trim());
  const rowIndex = found.row;

  const row = headers.map(h => {
    if (!h) return "";
    if (item[h] !== undefined) return item[h];
    if (rowIndex) {
      const idx = headers.indexOf(h);
      return found.values[idx];
    }
    return "";
  });

  if(rowIndex){
    sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
    return { action:"update" };
  }else{
    sh.appendRow(row);
    return { action:"insert" };
  }
}

function genId_(){
  const ts = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd-HHmmss");
  const rand = Math.floor(Math.random()*900+100);
  return "C-"+ts+"-"+rand;
}

function listSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(s => s.getName());
}

function resolveSheetName_(name) {
  const v = String(name || "").trim();
  if (!v) return v;
  const lower = v.toLowerCase();
  if (lower === "tools" || lower === "tool" || lower === "tool_inventory") return "工具庫存管理";
  return v;
}