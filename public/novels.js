const $ = (selector) => document.querySelector(selector);
const SETTINGS_KEY = "local-ai-chat-settings";

const els = {
  list: $("#project-list"),
  listMeta: $("#project-list-meta"),
  title: $("#project-title"),
  meta: $("#project-meta"),
  statusBar: $("#status-bar"),
  projectActions: $("#project-actions"),
  emptyState: $("#empty-state"),
  emptyTitle: $("#empty-state-title"),
  emptyBody: $("#empty-state-body"),
  emptyCreateProject: $("#empty-create-project"),
  projectContent: $("#project-content"),
  progress: $("#project-progress"),
  operationBox: $("#operation-feedback"),
  operationTitle: $("#operation-title"),
  operationPercent: $("#operation-percent"),
  operationHint: $("#operation-hint"),
  operationProgressFill: $("#operation-progress-fill"),
  settingSelect: $("#setting-select"),
  settingEditor: $("#setting-editor"),
  chapterList: $("#chapter-list"),
  chapterViewer: $("#chapter-viewer"),
  readerDialog: $("#chapter-reader-dialog"),
  readerTitle: $("#reader-title"),
  readerMeta: $("#reader-meta"),
  readerOperationBox: $("#reader-operation-feedback"),
  readerOperationTitle: $("#reader-operation-title"),
  readerOperationPercent: $("#reader-operation-percent"),
  readerOperationHint: $("#reader-operation-hint"),
  readerOperationProgressFill: $("#reader-operation-progress-fill"),
  readerReviewBox: $("#reader-review-box"),
  toggleReaderReview: $("#toggle-reader-review"),
  readerReviewHint: $("#reader-review-hint"),
  readerReviewBody: $("#reader-review-body"),
  readerReviewFeedback: $("#reader-review-feedback"),
  readerApprove: $("#reader-approve"),
  readerRewrite: $("#reader-rewrite"),
  readerContent: $("#reader-content"),
  readerPrev: $("#reader-prev"),
  readerNext: $("#reader-next"),
  readerGenerateNext: $("#reader-generate-next"),
  readerRegenerateCurrent: $("#reader-regenerate-current"),
  readerDeleteChapter: $("#reader-delete-chapter"),
  closeReader: $("#close-reader"),
  reviewFeedback: $("#review-feedback"),
  dialog: $("#project-dialog"),
  createProject: $("#create-project"),
  closeCreateDialog: $("#close-create-dialog"),
  cancelCreate: $("#cancel-create"),
  confirmCreate: $("#confirm-create"),
  createOperationBox: $("#create-operation-feedback"),
  createOperationTitle: $("#create-operation-title"),
  createOperationPercent: $("#create-operation-percent"),
  createOperationHint: $("#create-operation-hint"),
  createOperationProgressFill: $("#create-operation-progress-fill"),
  openChat: $("#open-chat"),
  saveProject: $("#save-project"),
  deleteProject: $("#delete-project"),
  toggleProjectInfo: $("#toggle-project-info"),
  projectInfoPanel: $("#project-info-panel"),
  projectInfoBody: $("#project-info-body"),
  saveSetting: $("#save-setting"),
  toggleSettings: $("#toggle-settings"),
  settingsPanel: $("#settings-panel"),
  settingsBody: $("#settings-body"),
  generateSettings: $("#generate-settings"),
  reconcileSettings: $("#reconcile-settings"),
  batchGenerate: $("#batch-generate"),
  generateChapter: $("#generate-chapter"),
  deleteChapter: $("#delete-chapter"),
  approveChapter: $("#approve-chapter"),
  rewriteChapter: $("#rewrite-chapter"),
  fields: {
    name: $("#project-name"),
    genre: $("#project-genre"),
    theme: $("#project-theme"),
    targetChapters: $("#project-target"),
    chapterWordTarget: $("#project-chapter-word-target"),
    stylePreference: $("#project-style"),
    audience: $("#project-audience"),
    protagonist: $("#project-protagonist"),
    premise: $("#project-premise"),
    keywords: $("#project-keywords"),
    notes: $("#project-notes"),
    qqReviewEnabled: $("#project-qq-enabled"),
    qqTargetType: $("#project-qq-type"),
    qqTargetId: $("#project-qq-id"),
  },
  newFields: {
    name: $("#new-name"),
    genre: $("#new-genre"),
    theme: $("#new-theme"),
    premise: $("#new-premise"),
    protagonist: $("#new-protagonist"),
    stylePreference: $("#new-style"),
    audience: $("#new-audience"),
    targetChapters: $("#new-target"),
    chapterWordTarget: $("#new-chapter-word-target"),
    keywords: $("#new-keywords"),
    notes: $("#new-notes"),
    qqReviewEnabled: $("#new-qq-enabled"),
    qqTargetType: $("#new-qq-type"),
    qqTargetId: $("#new-qq-id"),
  },
};

const state = {
  projects: [],
  activeId: "",
  settings: {},
  activeSetting: "base-info",
  detail: null,
  activeChapterNo: 0,
  activeChapterStatus: "",
  activeChapterTitle: "",
  activeChapterContent: "",
  activeChapterCharacterCount: 0,
  readerChapterNo: 0,
};

function getSavedBackgroundForNovelPage() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const backgrounds = saved?.pageBackgrounds && typeof saved.pageBackgrounds === "object" ? saved.pageBackgrounds : {};
    const record = backgrounds.novel && typeof backgrounds.novel === "object" ? backgrounds.novel : {};
    return {
      image: String(record.image || ""),
      blur: Math.max(0, Number(record.blur) || 0),
      brightness: Math.min(140, Math.max(60, Number(record.brightness) || 100)),
      overlay: Math.min(80, Math.max(0, Number(record.overlay) || 20)),
    };
  } catch {
    return { image: "", blur: 0, brightness: 100, overlay: 20 };
  }
}

function applyNovelPageBackground() {
  const background = getSavedBackgroundForNovelPage();
  document.body.classList.toggle("has-custom-background", Boolean(background.image));
  if (background.image) {
    document.body.style.setProperty("--custom-bg-image", `url("${background.image}")`);
    document.body.style.setProperty("--custom-bg-blur", `${background.blur}px`);
    document.body.style.setProperty("--custom-bg-brightness", `${background.brightness / 100}`);
    document.body.style.setProperty("--custom-bg-overlay-opacity", `${background.overlay / 100}`);
  } else {
    document.body.style.removeProperty("--custom-bg-image");
    document.body.style.removeProperty("--custom-bg-blur");
    document.body.style.removeProperty("--custom-bg-brightness");
    document.body.style.removeProperty("--custom-bg-overlay-opacity");
  }
}

const WORKSPACE_STATES = {
  empty: {
    meta: "请先新建项目，创建后点击左侧项目查看详情。",
    status: "请先新建项目。创建完成后，从左侧点击项目开始编辑。",
    emptyTitle: "请新建项目",
    emptyBody: "当前还没有小说项目。先点击左侧“新建项目”，创建完成后再从左侧选择项目，右侧才会显示项目信息、设定文件和章节内容。",
  },
  idle: {
    meta: "请选择左侧项目查看详情。",
    status: "请点击左侧项目查看详情，右侧将显示项目信息、设定文件和章节内容。",
    emptyTitle: "请选择左侧项目",
    emptyBody: "项目已经创建完成。点击左侧项目卡片后，右侧才会显示项目信息、设定文件和章节内容。",
  },
  created: {
    meta: "项目已创建，请点击左侧项目查看详情。",
    status: "项目已创建。现在请从左侧点击项目，右侧才会展示完整内容。",
    emptyTitle: "项目已创建",
    emptyBody: "新项目已经准备好了。请从左侧点击刚创建的项目卡片，再继续编辑项目信息、设定文件和章节内容。",
  },
  deleted: {
    meta: "项目已删除，请重新从左侧选择项目。",
    status: "项目已删除。请从左侧选择其他项目，或新建项目继续。",
    emptyTitle: "项目已删除",
    emptyBody: "当前工作区已回到初始状态。你可以从左侧选择其他项目，或点击“新建项目”继续创建新的小说项目。",
  },
};

const OPERATION_CONFIGS = {
  create: {
    title: "正在创建项目",
    buttonText: "创建中...",
    successTitle: "创建完成",
    successHint: "项目已创建，请点击左侧项目查看详情。",
    errorTitle: "创建失败",
    feedbackTarget: "dialog",
    initialProgress: 8,
    stepMs: 320,
    stepValue: 5,
    ceiling: 92,
    releaseDelayMs: 420,
    stages: [
      { progress: 8, hint: "正在保存项目信息..." },
      { progress: 38, hint: "正在生成基础设定，这一步可能需要一点时间..." },
      { progress: 72, hint: "正在整理项目列表..." },
    ],
  },
  save: {
    title: "正在保存项目",
    buttonText: "保存中...",
    successTitle: "保存完成",
    successHint: "已刷新为最新的项目内容。",
    errorTitle: "保存失败",
    initialProgress: 14,
    stepMs: 220,
    stepValue: 11,
    ceiling: 88,
    releaseDelayMs: 280,
    stages: [
      { progress: 14, hint: "正在提交最新修改..." },
      { progress: 52, hint: "正在刷新项目详情..." },
      { progress: 76, hint: "马上就好..." },
    ],
  },
  saveSetting: {
    title: "正在保存设定",
    buttonText: "保存中...",
    successTitle: "设定已保存",
    successHint: "当前设定内容已经刷新为最新版本。",
    errorTitle: "保存设定失败",
    initialProgress: 16,
    stepMs: 220,
    stepValue: 10,
    ceiling: 86,
    releaseDelayMs: 280,
    stages: [
      { progress: 16, hint: "正在提交当前设定..." },
      { progress: 48, hint: "正在刷新设定内容..." },
      { progress: 74, hint: "正在同步项目状态..." },
    ],
  },
  generateSettings: {
    title: "正在重新生成设定",
    buttonText: "生成中...",
    successTitle: "设定生成完成",
    successHint: "设定文件已经更新为最新生成结果。",
    errorTitle: "生成设定失败",
    initialProgress: 10,
    stepMs: 340,
    stepValue: 6,
    ceiling: 90,
    releaseDelayMs: 360,
    stages: [
      { progress: 10, hint: "正在分析当前项目信息..." },
      { progress: 36, hint: "正在生成新的设定文件..." },
      { progress: 68, hint: "正在整理并刷新设定列表..." },
    ],
  },
  reconcileSettings: {
    title: "正在按已写章节整理设定",
    buttonText: "整理中...",
    successTitle: "设定整理完成",
    successHint: "设定文件已根据已写章节重新对齐。",
    errorTitle: "整理设定失败",
    initialProgress: 10,
    stepMs: 340,
    stepValue: 6,
    ceiling: 90,
    releaseDelayMs: 360,
    stages: [
      { progress: 10, hint: "正在读取已写章节与当前设定..." },
      { progress: 36, hint: "正在根据既成正文整理设定文件..." },
      { progress: 68, hint: "正在刷新设定内容..." },
    ],
  },
  batchGenerate: {
    title: "正在连续写作",
    buttonText: "写作中...",
    successTitle: "连续写作完成",
    successHint: "章节结果已刷新，可以继续查看最新草稿。",
    errorTitle: "连续写作失败",
    initialProgress: 12,
    stepMs: 420,
    stepValue: 5,
    ceiling: 92,
    releaseDelayMs: 420,
    stages: [
      { progress: 12, hint: "正在提交连续写作请求..." },
      { progress: 34, hint: "正在按顺序生成章节内容..." },
      { progress: 66, hint: "正在整理最新章节与草稿..." },
    ],
  },
  generateChapter: {
    title: "正在生成下一章",
    buttonText: "生成中...",
    successTitle: "下一章已生成",
    successHint: "最新草稿已经载入到右侧章节区。",
    errorTitle: "生成章节失败",
    initialProgress: 12,
    stepMs: 340,
    stepValue: 7,
    ceiling: 90,
    releaseDelayMs: 320,
    stages: [
      { progress: 12, hint: "正在准备章节上下文..." },
      { progress: 44, hint: "正在生成下一章草稿..." },
      { progress: 72, hint: "正在刷新章节列表..." },
    ],
  },
  approveChapter: {
    title: "正在通过待审章节",
    buttonText: "处理中...",
    successTitle: "章节已通过",
    successHint: "待审章节已经转为正式章节。",
    errorTitle: "通过章节失败",
    initialProgress: 18,
    stepMs: 220,
    stepValue: 11,
    ceiling: 88,
    releaseDelayMs: 260,
    stages: [
      { progress: 18, hint: "正在提交通过操作..." },
      { progress: 54, hint: "正在刷新章节状态..." },
      { progress: 78, hint: "马上完成..." },
    ],
  },
  rewriteChapter: {
    title: "正在重写章节",
    buttonText: "重写中...",
    successTitle: "章节已重写",
    successHint: "新的待审草稿已经准备好。",
    errorTitle: "重写章节失败",
    initialProgress: 14,
    stepMs: 320,
    stepValue: 8,
    ceiling: 90,
    releaseDelayMs: 320,
    stages: [
      { progress: 14, hint: "正在提交重写意见..." },
      { progress: 42, hint: "正在重新生成章节内容..." },
      { progress: 74, hint: "正在刷新待审草稿..." },
    ],
  },
  deleteChapter: {
    title: "正在删除章节并回退进度",
    buttonText: "删除中...",
    successTitle: "章节已删除",
    successHint: "已删除当前章及后续内容，并同步回退写作进度。",
    errorTitle: "删除章节失败",
    initialProgress: 16,
    stepMs: 240,
    stepValue: 10,
    ceiling: 90,
    releaseDelayMs: 320,
    stages: [
      { progress: 16, hint: "正在删除当前章及后续文件..." },
      { progress: 48, hint: "正在回退章节进度与审阅状态..." },
      { progress: 76, hint: "正在刷新章节列表..." },
    ],
  },
  readerGenerateNext: {
    title: "正在继续生成下一章",
    buttonText: "生成中...",
    successTitle: "下一章已生成",
    successHint: "新的章节草稿已经载入阅读器。",
    errorTitle: "继续生成失败",
    feedbackTarget: "reader",
    initialProgress: 10,
    stepMs: 340,
    stepValue: 7,
    ceiling: 92,
    releaseDelayMs: 320,
    stages: [
      { progress: 10, hint: "正在检查待审章节状态..." },
      { progress: 36, hint: "正在自动通过上一章待审..." },
      { progress: 64, hint: "正在生成下一章草稿..." },
      { progress: 82, hint: "正在刷新阅读器内容..." },
    ],
  },
  readerRegenerateChapter: {
    title: "正在重新生成当前章",
    buttonText: "重生成中...",
    successTitle: "当前章已重生成",
    successHint: "新的草稿已经载入阅读器。",
    errorTitle: "重新生成失败",
    feedbackTarget: "reader",
    initialProgress: 12,
    stepMs: 340,
    stepValue: 7,
    ceiling: 92,
    releaseDelayMs: 320,
    stages: [
      { progress: 12, hint: "正在准备当前章节上下文..." },
      { progress: 46, hint: "正在重新生成当前章节..." },
      { progress: 76, hint: "正在刷新阅读器内容..." },
    ],
  },
};

const uiState = {
  busy: false,
  promise: null,
  timer: null,
  progressValue: 0,
  activeConfig: null,
  activeFeedbackTarget: "workspace",
};

const CREATE_DIALOG_CLOSE_CONFIRMATION = "确认关闭新建项目窗口吗？当前已填写的内容不会保存。";

const COLLAPSIBLE_SECTION_CONFIGS = [
  {
    button: els.toggleProjectInfo,
    panel: els.projectInfoPanel,
    body: els.projectInfoBody,
    expandedText: "折叠",
    collapsedText: "展开",
  },
  {
    button: els.toggleSettings,
    panel: els.settingsPanel,
    body: els.settingsBody,
    expandedText: "折叠",
    collapsedText: "展开",
  },
];

const actionButtons = [
  els.createProject,
  els.emptyCreateProject,
  els.closeCreateDialog,
  els.cancelCreate,
  els.confirmCreate,
  els.openChat,
  els.saveProject,
  els.deleteProject,
  els.saveSetting,
  els.generateSettings,
  els.reconcileSettings,
  els.batchGenerate,
  els.generateChapter,
  els.deleteChapter,
  els.approveChapter,
  els.rewriteChapter,
  els.readerPrev,
  els.readerNext,
  els.readerGenerateNext,
  els.readerRegenerateCurrent,
  els.readerDeleteChapter,
  els.readerApprove,
  els.readerRewrite,
  els.closeReader,
  els.toggleReaderReview,
].filter(Boolean);

const inputControls = [
  ...Object.values(els.fields),
  ...Object.values(els.newFields),
  els.settingSelect,
  els.settingEditor,
  els.reviewFeedback,
  els.readerReviewFeedback,
].filter(Boolean);

async function j(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setElementHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
  const tokens = new Set(String(element.className || "").split(/\s+/).filter(Boolean));
  if (hidden) tokens.add("is-hidden");
  else tokens.delete("is-hidden");
  element.className = Array.from(tokens).join(" ");
}

function setCollapsibleSectionState(config, expanded) {
  if (!config?.button || !config.body) return;
  setElementHidden(config.body, !expanded);
  config.button.textContent = expanded ? config.expandedText : config.collapsedText;
  config.button.ariaExpanded = expanded ? "true" : "false";
  if (config.panel) {
    const tokens = new Set(String(config.panel.className || "").split(/\s+/).filter(Boolean));
    if (expanded) tokens.delete("is-collapsed");
    else tokens.add("is-collapsed");
    config.panel.className = Array.from(tokens).join(" ");
  }
}

function bindCollapsibleSection(config) {
  if (!config?.button || !config.body) return;
  setCollapsibleSectionState(config, true);
  config.button.onclick = () => {
    setCollapsibleSectionState(config, Boolean(config.body.hidden));
  };
}

function setReaderReviewExpanded(expanded) {
  if (!els.toggleReaderReview || !els.readerReviewBody) return;
  setElementHidden(els.readerReviewBody, !expanded);
  els.toggleReaderReview.textContent = expanded ? "收起审阅" : "展开审阅";
  els.toggleReaderReview.ariaExpanded = expanded ? "true" : "false";
}

function setStatusBar(message, tone = "") {
  if (!els.statusBar) return;
  els.statusBar.textContent = message || "";
  if (tone) {
    els.statusBar.dataset.tone = tone;
  } else if (els.statusBar.dataset) {
    delete els.statusBar.dataset.tone;
  }
}

function clearProjectFields() {
  Object.values(els.fields).forEach((input) => {
    if (!input) return;
    if (input.tagName === "SELECT") {
      input.selectedIndex = 0;
    } else {
      input.value = "";
    }
  });
  els.progress.innerHTML = '<div class="file-empty">暂无项目进度。</div>';
  els.settingSelect.innerHTML = "";
  els.settingEditor.value = "";
  els.chapterList.innerHTML = '<div class="file-empty">暂无章节。</div>';
  els.chapterViewer.value = "";
  setReviewFeedbackValue("");
  resetChapterState();
  closeReader();
}

function clearCreateProjectFields() {
  Object.values(els.newFields).forEach((input) => {
    if (!input) return;
    if (input.tagName === "SELECT") {
      input.selectedIndex = 0;
    } else {
      input.value = "";
    }
  });
}

function formatChineseCharacterCount(value) {
  const normalized = Math.max(0, Number(value) || 0);
  return `${normalized} 汉字`;
}

function setReviewFeedbackValue(value = "") {
  const normalized = String(value || "");
  if (els.reviewFeedback) {
    els.reviewFeedback.value = normalized;
  }
  if (els.readerReviewFeedback) {
    els.readerReviewFeedback.value = normalized;
  }
}

function getPreferredChapterMeta(chapterNo) {
  const chapterItems = Array.isArray(state.detail?.chapters) ? state.detail.chapters : [];
  return chapterItems.find((item) => item.chapterNo === chapterNo && item.status === "draft")
    || chapterItems.find((item) => item.chapterNo === chapterNo)
    || null;
}

function getChapterSequence() {
  return Array.from(new Set((state.detail?.chapters || []).map((item) => Number(item.chapterNo) || 0).filter(Boolean))).sort((a, b) => a - b);
}

function resetChapterState() {
  state.activeChapterNo = 0;
  state.activeChapterStatus = "";
  state.activeChapterTitle = "";
  state.activeChapterContent = "";
  state.activeChapterCharacterCount = 0;
  state.readerChapterNo = 0;
  setReaderReviewExpanded(false);
  if (els.readerReviewHint) {
    els.readerReviewHint.textContent = "当前章节不是待审草稿，阅读器中暂不可审阅。";
  }
  if (els.readerApprove) els.readerApprove.disabled = true;
  if (els.readerRewrite) els.readerRewrite.disabled = true;
}

function updateActiveChapterListSelection() {
  Array.from(els.chapterList?.children || []).forEach((item) => {
    if (!item?.dataset) return;
    const chapterNo = Number(item.dataset.chapterNo || 0);
    const isActive = chapterNo === Number(state.activeChapterNo || 0)
      && (!state.activeChapterStatus || String(item.dataset.status || "") === String(state.activeChapterStatus || ""));
    const tokens = new Set(String(item.className || "").split(/\s+/).filter(Boolean));
    if (isActive) tokens.add("active");
    else tokens.delete("active");
    item.className = Array.from(tokens).join(" ");
  });
}

function setActiveChapterState(chapter = {}) {
  const chapterNo = Number(chapter.chapterNo) || 0;
  const chapterMeta = getPreferredChapterMeta(chapterNo);
  state.activeChapterNo = chapterNo;
  state.activeChapterStatus = String(chapter.status || chapterMeta?.status || "").trim();
  state.activeChapterTitle = String(chapter.title || chapterMeta?.title || (chapterNo ? `第 ${chapterNo} 章` : "")).trim();
  state.activeChapterContent = String(chapter.content || "");
  state.activeChapterCharacterCount = Math.max(0, Number(chapter.characterCount ?? chapterMeta?.characterCount) || 0);
  els.chapterViewer.value = state.activeChapterContent;
  updateActiveChapterListSelection();
}

function formatReaderContent(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  if (lines.length && /^#\s+/.test(String(lines[0] || "").trim())) {
    return lines.slice(1).join("\n").trim();
  }
  return String(content || "").trim();
}

function isReaderChapterReviewable(chapterNo = state.readerChapterNo || state.activeChapterNo) {
  const pendingChapterNo = Number(state.detail?.state?.pendingDraftChapter) || 0;
  return pendingChapterNo > 0 && pendingChapterNo === Number(chapterNo || 0);
}

function updateReaderReviewState() {
  const reviewable = isReaderChapterReviewable();
  if (els.readerReviewHint) {
    els.readerReviewHint.textContent = reviewable
      ? "当前章节是待审草稿，可以直接在阅读器中通过或按意见重写。"
      : "当前章节不是待审草稿，阅读器中暂不可审阅。";
  }
  if (els.readerReviewFeedback) {
    els.readerReviewFeedback.disabled = !reviewable;
    els.readerReviewFeedback.placeholder = reviewable ? "在阅读器里直接填写审阅意见" : "仅待审草稿支持在阅读器中审阅";
  }
  if (els.readerApprove) els.readerApprove.disabled = !reviewable;
  if (els.readerRewrite) els.readerRewrite.disabled = !reviewable;
}

function renderChapterReader() {
  const chapterNo = Number(state.readerChapterNo || state.activeChapterNo || 0);
  const chapterSequence = getChapterSequence();
  const chapterIndex = chapterSequence.indexOf(chapterNo);
  const chapterMeta = getPreferredChapterMeta(chapterNo);
  const title = state.activeChapterNo === chapterNo
    ? state.activeChapterTitle
    : String(chapterMeta?.title || (chapterNo ? `第 ${chapterNo} 章` : "章节阅读"));
  const status = state.activeChapterNo === chapterNo
    ? state.activeChapterStatus
    : String(chapterMeta?.status || "");
  const characterCount = state.activeChapterNo === chapterNo
    ? state.activeChapterCharacterCount
    : Math.max(0, Number(chapterMeta?.characterCount) || 0);

  els.readerTitle.textContent = title || "章节阅读";
  els.readerMeta.textContent = [
    chapterNo ? `第 ${chapterNo} 章` : "",
    status || "",
    formatChineseCharacterCount(characterCount),
    chapterIndex >= 0 ? `${chapterIndex + 1} / ${chapterSequence.length}` : "",
  ].filter(Boolean).join(" · ");
  els.readerContent.textContent = formatReaderContent(state.activeChapterContent) || "暂无章节内容。";
  els.readerPrev.disabled = chapterIndex <= 0;
  els.readerNext.disabled = chapterIndex < 0 || chapterIndex >= chapterSequence.length - 1;
  updateReaderReviewState();
}

function openChapterReader() {
  if (!state.activeChapterNo || !String(state.activeChapterContent || "").trim()) {
    return;
  }
  state.readerChapterNo = state.activeChapterNo;
  setReaderReviewExpanded(false);
  setReviewFeedbackValue(els.reviewFeedback?.value || "");
  renderChapterReader();
  if (!els.readerDialog?.open) {
    els.readerDialog.showModal();
  }
}

function closeReader() {
  if (els.readerDialog?.open) {
    els.readerDialog.close();
  }
  state.readerChapterNo = 0;
  setReaderReviewExpanded(false);
  hideOperationFeedback("reader");
  if (els.readerContent) {
    els.readerContent.textContent = "";
  }
}

async function navigateChapterReader(offset = 0) {
  if (isOperationBusy()) return;
  const chapterSequence = getChapterSequence();
  const currentChapterNo = Number(state.readerChapterNo || state.activeChapterNo || 0);
  const currentIndex = chapterSequence.indexOf(currentChapterNo);
  const targetChapterNo = chapterSequence[currentIndex + Number(offset || 0)];
  if (!targetChapterNo || targetChapterNo === currentChapterNo) {
    return;
  }
  await loadChapter(targetChapterNo);
  if (els.readerContent) {
    els.readerContent.scrollTop = 0;
  }
}

async function readerGenerateNextChapter() {
  const projectId = requireActiveProject("继续生成下一章");
  await runWithOperation(OPERATION_CONFIGS.readerGenerateNext, els.readerGenerateNext, async () => {
    const pendingChapterNo = Number(state.detail?.state?.pendingDraftChapter) || 0;
    if (pendingChapterNo) {
      await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/${pendingChapterNo}/approve`, { method: "POST" });
    }
    const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/generate-next`, { method: "POST" });
    await loadProject(projectId);
    setActiveChapterState({
      chapterNo: data.chapterNo,
      status: "draft",
      title: data.title,
      content: data.draft || "",
    });
    state.readerChapterNo = data.chapterNo;
    setReaderReviewExpanded(false);
    renderChapterReader();
    if (els.readerContent) {
      els.readerContent.scrollTop = 0;
    }
  });
}

async function regenerateCurrentReaderChapter() {
  const projectId = requireActiveProject("重新生成当前章");
  const chapterNo = Number(state.readerChapterNo || state.activeChapterNo || 0);
  if (!chapterNo) {
    throw new Error("请先打开一个章节再重新生成");
  }
  await runWithOperation(OPERATION_CONFIGS.readerRegenerateChapter, els.readerRegenerateCurrent, async () => {
    const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/${chapterNo}/regenerate`, { method: "POST" });
    await loadProject(projectId);
    setActiveChapterState({
      chapterNo: data.chapterNo || chapterNo,
      status: "draft",
      title: data.title,
      content: data.draft || "",
    });
    state.readerChapterNo = chapterNo;
    setReaderReviewExpanded(false);
    renderChapterReader();
    if (els.readerContent) {
      els.readerContent.scrollTop = 0;
    }
  });
}

function projectPayloadFromFields(source) {
  return {
    name: source.name.value.trim(),
    genre: source.genre.value.trim(),
    theme: source.theme.value.trim(),
    premise: source.premise.value.trim(),
    protagonist: source.protagonist.value.trim(),
    stylePreference: source.stylePreference.value.trim(),
    audience: source.audience.value.trim(),
    targetChapters: Number(source.targetChapters.value || 0),
    chapterWordTarget: Number(source.chapterWordTarget.value || 0),
    keywords: source.keywords.value.trim(),
    notes: source.notes ? source.notes.value.trim() : "",
    qqReviewEnabled: source.qqReviewEnabled ? source.qqReviewEnabled.value === "true" : Boolean(source.qqTargetId.value.trim()),
    qqTargetType: source.qqTargetType ? source.qqTargetType.value : "private",
    qqTargetId: source.qqTargetId.value.trim(),
  };
}

function renderProjectList() {
  els.list.innerHTML = "";

  if (!state.projects.length) {
    els.listMeta.textContent = "当前还没有小说项目。";
    els.list.innerHTML = '<div class="file-empty">还没有小说项目。</div>';
    return;
  }

  const activeProject = state.projects.find((project) => project.id === state.activeId);
  els.listMeta.textContent = activeProject
    ? `共 ${state.projects.length} 个项目，当前选中：《${activeProject.name}》`
    : `共 ${state.projects.length} 个项目。点击左侧项目卡片查看详情。`;

  state.projects.forEach((project) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `project-item ${project.id === state.activeId ? "active" : ""}`;
    item.innerHTML = `<strong>${project.name}</strong><div class="muted">${project.genre || "未设置题材"}</div><div class="muted">已通过 ${project.lastApprovedChapter || 0} 章 / 待审 ${project.pendingDraftChapter || 0}</div>`;
    item.onclick = () => loadProject(project.id);
    els.list.append(item);
  });
}

function renderWorkspaceState(config = WORKSPACE_STATES.empty) {
  state.activeId = "";
  state.detail = null;
  state.settings = {};
  state.activeSetting = "base-info";
  els.title.textContent = "小说项目工坊";
  els.meta.textContent = config.meta;
  els.emptyTitle.textContent = config.emptyTitle;
  els.emptyBody.textContent = config.emptyBody;
  setStatusBar(config.status, config.tone || "");
  clearProjectFields();
  setElementHidden(els.projectActions, true);
  setElementHidden(els.projectContent, true);
  setElementHidden(els.emptyState, false);
}

function renderProjectDetail(detail) {
  state.detail = detail;
  state.activeId = detail.project.id;
  const { project, state: projectState, review, chapters, settings } = detail;
  state.settings = settings;

  setElementHidden(els.emptyState, true);
  setElementHidden(els.projectContent, false);
  setElementHidden(els.projectActions, false);
  renderProjectList();

  els.title.textContent = project.name;
  els.meta.textContent = `${project.genre || "未设置题材"} · 已通过 ${projectState.lastApprovedChapter || 0} 章 · 待审 ${projectState.pendingDraftChapter || 0}`;
  setStatusBar(`已选中《${project.name}》。你现在可以编辑项目信息、设定文件和章节内容。`);

  Object.entries(els.fields).forEach(([key, input]) => {
    if (!input) return;
    if (key === "keywords") input.value = Array.isArray(project[key]) ? project[key].join(", ") : project[key] || "";
    else if (key === "qqReviewEnabled") input.value = project.qqReviewEnabled ? "true" : "false";
    else input.value = project[key] ?? "";
  });

  els.progress.innerHTML = "";
  [
    `阶段：${projectState.phase || "planning"}`,
    `当前章：${projectState.currentChapter || 0}`,
    `最近生成：${projectState.lastGeneratedChapter || 0}`,
    `最后通过：${projectState.lastApprovedChapter || 0}`,
    `待审：${projectState.pendingDraftChapter || 0}`,
    `审阅队列：${(review.pending || []).length}`,
    `连续写作：${projectState.autoWriteEnabled ? `已启用（最近批量 ${projectState.autoWriteLastCount || 0} 章）` : "未启用"}`,
  ].forEach((text) => {
    const div = document.createElement("div");
    div.className = "stack-item";
    div.textContent = text;
    els.progress.append(div);
  });

  const settingItems = Object.values(settings || {});
  els.settingSelect.innerHTML = settingItems.map((item) => `<option value="${item.key}">${item.title}</option>`).join("");
  if (!settingItems.some((item) => item.key === state.activeSetting)) {
    state.activeSetting = settingItems[0]?.key || "base-info";
  }
  els.settingSelect.value = state.activeSetting;
  loadSetting(state.activeSetting).catch((error) => {
    setStatusBar(error.message, "error");
    els.settingEditor.value = "";
  });

  els.chapterList.innerHTML = "";
  (chapters || []).forEach((chapter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chapter-item";
    button.dataset.chapterNo = String(chapter.chapterNo || "");
    button.dataset.status = String(chapter.status || "");
    button.innerHTML = `<strong>第 ${chapter.chapterNo} 章</strong><div class="muted">${chapter.status} · ${chapter.title}</div><div class="muted">${formatChineseCharacterCount(chapter.characterCount)}</div>`;
    button.onclick = () => loadChapter(chapter.chapterNo);
    els.chapterList.append(button);
  });
  if (!chapters?.length) {
    els.chapterList.innerHTML = '<div class="file-empty">暂无章节。</div>';
    els.chapterViewer.value = "";
    resetChapterState();
    closeReader();
    return;
  }
  if (state.activeChapterNo && !chapters.some((chapter) => Number(chapter.chapterNo) === Number(state.activeChapterNo))) {
    resetChapterState();
    els.chapterViewer.value = "";
    closeReader();
  } else {
    updateActiveChapterListSelection();
    if (els.readerDialog?.open && state.readerChapterNo) {
      if (getChapterSequence().includes(Number(state.readerChapterNo))) {
        renderChapterReader();
      } else {
        closeReader();
      }
    }
  }
}

async function refreshProjects(options = {}) {
  const {
    preferredId = state.activeId,
    autoSelect = Boolean(state.activeId),
    idleState = WORKSPACE_STATES.idle,
  } = options;

  const data = await j("/novels/projects");
  state.projects = data.projects || [];
  renderProjectList();

  if (!state.projects.length) {
    renderWorkspaceState(WORKSPACE_STATES.empty);
    return;
  }

  const hasPreferredId = preferredId && state.projects.some((project) => project.id === preferredId);
  if (autoSelect && hasPreferredId) {
    await loadProject(preferredId);
    return;
  }

  renderWorkspaceState(idleState);
}

async function loadProject(projectId) {
  state.activeId = projectId;
  renderProjectList();
  const detail = await j(`/novels/projects/${encodeURIComponent(projectId)}`);
  renderProjectDetail(detail);
}

async function loadSetting(key) {
  const projectId = requireActiveProject("查看设定");
  state.activeSetting = key;
  const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/settings/${encodeURIComponent(key)}`);
  els.settingEditor.value = data.content || "";
}

async function loadChapter(chapterNo) {
  const projectId = requireActiveProject("查看章节");
  const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/${chapterNo}`);
  setActiveChapterState(data);
  if (els.readerDialog?.open) {
    state.readerChapterNo = state.activeChapterNo;
    setReaderReviewExpanded(false);
    renderChapterReader();
  }
}

function getOperationHint(config, progressValue) {
  const stages = Array.isArray(config?.stages) ? config.stages : [];
  let hint = stages[0]?.hint || "请稍候，处理中。";
  stages.forEach((stage) => {
    if (progressValue >= Number(stage.progress || 0)) {
      hint = stage.hint || hint;
    }
  });
  return hint;
}

const OPERATION_FEEDBACK_TARGETS = {
  workspace: {
    baseClass: "novel-operation-card",
    box: els.operationBox,
    title: els.operationTitle,
    percent: els.operationPercent,
    hint: els.operationHint,
    fill: els.operationProgressFill,
  },
  dialog: {
    baseClass: "novel-operation-card novel-dialog-operation",
    box: els.createOperationBox,
    title: els.createOperationTitle,
    percent: els.createOperationPercent,
    hint: els.createOperationHint,
    fill: els.createOperationProgressFill,
  },
  reader: {
    baseClass: "novel-operation-card novel-reader-operation",
    box: els.readerOperationBox,
    title: els.readerOperationTitle,
    percent: els.readerOperationPercent,
    hint: els.readerOperationHint,
    fill: els.readerOperationProgressFill,
  },
};

function getOperationFeedbackTarget(targetName = "workspace") {
  return OPERATION_FEEDBACK_TARGETS[targetName] || OPERATION_FEEDBACK_TARGETS.workspace;
}

function resetOperationFeedbackTarget(target) {
  if (!target?.box) return;
  setElementHidden(target.box, true);
  target.box.className = `${target.baseClass || "novel-operation-card"} is-hidden`;
  if (target.fill) target.fill.style.width = "0%";
  if (target.percent) target.percent.textContent = "0%";
  if (target.title) target.title.textContent = "正在处理";
  if (target.hint) target.hint.textContent = "请稍候，处理中。";
}

function updateOperationFeedback(options = {}) {
  const feedbackTargetName = options.feedbackTarget || uiState.activeFeedbackTarget || "workspace";
  const target = getOperationFeedbackTarget(feedbackTargetName);
  if (!target?.box) return;
  const progressValue = Math.max(0, Math.min(100, Number(options.progress ?? uiState.progressValue) || 0));
  uiState.progressValue = progressValue;
  uiState.activeFeedbackTarget = feedbackTargetName;
  Object.entries(OPERATION_FEEDBACK_TARGETS).forEach(([name, item]) => {
    if (name !== feedbackTargetName) {
      resetOperationFeedbackTarget(item);
    }
  });
  setElementHidden(target.box, false);
  target.box.className = `${target.baseClass || "novel-operation-card"}${options.stateClass ? ` ${options.stateClass}` : ""}`;
  target.title.textContent = options.title || "正在处理";
  target.percent.textContent = `${Math.round(progressValue)}%`;
  target.hint.textContent = options.hint || "请稍候，处理中。";
  target.fill.style.width = `${progressValue}%`;
}

function hideOperationFeedback(targetName = uiState.activeFeedbackTarget) {
  resetOperationFeedbackTarget(getOperationFeedbackTarget(targetName));
}

function setInteractiveState(disabled, activeButton = null, activeText = "") {
  actionButtons.forEach((button) => {
    if (!button) return;
    if (!button.dataset.defaultText) {
      button.dataset.defaultText = button.textContent;
    }
    button.disabled = disabled;
    button.textContent = button === activeButton && disabled ? activeText : button.dataset.defaultText;
  });

  inputControls.forEach((control) => {
    if (control) {
      control.disabled = disabled;
    }
  });
}

function stopOperationTimer() {
  if (uiState.timer) {
    clearInterval(uiState.timer);
    uiState.timer = null;
  }
}

function beginOperation(config, activeButton) {
  stopOperationTimer();
  uiState.busy = true;
  uiState.activeConfig = config;
  uiState.activeFeedbackTarget = config.feedbackTarget || "workspace";
  uiState.progressValue = Math.max(0, Number(config.initialProgress || 0));
  setInteractiveState(true, activeButton, config.buttonText || "处理中...");
  setStatusBar(config.title);
  updateOperationFeedback({
    title: config.title,
    hint: getOperationHint(config, uiState.progressValue),
    progress: uiState.progressValue,
    feedbackTarget: uiState.activeFeedbackTarget,
  });
  uiState.timer = setInterval(() => {
    if (!uiState.busy) return;
    uiState.progressValue = Math.min(Number(config.ceiling || 90), uiState.progressValue + Number(config.stepValue || 5));
    updateOperationFeedback({
      title: config.title,
      hint: getOperationHint(config, uiState.progressValue),
      progress: uiState.progressValue,
      feedbackTarget: uiState.activeFeedbackTarget,
    });
  }, Number(config.stepMs || 300));
}

async function finishOperation(resultState, error) {
  const config = uiState.activeConfig || OPERATION_CONFIGS.save;
  stopOperationTimer();
  if (resultState === "success") {
    updateOperationFeedback({
      title: config.successTitle || "处理完成",
      hint: config.successHint || "已完成。",
      progress: 100,
      stateClass: "is-success",
      feedbackTarget: uiState.activeFeedbackTarget,
    });
    await wait(Number(config.releaseDelayMs || 300));
  } else if (resultState === "error") {
    setStatusBar(error?.message || "操作失败，请稍后再试。", "error");
    updateOperationFeedback({
      title: config.errorTitle || "处理失败",
      hint: error?.message || "请稍后再试。",
      progress: Math.max(uiState.progressValue || 0, 100),
      stateClass: "is-error",
      feedbackTarget: uiState.activeFeedbackTarget,
    });
    await wait(900);
  }
  setInteractiveState(false);
  if (els.readerDialog?.open && state.readerChapterNo) {
    renderChapterReader();
  }
  hideOperationFeedback();
  uiState.busy = false;
  uiState.promise = null;
  uiState.activeConfig = null;
  uiState.activeFeedbackTarget = "workspace";
  uiState.progressValue = 0;
}

function isOperationBusy() {
  return uiState.busy === true;
}

function runWithOperation(config, activeButton, task) {
  if (isOperationBusy()) {
    return uiState.promise || Promise.resolve();
  }

  beginOperation(config, activeButton);
  uiState.promise = (async () => {
    try {
      const result = await task();
      await finishOperation("success");
      return result;
    } catch (error) {
      await finishOperation("error", error);
      throw error;
    }
  })();
  return uiState.promise;
}

function requireActiveProject(actionText = "执行此操作") {
  if (state.activeId) {
    return state.activeId;
  }
  throw new Error(`请先从左侧选择项目，再${actionText}`);
}

function resolveActiveChapterNo(preferredChapterNo = 0, actionText = "删除章节") {
  const chapterNo = Number(preferredChapterNo) || Number(state.readerChapterNo || state.activeChapterNo || 0);
  if (chapterNo > 0) {
    return chapterNo;
  }
  throw new Error(`请先选择一个章节，再${actionText}`);
}

function resolveReviewChapterNo(preferredChapterNo = 0, actionText = "审阅章节") {
  const pendingChapterNo = Number(state.detail?.state?.pendingDraftChapter) || 0;
  if (!pendingChapterNo) {
    throw new Error("当前没有待审章节");
  }
  const requestedChapterNo = Number(preferredChapterNo) || pendingChapterNo;
  if (requestedChapterNo !== pendingChapterNo) {
    throw new Error(`请先切换到第 ${pendingChapterNo} 章待审草稿，再${actionText}`);
  }
  return pendingChapterNo;
}

async function createProjectFromPayload(payload, options = {}) {
  if (!payload.name) {
    throw new Error("请填写项目名称");
  }

  const data = await runWithOperation(OPERATION_CONFIGS.create, options.triggerButton || null, async () => {
    const data = await j("/novels/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.activeId = "";
    await refreshProjects({ autoSelect: false, idleState: WORKSPACE_STATES.created });
    return data;
  });
  if (options.closeDialog !== false) {
    closeCreateDialog("created");
  }
  return data;
}

async function createProject() {
  const payload = projectPayloadFromFields(els.newFields);
  return await createProjectFromPayload(payload, {
    closeDialog: true,
    triggerButton: els.confirmCreate,
  });
}

async function saveProject() {
  const projectId = requireActiveProject("保存项目");
  const payload = projectPayloadFromFields(els.fields);
  return await runWithOperation(OPERATION_CONFIGS.save, els.saveProject, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await refreshProjects({ preferredId: projectId, autoSelect: true });
  });
}

async function deleteProject() {
  const projectId = requireActiveProject("删除项目");
  if (!confirm("确认删除当前小说项目吗？")) return;
  await j(`/novels/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
  state.activeId = "";
  await refreshProjects({ autoSelect: false, idleState: WORKSPACE_STATES.deleted });
}

async function saveSetting() {
  const projectId = requireActiveProject("保存设定");
  await runWithOperation(OPERATION_CONFIGS.saveSetting, els.saveSetting, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/settings/${encodeURIComponent(state.activeSetting)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: els.settingEditor.value }),
    });
    await loadProject(projectId);
  });
}

async function generateSettings() {
  const projectId = requireActiveProject("生成设定");
  await runWithOperation(OPERATION_CONFIGS.generateSettings, els.generateSettings, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/generate-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite: true }),
    });
    await loadProject(projectId);
  });
}

async function reconcileSettings() {
  const projectId = requireActiveProject("按正文整理设定");
  if (!confirm("确认根据已写章节反向整理设定吗？这会覆盖现有设定文件，让它们尽量向既成正文对齐。")) return;
  await runWithOperation(OPERATION_CONFIGS.reconcileSettings, els.reconcileSettings, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/reconcile-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite: true }),
    });
    await loadProject(projectId);
  });
}

async function generateChapter() {
  const projectId = requireActiveProject("生成章节");
  await runWithOperation(OPERATION_CONFIGS.generateChapter, els.generateChapter, async () => {
    const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/generate-next`, { method: "POST" });
    await loadProject(projectId);
    setActiveChapterState({
      chapterNo: data.chapterNo,
      status: "draft",
      title: data.title,
      content: data.draft || "",
    });
  });
}

async function deleteChapterAndProgress(options = {}) {
  const projectId = requireActiveProject("删除章节");
  const chapterNo = resolveActiveChapterNo(options.chapterNo, "删除章节");
  const resetToChapter = Math.max(0, chapterNo - 1);
  const confirmationMessage = resetToChapter > 0
    ? `确认删除第 ${chapterNo} 章及之后的所有章节、草稿、摘要、快照，并把进度回退到第 ${resetToChapter} 章吗？`
    : `确认删除第 ${chapterNo} 章及之后的所有章节、草稿、摘要、快照，并把项目进度恢复到初始状态吗？`;
  if (!confirm(confirmationMessage)) {
    return;
  }
  const config = options.feedbackTarget ? { ...OPERATION_CONFIGS.deleteChapter, feedbackTarget: options.feedbackTarget } : OPERATION_CONFIGS.deleteChapter;
  await runWithOperation(config, options.triggerButton || els.deleteChapter, async () => {
    const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/${chapterNo}`, { method: "DELETE" });
    await loadProject(projectId);
    const nextChapterNo = Number(data.resetToChapter || 0);
    if (nextChapterNo > 0) {
      await loadChapter(nextChapterNo);
      if (options.keepReaderOpen) {
        openChapterReader();
      }
      return;
    }
    resetChapterState();
    els.chapterViewer.value = "";
    closeReader();
  });
}

async function batchGenerate() {
  const projectId = requireActiveProject("连续写作");
  const rawCount = window.prompt("连续写作多少章？建议 1-5 章。", "3");
  if (rawCount == null) return;
  const count = Number(rawCount);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("请输入有效的章节数量");
  }
  const autoApprove = window.confirm("是否自动通过每章并继续写下一章？\n选择“确定”会直接把生成的章节转正；选择“取消”则生成一章草稿后等待审阅。");
  const data = await runWithOperation(OPERATION_CONFIGS.batchGenerate, els.batchGenerate, async () => {
    const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/batch-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, autoApprove }),
    });
    await loadProject(projectId);
    if (data.generated?.length) {
      const last = data.generated[data.generated.length - 1];
      await loadChapter(last.chapterNo);
    }
    return data;
  });
  if (data) {
    window.alert(`已处理 ${data.generated?.length || 0} 章。${data.haltedReason ? `\n停止原因：${data.haltedReason}` : ""}`);
  }
}

async function approveChapter(options = {}) {
  const projectId = requireActiveProject("审批章节");
  const chapterNo = resolveReviewChapterNo(options.chapterNo, "审批章节");
  const config = options.feedbackTarget ? { ...OPERATION_CONFIGS.approveChapter, feedbackTarget: options.feedbackTarget } : OPERATION_CONFIGS.approveChapter;
  await runWithOperation(config, options.triggerButton || els.approveChapter, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/${chapterNo}/approve`, { method: "POST" });
    await loadProject(projectId);
    await loadChapter(chapterNo);
  });
}

async function rewriteChapter(options = {}) {
  const projectId = requireActiveProject("重写章节");
  const chapterNo = resolveReviewChapterNo(options.chapterNo, "重写章节");
  const feedback = String(options.feedback ?? els.reviewFeedback.value).trim();
  const config = options.feedbackTarget ? { ...OPERATION_CONFIGS.rewriteChapter, feedbackTarget: options.feedbackTarget } : OPERATION_CONFIGS.rewriteChapter;
  setReviewFeedbackValue(feedback);
  await runWithOperation(config, options.triggerButton || els.rewriteChapter, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/chapters/${chapterNo}/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
    await loadProject(projectId);
    await loadChapter(chapterNo);
  });
}

function bindAsyncAction(button, handler, options = {}) {
  if (!button) return;
  button.onclick = async (event) => {
    if (options.preventDefault && event?.preventDefault) {
      event.preventDefault();
    }
    if (isOperationBusy()) {
      return uiState.promise || Promise.resolve();
    }
    return await handler(event).catch((error) => {
      alert(error.message);
      return null;
    });
  };
}

function openCreateDialog() {
  if (isOperationBusy() || els.dialog?.open) return;
  els.dialog.showModal();
}

function closeCreateDialog(returnValue = "cancel") {
  if (!els.dialog?.open) return false;
  hideOperationFeedback("dialog");
  clearCreateProjectFields();
  els.dialog.close(returnValue);
  return true;
}

function requestCloseCreateDialog(event) {
  if (event?.preventDefault) {
    event.preventDefault();
  }
  if (!els.dialog?.open || isOperationBusy()) {
    return false;
  }
  if (!confirm(CREATE_DIALOG_CLOSE_CONFIRMATION)) {
    return false;
  }
  return closeCreateDialog("cancel");
}

els.createProject.onclick = openCreateDialog;
els.emptyCreateProject.onclick = openCreateDialog;
els.closeCreateDialog.onclick = requestCloseCreateDialog;
els.cancelCreate.onclick = requestCloseCreateDialog;
els.dialog.oncancel = requestCloseCreateDialog;
els.reviewFeedback.oninput = () => setReviewFeedbackValue(els.reviewFeedback.value);
els.readerReviewFeedback.oninput = () => setReviewFeedbackValue(els.readerReviewFeedback.value);
els.toggleReaderReview.onclick = () => setReaderReviewExpanded(Boolean(els.readerReviewBody?.hidden));
els.chapterViewer.ondblclick = () => openChapterReader();
els.readerPrev.onclick = () => navigateChapterReader(-1);
els.readerNext.onclick = () => navigateChapterReader(1);
bindAsyncAction(els.readerGenerateNext, () => readerGenerateNextChapter());
bindAsyncAction(els.readerRegenerateCurrent, () => regenerateCurrentReaderChapter());
bindAsyncAction(els.readerDeleteChapter, () => deleteChapterAndProgress({
  triggerButton: els.readerDeleteChapter,
  feedbackTarget: "reader",
  chapterNo: state.readerChapterNo || state.activeChapterNo,
  keepReaderOpen: true,
}));
bindAsyncAction(els.readerApprove, () => approveChapter({
  triggerButton: els.readerApprove,
  feedbackTarget: "reader",
  chapterNo: state.readerChapterNo || state.activeChapterNo,
}));
bindAsyncAction(els.readerRewrite, () => rewriteChapter({
  triggerButton: els.readerRewrite,
  feedbackTarget: "reader",
  chapterNo: state.readerChapterNo || state.activeChapterNo,
  feedback: els.readerReviewFeedback.value,
}));
els.closeReader.onclick = () => closeReader();
els.readerDialog.oncancel = (event) => {
  if (event?.preventDefault) {
    event.preventDefault();
  }
  closeReader();
};
bindAsyncAction(els.confirmCreate, () => createProject(), { preventDefault: true });
els.openChat.onclick = () => {
  if (isOperationBusy()) return;
  window.location.href = "/";
};
bindAsyncAction(els.saveProject, () => saveProject());
bindAsyncAction(els.deleteProject, () => deleteProject());
bindAsyncAction(els.saveSetting, () => saveSetting());
els.settingSelect.onchange = () => loadSetting(els.settingSelect.value).catch((error) => alert(error.message));
bindAsyncAction(els.generateSettings, () => generateSettings());
bindAsyncAction(els.reconcileSettings, () => reconcileSettings());
bindAsyncAction(els.batchGenerate, () => batchGenerate());
bindAsyncAction(els.generateChapter, () => generateChapter());
bindAsyncAction(els.deleteChapter, () => deleteChapterAndProgress({
  triggerButton: els.deleteChapter,
}));
bindAsyncAction(els.approveChapter, () => approveChapter());
bindAsyncAction(els.rewriteChapter, () => rewriteChapter());
COLLAPSIBLE_SECTION_CONFIGS.forEach(bindCollapsibleSection);
setReaderReviewExpanded(false);
hideOperationFeedback("workspace");
hideOperationFeedback("dialog");
hideOperationFeedback("reader");
applyNovelPageBackground();

refreshProjects({ autoSelect: false }).catch((error) => {
  setStatusBar(error.message, "error");
  els.meta.textContent = error.message;
});
