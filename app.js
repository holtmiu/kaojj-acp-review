const STORAGE_KEY = "kaojj-acp-static-v1";
const DEFAULT_LIMIT = 3;

const state = {
  questions: [],
  stats: {},
  sourceName: "",
  correctLimit: DEFAULT_LIMIT,
  currentQuestion: null,
  lastQuestionId: null,
  selected: [],
  submitted: false,
};

const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.questions)) return;
    state.questions = saved.questions;
    state.stats = saved.stats && typeof saved.stats === "object" ? saved.stats : {};
    state.sourceName = String(saved.sourceName || "");
    state.correctLimit = validLimit(saved.correctLimit);
  } catch (error) {
    showToast("本地进度读取失败，将从空题库开始");
  }
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      questions: state.questions,
      stats: state.stats,
      sourceName: state.sourceName,
      correctLimit: state.correctLimit,
    }),
  );
}

function validLimit(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, 99) : DEFAULT_LIMIT;
}

function getStat(questionId) {
  if (!state.stats[questionId] || typeof state.stats[questionId] !== "object") {
    state.stats[questionId] = { attempts: 0, correct: 0, lastAnsweredAt: null };
  }
  const stat = state.stats[questionId];
  stat.attempts = Number(stat.attempts) || 0;
  stat.correct = Number(stat.correct) || 0;
  return stat;
}

function isMastered(question) {
  return getStat(question.id).correct > state.correctLimit;
}

function getSummary() {
  return state.questions.reduce(
    (summary, question) => {
      const stat = getStat(question.id);
      summary.attempts += stat.attempts;
      summary.correct += stat.correct;
      if (stat.correct > state.correctLimit) summary.mastered += 1;
      return summary;
    },
    { attempts: 0, correct: 0, mastered: 0 },
  );
}

function chooseNextQuestion() {
  const available = state.questions.filter((question) => !isMastered(question));
  if (!available.length) {
    state.currentQuestion = null;
    state.selected = [];
    state.submitted = false;
    return;
  }
  const withoutLast = available.filter((question) => question.id !== state.lastQuestionId);
  const pool = withoutLast.length ? withoutLast : available;
  state.currentQuestion = pool[Math.floor(Math.random() * pool.length)];
  state.lastQuestionId = state.currentQuestion.id;
  state.selected = [];
  state.submitted = false;
}

function render() {
  const hasQuestions = state.questions.length > 0;
  $("empty-state").hidden = hasQuestions;
  $("dashboard").hidden = !hasQuestions;
  if (!hasQuestions) return;

  const summary = getSummary();
  $("source-label").textContent = `题库：${state.sourceName || "本地题库"} · 答对超过 ${state.correctLimit} 次后移出`;
  $("remaining-count").textContent = String(state.questions.length - summary.mastered);
  $("mastered-count").textContent = String(summary.mastered);
  $("attempt-count").textContent = String(summary.attempts);
  $("accuracy-count").textContent = `${summary.attempts ? Math.round((summary.correct / summary.attempts) * 100) : 0}%`;
  $("limit-input").value = String(state.correctLimit);

  if (!state.currentQuestion || (isMastered(state.currentQuestion) && !state.submitted)) chooseNextQuestion();
  if (state.currentQuestion) renderQuestion();
  else renderComplete(summary);
}

function renderQuestion() {
  const question = state.currentQuestion;
  const multi = question.correctAnswers.length > 1;
  $("question-state").hidden = false;
  $("complete-state").hidden = true;
  $("question-number").textContent = `第 ${question.index + 1} 题`;
  $("question-type").textContent = multi ? "多选题" : "单选题";

  const stem = $("question-stem");
  stem.replaceChildren();
  question.stem.split(/\n/).forEach((line, index) => {
    if (index) stem.appendChild(document.createElement("br"));
    stem.appendChild(document.createTextNode(line));
  });

  const form = $("options-form");
  form.replaceChildren();
  question.options.forEach((option) => {
    const label = document.createElement("label");
    label.className = "option";
    const input = document.createElement("input");
    input.type = multi ? "checkbox" : "radio";
    input.name = `question-${question.id}`;
    input.value = option.label;
    input.checked = state.selected.includes(option.label);
    input.disabled = state.submitted;
    input.addEventListener("change", () => {
      if (multi) {
        if (input.checked) state.selected = [...state.selected, option.label];
        else state.selected = state.selected.filter((value) => value !== option.label);
      } else {
        state.selected = [option.label];
      }
      updateSubmitState();
    });
    label.append(input, document.createTextNode(`${option.label}. ${option.text}`));
    if (state.submitted) {
      if (question.correctAnswers.includes(option.label)) label.classList.add("is-correct");
      else if (state.selected.includes(option.label)) label.classList.add("is-wrong");
    }
    form.appendChild(label);
  });

  const feedback = $("feedback");
  feedback.hidden = !state.submitted;
  feedback.replaceChildren();
  feedback.className = "feedback";
  if (state.submitted) {
    const correct = sameAnswers(state.selected, question.correctAnswers);
    feedback.classList.add(correct ? "correct" : "wrong");
    const title = document.createElement("strong");
    title.textContent = correct ? "回答正确" : `正确答案：${question.correctAnswers.join("、")}`;
    feedback.appendChild(title);
    if (!correct) {
      const note = document.createElement("span");
      note.textContent = "记住这个薄弱点，下一轮还会再遇到。";
      feedback.appendChild(note);
    }
    if (question.explanation) {
      const explanation = document.createElement("span");
      explanation.className = "explanation";
      explanation.textContent = `解析：${question.explanation}`;
      feedback.appendChild(explanation);
    }
  }
  $("submit-button").textContent = state.submitted ? "下一题" : "提交答案";
  updateSubmitState();
}

function renderComplete(summary) {
  $("question-state").hidden = true;
  $("complete-state").hidden = false;
  $("complete-copy").textContent = `共 ${summary.total || state.questions.length} 道题，${summary.mastered} 道已经答对超过 ${state.correctLimit} 次。`;
}

function updateSubmitState() {
  $("submit-button").disabled = !state.submitted && state.selected.length === 0;
}

function sameAnswers(selected, expected) {
  if (selected.length !== expected.length) return false;
  const selectedSet = new Set(selected);
  return expected.every((label) => selectedSet.has(label));
}

function submitAnswer() {
  if (!state.currentQuestion) return;
  if (state.submitted) {
    chooseNextQuestion();
    render();
    return;
  }
  const stat = getStat(state.currentQuestion.id);
  stat.attempts += 1;
  if (sameAnswers(state.selected, state.currentQuestion.correctAnswers)) stat.correct += 1;
  stat.lastAnsweredAt = new Date().toISOString();
  state.submitted = true;
  persist();
  render();
}

async function importMarkdown(file) {
  if (!file) return;
  try {
    const questions = KaojjParser.parseQuestionNote(await file.text());
    if (!questions.length) throw new Error("没有解析到题目。请确认题目包含至少两个选项和答案标记。");
    state.questions = questions;
    state.sourceName = file.name;
    state.currentQuestion = null;
    state.lastQuestionId = null;
    state.stats = {};
    persist();
    chooseNextQuestion();
    render();
    showToast(`已导入 ${questions.length} 道题`);
  } catch (error) {
    showToast(error.message || "题库导入失败");
  }
}

async function loadBundledQuestionBank() {
  if (state.questions.length) return;
  try {
    const response = await fetch("questions.md", { cache: "no-store" });
    if (!response.ok) return;
    const questions = KaojjParser.parseQuestionNote(await response.text());
    if (!questions.length) return;
    if (state.questions.length) return;
    state.questions = questions;
    state.sourceName = "questions.md";
    chooseNextQuestion();
    persist();
    render();
    showToast(`已自动加载 ${questions.length} 道题`);
  } catch (error) {
    // A bundled file is optional; the upload flow remains available.
  }
}

function exportBackup() {
  const payload = {
    app: "kaojj-acp-static",
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceName: state.sourceName,
    correctLimit: state.correctLimit,
    questions: state.questions,
    stats: state.stats,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kaojj-acp-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("备份已导出");
}

async function importBackup(file) {
  if (!file) return;
  try {
    const saved = JSON.parse(await file.text());
    if (!Array.isArray(saved.questions) || !saved.questions.length) throw new Error("备份中没有题库数据");
    if (!saved.questions.every((question) => question.id && question.stem && Array.isArray(question.options))) {
      throw new Error("备份格式不完整");
    }
    state.questions = saved.questions;
    state.stats = saved.stats && typeof saved.stats === "object" ? saved.stats : {};
    state.sourceName = String(saved.sourceName || "备份题库");
    state.correctLimit = validLimit(saved.correctLimit);
    state.currentQuestion = null;
    chooseNextQuestion();
    persist();
    render();
    showToast(`已恢复 ${state.questions.length} 道题和答题统计`);
  } catch (error) {
    showToast(error.message || "备份导入失败");
  }
}

function resetStats() {
  if (!window.confirm("确定清除全部答题统计吗？题库本身不会被删除。")) return;
  state.stats = {};
  state.currentQuestion = null;
  chooseNextQuestion();
  persist();
  render();
  showToast("答题统计已重置");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function setupFileInputs() {
  $("markdown-input").addEventListener("change", (event) => {
    void importMarkdown(event.target.files[0]);
    event.target.value = "";
  });
  $("backup-import-button").addEventListener("click", () => $("backup-input").click());
  $("backup-input").addEventListener("change", (event) => {
    void importBackup(event.target.files[0]);
    event.target.value = "";
  });
  const dropzone = $("dropzone");
  ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  }));
  dropzone.addEventListener("drop", (event) => {
    void importMarkdown(event.dataTransfer.files[0]);
  });
}

function setupInstallPrompt() {
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    $("install-button").hidden = false;
  });
  $("install-button").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("install-button").hidden = true;
  });
}

function setupServiceWorker() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

$("submit-button").addEventListener("click", submitAnswer);
$("skip-button").addEventListener("click", () => {
  chooseNextQuestion();
  render();
});
$("export-button").addEventListener("click", exportBackup);
$("reset-button").addEventListener("click", resetStats);
$("limit-input").addEventListener("change", (event) => {
  state.correctLimit = validLimit(event.target.value);
  event.target.value = String(state.correctLimit);
  persist();
  render();
});

loadState();
setupFileInputs();
setupInstallPrompt();
setupServiceWorker();
render();
void loadBundledQuestionBank();
