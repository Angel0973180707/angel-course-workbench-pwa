(()=>{'use strict';
const TOOLS_API_URL="https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec?sheet=%E5%B7%A5%E5%85%B7%E5%BA%AB%E5%AD%98%E7%AE%A1%E7%90%86&format=tools";
const COURSE_API_BASE="https://script.google.com/macros/s/AKfycbwUl82fzFmReE8PyOB9G6FJDT-B1MOCZufcLDJ6mvUXIfuFN2YsHpPLS5ZNi93LeHR0SA/exec";
const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const st={tools:[],cats:[],courses:[],singles:[],picks:new Set(),currentItem:null};
const toastEl=$("#toast");
const toast=m=>{toastEl.textContent=m;toastEl.classList.add("on");clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.classList.remove("on"),1600)};
const safe=v=>v==null?"":String(v);const norm=s=>safe(s).trim();
const setL=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
const getL=(k,f)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch(e){return f}};
const esc=safeStr=>safe(safeStr).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
async function jget(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json();}
function courseUrl(p){const u=new URL(COURSE_API_BASE);Object.entries(p).forEach(([k,v])=>{if(v!==""&&v!=null)u.searchParams.set(k,String(v))});return u.toString();}
function isSingle(x){
  const sch=norm(x.schedule_mode).toLowerCase();
  const type=norm(x.type).toLowerCase();
  if(sch==="single") return true;
  if(type.includes("single")||type.includes("talk")||type.includes("event")||type.includes("class")) return true;
  const hasDur=norm(x.duration_min)||norm(x.single_duration);
  const hasModules=norm(x.module_sessions);
  return !!hasDur && !hasModules;
}
function renderTools(){
  const q=norm($("#tools-q").value).toLowerCase();
  const cat=$("#tools-cat").value;
  let items=st.tools.slice();
  if(cat) items=items.filter(x=>norm(x.category||x.tool_category||x["性質分類"])===cat);
  if(q) items=items.filter(x=>`${safe(x.toolCode)} ${safe(x.toolName)} ${safe(x.core)} ${safe(x.tags)}`.toLowerCase().includes(q));
  const box=$("#tools-list"); box.innerHTML=items.length?"":'<div class="hint">目前沒有資料（或被篩選掉了）。</div>';
  items.forEach(x=>{
    const id=norm(x.toolCode||x.id), name=norm(x.toolName||x.title||"未命名工具");
    const core=norm(x.core||x["核心功能"]||"");
    const tags=norm(x.tags||""); const link=norm(x.link||x.toolLink||x["工具連結"]||"");
    const catT=norm(x.category||x.tool_category||x["性質分類"]||"");
    box.insertAdjacentHTML("beforeend",`
      <div class="item">
        <div class="t">${esc(name)}</div>
        <div class="meta">${id?("ID："+esc(id)):""}</div>
        ${core?`<div class="meta"><b>核心</b>：${esc(core)}</div>`:""}
        <div class="badges">
          ${catT?`<span class="badge">${esc(catT)}</span>`:""}
          ${tags?`<span class="badge">${esc(tags)}</span>`:""}
          ${link?`<a class="badge dark" href="${esc(link)}" target="_blank" rel="noopener">開啟</a>`:""}
        </div>
      </div>`);
  });
}
function renderCats(){
  const sel=$("#tools-cat");
  sel.innerHTML='<option value="">全部分類</option>'+st.cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
}
function renderCourses(){
  const q=norm($("#course-q").value).toLowerCase();
  const status=$("#course-status").value;
  let items=st.courses.slice();
  if(q) items=items.filter(x=>`${safe(x.id)} ${safe(x.title)} ${safe(x.tags)} ${safe(x.summary)}`.toLowerCase().includes(q));
  if(status) items=items.filter(x=>norm(x.status).toLowerCase()===status.toLowerCase());
  const box=$("#courses-list"); box.innerHTML=items.length?"":'<div class="hint">目前沒有資料（或被篩選掉了）。</div>';
  items.forEach(x=>{
    const id=norm(x.id), title=norm(x.title||"未命名");
    const type=norm(x.type), stt=norm(x.status);
    const tags=norm(x.tags||""); const sum=norm(x.summary||"");
    box.insertAdjacentHTML("beforeend",`
      <div class="item">
        <div class="t">${esc(title)}</div>
        <div class="meta">${esc(id)} ${type?("｜"+esc(type)):""} ${stt?("｜"+esc(stt)):""}</div>
        ${tags?`<div class="meta"><b>tags</b>：${esc(tags)}</div>`:""}
        ${sum?`<div class="meta"><b>摘要</b>：${esc(sum)}</div>`:""}
        <div class="badges">
          <button class="btn ghost copy" data-copytext="${esc(id)}">複製 ID</button>
          <button class="btn ghost" data-act="view" data-id="${esc(id)}">查看 JSON</button>
          <button class="btn ghost" data-act="script" data-id="${esc(id)}">文稿</button>
        </div>
      </div>`);
  });
}
function renderBuilder(){
  const q=norm($("#builder-q").value).toLowerCase();
  let items=st.singles.slice();
  if(q) items=items.filter(x=>`${safe(x.id)} ${safe(x.title)} ${safe(x.tags)} ${safe(x.summary)}`.toLowerCase().includes(q));
  const box=$("#builder-list"); box.innerHTML=items.length?"":'<div class="hint">找不到符合的「單場完稿」。</div>';
  items.forEach(x=>{
    const id=norm(x.id), title=norm(x.title||"未命名"), tags=norm(x.tags||"");
    const checked=st.picks.has(id)?"checked":"";
    box.insertAdjacentHTML("beforeend",`
      <div class="item">
        <label class="pick">
          <input type="checkbox" data-pick="${esc(id)}" ${checked}/>
          <div>
            <div class="t">${esc(title)}</div>
            <div class="meta">${esc(id)}</div>
            ${tags?`<div class="meta"><b>tags</b>：${esc(tags)}</div>`:""}
          </div>
        </label>
      </div>`);
  });
  $$("[data-pick]").forEach(cb=>cb.addEventListener("change",()=>{
    const id=cb.dataset.pick;
    cb.checked?st.picks.add(id):st.picks.delete(id);
    setL("angel_picks",Array.from(st.picks));
  }));
}
async function loadTools(){
  try{
    const data=await jget(TOOLS_API_URL);
    const list=Array.isArray(data)?data:(data.items||data.data||data.tools||[]);
    st.tools=list||[]; setL("cache_tools",st.tools);
    const cats=new Set(); st.tools.forEach(x=>{const c=norm(x.category||x.tool_category||x["性質分類"]); if(c)cats.add(c);});
    st.cats=Array.from(cats).sort((a,b)=>a.localeCompare(b,'zh-Hant')); setL("cache_cats",st.cats);
    renderCats(); renderTools();
  }catch(e){
    st.tools=getL("cache_tools",[]); st.cats=getL("cache_cats",[]); renderCats(); renderTools();
    toast("工具庫存：改用上次快取（可能是網路或權限）");
  }
}
async function loadCourses(state){
  try{
    const data=await jget(courseUrl({mode:"list",state,limit:300}));
    st.courses=data.items||[]; setL("cache_courses_"+state,st.courses);
    renderCourses();
    if(state==="final"){ st.singles=st.courses.filter(isSingle); setL("cache_singles",st.singles); renderBuilder(); }
  }catch(e){
    st.courses=getL("cache_courses_"+state,[]); renderCourses();
    if(state==="final"){ st.singles=getL("cache_singles",[]).filter(isSingle); renderBuilder(); }
    toast("課程管理：改用上次快取（可能是網路或權限）");
  }
}
async function buildModule(){
  const title=norm($("#module-title").value);
  if(!title){toast("先填模組名稱");$("#module-title").focus();return;}
  const target=$("#module-target").value;
  const picks=Array.from(st.picks);
  if(!picks.length){toast("先勾選至少 1 個單場完稿");return;}
  const picked=st.singles.filter(x=>picks.includes(norm(x.id)));
  const outline=picked.map((x,i)=>`${String(i+1).padStart(2,'0')}｜${norm(x.title)}（${norm(x.id)}）`).join("\n");
  const payload={
    title,type:"course",status:target==="final"?"ready":"draft",
    schedule_mode:"module",module_sessions:picked.length,
    session_minutes:norm($("#module-session-min").value),
    tags:norm($("#module-tags").value),
    summary:`由 ${picked.length} 個單場完稿組合的模組課程（活動）。`,
    outline,notes:`sources:\n${outline}`
  };
  $("#builder-result").textContent="建立中…";
  try{
    const url=courseUrl({mode:"upsert",state:target});
    const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error("POST HTTP "+r.status);
    const out=await r.json();
    $("#builder-result").textContent=`✅ 建立成功\nstate=${out.state||target}\nid=${out.id||(out.item&&out.item.id)||""}`;
    toast("模組課程已建立");
    st.picks.clear(); setL("angel_picks",[]);
    $("#course-state").value=target;
    await loadCourses(target);
    if(target!=="final") await loadCourses("final");
    renderBuilder();
  }catch(e){
    $("#builder-result").textContent=`⚠️ 建立失敗（可能是 CORS 或權限）\n\n若 ping/list 都 OK 但 POST 不行，跟我說，我幫你改成 GET 版 upsert。\n\n錯誤：${e.message||e}`;
    toast("建立失敗");
  }
}

async function loadScriptDoc(state,id,goTab){
  try{
    const data=await jget(courseUrl({mode:"get",state,id}));
    const item=data.item||{};
    st.currentItem=item;
    fillScriptForm_(state,item);
    $("#script-out").textContent="✅ 已載入（可編輯後存回後臺）";
    if(goTab) showTab("scripts");
  }catch(e){
    $("#script-out").textContent=`⚠️ 載入失敗：${e.message||e}`;
    toast("文稿載入失敗");
  }
}

function fillScriptForm_(state,item){
  $("#script-state").value=state;
  $("#script-id").value=norm(item.id);
  $("#script-title").value=norm(item.title);
  $("#script-version").value=norm(item.version);
  $("#script-ppt").value=cleanTextForCopy(item.ppt_outline||"");
  $("#script-page").value=cleanTextForCopy(item.page_script||"");
  $("#script-voice").value=cleanTextForCopy(item.voiceover_script||"");
  $("#script-host").value=cleanTextForCopy(item.host_script||"");
  // materials/homework：優先用 materials，沒有就用 notes/outline 裡的作業區
  $("#script-homework").value=cleanTextForCopy(item.materials||item.homework||"");
}

function collectScriptForm_(){
  const state=$("#script-state").value;
  const id=norm($("#script-id").value);
  const item={
    id,
    title:norm($("#script-title").value),
    version:norm($("#script-version").value),
    ppt_outline: cleanTextForCopy($("#script-ppt").value),
    page_script: cleanTextForCopy($("#script-page").value),
    voiceover_script: cleanTextForCopy($("#script-voice").value),
    host_script: cleanTextForCopy($("#script-host").value),
    materials: cleanTextForCopy($("#script-homework").value),
  };
  return {state,item};
}

async function saveScriptDoc(){
  const {state,item}=collectScriptForm_();
  if(!item.id){toast("請先有課程 ID（可從清單點「文稿」自動帶入）");return;}
  try{
    const url=courseUrl({mode:"upsert",state});
    const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(item)});
    if(!r.ok) throw new Error("POST HTTP "+r.status);
    const out=await r.json();
    $("#script-out").textContent=`✅ 已存回後臺\nstate=${out.state||state}\nid=${out.id||(out.item&&out.item.id)||item.id}`;
    toast("文稿已存回後臺");
  }catch(e){
    $("#script-out").textContent=`⚠️ 存回失敗（可能是權限/CORS）\n\n錯誤：${e.message||e}`;
    toast("文稿存回失敗");
  }
}

function saveScriptLocal(){
  const {state,item}=collectScriptForm_();
  if(!item.id){toast("請先填課程 ID");return;}
  setL("script_draft_"+state+"_"+item.id,item);
  $("#script-out").textContent="✅ 已存本機草稿（localStorage）";
  toast("已存本機草稿");
}

async function loadScriptByForm(){
  const state=$("#script-state").value;
  const id=norm($("#script-id").value);
  if(!id){toast("請填 ID");return;}
  // 先試本機草稿
  const local=getL("script_draft_"+state+"_"+id,null);
  if(local){
    fillScriptForm_(state,local);
    $("#script-out").textContent="✅ 已載入本機草稿（若要對後臺同步，請按「載入」或「存回後臺」）";
    if(confirm("要同時從後臺再載一次比對嗎？取消=先用本機草稿")){ await loadScriptDoc(state,id,false); }
    return;
  }
  await loadScriptDoc(state,id,false);
}

async function copy(text){
  try{await navigator.clipboard.writeText(text);toast("已複製");}
  catch(e){toast("複製失敗");}
}
function bind(){
  $$(".tabbtn").forEach(b=>b.addEventListener("click",()=>{
    $$(".tabbtn").forEach(x=>x.classList.remove("on")); b.classList.add("on");
    $$(".tab").forEach(x=>x.classList.remove("on")); $("#"+b.dataset.tab).classList.add("on");
  }));
  $("#btn-refresh").addEventListener("click",initLoad);
  $("#tools-q").addEventListener("input",renderTools);
  $("#tools-cat").addEventListener("change",renderTools);
  $("#course-state").addEventListener("change",()=>loadCourses($("#course-state").value));
  $("#course-q").addEventListener("input",renderCourses);
  $("#course-status").addEventListener("change",renderCourses);
  $("#builder-q").addEventListener("input",renderBuilder);
  $("#btn-clear-picks").addEventListener("click",()=>{st.picks.clear();setL("angel_picks",[]);renderBuilder();toast("已清空勾選")});
  $("#btn-build-module").addEventListener("click",buildModule);
  document.addEventListener("click",async e=>{
    const c=e.target.closest(".copy");
    if(c){
      const sel=c.getAttribute("data-copy");
      let t=c.getAttribute("data-copytext")||(sel?(()=>{const el=document.querySelector(sel); if(!el) return ""; return ("value" in el)?el.value:el.textContent;})():"");
      t = cleanTextForCopy(t);
      if(t) await copy(t);
    }
    const v=e.target.closest("[data-act='view']");
    if(v){
      const id=v.dataset.id; const state=$("#course-state").value;
      try{const data=await jget(courseUrl({mode:"get",state,id})); $("#api-out").textContent=JSON.stringify(data,null,2);
        document.querySelector(".tabbtn[data-tab='api']").click();
      }catch(err){toast("讀取失敗")}
    }

    const s=e.target.closest("[data-act='script']");
    if(s){
      const id=s.dataset.id; const state=$("#course-state").value;
      await loadScriptDoc(state,id,true);
    }
  });
  $("#btn-ping").addEventListener("click",async()=>{try{$("#api-out").textContent=JSON.stringify(await jget(courseUrl({mode:"ping"})),null,2);toast("ping OK")}catch(e){toast("ping 失敗")}});
  $("#btn-sample-list").addEventListener("click",async()=>{try{$("#api-out").textContent=JSON.stringify(await jget(courseUrl({mode:"list",state:"final",limit:20})),null,2);toast("list OK")}catch(e){toast("list 失敗")}});
  // 文稿存取
  $("#btn-script-load").addEventListener("click",loadScriptByForm);
  $("#btn-script-save").addEventListener("click",saveScriptDoc);
  $("#btn-script-local").addEventListener("click",saveScriptLocal);


  // 文稿存取
  $("#btn-script-load").addEventListener("click",loadScriptByForm);
  $("#btn-script-save").addEventListener("click",saveScriptDoc);
  $("#btn-script-local").addEventListener("click",saveScriptLocal);
}

let deferredPrompt=null;
function pwa(){
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
  window.addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();deferredPrompt=e;const b=$("#btn-install");b.hidden=false;b.onclick=async()=>{b.hidden=true;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;}});
}
async function initLoad(){
  $("#tools-api").textContent=TOOLS_API_URL;
  $("#course-api").textContent=COURSE_API_BASE;
  await loadTools();
  await loadCourses($("#course-state").value);
}
document.addEventListener("DOMContentLoaded",()=>{
  st.tools=getL("cache_tools",[]); st.cats=getL("cache_cats",[]); renderCats(); renderTools();
  st.picks=new Set(getL("angel_picks",[]));
  st.singles=getL("cache_singles",[]).filter(isSingle); renderBuilder();
  bind(); pwa(); initLoad();
});
})();