const STORAGE_KEY = "kaojj-acp-static-v1";
const DEFAULT_LIMIT = 3;
const BATCH_SIZE = 20;
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];
const WRONG_RETRY_MINUTES = 10;
const BUNDLED_QUESTIONS = Array.isArray(globalThis.KAOJJ_QUESTIONS) ? globalThis.KAOJJ_QUESTIONS : [];

const state = {
  questions: BUNDLED_QUESTIONS,
  stats: {},
  correctLimit: DEFAULT_LIMIT,
  currentQuestion: null,
  selected: [],
  submitted: false,
  lastOutcome: null,
  sessionQueue: [],
  sessionIndex: 0,
  sessionMode: "today",
  sessionName: "今日重点",
};

const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    state.stats = saved.stats && typeof saved.stats === "object" ? saved.stats : {};
    state.correctLimit = validLimit(saved.correctLimit);
  } catch (error) {
    showToast("本地进度读取失败，将从默认计划开始");
  }
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 3,
      stats: state.stats,
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
    state.stats[questionId] = {};
  }
  const stat = state.stats[questionId];
  stat.attempts = Number(stat.attempts) || 0;
  stat.correct = Number(stat.correct) || 0;
  stat.streak = Number(stat.streak) || 0;
  stat.stage = Math.max(0, Number(stat.stage) || 0);
  stat.lastAnsweredAt = stat.lastAnsweredAt || null;
  stat.dueAt = stat.dueAt || null;
  return stat;
}

function getDomains(question) {
  return Array.isArray(question.domains) && question.domains.length ? question.domains : ["未分类"];
}

function isMastered(question) {
  return getStat(question.id).correct > state.correctLimit;
}

function isDue(question, now = Date.now()) {
  const stat = getStat(question.id);
  if (!stat.attempts) return false;
  if (!stat.dueAt) return true;
  const due = Date.parse(stat.dueAt);
  return !Number.isFinite(due) || due <= now;
}

function questionAccuracy(question) {
  const stat = getStat(question.id);
  return stat.attempts ? stat.correct / stat.attempts : null;
}

function priorityWeight(priority) {
  if (priority === "P0") return 1;
  if (priority === "P1") return 0.62;
  return 0.35;
}

function getSummary() {
  return state.questions.reduce(
    (summary, question) => {
      const stat = getStat(question.id);
      summary.attempts += stat.attempts;
      summary.correct += stat.correct;
      if (stat.correct > state.correctLimit) summary.mastered += 1;
      else if (!stat.attempts) summary.newCount += 1;
      if (!isMastered(question) && isDue(question)) summary.due += 1;
      if (stat.attempts && stat.correct / stat.attempts < 0.7) summary.weak += 1;
      return summary;
    },
    { attempts: 0, correct: 0, mastered: 0, due: 0, weak: 0, newCount: 0 },
  );
}

function buildDomainSummaries() {
  const domains = new Map();
  state.questions.forEach((question) => {
    getDomains(question).forEach((name) => {
      if (!domains.has(name)) {
        domains.set(name, {
          name,
          total: 0,
          attempts: 0,
          correct: 0,
          attemptedQuestions: 0,
          due: 0,
          mastered: 0,
          p0: 0,
          newCount: 0,
        });
      }
      const item = domains.get(name);
      const stat = getStat(question.id);
      item.total += 1;
      item.attempts += stat.attempts;
      item.correct += stat.correct;
      if (stat.attempts) item.attemptedQuestions += 1;
      else item.newCount += 1;
      if (isDue(question) && !isMastered(question)) item.due += 1;
      if (isMastered(question)) item.mastered += 1;
      if (question.priority === "P0") item.p0 += 1;
    });
  });

  const values = [...domains.values()];
  const coreCount = Math.max(1, Math.ceil(values.length * 0.2));
  const coreNames = new Set(
    [...values]
      .sort((a, b) => b.total - a.total)
      .slice(0, coreCount)
      .map((item) => item.name),
  );
  const largest = Math.max(...values.map((item) => item.total), 1);

  return values
    .map((item) => {
      const accuracy = item.attempts ? item.correct / item.attempts : null;
      const errorRate = accuracy === null ? 0.55 : 1 - accuracy;
      const dueRate = item.total ? item.due / item.total : 0;
      const p0Rate = item.total ? item.p0 / item.total : 0;
      const coverage = item.total / largest;
      return {
        ...item,
        accuracy,
        isCore: coreNames.has(item.name),
        focusScore: Math.round((errorRate * 0.35 + dueRate * 0.25 + p0Rate * 0.2 + coverage * 0.2) * 100),
      };
    })
    .sort((a, b) => b.focusScore - a.focusScore || b.total - a.total);
}

function scoreQuestion(question, domainLookup) {
  if (isMastered(question)) return -1;
  const stat = getStat(question.id);
  const accuracy = questionAccuracy(question);
  const core = getDomains(question).some((name) => domainLookup.get(name)?.isCore);
  let score = priorityWeight(question.priority) * 25;
  if (isDue(question)) score += 42;
  if (!stat.attempts) score += 18;
  else score += (1 - accuracy) * 34;
  if (core) score += 20;
  score += Math.min(stat.attempts, 5);
  return score;
}

function uniqueQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    if (seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });
}

function buildSessionPool(mode, value = null) {
  const summaries = buildDomainSummaries();
  const domainLookup = new Map(summaries.map((item) => [item.name, item]));
  const active = state.questions.filter((question) => !isMastered(question));
  const ranked = (questions) => [...questions].sort((a, b) => scoreQuestion(b, domainLookup) - scoreQuestion(a, domainLookup));
  const due = ranked(active.filter((question) => isDue(question)));
  const weak = ranked(active.filter((question) => {
    const stat = getStat(question.id);
    return stat.attempts && stat.correct / stat.attempts < 0.7;
  }));
  const newCore = ranked(active.filter((question) => {
    const stat = getStat(question.id);
    return !stat.attempts && getDomains(question).some((name) => domainLookup.get(name)?.isCore);
  }));
  const newQuestions = ranked(active.filter((question) => !getStat(question.id).attempts));

  if (mode === "review") return (due.length ? due : weak).slice(0, BATCH_SIZE);
  if (mode === "priority") return ranked(active).slice(0, BATCH_SIZE);
  if (mode === "all") return ranked(active).slice(0, BATCH_SIZE);
  if (mode === "domain") {
    return ranked(active.filter((question) => getDomains(question).includes(value))).slice(0, BATCH_SIZE);
  }
  return uniqueQuestions([...due, ...weak, ...newCore, ...newQuestions, ...ranked(active)]).slice(0, BATCH_SIZE);
}

function sessionLabel(mode, value) {
  if (mode === "priority") return "二八优先";
  if (mode === "review") return "到期复习";
  if (mode === "all") return "综合练习";
  if (mode === "domain") return value;
  return "今日重点";
}

function startSession(mode, value = null, options = {}) {
  const { announce = true, shouldRender = true } = options;
  const pool = buildSessionPool(mode, value);
  state.sessionMode = mode;
  state.sessionName = sessionLabel(mode, value);
  state.sessionQueue = pool.map((question) => question.id);
  state.sessionIndex = 0;
  state.currentQuestion = pool[0] || null;
  state.selected = [];
  state.submitted = false;
  state.lastOutcome = null;
  if (shouldRender) render();
  if (announce) {
    showToast(pool.length ? `已生成“${state.sessionName}” ${pool.length} 题` : "当前没有符合条件的题目");
  }
}

function advanceSession() {
  state.sessionIndex += 1;
  const nextId = state.sessionQueue[state.sessionIndex];
  state.currentQuestion = state.questions.find((question) => question.id === nextId) || null;
  state.selected = [];
  state.submitted = false;
  state.lastOutcome = null;
}

function render() {
  const hasQuestions = state.questions.length > 0;
  $("empty-state").hidden = hasQuestions;
  $("dashboard").hidden = !hasQuestions;
  if (!hasQuestions) return;

  const summary = getSummary();
  const domains = buildDomainSummaries();
  const coreDomains = domains.filter((item) => item.isCore);
  $("source-label").textContent = `内置 ${state.questions.length} 题 · ${domains.length} 个知识域 · 每批 ${BATCH_SIZE} 题`;
  $("due-count").textContent = String(summary.due);
  $("core-count").textContent = String(coreDomains.length);
  $("mastered-count").textContent = String(summary.mastered);
  $("accuracy-count").textContent = `${summary.attempts ? Math.round((summary.correct / summary.attempts) * 100) : 0}%`;
  $("limit-input").value = String(state.correctLimit);

  renderPlan(summary, domains);
  renderKnowledgeMap(domains);
  renderSessionStatus();
  if (state.currentQuestion) renderQuestion();
  else renderComplete(summary);
}

function renderPlan(summary, domains) {
  const coreNames = new Set(domains.filter((item) => item.isCore).map((item) => item.name));
  const corePending = state.questions.filter(
    (question) => !isMastered(question) && getDomains(question).some((name) => coreNames.has(name)),
  ).length;
  $("plan-due-count").textContent = String(summary.due);
  $("plan-core-count").textContent = String(corePending);
  $("plan-new-count").textContent = String(summary.newCount);
  $("plan-summary").textContent = summary.due
    ? `先完成 ${summary.due} 道到期题，再补强核心知识域。`
    : "今天没有到期积压，从核心 20% 知识域开始建立记忆。";
  const total = state.sessionQueue.length;
  const completed = Math.min(state.sessionIndex, total);
  $("session-progress-copy").textContent = total ? `本批已完成 ${completed}/${total}` : "当前批次为空";
  $("session-progress-bar").style.width = total ? `${Math.round((completed / total) * 100)}%` : "0%";
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderKnowledgeMap(domains) {
  const grid = $("knowledge-grid");
  grid.replaceChildren();
  domains.forEach((item, index) => {
    const card = createElement("article", "knowledge-card");
    const heading = createElement("div", "knowledge-heading");
    const titleWrap = createElement("div");
    titleWrap.append(
      createElement("p", "knowledge-rank", `优先级 ${index + 1}`),
      createElement("h3", "", item.name),
    );
    heading.append(titleWrap, createElement("span", item.isCore ? "core-badge" : "focus-badge", item.isCore ? "核心 20%" : `关注度 ${item.focusScore}`));

    const metrics = createElement("div", "knowledge-metrics");
    metrics.append(
      metric("题目", item.total),
      metric("到期", item.due),
      metric("正确率", item.accuracy === null ? "--" : `${Math.round(item.accuracy * 100)}%`),
    );
    const track = createElement("div", "focus-track");
    const fill = createElement("span", "focus-fill");
    fill.style.width = `${Math.max(8, item.focusScore)}%`;
    track.append(fill);
    const footer = createElement("div", "knowledge-footer");
    const reason = item.due
      ? `${item.due} 道已到期`
      : item.attemptedQuestions
        ? `已练 ${item.attemptedQuestions}/${item.total} 题`
        : `${item.p0} 道 P0 重点`;
    const button = createElement("button", "text-button", "开始该类");
    button.type = "button";
    button.dataset.domain = item.name;
    footer.append(createElement("span", "", reason), button);
    card.append(heading, metrics, track, footer);
    grid.append(card);
  });
}

function metric(label, value) {
  const wrapper = createElement("div", "knowledge-metric");
  wrapper.append(createElement("strong", "", String(value)), createElement("span", "", label));
  return wrapper;
}

function renderSessionStatus() {
  $("session-name").textContent = state.sessionName;
  $("session-count").textContent = `${state.sessionQueue.length} 题`;
  const position = state.currentQuestion ? state.sessionIndex + 1 : state.sessionQueue.length;
  $("session-position").textContent = state.sessionQueue.length ? `${position}/${state.sessionQueue.length}` : "0/0";
}

function renderQuestion() {
  const question = state.currentQuestion;
  const multi = question.correctAnswers.length > 1;
  $("question-state").hidden = false;
  $("complete-state").hidden = true;
  $("question-number").textContent = `本批 ${state.sessionIndex + 1}/${state.sessionQueue.length} · 题库 #${question.index + 1}`;
  $("question-type").textContent = question.questionType || (multi ? "多选题" : "单选题");
  $("question-domain").textContent = getDomains(question).join(" · ");
  $("question-priority").textContent = question.priority || "P2";

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
  if (state.submitted && state.lastOutcome) {
    feedback.classList.add(state.lastOutcome.correct ? "correct" : "wrong");
    const title = createElement(
      "strong",
      "",
      state.lastOutcome.correct ? "回答正确" : `正确答案：${question.correctAnswers.join("、")}`,
    );
    const review = createElement("span", "review-schedule", state.lastOutcome.reviewText);
    feedback.append(title, review);
    if (question.explanation) {
      feedback.append(createElement("span", "explanation", `解析：${question.explanation}`));
    }
  }
  $("submit-button").textContent = state.submitted ? "下一题" : "提交答案";
  updateSubmitState();
}

function renderComplete(summary) {
  $("question-state").hidden = true;
  $("complete-state").hidden = false;
  const copy = state.sessionQueue.length
    ? `“${state.sessionName}”已完成。系统会按你的答题结果安排下一次复习。`
    : "当前没有到期题目，可以开始二八优先批次继续补强。";
  $("complete-copy").textContent = copy;
  $("complete-summary").textContent = `累计掌握 ${summary.mastered} 题 · 正确率 ${summary.attempts ? Math.round((summary.correct / summary.attempts) * 100) : 0}%`;
}

function updateSubmitState() {
  $("submit-button").disabled = !state.submitted && state.selected.length === 0;
}

function sameAnswers(selected, expected) {
  if (selected.length !== expected.length) return false;
  const selectedSet = new Set(selected);
  return expected.every((label) => selectedSet.has(label));
}

function scheduleReview(stat, wasCorrect) {
  const now = Date.now();
  if (!wasCorrect) {
    stat.streak = 0;
    stat.stage = 0;
    stat.dueAt = new Date(now + WRONG_RETRY_MINUTES * 60 * 1000).toISOString();
    return `答错题将在 ${WRONG_RETRY_MINUTES} 分钟后重新进入复习队列。`;
  }

  stat.streak += 1;
  stat.stage = Math.min(stat.stage + 1, REVIEW_INTERVAL_DAYS.length);
  const interval = REVIEW_INTERVAL_DAYS[Math.max(0, stat.stage - 1)];
  stat.dueAt = new Date(now + interval * 24 * 60 * 60 * 1000).toISOString();
  if (stat.correct > state.correctLimit) {
    stat.dueAt = null;
    return `已连续巩固并答对超过 ${state.correctLimit} 次，这道题已移出日常队列。`;
  }
  return `记忆间隔已拉长，下次将在 ${interval} 天后复习。`;
}

function submitAnswer() {
  if (!state.currentQuestion) return;
  if (state.submitted) {
    advanceSession();
    render();
    return;
  }
  const stat = getStat(state.currentQuestion.id);
  const correct = sameAnswers(state.selected, state.currentQuestion.correctAnswers);
  stat.attempts += 1;
  if (correct) stat.correct += 1;
  stat.lastAnsweredAt = new Date().toISOString();
  state.lastOutcome = { correct, reviewText: scheduleReview(stat, correct) };
  state.submitted = true;
  persist();
  render();
}

function exportBackup() {
  const payload = {
    app: "kaojj-acp-static",
    version: 3,
    exportedAt: new Date().toISOString(),
    correctLimit: state.correctLimit,
    stats: state.stats,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kaojj-acp-progress-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("学习进度已导出");
}

async function importBackup(file) {
  if (!file) return;
  try {
    const saved = JSON.parse(await file.text());
    if (!saved || typeof saved !== "object" || !saved.stats || typeof saved.stats !== "object") {
      throw new Error("进度文件格式不完整");
    }
    state.stats = saved.stats;
    state.correctLimit = validLimit(saved.correctLimit);
    startSession("today", null, { announce: false });
    persist();
    showToast("学习进度和复习计划已恢复");
  } catch (error) {
    showToast(error.message || "进度导入失败");
  }
}

function resetStats() {
  if (!window.confirm("确定清除全部答题统计和复习计划吗？题库本身不会被删除。")) return;
  state.stats = {};
  startSession("today", null, { announce: false });
  persist();
  showToast("学习进度已重置");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function setupEvents() {
  document.querySelectorAll("[data-session-mode]").forEach((button) => {
    button.addEventListener("click", () => startSession(button.dataset.sessionMode));
  });
  $("knowledge-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-domain]");
    if (button) startSession("domain", button.dataset.domain);
  });
  $("submit-button").addEventListener("click", submitAnswer);
  $("skip-button").addEventListener("click", () => {
    advanceSession();
    render();
  });
  $("next-batch-button").addEventListener("click", () => startSession("priority"));
  $("export-button").addEventListener("click", exportBackup);
  $("reset-button").addEventListener("click", resetStats);
  $("limit-input").addEventListener("change", (event) => {
    state.correctLimit = validLimit(event.target.value);
    event.target.value = String(state.correctLimit);
    persist();
    render();
  });
  $("backup-import-button").addEventListener("click", () => $("backup-input").click());
  $("backup-input").addEventListener("change", (event) => {
    void importBackup(event.target.files[0]);
    event.target.value = "";
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

loadState();
startSession("today", null, { announce: false, shouldRender: false });
setupEvents();
setupInstallPrompt();
setupServiceWorker();
render();
persist();
