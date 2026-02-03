/*
  Angel｜課程管理工房 (PWA)
  - 三狀態：idea / draft / final -> 對應 GAS Course Manager API
  - 工具庫存：讀取 Tools Inventory API (工具庫存管理)
  - 完稿：可勾選多個「單場完稿」-> 一鍵組合成「模組課程/活動」，存回 final

  設計原則：
  - 一眼就會用、三秒開始
  - 不說教、不評價
*/

/* ===================== CONFIG ===================== */
const CONFIG = {
  // ✅ 你的「幸福教養課程管理 API」
  courseApi: "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec",
  // ✅ 工具庫存（你說：這張手動維護，給前臺勾選用）
  toolsApi: "https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec?sheet=工具庫存管理&format=tools",
  listLimit: 200,
};

const STATE_LABEL = { idea: "發想", draft: "草稿", final: "完稿" };

/* ===================== DOM ===================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const els = {
  // tabs
  tabBtns: $$('[data-tab]'),
  panels: $$('.panel'),
  // toast
  toast: $('#toast'),

  // lists
  list: {
    idea: $('#list-idea'),
    draft: $('#list-draft'),
    final: $('#list-final'),
  },
  search: {
    idea: $('#search-idea'),
    draft: $('#search-draft'),
    final: $('#search-final'),
  },
  refresh: {
    idea: $('#refresh-idea'),
    draft: $('#refresh-draft'),
    final: $('#refresh-final'),
  },
  newBtn: {
    idea: $('#new-idea'),
    draft: $('#new-draft'),
    final: $('#new-final'),
  },

  // editor fields
  editor: {
    state: $('#editor-state'),
    id: $('#f-id'),
    title: $('#f-title'),
    type: $('#f-type'),
    kind: $('#f-kind'),
    kindOther: $('#f-kind-other'),
    audience: $('#f-audience'),
    duration: $('#f-duration'),
    tags: $('#f-tags'),
    status: $('#f-status'),
    summary: $('#f-summary'),
    outline: $('#f-outline'),
    links: $('#f-links'),
    script: $('#f-script'),
    toolsUsed: $('#f-tools-used'),
  },
  editorActions: {
    save: $('#save'),
    clear: $('#clear'),
    delete: $('#delete'),
  },

  // local draft
  local: {
    save: $('#local-save'),
    load: $('#local-load'),
    clear: $('#local-clear'),
  },

  // tools
  tools: {
    refresh: $('#tools-refresh'),
    list: $('#tools-list'),
    filter: $('#tools-filter'),
  },

  // module composer
  moduleBar: $('#module-bar'),
  moduleCount: $('#module-count'),
  moduleBtn: $('#module-create'),
  modal: $('#modal'),
  modalTitle: $('#m-title'),
  modalKind: $('#m-kind'),
  modalMinutes: $('#m-minutes'),
  modalNote: $('#m-note'),
  modalCancel: $('#m-cancel'),
  modalCreate: $('#m-create'),
};

/* ===================== STATE ===================== */
const store = {
  activeTab: 'idea',
  lists: { idea: [], draft: [], final: [] },
  current: null, // current editor object
  tools: [],
  finalSelections: new Set(),
};

/* ===================== UTIL ===================== */
function toast(msg, type = 'ok') {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.remove('hide');
  els.toast.dataset.type = type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.add('hide'), 2200);
}

function safeJsonParse(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function nowISO() { return new Date().toISOString(); }

function pick(v) { return (v === undefined || v === null) ? '' : String(v); }

function normalizeKind() {
  const k = els.editor.kind.value;
  const other = els.editor.kindOther.value.trim();
  els.editor.kindOther.classList.toggle('hide', k !== '其他');
  return k === '其他' ? other : k;
}

function editorToObj() {
  const state = els.editor.state.value;
  const kind = normalizeKind();
  return {
    id: els.editor.id.value.trim(),
    title: els.editor.title.value.trim(),
    type: els.editor.type.value,
    kind: els.editor.kind.value,
    kind_other: els.editor.kind.value === '其他' ? els.editor.kindOther.value.trim() : '',
    audience: els.editor.audience.value.trim(),
    duration_min: els.editor.duration.value.trim(),
    tags: els.editor.tags.value.trim(),
    status: els.editor.status.value.trim(),
    summary: els.editor.summary.value.trim(),
    outline: els.editor.outline.value.trim(),
    links: els.editor.links.value.trim(),
    script: els.editor.script.value.trim(),
    tools_used: els.editor.toolsUsed.value.trim(),
    updated_at: nowISO(),
    // schedule fields (single by default)
    schedule_mode: 'single',
    single_duration: els.editor.duration.value.trim(),
    // keep state as info (not required, but handy)
    state,
  };
}

function objToEditor(obj, state) {
  store.current = obj ? { ...obj } : null;
  els.editor.state.value = state;
  els.editor.id.value = pick(obj?.id);
  els.editor.title.value = pick(obj?.title);
  els.editor.type.value = pick(obj?.type) || 'course';
  const k = pick(obj?.kind) || '';
  const kindOptions = ['演講', '模組課程', '單場課程', '單場活動', '其他'];
  els.editor.kind.value = kindOptions.includes(k) ? k : (k ? '其他' : '單場課程');
  els.editor.kindOther.value = pick(obj?.kind_other || (els.editor.kind.value === '其他' ? k : ''));
  normalizeKind();
  els.editor.audience.value = pick(obj?.audience);
  els.editor.duration.value = pick(obj?.duration_min || obj?.single_duration);
  els.editor.tags.value = pick(obj?.tags);
  els.editor.status.value = pick(obj?.status);
  els.editor.summary.value = pick(obj?.summary);
  els.editor.outline.value = pick(obj?.outline);
  els.editor.links.value = pick(obj?.links);
  els.editor.script.value = pick(obj?.script);
  els.editor.toolsUsed.value = pick(obj?.tools_used);
}

function clearEditor(keepState = true) {
  const state = keepState ? els.editor.state.value : 'idea';
  objToEditor(null, state);
  els.editor.id.value = '';
}

function makeCard({ title, sub, right, body, checked, checkbox }) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <div class="card-title">
      <div class="row" style="gap:10px; align-items:center;">
        ${checkbox ? `<input class="chk" type="checkbox" ${checked ? 'checked' : ''} />` : ''}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800;">${escapeHtml(title || '未命名')}</div>
          ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}
        </div>
      </div>
      ${right ? `<span class="pill">${escapeHtml(right)}</span>` : ''}
    </div>
    ${body ? `<div class="card-body">${escapeHtml(body)}</div>` : ''}
  `;
  return div;
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ===================== API ===================== */
async function apiCourseList(state, q = '') {
  const url = new URL(CONFIG.courseApi);
  url.searchParams.set('mode', 'list');
  url.searchParams.set('state', state);
  url.searchParams.set('limit', String(CONFIG.listLimit));
  if (q) url.searchParams.set('q', q);
  const res = await fetch(url.toString(), { method: 'GET' });
  return res.json();
}

async function apiCourseUpsert(state, item) {
  const url = new URL(CONFIG.courseApi);
  url.searchParams.set('mode', 'upsert');
  url.searchParams.set('state', state);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item }),
  });
  return res.json();
}

async function apiCourseDelete(state, id) {
  const url = new URL(CONFIG.courseApi);
  url.searchParams.set('mode', 'delete');
  url.searchParams.set('state', state);
  url.searchParams.set('id', id);
  const res = await fetch(url.toString(), { method: 'GET' });
  return res.json();
}

async function apiToolsList() {
  const res = await fetch(CONFIG.toolsApi, { method: 'GET' });
  return res.json();
}

/* ===================== RENDER ===================== */
function renderCourseList(state) {
  const listEl = els.list[state];
  const q = els.search[state].value.trim().toLowerCase();
  listEl.innerHTML = '';

  const items = (store.lists[state] || []).filter(it => {
    if (!q) return true;
    const hay = `${it.id || ''} ${it.title || ''} ${it.tags || ''} ${it.summary || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '目前沒有資料。你可以按「新增一筆」，先把它寫下來。';
    listEl.appendChild(empty);
    return;
  }

  items.forEach(it => {
    const right = it.kind || it.type || '';
    const sub = [it.id, it.status].filter(Boolean).join(' · ');
    const body = it.summary || '';

    const checkbox = (state === 'final') && isSingleFinal_(it);
    const checked = checkbox ? store.finalSelections.has(it.id) : false;
    const card = makeCard({
      title: it.title || '未命名',
      sub,
      right,
      body,
      checkbox,
      checked,
    });
    card.dataset.id = it.id;
    card.dataset.state = state;
    card.addEventListener('click', (ev) => {
      // checkbox click should not load editor
      if (ev.target && ev.target.classList.contains('chk')) return;
      objToEditor(it, state);
      toast(`已載入：${it.title || it.id}`);
    });
    if (checkbox) {
      const chk = $('.chk', card);
      chk.addEventListener('change', () => {
        if (!it.id) return;
        if (chk.checked) store.finalSelections.add(it.id);
        else store.finalSelections.delete(it.id);
        updateModuleBar_();
      });
    }
    listEl.appendChild(card);
  });
}

function isSingleFinal_(it) {
  const mode = String(it.schedule_mode || '').toLowerCase();
  if (mode === 'module') return false;
  const kind = String(it.kind || '').trim();
  // 你要「單場完稿」才能被拿去組模組
  return ['演講', '單場課程', '單場活動'].includes(kind) || !kind;
}

function updateModuleBar_() {
  const n = store.finalSelections.size;
  els.moduleBar.classList.toggle('hide', store.activeTab !== 'final');
  els.moduleCount.textContent = n ? `已勾選 ${n} 堂` : '可勾選多堂「單場完稿」，組合成模組課程';
  els.moduleBtn.disabled = n < 2;
}

function renderTools() {
  const listEl = els.tools.list;
  const q = els.tools.filter.value.trim().toLowerCase();
  listEl.innerHTML = '';

  const items = (store.tools || []).filter(it => {
    if (!q) return true;
    const hay = `${it.toolCode || ''} ${it.name || ''} ${it.core || ''} ${it.pain_points || ''} ${it.category || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '找不到工具。你可以清掉關鍵字，或確認「工具庫存管理」分頁有資料。';
    listEl.appendChild(empty);
    return;
  }

  items.forEach(it => {
    const title = `${it.toolCode || ''} ${it.name || ''}`.trim() || '未命名工具';
    const sub = [it.category, it.status].filter(Boolean).join(' · ');
    const body = it.core || it.tips || '';
    const card = makeCard({ title, sub, right: '工具', body });
    card.addEventListener('click', () => {
      // 一鍵加入「工具使用」欄位（逗號分隔）
      const code = (it.toolCode || it.name || '').trim();
      if (!code) return;
      const cur = els.editor.toolsUsed.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!cur.includes(code)) cur.push(code);
      els.editor.toolsUsed.value = cur.join(', ');
      toast(`已加入工具：${code}`);
    });
    listEl.appendChild(card);
  });
}

/* ===================== ACTIONS ===================== */
async function loadState(state, silent = false) {
  if (!silent) toast(`抓取 ${STATE_LABEL[state]}...`);
  const data = await apiCourseList(state, '');
  if (!data?.ok) {
    toast(`抓取失敗：${data?.error || '未知錯誤'}`, 'err');
    return;
  }
  store.lists[state] = data.items || [];
  renderCourseList(state);
  if (!silent) toast(`已更新 ${STATE_LABEL[state]}：${data.count || 0} 筆`);
}

async function saveCurrent() {
  const state = els.editor.state.value;
  const item = editorToObj();
  if (!item.title) {
    toast('先給它一個標題（title）就好。', 'err');
    els.editor.title.focus();
    return;
  }

  toast('正在存入後臺...');
  const res = await apiCourseUpsert(state, item);
  if (!res?.ok) {
    toast(`存檔失敗：${res?.error || '未知錯誤'}`, 'err');
    return;
  }
  // server may generate id
  const saved = res.item || item;
  objToEditor(saved, state);
  await loadState(state, true);
  toast(`已存入 ${STATE_LABEL[state]} ✅`);
}

async function deleteCurrent() {
  const state = els.editor.state.value;
  const id = els.editor.id.value.trim();
  if (!id) {
    toast('這筆還沒有 id，不需要刪。', 'err');
    return;
  }
  if (!confirm(`確定刪除這筆嗎？\n${id}`)) return;
  toast('刪除中...');
  const res = await apiCourseDelete(state, id);
  if (!res?.ok) {
    toast(`刪除失敗：${res?.error || '未知錯誤'}`, 'err');
    return;
  }
  clearEditor(true);
  await loadState(state, true);
  toast('已刪除');
}

function saveLocal() {
  const state = els.editor.state.value;
  const item = editorToObj();
  const key = `angel_course_local_${state}`;
  localStorage.setItem(key, JSON.stringify({ saved_at: nowISO(), item }));
  toast('已存本機草稿（localStorage）');
}

function loadLocal() {
  const state = els.editor.state.value;
  const key = `angel_course_local_${state}`;
  const raw = localStorage.getItem(key);
  const data = safeJsonParse(raw, null);
  if (!data?.item) {
    toast('本機沒有草稿。', 'err');
    return;
  }
  objToEditor(data.item, state);
  toast('已叫出本機草稿');
}

function clearLocal() {
  const state = els.editor.state.value;
  const key = `angel_course_local_${state}`;
  localStorage.removeItem(key);
  toast('已清空本機草稿');
}

/* ===================== MODULE COMPOSE ===================== */
function openModal() {
  els.modal.classList.remove('hide');
  els.modalTitle.value = '';
  els.modalKind.value = '模組課程';
  els.modalMinutes.value = '';
  els.modalNote.value = '';
  setTimeout(() => els.modalTitle.focus(), 50);
}

function closeModal() {
  els.modal.classList.add('hide');
}

async function createModuleFromSelections() {
  const ids = Array.from(store.finalSelections);
  if (ids.length < 2) {
    toast('至少勾選 2 堂單場完稿，才可以組模組。', 'err');
    return;
  }
  const title = els.modalTitle.value.trim();
  if (!title) {
    toast('請填「模組名稱」。', 'err');
    els.modalTitle.focus();
    return;
  }

  // find selected items
  const map = new Map((store.lists.final || []).map(it => [String(it.id || ''), it]));
  const children = ids.map(id => map.get(String(id))).filter(Boolean);
  const childTitles = children.map(it => it.title).filter(Boolean);

  const moduleItem = {
    title,
    type: 'course',
    kind: els.modalKind.value,
    schedule_mode: 'module',
    module_sessions: String(children.length),
    session_minutes: els.modalMinutes.value.trim(),
    status: 'ready',
    tags: '',
    summary: `由 ${children.length} 堂單場完稿組合而成。`,
    outline: childTitles.map((t, i) => `${String(i + 1).padStart(2, '0')}｜${t}`).join('\n'),
    notes: els.modalNote.value.trim(),
    module_children: JSON.stringify({ ids, titles: childTitles }),
    updated_at: nowISO(),
  };

  toast('正在建立模組...');
  const res = await apiCourseUpsert('final', moduleItem);
  if (!res?.ok) {
    toast(`建立失敗：${res?.error || '未知錯誤'}`, 'err');
    return;
  }

  // reset selections
  store.finalSelections.clear();
  closeModal();
  await loadState('final', true);
  updateModuleBar_();
  toast('模組已建立並存入完稿 ✅');
}

/* ===================== TOOLS ===================== */
async function refreshTools() {
  toast('抓取工具庫存...');
  const data = await apiToolsList();
  if (!data?.ok) {
    toast(`工具抓取失敗：${data?.error || '未知錯誤'}`, 'err');
    return;
  }
  // 兼容不同後端：items 或 tools
  store.tools = data.items || data.tools || data.data || [];
  renderTools();
  toast(`已更新工具：${store.tools.length} 筆`);
}

/* ===================== TAB ===================== */
function showTab(tab) {
  store.activeTab = tab;
  els.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  els.panels.forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  // keep editor state in sync
  if (['idea', 'draft', 'final'].includes(tab)) {
    els.editor.state.value = tab;
    updateModuleBar_();
  }
}

/* ===================== INIT ===================== */
function bind() {
  // tabs
  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      showTab(tab);
    });
  });

  // list actions
  ['idea', 'draft', 'final'].forEach(state => {
    els.refresh[state].addEventListener('click', () => loadState(state));
    els.search[state].addEventListener('input', () => renderCourseList(state));
    els.newBtn[state].addEventListener('click', () => {
      showTab(state);
      clearEditor(true);
      els.editor.state.value = state;
      // default for new
      els.editor.kind.value = (state === 'final') ? '單場課程' : '其他';
      normalizeKind();
      toast('新增一筆：你可以先寫標題就好。');
    });
  });

  // editor
  els.editor.kind.addEventListener('change', normalizeKind);
  els.editorActions.save.addEventListener('click', saveCurrent);
  els.editorActions.clear.addEventListener('click', () => clearEditor(true));
  els.editorActions.delete.addEventListener('click', deleteCurrent);

  // local
  els.local.save.addEventListener('click', saveLocal);
  els.local.load.addEventListener('click', loadLocal);
  els.local.clear.addEventListener('click', clearLocal);

  // tools
  els.tools.refresh.addEventListener('click', refreshTools);
  els.tools.filter.addEventListener('input', renderTools);

  // module
  els.moduleBtn.addEventListener('click', openModal);
  els.modalCancel.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
  els.modalCreate.addEventListener('click', createModuleFromSelections);
}

async function boot() {
  bind();
  showTab('idea');
  clearEditor(true);
  // initial load
  await Promise.all([
    loadState('idea', true),
    loadState('draft', true),
    loadState('final', true),
    refreshTools(),
  ]);
  renderCourseList('idea');
  updateModuleBar_();
  toast('已就緒');
}

boot();
