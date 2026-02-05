const btn = document.getElementById('btnAI');
btn.onclick = () => {
  const state = document.getElementById('state').value;
  const title = document.getElementById('courseTitle').value;
  const core = document.getElementById('core').value;

  let prompt = '';
  if(state==='idea'){
    prompt = `請協助我把以下課程發想擴寫成完整結構：\n課程：${title}\n核心：${core}`;
  }else if(state==='draft'){
    prompt = `請協助我把以下課程草稿補齊教學流程與活動：\n課程：${title}\n核心：${core}`;
  }else{
    prompt = `請把以下完稿課程轉為提案與簡報大綱：\n課程：${title}\n核心：${core}`;
  }

  document.getElementById('aiOut').value = prompt;
  navigator.clipboard.writeText(prompt);
  alert('AI 指令已複製');
};
