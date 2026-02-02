// Step 2-2: Tool Library Integration (inline, no overlay)
const TOOL_API = "https://script.google.com/macros/s/AKfycbwecHTILAMuk5Izr_yF9wfce_qNjxuy28XuvpDzK0LZ4Wszmw7zI3xve8jeLghzveWbXA/exec";
const LS_KEY = "angel_course_workbench_step2_2";
const STATE_MAP = { idea:"發想", draft:"草稿", final:"完稿" };

const model = JSON.parse(localStorage.getItem(LS_KEY) || JSON.stringify({
  state:"idea", title:"", audience:"", tags:"", framework_text:"",
  main_tool_name:"", main_tool_link:"", tool_list_with_links:"",
  created_at:"", updated_at:""
}));

const el = (id)=>document.getElementById(id);
function now(){return new Date().toISOString()}
function save(){ model.updated_at=now(); localStorage.setItem(LS_KEY, JSON.stringify(model)); el("saveHint").textContent="已存 ✓"; setTimeout(()=>el("saveHint").textContent="",1200); }
function setState(s){ model.state=s; render(); save(); }

let toolsCache=[];
async function loadTools(){
  try{
    const r = await fetch(TOOL_API);
    const j = await r.json();
    toolsCache = j.data || j || [];
    render();
  }catch(e){ console.warn("tool api failed", e); }
}

function toolChip(t, isMain=false){
  const id = `tool_${t.toolCode || t.id}`;
  const checked = isMain ? (model.main_tool_name===t.name) : (model.tool_list_with_links||"").includes(t.link||"");
  return `<label class="tool">
    <input type="${isMain?'radio':'checkbox'}" name="${isMain?'main':'sub'}" ${checked?'checked':''}
      data-name="${t.name||''}" data-link="${t.link||''}"/>
    ${t.name||''}
  </label>`;
}

function renderTools(){
  const list = toolsCache.map(t=>toolChip(t,false)).join("");
  const main = toolsCache.map(t=>toolChip(t,true)).join("");
  return `
    <div class="tools">
      <div><b>主工具（單選）</b></div>
      <div class="row" id="mainTools">${main}</div>
      <hr/>
      <div><b>副工具（多選）</b></div>
      <div class="row" id="subTools">${list}</div>
    </div>
  `;
}

function bindTools(){
  document.querySelectorAll('#mainTools input').forEach(i=>{
    i.addEventListener('change',()=>{
      model.main_tool_name=i.dataset.name;
      model.main_tool_link=i.dataset.link;
      save();
    });
  });
  document.querySelectorAll('#subTools input').forEach(i=>{
    i.addEventListener('change',()=>{
      const arr = [];
      document.querySelectorAll('#subTools input:checked').forEach(x=>arr.push(`${x.dataset.name}｜${x.dataset.link}`));
      model.tool_list_with_links = arr.join("\n");
      save();
    });
  });
}

function stepCard(title, body){
  const s=document.createElement('section');
  s.className='step open';
  s.innerHTML=`<div class="step-hd"><b>${title}</b></div><div class="step-bd">${body}</div>`;
  return s;
}

function render(){
  el("stateLabel").textContent=STATE_MAP[model.state];
  el("stateLabelBottom").textContent=STATE_MAP[model.state];
  const area=document.getElementById('stepsArea'); area.innerHTML="";
  area.appendChild(stepCard("I-1 一句話定義",`
    <div class="grid two">
      <div class="field"><label>課名</label><input value="${model.title||''}" oninput="model.title=this.value;save()"/></div>
      <div class="field"><label>對象</label><input value="${model.audience||''}" oninput="model.audience=this.value;save()"/></div>
    </div>
    <div class="field"><label>標籤</label><input value="${model.tags||''}" oninput="model.tags=this.value;save()"/></div>
  `));
  area.appendChild(stepCard("I-3 工具配方（API）", renderTools()));
  bindTools();
}

document.addEventListener('click',(e)=>{
  if(e.target.matches('.pill')) setState(e.target.dataset.state);
});
document.getElementById('btnReloadTools').addEventListener('click', loadTools);

document.getElementById('btnCopyAI').addEventListener('click',()=>{
  navigator.clipboard.writeText("AI 指令（略）"); 
});
document.getElementById('btnCopyTSV').addEventListener('click',()=>{
  navigator.clipboard.writeText("TSV（略）");
});
document.getElementById('btnSaveLocal').addEventListener('click',save);
document.getElementById('btnExportJson').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(model,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='course.json'; a.click();
});

render();
loadTools();
