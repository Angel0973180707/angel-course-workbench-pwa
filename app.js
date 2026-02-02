/* Angel｜Course Workbench v2 (no-mask, scroll-safe)
   - Wizard for Idea/Draft/Final (4 steps each)
   - One-click copy: AI prompt + TSV row
   - localStorage save + JSON export
*/

const LS_KEY = "angel_course_workbench_v2";

const STATE_MAP = {
  idea: "發想",
  draft: "草稿",
  final: "完稿",
};

const DEFAULT_DATA = () => ({
  state: "idea",
  // Common fields
  id: "",
  title: "",
  type: "",
  status: "ready",
  version: "v1",
  owner: "",
  audience: "",
  duration_min: "120",
  capacity: "20",
  tags: "",
  closing_line: "",
  framework_text: "",
  episodes: "8",

  // Tool (placeholders; next step will connect tool library)
  main_tool_name: "",
  main_tool_link: "",
  tool_list_with_links: "",

  // Draft/Final content
  summary: "",
  objectives: "",
  outline: "",
  materials: "",
  links: "",
  assets: "",
  notes: "",

  // Draft extras
  rhythm: "",
  feedback: "",

  created_at: "",
  updated_at: "",
});

let model = loadLocal() || DEFAULT_DATA();

const el = (id) => document.getElementById(id);

function nowISO() {
  return new Date().toISOString();
}

function ensureId() {
  if (!model.id) model.id = "C-" + Date.now();
}

function setState(next) {
  model.state = next;
  renderAll();
}

function setDot(dotEl, status) {
  dotEl.classList.remove("ok", "doing", "todo");
  dotEl.classList.add(status);
}

function computeProgress() {
  // Very conservative: if title exists => idea doing; if outline exists => draft doing; if summary+outline exist => final doing
  const ideaDone = !!model.title && !!model.audience && !!model.tags;
  const draftDone = !!model.objectives && !!model.outline;
  const finalDone = !!model.summary && !!model.outline && !!model.materials;

  return { ideaDone, draftDone, finalDone };
}

function renderProgress() {
  const { ideaDone, draftDone, finalDone } = computeProgress();

  // Dots: ok / doing / todo
  // current state gets doing unless already done
  const s = model.state;

  setDot(el("dotIdea"), ideaDone ? "ok" : (s === "idea" ? "doing" : "todo"));
  setDot(el("dotDraft"), draftDone ? "ok" : (s === "draft" ? "doing" : "todo"));
  setDot(el("dotFinal"), finalDone ? "ok" : (s === "final" ? "doing" : "todo"));

  el("stateLabel").textContent = STATE_MAP[s];
  el("stateLabelBottom").textContent = STATE_MAP[s];
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelector('.tab[data-tab="workbench"]').classList.add("active");

  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));