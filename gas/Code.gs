
/**
 * Angel Course Workbench API (GAS)
 * Sheets:
 * 1) 幸福教養課程管理  (final)
 * 2) 發想            (idea)
 * 3) 草稿            (draft)
 * 4) 工具庫存管理      (tools, read only)
 *
 * Deploy:
 * - Execute as: Me
 * - Who has access: Anyone
 *
 * Frontend uses:
 *   GET  ?mode=ping
 *   GET  ?mode=list&state=idea|draft|final&q=...
 *   GET  ?mode=get&state=...&id=...
 *   POST ?mode=upsert&state=...   body: { item: {...} }  (Content-Type text/plain)
 *   GET  ?mode=promote&from=...&to=...&id=...&overwrite=1
 *   GET  ?mode=delete&state=...&id=...
 *
 * Tools (optional):
 *   GET  ?sheet=工具庫存管理&format=tools
 */

const SHEET_BY_STATE = {
  idea: "發想",
  draft:"草稿",
  final:"幸福教養課程管理",
};

const BASE_HEADERS = [
  "id","title","type","status","version","owner","audience","duration_min","capacity","tags",
  "summary","objectives","outline","materials","links","assets","notes","created_at","updated_at",
  // extra columns are allowed; script will auto-extend
];

function doGet(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const mode = String(p.mode || "").trim();

    // tools export compatibility
    if(p.sheet && p.format === "tools"){
      const sheetName = p.sheet;
      const ss = SpreadsheetApp.getActive();
      const sh = ss.getSheetByName(sheetName);
      if(!sh) return json({ ok:false, error:"sheet not found: "+sheetName });
      const items = sheetToObjects(sh);
      return json({ ok:true, tools: items });
    }

    if(mode === "ping"){
      return json({ ok:true, time: new Date().toISOString(), spreadsheet: SpreadsheetApp.getActive().getName() });
    }

    if(mode === "list"){
      const state = String(p.state || "idea");
      const sh = getStateSheet_(state);
      const q = String(p.q || "").toLowerCase().trim();
      const limit = Math.min(parseInt(p.limit || "300",10) || 300, 1000);
      const items = sheetToObjects(sh);

      const filtered = q ? items.filter(it=>{
        const hay = (String(it.id||"")+" "+String(it.title||"")+" "+String(it.tags||"")+" "+String(it.summary||"")).toLowerCase();
        return hay.indexOf(q) !== -1;
      }) : items;

      // sort by updated_at desc if present
      filtered.sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
      return json({ ok:true, items: filtered.slice(0, limit) });
    }

    if(mode === "get"){
      const state = String(p.state || "idea");
      const id = String(p.id || "").trim();
      if(!id) return json({ ok:false, error:"missing id" });
      const sh = getStateSheet_(state);
      const { row, headers, values } = findById_(sh, id);
      if(!row) return json({ ok:false, error:"not found: "+id });
      const item = rowToObject_(headers, values);
      return json({ ok:true, item });
    }

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

    if(mode === "delete"){
      const state = String(p.state || "idea");
      const id = String(p.id || "").trim();
      if(!id) return json({ ok:false, error:"missing id" });
      const sh = getStateSheet_(state);
      const found = findById_(sh, id);
      if(!found.row) return json({ ok:false, error:"not found: "+id });
      sh.deleteRow(found.row);
      return json({ ok:true, id });
    }

    return json({ ok:false, error:"unknown mode" });

  }catch(err){
    return json({ ok:false, error: String(err) });
  }
}

function doPost(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const mode = String(p.mode || "").trim();
    if(mode !== "upsert") return json({ ok:false, error:"unknown mode" });

    const state = String(p.state || "idea").trim();
    const sh = getStateSheet_(state);

    const body = e.postData && e.postData.contents ? e.postData.contents : "";
    const payload = body ? JSON.parse(body) : {};
    const item = payload.item || payload;

    if(!item) return json({ ok:false, error:"missing item" });

    if(!item.id) item.id = genId_();
    const now = new Date().toISOString();
    if(!item.created_at) item.created_at = now;
    item.updated_at = now;
    item.status = state;

    const result = upsert_(sh, item, { overwrite:true });
    return json({ ok:true, action: result.action, id: item.id, item });

  }catch(err){
    return json({ ok:false, error: String(err) });
  }
}

/* ===== helpers ===== */

function json(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getStateSheet_(state){
  const name = SHEET_BY_STATE[state];
  if(!name) throw new Error("unknown state: "+state);
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,BASE_HEADERS.length).setValues([BASE_HEADERS]);
  }
  ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sh){
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(String);
  // ensure base headers exist (keep existing order, append missing)
  const missing = BASE_HEADERS.filter(h => headers.indexOf(h) === -1);
  if(missing.length){
    sh.getRange(1, lastCol+1, 1, missing.length).setValues([missing]);
  }
}

function sheetToObjects(sh){
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if(lastRow < 2) return [];
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(String);
  const data = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  return data.map(r => rowToObject_(headers, r)).filter(o=>o.id || o.title);
}

function rowToObject_(headers, row){
  const obj = {};
  headers.forEach((h,i)=> obj[h] = row[i]);
  return obj;
}

function findById_(sh, id){
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if(lastRow < 2) return { row:null, headers:[], values:[] };
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(String);
  const idCol = headers.indexOf("id")+1;
  if(idCol <= 0) throw new Error("missing id column");
  const values = sh.getRange(2, idCol, lastRow-1, 1).getValues().map(r=>String(r[0]||""));
  const idx = values.indexOf(String(id));
  if(idx === -1) return { row:null, headers, values:[] };
  const rowIndex = idx + 2;
  const rowValues = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return { row: rowIndex, headers, values: rowValues };
}

function upsert_(sh, item, opt){
  opt = opt || {};
  ensureHeaders_(sh);
  const lastCol = sh.getLastColumn();
  let headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(String);

  // auto-extend columns for new keys
  const keys = Object.keys(item);
  const missing = keys.filter(k => headers.indexOf(k) === -1);
  if(missing.length){
    sh.getRange(1, lastCol+1, 1, missing.length).setValues([missing]);
    headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  }

  const found = findById_(sh, String(item.id));
  const rowIndex = found.row;

  const row = headers.map(h => (item[h] !== undefined ? item[h] : (rowIndex ? found.values[headers.indexOf(h)] : "")));

  if(rowIndex){
    // update
    sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
    return { action:"update" };
  }else{
    // insert new row
    sh.appendRow(row);
    return { action:"insert" };
  }
}

function genId_(){
  const ts = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd-HHmmss");
  const rand = Math.floor(Math.random()*900+100);
  return "C-"+ts+"-"+rand;
}
