/* Angel Course Workbench - GitHub Pages Full Overwrite
   - Green theme
   - Flexible episodes / kinds
   - Tools API sync + cache
   - Course API optional sync (best-effort; depends on your GAS)
   - Local drafts + JSON export
   - One-click AI prompt + TSV row (auto clean newlines)
*/

const DEFAULTS = {
  toolsApi: 'https://script.google.com/macros/s/AKfycbwecHTILAMuk5Izr_yF9wfce_qNjxuy28XuvpDzK0LZ4Wszmw7zI3xve8jeLghzveWbXA/exec',
  courseApi: 'https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec'
};

const LS_KEYS = {
  settings: 'angel_course_workbench_settings_v1',
  draft: 'angel_course_workbench_draft_v1',
  toolsCache: 'angel_tools_cache_v1'
};

const SHEET_BY_STATE = {
  idea: '發想',
  draft: '草稿',
  final: '幸福教養課程管理'
};

const UI = {};
let tools = [];
let pickerMode = 'main'; // 'main' or 'subs'
let selectedMainTool = null;
let selectedSubTools = [];
let finals = [];
let lastApiList = [];

function $(id){ return document.getElementById(id); }

function toast(msg){
  UI.toast.textContent = msg;
  UI.toast.style.display = 'block';
  clearTimeout(UI._toastT);
  UI._toastT = setTimeout(()=> UI.toast.style.display='none', 1600);
}

function safeStr(v){
  if (v === null || v === undefined) return '';
  return String(v);
}

function nowIso(){
  return new Date().toISOString();
}

function loadSettings(){
  const raw = localStorage.getItem(LS_KEYS.settings);
  let s = {};
  try{ s = raw ? JSON.parse(raw) : {}; }catch(e){ s = {}; }
  s.toolsApi = s.toolsApi || DEFAULTS.toolsApi;
  s.courseApi = s.courseApi || DEFAULTS.courseApi;
  return s;
}

function saveSettings(s){
  localStorage.setItem(LS_KEYS.settings, JSON.stringify(s));
}

function getForm(){
  const state = UI.stateSelect.value;
  const kind = UI.kindSelect.value;
  const kindName = (kind === 'other') ? safeStr(UI.kindOther.value).trim() : UI.kindSelect.options[UI.kindSelect.selectedIndex].text;

  const episodes = parseInt(UI.episodes.value || '1', 10);
  const durationMin = parseInt(UI.durationMin.value || '0', 10);
  const capacity = parseInt(UI.capacity.value || '0', 10);

  const outlineItems = Array.from(document.querySelectorAll('.outline-item')).map((el)=> safeStr(el.value).trim());

  const payload = {
    id: makeId_(),
    title: safeStr(UI.title.value).trim(),
    type: kindName,
    status: (state === 'final') ? 'ready' : state, // per spec: final defaults ready
    version: 'v1',
    owner: safeStr(UI.owner.value).trim(),
    audience: safeStr(UI.audience.value).trim(),
    duration_min: durationMin || '',
    capacity: capacity || '',
    tags: safeStr(UI.tags.value).trim(),
    episodes: episodes || '',
    kind: kind,
    kindName: kindName,
    closing_line: safeStr(UI.closingLine.value).trim(),
    framework_text: safeStr(UI.frameworkText.value).trim(),
    outline_items: outlineItems,
    main_tool: selectedMainTool,
    sub_tools: selectedSubTools.slice(),
    summary: safeStr(UI.summary.value).trim(),
    objectives: safeStr(UI.objectives.value).trim(),
    materials: safeStr(UI.materials.value).trim(),
    notes: safeStr(UI.notes.value).trim(),
    created_at: nowIso(),
    updated_at: nowIso()
  };

  // Derived links field (for TSV)
  payload.links = buildLinksText(payload);

  // outline text
  payload.outline = buildOutlineText(payload);

  return payload;
}

function applyForm(data){
  // Apply safe
  UI.title.value = safeStr(data.title || '');
  UI.audience.value = safeStr(data.audience || '');
  UI.tags.value = safeStr(data.tags || '');
  UI.owner.value = safeStr(data.owner || '');
  UI.closingLine.value = safeStr(data.closing_line || '');
  UI.frameworkText.value = safeStr(data.framework_text || '');

  // Kind + schedule
  const kind = data.kind || guessKindFromType_(data.type);
  UI.kindSelect.value = kind;
  UI.kindOther.value = safeStr(data.kindName || '');
  onKindChange();

  UI.episodes.value = safeStr(data.episodes || UI.episodes.value);
  UI.durationMin.value = safeStr(data.duration_min || UI.durationMin.value);
  UI.capacity.value = safeStr(data.capacity || UI.capacity.value);

  // state
  if (data.status === 'ready') UI.stateSelect.value = 'final';
  else if (data.status === 'draft') UI.stateSelect.value = 'draft';
  else if (data.status === 'idea') UI.stateSelect.value = 'idea';
  else UI.stateSelect.value = UI.stateSelect.value;

  onStateChange();

  // tools
  selectedMainTool = data.main_tool || null;
  selectedSubTools = (data.sub_tools || []).slice();
  renderSelectedTools();

  // outline
  buildOutlineInputs(parseInt(UI.episodes.value||'1',10));
  const items = data.outline_items || [];
  const inputs = document.querySelectorAll('.outline-item');
  inputs.forEach((inp, i)=> { inp.value = safeStr(items[i] || ''); });

  // draft extras
  UI.summary.value = safeStr(data.summary || '');
  UI.objectives.value = safeStr(data.objectives || '');
  UI.materials.value = safeStr(data.materials || '');
  UI.notes.value = safeStr(data.notes || '');
}

function guessKindFromType_(type){
  const t = safeStr(type).toLowerCase();
  if (t.includes('演講')) return 'lecture';
  if (t.includes('模組') || t.includes('課程') && t.includes('堂')) return 'module';
  if (t.includes('單場活動')) return 'single_event';
  if (t.includes('單場')) return 'single_class';
  return 'other';
}

function makeId_(){
  // stable-ish id per save: timestamp + random
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2,6);
  return `c_${t}_${r}`;
}

function normalizeNewlines(text){
  const s = safeStr(text);
  // Replace CRLF + LF with single space, trim redundant
  return s.replace(/\r\n|\n|\r/g, ' ').replace(/\s{2,}/g,' ').trim();
}

function tsvSafe(text){
  const s = UI.autoCleanNewlines.checked ? normalizeNewlines(text) : safeStr(text);
  return s.replace(/\t/g,' ').trim();
}

function buildOutlineText(data){
  const items = (data.outline_items || []).filter(x => safeStr(x).trim());
  if (!items.length) return '';
  const lines = items.map((x, i)=> `${i+1}. ${x}`);
  return lines.join('\n');
}

function buildLinksText(data){
  const chunks = [];
  if (data.main_tool && data.main_tool.name){
    chunks.push(`${data.main_tool.name}｜${data.main_tool.link || ''}`);
  }
  (data.sub_tools || []).forEach(t=>{
    chunks.push(`${t.name}｜${t.link || ''}`);
  });
  // remove dup
  const uniq = Array.from(new Set(chunks.filter(Boolean)));
  return uniq.join('\n');
}

function buildToolLabel(t){
  if (!t) return '';
  const code = t.toolCode || t.tool_code || t.code || '';
  const name = t.name || '';
  return code ? `${code} ${name}`.trim() : name;
}

function renderSelectedTools(){
  UI.mainTool.value = selectedMainTool ? buildToolLabel(selectedMainTool) : '';
  UI.subTools.value = selectedSubTools.length ? selectedSubTools.map(buildToolLabel).join('、') : '';
}

function buildOutlineInputs(n){
  const count = Math.max(1, Math.min(40, n || 1));
  UI.outlineList.innerHTML = '';
  for (let i=0;i<count;i++){
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = `第${i+1}堂｜一句話大綱`;
    const inp = document.createElement('input');
    inp.className = 'outline-item';
    inp.placeholder = '一句話就好，先站穩骨架。';
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    UI.outlineList.appendChild(wrap);
  }
}

function updateStatusPills(){
  const state = UI.stateSelect.value;
  const steps = [
    {key:'idea', label:'① 發想'},
    {key:'draft', label:'② 草稿'},
    {key:'final', label:'③ 完稿'}
  ];
  UI.statusPills.innerHTML='';
  steps.forEach(s=>{
    const span=document.createElement('span');
    span.className='pill';
    if (s.key === state) span.classList.add('doing');
    if (state === 'draft' && s.key === 'idea') span.classList.add('ok');
    if (state === 'final' && (s.key === 'idea' || s.key === 'draft')) span.classList.add('ok');
    if (!(span.classList.contains('ok') || span.classList.contains('doing'))) span.classList.add('todo');
    span.textContent = span.classList.contains('ok') ? `✅ ${s.label}` : (span.classList.contains('doing') ? `🟡 ${s.label}` : `⬜ ${s.label}`);
    UI.statusPills.appendChild(span);
  });

  UI.stateHint.textContent = (
    state === 'idea' ? '發想：先把「這堂課是什麼 / 為誰做 / 工具配方 / 粗架構」站穩。' :
    state === 'draft' ? '草稿：補齊目標、節律、每堂內容、教材與作業，能試教、可調整。' :
    '完稿：對外提案版＋上架素材（PPT大綱/講稿/口播/主持稿），進正式課程管理表。'
  );
}

function updateWizardDots(){
  // Keep simple: based on filledness
  const data = getForm();
  const score = [
    data.title && data.audience,
    data.closing_line,
    data.main_tool,
    (data.outline_items || []).some(x=>safeStr(x).trim())
  ].map(Boolean);

  [UI.dot1,UI.dot2,UI.dot3,UI.dot4].forEach((d,i)=>{
    d.classList.remove('active','done');
    if (score[i]) d.classList.add('done');
  });

  const firstIncomplete = score.findIndex(v=>!v);
  const idx = (firstIncomplete === -1) ? 3 : firstIncomplete;
  [UI.dot1,UI.dot2,UI.dot3,UI.dot4][idx].classList.add('active');
}

function onKindChange(){
  const kind = UI.kindSelect.value;
  UI.kindOtherWrap.style.display = (kind === 'other') ? 'block' : 'none';

  if (kind === 'module'){
    UI.episodesLabel.textContent = '模組堂數（episodes）';
    UI.durationLabel.textContent = '每堂時間（分鐘）';
    UI.episodes.disabled = false;
    UI.episodes.value = UI.episodes.value || '8';
  } else {
    UI.episodesLabel.textContent = '集數（episodes）';
    UI.durationLabel.textContent = '時間（分鐘）';
    // for lecture/single -> episodes forced 1
    UI.episodes.value = '1';
    UI.episodes.disabled = true;
  }

  buildOutlineInputs(parseInt(UI.episodes.value||'1',10));
  updateWizardDots();
}

function onEpisodesChange(){
  buildOutlineInputs(parseInt(UI.episodes.value||'1',10));
  updateWizardDots();
}

function onStateChange(){
  const state = UI.stateSelect.value;
  UI.draftExtra.style.display = (state === 'draft' || state === 'final') ? 'block' : 'none';
  updateStatusPills();
  updateWizardDots();
}

function getAiPrompt(){
  const state = UI.stateSelect.value;
  const stateZh = (state === 'idea') ? '發想' : (state === 'draft' ? '草稿' : '完稿');

  const data = getForm();
  const kindText = data.kindName || '';

  const mainName = data.main_tool ? (data.main_tool.name || '') : '';
  const mainLink = data.main_tool ? (data.main_tool.link || '') : '';
  const subs = (data.sub_tools || []).map(t => `${t.name || ''}｜${t.link || ''}`).join('\n');

  const framework = data.framework_text || data.outline || '';
  const episodesText = (data.kind === 'module')
    ? `${data.episodes}堂｜每堂${data.duration_min}分鐘｜${data.capacity}人`
    : `1場｜${data.duration_min}分鐘｜${data.capacity}人`;

  const template = `
你是「天使笑長」的協作夥伴。請用溫柔、清楚、不說教的語氣，幫我把課程從「${stateZh}」往下一階段完成。

0｜已輸入資料（請以此為準，不要改名、不重問）
課程名稱：${data.title}
類型：${kindText}
對象：${data.audience}
集數/時長/人數：${episodesText}
關鍵痛點/標籤：${data.tags}
主工具：${mainName}｜${mainLink}
副工具：
${subs || '（尚未選）'}
核心流程架構：${framework}
結尾定錨句：${data.closing_line}

1｜請你輸出三份成果（務必分段標題）
A) 活動/課程規劃（定位、目標、節律、適用場域）
B) 詳細設計內容（每堂/每場內容、現場流程、練習、作業、教材）
C) 回饋與追蹤方案（每週追蹤、回饋題、工具使用節律）

2｜依目前狀態輸出格式（很重要）
若 ${stateZh}=發想：請先產出「最小可行的完整課堂企劃」＋「可試做的教材與作業」，不要寫太長，但要完整可行。
若 ${stateZh}=草稿：請補齊每堂/每場「目標/工具/練習/作業/教材」，可直接拿去試教。
若 ${stateZh}=完稿：請產出「對外提案版」＋「PPT大綱」＋「逐頁講稿」＋「口播稿」＋「演說/主持稿」＋「教材與作業包」。

3｜最後請再輸出：表單橫向一列（可貼入）
請依下列表頭輸出一列（用 tab 分隔）：
{id, title, type, status, version, owner, audience, duration_min, capacity, tags, summary, objectives, outline, materials, links, assets, notes, created_at, updated_at}

若 ${stateZh}=發想：summary/objectives/outline 可短版
若 ${stateZh}=草稿：summary/objectives/outline 完整版
若 ${stateZh}=完稿：全部欄位給可上架的定稿版（status 預設 ready）
`.trim();

  return template;
}

function getTsvRow(){
  const data = getForm();

  const row = {
    id: data.id,
    title: data.title,
    type: data.type,
    status: data.status,
    version: data.version,
    owner: data.owner,
    audience: data.audience,
    duration_min: data.duration_min,
    capacity: data.capacity,
    tags: data.tags,
    summary: data.summary,
    objectives: data.objectives,
    outline: data.outline,
    materials: data.materials,
    links: data.links,
    assets: '',
    notes: data.notes,
    created_at: data.created_at,
    updated_at: data.updated_at
  };

  const header = ['id','title','type','status','version','owner','audience','duration_min','capacity','tags','summary','objectives','outline','materials','links','assets','notes','created_at','updated_at'];

  const cells = header.map(k => tsvSafe(row[k]));
  return cells.join('\t');
}

async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    toast('已複製');
  }catch(err){
    // fallback
    const ta=document.createElement('textarea');
    ta.value=text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已複製');
  }
}

function saveLocal(){
  const data = getForm();
  localStorage.setItem(LS_KEYS.draft, JSON.stringify(data));
  toast('已存本機草稿');
}

function loadLocal(){
  const raw = localStorage.getItem(LS_KEYS.draft);
  if (!raw){ toast('本機尚無草稿'); return; }
  try{
    const data = JSON.parse(raw);
    applyForm(data);
    toast('已叫出本機草稿');
  }catch(e){
    toast('草稿格式錯誤');
  }
}

function clearLocal(){
  localStorage.removeItem(LS_KEYS.draft);
  toast('已清空本機草稿');
}

function exportJson(){
  const data = getForm();
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url;
  a.download = `angel-course-${UI.stateSelect.value}-${Date.now()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 800);
}

function parseToolsApiResponse(obj){
  // Accept multiple shapes:
  // {ok:true, tools:[...]}
  // {ok:true, items:[...]}
  // [...]
  if (Array.isArray(obj)) return obj;
  if (!obj) return [];
  if (Array.isArray(obj.tools)) return obj.tools;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.data)) return obj.data;
  if (obj.ok && obj.tools) return obj.tools;
  return [];
}

function normalizeTool(t){
  const toolCode = safeStr(t.toolCode || t.tool_code || t.code || t.id || '').trim();
  const name = safeStr(t.name || t.title || t.toolName || '').trim();
  const core = safeStr(t.core || t.summary || '').trim();
  const pain_points = safeStr(t.pain_points || t.tags || t.painPoints || '').trim();
  const chapters = safeStr(t.chapters || '').trim();
  const steps = safeStr(t.steps || '').trim();
  const tips = safeStr(t.tips || '').trim();
  const link = safeStr(t.link || t.url || '').trim();
  const category = safeStr(t.category || '').trim();
  const status = safeStr(t.status || 'active').trim().toLowerCase();
  const video_title = safeStr(t.video_title || '').trim();
  const video_link = safeStr(t.video_link || '').trim();

  return { toolCode, name, core, pain_points, chapters, steps, tips, link, category, status, video_title, video_link };
}

async function fetchTools(force=false){
  const settings = loadSettings();

  if (!force){
    const cached = localStorage.getItem(LS_KEYS.toolsCache);
    if (cached){
      try{
        const obj = JSON.parse(cached);
        tools = (obj.tools || []).map(normalizeTool);
        renderTools();
      }catch(e){}
    }
  }

  try{
    const url = new URL(settings.toolsApi);
    // read-only list
    if (!url.searchParams.get('mode')) url.searchParams.set('mode','tools');
    const res = await fetch(url.toString(), {method:'GET'});
    const txt = await res.text();
    const obj = JSON.parse(txt);
    const list = parseToolsApiResponse(obj).map(normalizeTool).filter(t=>t.status==='active');
    tools = list;
    localStorage.setItem(LS_KEYS.toolsCache, JSON.stringify({updated_at: nowIso(), tools}));
    renderTools();
    toast('工具庫已同步');
  }catch(err){
    toast('工具同步失敗：將使用快取');
  }
}

function filterTools(list, {q='', prefix='', category=''}){
  const qq = safeStr(q).trim().toLowerCase();
  const pf = safeStr(prefix).trim().toUpperCase();
  const cat = safeStr(category).trim().toLowerCase();

  return list.filter(t=>{
    if (pf){
      const code = safeStr(t.toolCode).toUpperCase();
      if (!code.startsWith(pf + '-')) return false;
    }
    if (cat){
      if (!safeStr(t.category).toLowerCase().includes(cat)) return false;
    }
    if (qq){
      const hay = [
        t.toolCode, t.name, t.core, t.pain_points, t.category, t.steps, t.tips
      ].join(' ').toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  });
}

function renderTools(){
  const q = UI.toolsSearch.value;
  const prefix = UI.toolsPrefix.value;
  const cat = UI.toolsCategory.value;

  const list = filterTools(tools, {q, prefix, category:cat});
  UI.toolsList.innerHTML = '';
  if (!list.length){
    UI.toolsList.innerHTML = `<div class="mini">目前沒有符合條件的工具。你可以按「同步工具庫」。</div>`;
    return;
  }
  list.forEach(t=>{
    const div=document.createElement('div');
    div.className='tool-item';
    div.innerHTML = `
      <div class="title">${escapeHtml(t.toolCode)}｜${escapeHtml(t.name)}</div>
      <div class="meta">${escapeHtml(t.category)} · ${escapeHtml(t.core)}</div>
      <div class="meta">${escapeHtml(t.pain_points)}</div>
      <div class="actions">
        <a class="btn small" href="${escapeAttr(t.link)}" target="_blank" rel="noopener">開啟</a>
        <button class="btn small" data-pick="${escapeAttr(t.toolCode)}">加入副工具</button>
        <button class="btn small" data-main="${escapeAttr(t.toolCode)}">設為主工具</button>
      </div>
    `;
    div.querySelector('[data-pick]').addEventListener('click', ()=>{
      addSubToolByCode(t.toolCode);
      toast('已加入副工具');
    });
    div.querySelector('[data-main]').addEventListener('click', ()=>{
      setMainToolByCode(t.toolCode);
      toast('已設為主工具');
    });
    UI.toolsList.appendChild(div);
  });
}

function addSubToolByCode(code){
  const t = tools.find(x=>x.toolCode===code);
  if (!t) return;
  if (selectedSubTools.some(x=>x.toolCode===code)) return;
  selectedSubTools.push(t);
  renderSelectedTools();
}

function setMainToolByCode(code){
  const t = tools.find(x=>x.toolCode===code);
  if (!t) return;
  selectedMainTool = t;
  renderSelectedTools();
}

function openToolModal(mode){
  pickerMode = mode;
  UI.modalTitle.textContent = (mode === 'main') ? '選主工具（單選）' : '選副工具（多選）';
  UI.modalSearch.value = '';
  UI.modalPrefix.value = '';
  UI.modalCategory.value = '';
  UI.modalBg.style.display='block';
  UI.toolModal.style.display='block';
  renderModalTools();
}

function closeToolModal(){
  UI.modalBg.style.display='none';
  UI.toolModal.style.display='none';
}

function renderModalTools(){
  const q = UI.modalSearch.value;
  const prefix = UI.modalPrefix.value;
  const cat = UI.modalCategory.value;

  const list = filterTools(tools, {q, prefix, category:cat});
  UI.modalTools.innerHTML='';
  if (!list.length){
    UI.modalTools.innerHTML = `<div class="mini">沒有找到工具。請先到「工具庫存管理」同步。</div>`;
    return;
  }

  list.forEach(t=>{
    const div=document.createElement('div');
    div.className='tool-item';
    const isMain = selectedMainTool && selectedMainTool.toolCode === t.toolCode;
    const isSub = selectedSubTools.some(x=>x.toolCode===t.toolCode);

    const pickLabel = (pickerMode === 'main') ? (isMain ? '已選' : '選它') : (isSub ? '已勾' : '勾選');
    const badge = `<span class="badge ${t.status==='active'?'active':''}">${escapeHtml(t.toolCode)}</span>`;

    div.innerHTML = `
      <div class="title">${badge} ${escapeHtml(t.name)}</div>
      <div class="meta">${escapeHtml(t.category)} · ${escapeHtml(t.core)}</div>
      <div class="meta">${escapeHtml(t.pain_points)}</div>
      <div class="actions">
        <a class="btn small" href="${escapeAttr(t.link)}" target="_blank" rel="noopener">開啟</a>
        <button class="btn small" data-select="${escapeAttr(t.toolCode)}">${pickLabel}</button>
      </div>
    `;
    div.querySelector('[data-select]').addEventListener('click', ()=>{
      if (pickerMode === 'main'){
        selectedMainTool = t;
      } else {
        if (selectedSubTools.some(x=>x.toolCode===t.toolCode)){
          selectedSubTools = selectedSubTools.filter(x=>x.toolCode!==t.toolCode);
        } else {
          selectedSubTools.push(t);
        }
      }
      renderSelectedTools();
      renderModalTools();
    });

    UI.modalTools.appendChild(div);
  });
}

function escapeHtml(s){
  return safeStr(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function escapeAttr(s){
  return escapeHtml(s).replace(/"/g,'&quot;');
}

async function apiPing(url){
  try{
    const u = new URL(url);
    u.searchParams.set('mode','ping');
    const res = await fetch(u.toString(), {method:'GET'});
    const txt = await res.text();
    return {ok:true, text:txt};
  }catch(e){
    return {ok:false, text:String(e)};
  }
}

async function syncToBackend(){
  const settings = loadSettings();
  const state = UI.stateSelect.value;
  const sheet = SHEET_BY_STATE[state];
  const row = getTsvRow();

  UI.syncLog.textContent = '同步中...';

  // Best-effort: try POST JSON first
  const payload = {
    action: 'append',
    sheet: sheet,
    tsv: row,
    state: state,
    ts: nowIso()
  };

  try{
    const res = await fetch(settings.courseApi, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const txt = await res.text();
    UI.syncLog.textContent = `POST 回應：${txt}`;
    toast('已送出同步（POST）');
    return;
  }catch(err){
    // fallback: GET with query
  }

  try{
    const u = new URL(settings.courseApi);
    u.searchParams.set('action','append');
    u.searchParams.set('sheet', sheet);
    u.searchParams.set('tsv', row);
    const res = await fetch(u.toString(), {method:'GET'});
    const txt = await res.text();
    UI.syncLog.textContent = `GET 回應：${txt}`;
    toast('已送出同步（GET）');
  }catch(err){
    UI.syncLog.textContent = `同步失敗：${String(err)}`;
    toast('同步失敗');
  }
}

async function loadListFromBackend(state){
  const settings = loadSettings();
  const sheet = SHEET_BY_STATE[state];
  UI.syncLog.textContent = '抓取中...';

  // Expect: ?action=list&sheet=...
  try{
    const u = new URL(settings.courseApi);
    u.searchParams.set('action','list');
    u.searchParams.set('sheet', sheet);
    const res = await fetch(u.toString(), {method:'GET'});
    const txt = await res.text();
    let obj = null;
    try{ obj = JSON.parse(txt); }catch(e){ obj = null; }
    // Accept shapes: {ok:true, rows:[...]} or {items:[...]} or raw array
    let list = [];
    if (Array.isArray(obj)) list = obj;
    else if (obj && Array.isArray(obj.rows)) list = obj.rows;
    else if (obj && Array.isArray(obj.items)) list = obj.items;
    else list = [];

    lastApiList = list;
    UI.syncLog.textContent = `已抓到 ${list.length} 筆（${sheet}）`;
    toast(`已抓到 ${list.length} 筆`);
    if (state === 'final'){
      finals = list;
      renderFinals();
    }
  }catch(err){
    UI.syncLog.textContent = `抓取失敗：${String(err)}`;
    toast('抓取失敗');
  }
}

function renderFinals(){
  const q = safeStr(UI.finalsSearch.value).toLowerCase().trim();
  UI.finalsList.innerHTML = '';
  const list = (finals || []).filter(x=>{
    const hay = JSON.stringify(x||{}).toLowerCase();
    return q ? hay.includes(q) : true;
  });

  if (!list.length){
    UI.finalsList.innerHTML = `<div class="mini">目前沒有完稿資料。請先按「抓完稿清單」。</div>`;
    return;
  }

  list.slice(0,200).forEach(item=>{
    const title = safeStr(item.title || item[1] || '').trim();
    const tags = safeStr(item.tags || '').trim();
    const audience = safeStr(item.audience || '').trim();
    const div=document.createElement('div');
    div.className='tool-item';
    div.innerHTML = `
      <div class="title">${escapeHtml(title || '（未命名）')}</div>
      <div class="meta">${escapeHtml(audience)} · ${escapeHtml(tags)}</div>
      <div class="actions">
        <button class="btn small" data-load>叫出到工作台</button>
        <button class="btn small" data-copyai>複製AI指令</button>
        <button class="btn small" data-copytsv>複製TSV</button>
      </div>
    `;
    div.querySelector('[data-load]').addEventListener('click', ()=>{
      // If backend returns full object in our shape, apply
      // Otherwise, keep minimal
      const mapped = mapBackendItemToForm_(item);
      applyForm(mapped);
      switchTab('workbench');
      toast('已叫出');
    });
    div.querySelector('[data-copyai]').addEventListener('click', async ()=>{
      const mapped = mapBackendItemToForm_(item);
      applyForm(mapped);
      await copyToClipboard(getAiPrompt());
    });
    div.querySelector('[data-copytsv]').addEventListener('click', async ()=>{
      const mapped = mapBackendItemToForm_(item);
      applyForm(mapped);
      await copyToClipboard(getTsvRow());
    });

    UI.finalsList.appendChild(div);
  });
}

function mapBackendItemToForm_(item){
  // If item is already structured
  if (item && typeof item === 'object' && !Array.isArray(item)){
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      status: item.status,
      version: item.version,
      owner: item.owner,
      audience: item.audience,
      duration_min: item.duration_min,
      capacity: item.capacity,
      tags: item.tags,
      summary: item.summary,
      objectives: item.objectives,
      outline: item.outline,
      materials: item.materials,
      notes: item.notes,
      main_tool: item.main_tool || null,
      sub_tools: item.sub_tools || [],
      outline_items: (item.outline_items || splitOutline_(item.outline)),
      framework_text: item.framework_text || '',
      closing_line: item.closing_line || '',
      episodes: item.episodes || ''
    };
  }
  // If it's an array row (tsv split by tabs already)
  if (Array.isArray(item)){
    // fallback mapping by known header order
    return {
      id: item[0],
      title: item[1],
      type: item[2],
      status: item[3],
      version: item[4],
      owner: item[5],
      audience: item[6],
      duration_min: item[7],
      capacity: item[8],
      tags: item[9],
      summary: item[10],
      objectives: item[11],
      outline: item[12],
      materials: item[13],
      links: item[14],
      notes: item[16],
      outline_items: splitOutline_(item[12] || ''),
    };
  }
  return {};
}

function splitOutline_(text){
  const s = safeStr(text);
  if (!s.trim()) return [];
  return s.split(/\n+/).map(x=>x.replace(/^\d+\.?\s*/,'').trim()).filter(Boolean);
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.tab===name);
  });
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  $('tab-' + name).classList.add('active');
}

function bindTabs(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTab(btn.dataset.tab));
  });
}

function bindSettings(){
  UI.btnSettings.addEventListener('click', ()=>{
    const s = loadSettings();
    UI.toolsApi.value = s.toolsApi;
    UI.courseApi.value = s.courseApi;
    UI.modalBg.style.display='block';
    UI.settingsModal.style.display='block';
    UI.settingsLog.textContent='';
  });
  UI.settingsClose.addEventListener('click', ()=>{
    UI.modalBg.style.display='none';
    UI.settingsModal.style.display='none';
  });
  UI.settingsSave.addEventListener('click', ()=>{
    const s = loadSettings();
    s.toolsApi = safeStr(UI.toolsApi.value).trim();
    s.courseApi = safeStr(UI.courseApi.value).trim();
    saveSettings(s);
    UI.settingsLog.textContent = '已儲存。';
    toast('設定已儲存');
  });
  UI.settingsPing.addEventListener('click', async ()=>{
    const toolsPing = await apiPing(UI.toolsApi.value.trim());
    const coursePing = await apiPing(UI.courseApi.value.trim());
    UI.settingsLog.textContent = `Tools ping: ${toolsPing.ok ? 'OK' : 'FAIL'}\n${toolsPing.text}\n\nCourse ping: ${coursePing.ok ? 'OK' : 'FAIL'}\n${coursePing.text}`;
  });
}

function bindWorkbench(){
  UI.kindSelect.addEventListener('change', onKindChange);
  UI.episodes.addEventListener('input', onEpisodesChange);
  UI.stateSelect.addEventListener('change', onStateChange);

  // update dots on input
  ['title','audience','tags','closingLine','frameworkText','durationMin','capacity','owner','kindOther'].forEach(id=>{
    $(id).addEventListener('input', updateWizardDots);
  });

  UI.btnPickMain.addEventListener('click', ()=>{
    if (!tools.length) fetchTools();
    openToolModal('main');
  });
  UI.btnPickSubs.addEventListener('click', ()=>{
    if (!tools.length) fetchTools();
    openToolModal('subs');
  });

  UI.modalClose.addEventListener('click', closeToolModal);
  UI.modalBg.addEventListener('click', ()=>{
    // close only tool/settings modals if open
    if (UI.toolModal.style.display==='block') closeToolModal();
    if (UI.settingsModal.style.display==='block'){
      UI.modalBg.style.display='none';
      UI.settingsModal.style.display='none';
    }
  });
  UI.modalSearch.addEventListener('input', renderModalTools);
  UI.modalPrefix.addEventListener('change', renderModalTools);
  UI.modalCategory.addEventListener('input', renderModalTools);
  UI.modalConfirm.addEventListener('click', ()=>{
    renderSelectedTools();
    closeToolModal();
    toast('已確認');
  });

  UI.btnCopyAI.addEventListener('click', ()=> copyToClipboard(getAiPrompt()));
  UI.btnCopyTSV.addEventListener('click', ()=> copyToClipboard(getTsvRow()));
  UI.btnSaveLocal.addEventListener('click', saveLocal);
  UI.btnLoadLocal.addEventListener('click', loadLocal);
  UI.btnClearLocal.addEventListener('click', clearLocal);
  UI.btnExportJson.addEventListener('click', exportJson);

  UI.fCopyAI.addEventListener('click', ()=> copyToClipboard(getAiPrompt()));
  UI.fCopyTSV.addEventListener('click', ()=> copyToClipboard(getTsvRow()));
  UI.fSaveLocal.addEventListener('click', saveLocal);
  UI.fExportJson.addEventListener('click', exportJson);

  UI.btnSync.addEventListener('click', syncToBackend);
  UI.btnLoadFromApi.addEventListener('click', ()=> loadListFromBackend(UI.stateSelect.value));
}

function bindTools(){
  UI.btnToolsSync.addEventListener('click', ()=> fetchTools(true));
  UI.btnToolsClearCache.addEventListener('click', ()=>{
    localStorage.removeItem(LS_KEYS.toolsCache);
    tools = [];
    renderTools();
    toast('已清空工具快取');
  });
  UI.toolsSearch.addEventListener('input', renderTools);
  UI.toolsPrefix.addEventListener('change', renderTools);
  UI.toolsCategory.addEventListener('input', renderTools);
}

function bindFinals(){
  UI.btnFinalsLoad.addEventListener('click', ()=> loadListFromBackend('final'));
  UI.finalsSearch.addEventListener('input', renderFinals);
}

function init(){
  // Cache UI refs
  Object.assign(UI, {
    toast: $('toast'),
    // tabs
    // workbench
    statusPills: $('statusPills'),
    stateSelect: $('stateSelect'),
    kindSelect: $('kindSelect'),
    kindOtherWrap: $('kindOtherWrap'),
    kindOther: $('kindOther'),
    scheduleRow: $('scheduleRow'),
    episodesLabel: $('episodesLabel'),
    durationLabel: $('durationLabel'),
    episodes: $('episodes'),
    durationMin: $('durationMin'),
    capacity: $('capacity'),
    title: $('title'),
    audience: $('audience'),
    tags: $('tags'),
    owner: $('owner'),
    closingLine: $('closingLine'),
    mainTool: $('mainTool'),
    subTools: $('subTools'),
    btnPickMain: $('btnPickMain'),
    btnPickSubs: $('btnPickSubs'),
    frameworkText: $('frameworkText'),
    outlineList: $('outlineList'),
    draftExtra: $('draftExtra'),
    summary: $('summary'),
    objectives: $('objectives'),
    materials: $('materials'),
    notes: $('notes'),
    dot1:$('dot1'), dot2:$('dot2'), dot3:$('dot3'), dot4:$('dot4'),
    stateHint: $('stateHint'),
    syncLog: $('syncLog'),
    btnSync: $('btnSync'),
    btnLoadFromApi: $('btnLoadFromApi'),
    btnCopyAI: $('btnCopyAI'),
    btnCopyTSV: $('btnCopyTSV'),
    btnSaveLocal: $('btnSaveLocal'),
    btnLoadLocal: $('btnLoadLocal'),
    btnClearLocal: $('btnClearLocal'),
    btnExportJson: $('btnExportJson'),
    autoCleanNewlines: $('autoCleanNewlines'),
    fCopyAI: $('fCopyAI'),
    fCopyTSV: $('fCopyTSV'),
    fSaveLocal: $('fSaveLocal'),
    fExportJson: $('fExportJson'),

    // tools tab
    btnToolsSync: $('btnToolsSync'),
    btnToolsClearCache: $('btnToolsClearCache'),
    toolsSearch: $('toolsSearch'),
    toolsPrefix: $('toolsPrefix'),
    toolsCategory: $('toolsCategory'),
    toolsList: $('toolsList'),

    // finals tab
    btnFinalsLoad: $('btnFinalsLoad'),
    finalsSearch: $('finalsSearch'),
    finalsList: $('finalsList'),

    // modals
    modalBg: $('modalBg'),
    toolModal: $('toolModal'),
    modalTitle: $('modalTitle'),
    modalClose: $('modalClose'),
    modalSearch: $('modalSearch'),
    modalPrefix: $('modalPrefix'),
    modalCategory: $('modalCategory'),
    modalTools: $('modalTools'),
    modalConfirm: $('modalConfirm'),

    // settings modal
    btnSettings: $('btnSettings'),
    settingsModal: $('settingsModal'),
    settingsClose: $('settingsClose'),
    toolsApi: $('toolsApi'),
    courseApi: $('courseApi'),
    settingsSave: $('settingsSave'),
    settingsPing: $('settingsPing'),
    settingsLog: $('settingsLog'),
  });

  bindTabs();
  bindSettings();
  bindWorkbench();
  bindTools();
  bindFinals();

  // Initial
  onKindChange();
  onStateChange();
  renderSelectedTools();
  updateWizardDots();

  // Load tools cache instantly, then fetch in background
  fetchTools(false);

  // Load local draft if exists (soft)
  const raw = localStorage.getItem(LS_KEYS.draft);
  if (raw){
    try{ applyForm(JSON.parse(raw)); }catch(e){}
  }

  // Register SW
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}

document.addEventListener('DOMContentLoaded', init);