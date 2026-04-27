const $ = (selector) => document.querySelector(selector);
const SETTINGS_KEY = "local-ai-chat-settings";
const SHARED_CONNECTION_CONFIG_ENDPOINT = "/connection-config";
const MODELS_ENDPOINT = "/api/v1/models";
const MAX_BACKGROUND_SIZE = 8 * 1024 * 1024;

const els = {
  list: $("#project-list"),
  listMeta: $("#project-list-meta"),
  modelMeta: $("#current-model-meta"),
  modelOptions: $("#novel-model-options"),
  openNovelBackgroundDialog: $("#open-novel-background-dialog-top"),
  novelBackgroundDialog: $("#novel-background-dialog"),
  novelBackgroundDialogBody: $("#novel-background-dialog-body"),
  closeNovelBackgroundDialog: $("#close-novel-background-dialog"),
  novelBackgroundCard: $(".novel-background-card"),
  novelBackgroundInput: $("#novel-background-input"),
  uploadNovelBackground: $("#upload-novel-background"),
  clearNovelBackground: $("#clear-novel-background"),
  novelBackgroundPreview: $("#novel-background-preview"),
  novelBackgroundMeta: $("#novel-background-meta"),
  novelBackgroundBlur: $("#novel-background-blur"),
  novelBackgroundShellOpacity: $("#novel-background-shell-opacity"),
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
  saveCreateDraft: $("#save-create-draft"),
  inferProject: $("#infer-project"),
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
  generateCurrentSetting: $("#generate-current-setting"),
  reconcileCurrentSetting: $("#reconcile-current-setting"),
  toggleSettings: $("#toggle-settings"),
  settingsPanel: $("#settings-panel"),
  settingsBody: $("#settings-body"),
  generateSettings: $("#generate-settings"),
  reconcileSettings: $("#reconcile-settings"),
  batchGenerate: $("#batch-generate"),
  generateChapter: $("#generate-chapter"),
  exportChapters: $("#export-chapters"),
  deleteChapter: $("#delete-chapter"),
  approveChapter: $("#approve-chapter"),
  rewriteChapter: $("#rewrite-chapter"),
  fields: {
    name: $("#project-name"),
    genre: $("#project-genre"),
    theme: $("#project-theme"),
    targetChapters: $("#project-target"),
    chapterWordTarget: $("#project-chapter-word-target"),
    model: $("#project-model"),
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
    brief: $("#new-brief"),
    genre: $("#new-genre"),
    theme: $("#new-theme"),
    premise: $("#new-premise"),
    protagonist: $("#new-protagonist"),
    stylePreference: $("#new-style"),
    audience: $("#new-audience"),
    targetChapters: $("#new-target"),
    chapterWordTarget: $("#new-chapter-word-target"),
    model: $("#new-model"),
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
  currentModel: "",
  availableModels: [],
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

function readSavedNovelSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function getLegacyPageBackgroundRecord(target = "novel") {
  const saved = readSavedNovelSettings();
  const backgrounds = saved?.pageBackgrounds && typeof saved.pageBackgrounds === "object" ? saved.pageBackgrounds : {};
  const record = backgrounds[target] && typeof backgrounds[target] === "object" ? backgrounds[target] : {};
  return {
    image: String(record.image || ""),
    softImage: String(record.softImage || ""),
    blur: Math.max(0, Number(record.blur) || 0),
    shellOpacity: Math.min(100, Math.max(30, Number(record.shellOpacity) || 70)),
  };
}

function getSavedBackgroundForNovelPage() {
  const saved = readSavedNovelSettings();
  const record = saved?.novelPageBackground && typeof saved.novelPageBackground === "object"
    ? saved.novelPageBackground
    : getLegacyPageBackgroundRecord("novel");
  return {
    image: String(record.image || ""),
    softImage: String(record.softImage || ""),
    blur: Math.max(0, Number(record.blur) || 0),
    shellOpacity: Math.min(100, Math.max(30, Number(record.shellOpacity) || 70)),
  };
}

function updateNovelPageBackgroundSetting(patch = {}) {
  const current = readSavedNovelSettings();
  const previous = getSavedBackgroundForNovelPage();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    novelPageBackground: {
      image: String(patch.image ?? previous.image ?? ""),
      softImage: String(patch.softImage ?? previous.softImage ?? ""),
      blur: Math.max(0, Number(patch.blur ?? previous.blur ?? 0) || 0),
      shellOpacity: Math.min(100, Math.max(30, Number(patch.shellOpacity ?? previous.shellOpacity ?? 70) || 70)),
    },
  }));
}
let novelBackgroundPersistTimer = null;
function scheduleNovelPageBackgroundSettingSave(patch = {}) {
  window.clearTimeout(novelBackgroundPersistTimer);
  novelBackgroundPersistTimer = window.setTimeout(() => {
    updateNovelPageBackgroundSetting(patch);
    novelBackgroundPersistTimer = null;
  }, 180);
}

function getSavedModelForNovelPage() {
  const saved = readSavedNovelSettings();
  return String(saved?.novelModel || "").trim();
}

function saveModelForNovelPage(modelName = "") {
  const current = readSavedNovelSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    novelModel: String(modelName || "").trim(),
  }));
}

function toggleClassName(element, className, enabled) {
  if (!element || !className) return;
  if (element.classList && typeof element.classList.toggle === "function") {
    element.classList.toggle(className, Boolean(enabled));
    return;
  }
  const tokens = new Set(String(element.className || "").split(/\s+/).filter(Boolean));
  if (enabled) tokens.add(className);
  else tokens.delete(className);
  element.className = Array.from(tokens).join(" ");
}

function setStyleProperty(element, name, value) {
  if (!element?.style || !name) return;
  if (typeof element.style.setProperty === "function") {
    element.style.setProperty(name, value);
    return;
  }
  element.style[name] = value;
}

function removeStyleProperty(element, name) {
  if (!element?.style || !name) return;
  if (typeof element.style.removeProperty === "function") {
    element.style.removeProperty(name);
    return;
  }
  delete element.style[name];
}
function clearNovelPageBackgroundEffects() {
  const body = document?.body;
  if (!body) return;
  toggleClassName(body, "has-custom-background", false);
  removeStyleProperty(body, "--custom-bg-image");
  removeStyleProperty(body, "--custom-bg-soft-image");
  removeStyleProperty(body, "--custom-bg-blur");
  removeStyleProperty(body, "--custom-bg-image-opacity");
  removeStyleProperty(body, "--custom-bg-soft-opacity");
  removeStyleProperty(body, "--custom-bg-soft-scale");
  removeStyleProperty(body, "--app-shell-opacity-factor");
  removeStyleProperty(body, "--surface-opacity-factor");
}

function applyNovelPageBackground() {
  const body = document?.body;
  if (!body) return;
  const background = getSavedBackgroundForNovelPage();
  if (!background.image) {
    clearNovelPageBackgroundEffects();
    return;
  }
  const shellOpacityFactor = background.shellOpacity / 100;
  const surfaceOpacityFactor = Math.min(1, 0.42 + shellOpacityFactor * 0.38);
  const softOpacity = 0.1 + (Math.max(0, background.blur) / 24) * 0.38;
  const softScale = 1.02 + (Math.max(0, background.blur) / 24) * 0.08;
  toggleClassName(body, "has-custom-background", true);
  setStyleProperty(body, "--custom-bg-image", `url("${background.image}")`);
  setStyleProperty(body, "--custom-bg-soft-image", `url("${background.softImage || background.image}")`);
  setStyleProperty(body, "--custom-bg-image-opacity", "1");
  setStyleProperty(body, "--custom-bg-soft-opacity", `${softOpacity}`);
  setStyleProperty(body, "--custom-bg-soft-scale", `${softScale}`);
  setStyleProperty(body, "--app-shell-opacity-factor", `${shellOpacityFactor}`);
  setStyleProperty(body, "--surface-opacity-factor", `${surfaceOpacityFactor}`);
}

function renderNovelBackgroundControls(override = null) {
  const savedBackground = getSavedBackgroundForNovelPage();
  const background = override && typeof override === "object"
    ? {
      ...savedBackground,
      ...override,
      image: String(override.image ?? savedBackground.image ?? ""),
      softImage: String(override.softImage ?? savedBackground.softImage ?? ""),
      blur: Math.max(0, Number(override.blur ?? savedBackground.blur ?? 0) || 0),
      shellOpacity: Math.min(100, Math.max(30, Number(override.shellOpacity ?? savedBackground.shellOpacity ?? 70) || 70)),
    }
    : savedBackground;
  const dataUrl = background.image;
  if (els.novelBackgroundBlur) {
    els.novelBackgroundBlur.value = String(background.blur);
  }
  if (els.novelBackgroundShellOpacity) {
    els.novelBackgroundShellOpacity.value = String(background.shellOpacity);
  }
  if (els.novelBackgroundPreview) {
    toggleClassName(els.novelBackgroundPreview, "has-image", Boolean(dataUrl));
    els.novelBackgroundPreview.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : "";
    els.novelBackgroundPreview.innerHTML = `<span>${dataUrl ? "当前背景图已启用" : "当前使用默认背景"}</span>`;
  }
  if (els.novelBackgroundMeta) {
    els.novelBackgroundMeta.textContent = dataUrl
      ? `当前已为小说页启用自定义背景；柔化 ${background.blur}px，界面透明度 ${background.shellOpacity}%。`
      : "支持为小说页上传独立背景，并调整柔化与界面透明度。";
  }
  if (background.image) {
    const body = document?.body;
    if (!body) return;
    const shellOpacityFactor = background.shellOpacity / 100;
    const surfaceOpacityFactor = Math.min(1, 0.42 + shellOpacityFactor * 0.38);
    const softOpacity = 0.1 + (Math.max(0, background.blur) / 24) * 0.38;
    const softScale = 1.02 + (Math.max(0, background.blur) / 24) * 0.08;
    toggleClassName(body, "has-custom-background", true);
    setStyleProperty(body, "--custom-bg-image", `url("${background.image}")`);
    setStyleProperty(body, "--custom-bg-soft-image", `url("${background.softImage || background.image}")`);
    setStyleProperty(body, "--custom-bg-image-opacity", "1");
    setStyleProperty(body, "--custom-bg-soft-opacity", `${softOpacity}`);
    setStyleProperty(body, "--custom-bg-soft-scale", `${softScale}`);
    setStyleProperty(body, "--app-shell-opacity-factor", `${shellOpacityFactor}`);
    setStyleProperty(body, "--surface-opacity-factor", `${surfaceOpacityFactor}`);
  } else {
    clearNovelPageBackgroundEffects();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = source;
  });
}
function getFittedImageSize(width, height, maxDimension) {
  const longestEdge = Math.max(Number(width) || 0, Number(height) || 0, 1);
  const scale = Math.min(1, Number(maxDimension) / longestEdge);
  return {
    width: Math.max(1, Math.round((Number(width) || 1) * scale)),
    height: Math.max(1, Math.round((Number(height) || 1) * scale)),
  };
}
function canvasToJpegDataUrl(canvas, quality = 0.84) {
  return canvas.toDataURL("image/jpeg", quality);
}
async function processBackgroundImageFile(file) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const baseSize = getFittedImageSize(image.naturalWidth, image.naturalHeight, 1800);
  const softSize = getFittedImageSize(image.naturalWidth, image.naturalHeight, 640);
  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = baseSize.width;
  baseCanvas.height = baseSize.height;
  const baseContext = baseCanvas.getContext("2d");
  baseContext.drawImage(image, 0, 0, baseSize.width, baseSize.height);
  const softCanvas = document.createElement("canvas");
  softCanvas.width = softSize.width;
  softCanvas.height = softSize.height;
  const softContext = softCanvas.getContext("2d");
  softContext.drawImage(image, 0, 0, softSize.width, softSize.height);
  return {
    image: canvasToJpegDataUrl(baseCanvas, 0.84),
    softImage: canvasToJpegDataUrl(softCanvas, 0.7),
  };
}

async function syncCurrentModel(options = {}) {
  const { quiet = true } = options;
  const fallbackModel = getSavedModelForNovelPage();
  if (!state.currentModel && fallbackModel) {
    state.currentModel = fallbackModel;
    renderCurrentModelMeta();
    if (state.detail?.project) {
      renderProjectHeader();
    }
  }
  if (!quiet && !state.currentModel) {
    setStatusBar("请先为小说项目选择模型。小说模型不会跟随聊天页模型。", "error");
  }
  renderCurrentModelMeta();
  return state.currentModel;
  try {
    const response = await j(SHARED_CONNECTION_CONFIG_ENDPOINT);
    const nextModel = String(response?.config?.model || "").trim() || fallbackModel;
    if (nextModel !== state.currentModel) {
      state.currentModel = nextModel;
      renderCurrentModelMeta();
      if (state.detail?.project) {
        renderProjectHeader();
      }
    }
    return nextModel;
  } catch (error) {
    if (!quiet && !state.currentModel) {
      setStatusBar(`读取当前模型失败：${String(error?.message || "未知错误")}`, "error");
    }
    renderCurrentModelMeta();
    return state.currentModel;
  }
}

function renderNovelModelOptions() {
  if (els.modelOptions) {
    els.modelOptions.replaceChildren(...(state.availableModels || []).map((modelName) => {
      const option = document.createElement("option");
      option.value = modelName;
      return option;
    }));
  }
  if (els.newFields.model?.tagName === "SELECT") {
    const currentValue = String(els.newFields.model.value || "").trim();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.availableModels.length ? "请选择项目模型" : "正在读取模型列表...";
    const options = (state.availableModels || []).map((modelName) => {
      const option = document.createElement("option");
      option.value = modelName;
      option.textContent = modelName;
      return option;
    });
    els.newFields.model.replaceChildren(placeholder, ...options);
    if (currentValue && state.availableModels.includes(currentValue)) {
      els.newFields.model.value = currentValue;
    }
  }
}

async function loadAvailableModelsForNovelPage(options = {}) {
  const { force = false } = options;
  try {
    const data = await j(force ? `${MODELS_ENDPOINT}?_=${Date.now()}` : MODELS_ENDPOINT, {
      cache: force ? "no-store" : "default",
    });
    state.availableModels = (data.data || []).map((item) => item?.id).filter(Boolean);
    renderNovelModelOptions();
    return state.availableModels;
  } catch {
    state.availableModels = [];
    renderNovelModelOptions();
    return state.availableModels;
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
  draftCreated: {
    meta: "鑽夌椤圭洰宸蹭繚瀛橈紝璇风偣鍑诲乏渚ч」鐩户缁畬鍠勩€?",
    status: "鑽夌椤圭洰宸蹭繚瀛樸€備綘鍙互鍏堝畬鍠勯」鐩俊鎭紝鍚庣画鍐嶆墜鍔ㄧ敓鎴愯瀹氥€?",
    emptyTitle: "鑽夌宸蹭繚瀛?",
    emptyBody: "椤圭洰宸茬粡浠ヨ崏绋跨殑褰㈠紡淇濆瓨銆傝浠庡乏渚х偣鍑昏椤圭洰锛岀户缁ˉ鍏呬俊鎭紱鍑嗗濂藉悗鍐嶇偣鍑烩€滅敓鎴愯瀹氣€濄€?",
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
  saveDraft: {
    title: "姝ｅ湪淇濆瓨椤圭洰鑽夌",
    buttonText: "淇濆瓨鑽夌涓?..",
    successTitle: "鑽夌淇濆瓨瀹屾垚",
    successHint: "椤圭洰鑽夌宸蹭繚瀛橈紝鍙互鍚庣画鍐嶇敓鎴愯瀹氥€?",
    errorTitle: "淇濆瓨鑽夌澶辫触",
    feedbackTarget: "dialog",
    initialProgress: 8,
    stepMs: 220,
    stepValue: 8,
    ceiling: 86,
    releaseDelayMs: 280,
    stages: [
      { progress: 8, hint: "姝ｅ湪淇濆瓨椤圭洰鍩虹淇℃伅..." },
      { progress: 42, hint: "姝ｅ湪鍒濆鍖栬崏绋块」鐩?.." },
      { progress: 72, hint: "姝ｅ湪鍒锋柊椤圭洰鍒楄〃..." },
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
  generateCurrentSetting: {
    title: "姝ｅ湪鐢熸垚褰撳墠璁惧畾",
    buttonText: "鐢熸垚涓?..",
    successTitle: "褰撳墠璁惧畾宸茬敓鎴?",
    successHint: "褰撳墠閫変腑鐨勮瀹氭枃浠跺凡鏇存柊涓烘渶鏂扮敓鎴愮粨鏋溿€?",
    errorTitle: "鐢熸垚褰撳墠璁惧畾澶辫触",
    initialProgress: 12,
    stepMs: 320,
    stepValue: 7,
    ceiling: 88,
    releaseDelayMs: 320,
    stages: [
      { progress: 12, hint: "姝ｅ湪鍒嗘瀽褰撳墠閫変腑璁惧畾..." },
      { progress: 44, hint: "姝ｅ湪鐢熸垚褰撳墠璁惧畾鍐呭..." },
      { progress: 74, hint: "姝ｅ湪鍒锋柊璁惧畾缂栬緫鍖?.." },
    ],
  },
  reconcileCurrentSetting: {
    title: "姝ｅ湪鎸夋鏂囨暣鐞嗗綋鍓嶈瀹?",
    buttonText: "鏁寸悊涓?..",
    successTitle: "褰撳墠璁惧畾宸叉寜姝ｆ枃鏁寸悊",
    successHint: "褰撳墠閫変腑鐨勮瀹氭枃浠跺凡灏介噺鍚戞棦鎴愭鏂囧榻愩€?",
    errorTitle: "鎸夋鏂囨暣鐞嗗綋鍓嶈瀹氬け璐?",
    initialProgress: 12,
    stepMs: 320,
    stepValue: 7,
    ceiling: 88,
    releaseDelayMs: 320,
    stages: [
      { progress: 12, hint: "姝ｅ湪璇诲彇宸插啓绔犺妭涓庡綋鍓嶈瀹?.." },
      { progress: 44, hint: "姝ｅ湪鎸夋鏂囧弽鍚戞暣鐞嗗綋鍓嶈瀹?.." },
      { progress: 74, hint: "姝ｅ湪鍒锋柊璁惧畾缂栬緫鍖?.." },
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
  els.saveCreateDraft,
  els.inferProject,
  els.confirmCreate,
  els.openChat,
  els.saveProject,
  els.deleteProject,
  els.saveSetting,
  els.generateCurrentSetting,
  els.reconcileCurrentSetting,
  els.generateSettings,
  els.reconcileSettings,
  els.batchGenerate,
  els.generateChapter,
  els.exportChapters,
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

function downloadTextFile(fileName = "download.md", content = "") {
  const blob = new Blob([String(content || "")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "download.md";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

function formatChapterStatusLabel(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") return "已通过";
  if (normalized === "draft") return "待审草稿";
  if (normalized === "pending") return "待审";
  if (normalized === "archived") return "已归档";
  return String(status || "").trim() || "未标记";
}

function getChapterDisplayTitle(chapter = {}) {
  const title = String(chapter?.title || "").trim();
  const chapterNo = Number(chapter?.chapterNo) || 0;
  if (title && chapterNo > 0) {
    const normalized = title.replace(new RegExp(`^第\\s*${chapterNo}\\s*章[：:、.\\-—\\s]*`), "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return title || "未命名章节";
}

function buildChapterCardMarkup(chapter = {}) {
  const chapterNo = Number(chapter?.chapterNo) || 0;
  const statusLabel = formatChapterStatusLabel(chapter?.status);
  const title = getChapterDisplayTitle(chapter);
  const countLabel = formatChineseCharacterCount(chapter?.characterCount);
  return [
    `<span class="chapter-item-number">第 ${chapterNo} 章</span>`,
    `<strong class="chapter-item-title">${escapeHtml(title)}</strong>`,
    '<div class="chapter-item-meta">',
    `<span class="chapter-item-badge chapter-item-status">${escapeHtml(statusLabel)}</span>`,
    `<span class="chapter-item-badge chapter-item-count">${escapeHtml(countLabel)}</span>`,
    "</div>",
  ].join("");
}

function renderChapterList(chapters = []) {
  if (!els.chapterList) return;
  els.chapterList.innerHTML = "";
  (chapters || []).forEach((chapter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chapter-item";
    button.dataset.chapterNo = String(chapter.chapterNo || "");
    button.dataset.status = String(chapter.status || "");
    button.title = [
      `第 ${chapter.chapterNo || 0} 章`,
      getChapterDisplayTitle(chapter),
      formatChapterStatusLabel(chapter.status),
      formatChineseCharacterCount(chapter.characterCount),
    ].join(" · ");
    button.innerHTML = buildChapterCardMarkup(chapter);
    button.onclick = () => loadChapter(chapter.chapterNo);
    els.chapterList.append(button);
  });
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
    model: source.model ? source.model.value.trim() : "",
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

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCurrentModelLabel() {
  return String(state.currentModel || getSavedModelForNovelPage() || "").trim();
}

function getActiveProjectModelLabel(project = state.detail?.project) {
  return String(project?.model || getCurrentModelLabel()).trim();
}

function renderCurrentModelMeta() {
  if (!els.modelMeta) return;
  const modelName = getCurrentModelLabel();
  els.modelMeta.textContent = modelName ? `小说默认模型：${modelName}` : "小说默认模型：未选择";
}

function getProjectDisplayName(project = {}) {
  return String(project?.name || "").trim() || "未命名项目";
}

function renderProjectHeader(detail = state.detail) {
  if (!detail?.project) return;
  const project = detail.project;
  const projectState = detail.state || {};
  const metaParts = [
    project.genre || "未设置题材",
    project.theme ? `主题：${project.theme}` : "",
    `已通过 ${projectState.lastApprovedChapter || 0} 章`,
    `待审 ${projectState.pendingDraftChapter || 0}`,
  ].filter(Boolean);
  const currentModel = getActiveProjectModelLabel(project);
  if (currentModel) {
    metaParts.push(`${project.model ? "项目模型" : "基础模型"} ${currentModel}`);
  }
  els.title.textContent = getProjectDisplayName(project);
  els.meta.textContent = metaParts.join(" · ");
}

function syncLocalProjectPreviewFromFields() {
  if (!state.activeId || !state.detail?.project) return;
  const draft = projectPayloadFromFields(els.fields);
  state.detail.project = {
    ...state.detail.project,
    ...draft,
    keywords: draft.keywords,
  };
  state.projects = state.projects.map((project) => project.id === state.activeId
    ? {
      ...project,
      name: draft.name,
      genre: draft.genre,
      theme: draft.theme,
      premise: draft.premise,
      targetChapters: draft.targetChapters,
      chapterWordTarget: draft.chapterWordTarget,
      qqReviewEnabled: draft.qqReviewEnabled,
    }
    : project);
  renderProjectList();
  renderProjectHeader();
}

function getProjectStatusLabel(project = {}) {
  return String(project?.status || "").trim().toLowerCase() === "draft" ? "鑽夌" : "宸插垱寤?";
}

function renderProjectList() {
  els.list.innerHTML = "";
  renderCurrentModelMeta();

  if (!state.projects.length) {
    els.listMeta.textContent = "当前还没有小说项目。";
    els.list.innerHTML = '<div class="file-empty">还没有小说项目。</div>';
    return;
  }

  const activeProject = state.projects.find((project) => project.id === state.activeId);
  els.listMeta.textContent = activeProject
    ? `共 ${state.projects.length} 个项目，当前选中：《${getProjectDisplayName(activeProject)}》`
    : `共 ${state.projects.length} 个项目。点击左侧项目卡片查看详情。`;

  state.projects.forEach((project) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `project-item ${project.id === state.activeId ? "active" : ""}`;
    item.innerHTML = [
      `<strong>${escapeHtml(getProjectDisplayName(project))}</strong>`,
      `<div class="muted">${escapeHtml(project.genre || "未设置题材")}</div>`,
      `<div class="muted">${escapeHtml(project.theme || "未设置主题")}</div>`,
      `<div class="muted">已通过 ${project.lastApprovedChapter || 0} 章 / 待审 ${project.pendingDraftChapter || 0}</div>`,
    ].join("");
    item.onclick = () => loadProject(project.id);
    els.list.append(item);
  });
}

function syncSettingActionButtons() {
  if (!els.generateCurrentSetting && !els.reconcileCurrentSetting) return;
  if (!els.generateCurrentSetting.dataset.defaultText) {
    els.generateCurrentSetting.dataset.defaultText = els.generateCurrentSetting.textContent || "鐢熸垚褰撳墠璁惧畾";
  }
  if (els.reconcileCurrentSetting && !els.reconcileCurrentSetting.dataset.defaultText) {
    els.reconcileCurrentSetting.dataset.defaultText = els.reconcileCurrentSetting.textContent || "鎸夋鏂囨暣鐞嗗綋鍓嶈瀹?";
  }
  if (!uiState.busy) {
    els.generateCurrentSetting.textContent = els.generateCurrentSetting.dataset.defaultText;
    if (els.reconcileCurrentSetting) {
      els.reconcileCurrentSetting.textContent = els.reconcileCurrentSetting.dataset.defaultText;
    }
  }
  const isBaseInfo = String(state.activeSetting || "").trim() === "base-info";
  els.generateCurrentSetting.disabled = isBaseInfo;
  els.generateCurrentSetting.title = isBaseInfo ? "鍩虹淇℃伅璇烽€氳繃淇濆瓨椤圭洰淇℃伅鏇存柊" : "";
  if (els.reconcileCurrentSetting) {
    els.reconcileCurrentSetting.disabled = isBaseInfo;
    els.reconcileCurrentSetting.title = isBaseInfo ? "鍩虹淇℃伅璇烽€氳繃淇濆瓨椤圭洰淇℃伅鏇存柊" : "";
  }
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
  syncSettingActionButtons();
  setElementHidden(els.projectActions, true);
  setElementHidden(els.projectContent, true);
  setElementHidden(els.emptyState, false);
}

function getProjectStatusLabel(project = {}) {
  return String(project?.status || "").trim().toLowerCase() === "draft" ? "草稿" : "已创建";
}

function renderProjectHeader(detail = state.detail) {
  if (!detail?.project) return;
  const project = detail.project;
  const projectState = detail.state || {};
  const metaParts = [
    `状态：${getProjectStatusLabel(project)}`,
    project.genre || "未设题材",
    project.theme ? `主题：${project.theme}` : "",
    `已通过 ${projectState.lastApprovedChapter || 0} 章`,
    `待审 ${projectState.pendingDraftChapter || 0}`,
  ].filter(Boolean);
  const currentModel = getActiveProjectModelLabel(project);
  if (currentModel) {
    metaParts.push(`${project.model ? "项目模型" : "基础模型"} ${currentModel}`);
  }
  els.title.textContent = getProjectDisplayName(project);
  els.meta.textContent = metaParts.join(" · ");
}

function renderProjectList() {
  els.list.innerHTML = "";
  renderCurrentModelMeta();

  if (!state.projects.length) {
    els.listMeta.textContent = "当前还没有小说项目。";
    els.list.innerHTML = '<div class="file-empty">还没有小说项目。</div>';
    return;
  }

  const activeProject = state.projects.find((project) => project.id === state.activeId);
  els.listMeta.textContent = activeProject
    ? `共 ${state.projects.length} 个项目，当前选中：《${getProjectDisplayName(activeProject)}》。`
    : `共 ${state.projects.length} 个项目。点击左侧项目卡片查看详情。`;

  state.projects.forEach((project) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `project-item ${project.id === state.activeId ? "active" : ""}`;
    item.innerHTML = [
      `<strong>${escapeHtml(getProjectDisplayName(project))}</strong>`,
      `<div class="muted">状态：${escapeHtml(getProjectStatusLabel(project))}</div>`,
      `<div class="muted">${escapeHtml(project.genre || "未设题材")}</div>`,
      `<div class="muted">${escapeHtml(project.theme || "未设主题")}</div>`,
      `<div class="muted">已通过 ${project.lastApprovedChapter || 0} 章 / 待审 ${project.pendingDraftChapter || 0}</div>`,
    ].join("");
    item.onclick = () => loadProject(project.id);
    els.list.append(item);
  });
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
  renderProjectHeader(detail);
  setStatusBar(`已选中《${getProjectDisplayName(project)}》。你现在可以编辑项目信息、设定文件和章节内容。`);

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

  renderChapterList(chapters || []);
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

function renderProjectDetail(detail) {
  state.detail = detail;
  state.activeId = detail.project.id;
  const { project, state: projectState, review, chapters, settings } = detail;
  state.settings = settings;

  setElementHidden(els.emptyState, true);
  setElementHidden(els.projectContent, false);
  setElementHidden(els.projectActions, false);
  renderProjectList();
  renderProjectHeader(detail);
  els.generateSettings.textContent = "生成设定";
  setStatusBar(
    project.status === "draft"
      ? `已选中《${getProjectDisplayName(project)}》草稿。你可以先继续补全信息，准备好后再生成设定。`
      : `已选中《${getProjectDisplayName(project)}》。你现在可以编辑项目信息、设定文件和章节内容。`,
  );

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
  syncSettingActionButtons();
  loadSetting(state.activeSetting).catch((error) => {
    setStatusBar(error.message, "error");
    els.settingEditor.value = "";
  });

  renderChapterList(chapters || []);
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

async function loadProject(projectId) {
  state.activeId = projectId;
  renderProjectList();
  const detail = await j(`/novels/projects/${encodeURIComponent(projectId)}`);
  renderProjectDetail(detail);
}

async function loadSetting(key) {
  const projectId = requireActiveProject("查看设定");
  state.activeSetting = key;
  syncSettingActionButtons();
  const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/settings/${encodeURIComponent(key)}`);
  els.settingEditor.value = data.content || "";
  syncSettingActionButtons();
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
  syncSettingActionButtons();
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
  saveModelForNovelPage(payload.model);
  state.currentModel = payload.model;
  renderCurrentModelMeta();
  return data;
}

async function createProject() {
  const payload = projectPayloadFromFields(els.newFields);
  return await createProjectFromPayload(payload, {
    closeDialog: true,
    triggerButton: els.confirmCreate,
  });
}

async function createProjectFromPayload(payload, options = {}) {
  if (!payload.name) {
    throw new Error("请填写项目名称");
  }

  if (!payload.model) {
    throw new Error("请先为小说项目选择模型。小说项目不会使用聊天页模型。");
  }

  const operationConfig = options.operationConfig || OPERATION_CONFIGS.create;
  const idleState = options.idleState || WORKSPACE_STATES.created;

  const data = await runWithOperation(operationConfig, options.triggerButton || null, async () => {
    const created = await j("/novels/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.activeId = "";
    await refreshProjects({ autoSelect: false, idleState });
    return created;
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

async function createDraftProject() {
  const payload = {
    ...projectPayloadFromFields(els.newFields),
    autoGenerateSettings: false,
  };
  return await createProjectFromPayload(payload, {
    closeDialog: true,
    triggerButton: els.saveCreateDraft,
    operationConfig: OPERATION_CONFIGS.saveDraft,
    idleState: WORKSPACE_STATES.draftCreated,
  });
}

function applyProjectFields(source, fields = {}) {
  if (!source || !fields) return;
  const fieldText = (value) => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => fieldText(item)).filter(Boolean).join("\n");
    }
    if (typeof value === "object") {
      return Object.entries(value)
        .map(([key, item]) => {
          const text = fieldText(item);
          return text ? `${key}：${text}` : "";
        })
        .filter(Boolean)
        .join("\n");
    }
    return "";
  };
  Object.entries(fields).forEach(([key, value]) => {
    const input = source[key];
    if (!input) return;
    if (key === "keywords" && Array.isArray(value)) {
      input.value = value.join(", ");
      return;
    }
    if (key === "qqReviewEnabled") {
      input.value = value ? "true" : "false";
      return;
    }
    input.value = fieldText(value);
  });
}

function preserveBriefInNotes(notesInput, brief = "") {
  if (!notesInput) return;
  const normalizedBrief = String(brief || "").trim();
  if (!normalizedBrief) return;
  const currentNotes = String(notesInput.value || "").trim();
  if (currentNotes.includes(normalizedBrief)) return;
  const originalSection = `原始构想：\n${normalizedBrief}`;
  notesInput.value = currentNotes ? `${currentNotes}\n\n${originalSection}` : originalSection;
}

async function inferProjectFromBrief() {
  const brief = String(els.newFields.brief?.value || "").trim();
  if (!brief) {
    throw new Error("请先填写一句话或一段话构想");
  }
  const model = els.newFields.model?.value?.trim() || state.currentModel || "";
  if (!model) {
    throw new Error("请先选择小说项目模型。拆解项目信息不会使用聊天页模型。");
  }
  const data = await runWithOperation(OPERATION_CONFIGS.saveDraft, els.inferProject, async () => {
    return await j("/novels/infer-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief,
        model,
      }),
    });
  });
  applyProjectFields(els.newFields, data.fields || {});
  saveModelForNovelPage(model);
  state.currentModel = model;
  renderCurrentModelMeta();
  preserveBriefInNotes(els.newFields.notes, brief);
  setStatusBar("已根据构想拆解项目信息，可以继续微调后创建。", "success");
  return data;
}

async function saveProject() {
  const projectId = requireActiveProject("保存项目");
  const payload = projectPayloadFromFields(els.fields);
  if (!payload.model) {
    throw new Error("请先为小说项目选择模型。小说项目不会使用聊天页模型。");
  }
  return await runWithOperation(OPERATION_CONFIGS.save, els.saveProject, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    saveModelForNovelPage(payload.model);
    state.currentModel = payload.model;
    renderCurrentModelMeta();
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

async function generateCurrentSetting() {
  const projectId = requireActiveProject("鐢熸垚褰撳墠璁惧畾");
  const key = String(state.activeSetting || "").trim() || "base-info";
  if (key === "base-info") {
    throw new Error("鍩虹淇℃伅鐢遍」鐩瓧娈佃嚜鍔ㄧ敓鎴愶紝璇蜂慨鏀归」鐩俊鎭悗鐐瑰嚮鈥滀繚瀛樷€濄€?");
  }
  await runWithOperation(OPERATION_CONFIGS.generateCurrentSetting, els.generateCurrentSetting, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/settings/${encodeURIComponent(key)}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite: true }),
    });
    await loadProject(projectId);
  });
}

async function reconcileCurrentSetting() {
  const projectId = requireActiveProject("鎸夋鏂囨暣鐞嗗綋鍓嶈瀹?");
  const key = String(state.activeSetting || "").trim() || "base-info";
  if (key === "base-info") {
    throw new Error("閸╄櫣顢呮穱鈩冧紖閻㈤亶銆嶉惄顔肩摟濞堜絻鍤滈崝銊ф晸閹存劧绱濈拠铚傛叏閺€褰掋€嶉惄顔讳繆閹垰鎮楅悙鐟板毊閳ユ粈绻氱€涙ǚ鈧縿鈧?");
  }
  await runWithOperation(OPERATION_CONFIGS.reconcileCurrentSetting, els.reconcileCurrentSetting, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/settings/${encodeURIComponent(key)}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite: true }),
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

async function exportChaptersMarkdown() {
  const projectId = requireActiveProject("导出正文合集");
  return await runWithOperation(OPERATION_CONFIGS.saveDraft, els.exportChapters, async () => {
    const data = await j(`/novels/projects/${encodeURIComponent(projectId)}/export/markdown`);
    downloadTextFile(data.fileName || "正文合集.md", data.content || "");
    setStatusBar(`已导出 ${data.chapterCount || 0} 章正文合集`, "success");
    return data;
  });
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

function bindLiveProjectFieldSync() {
  Object.values(els.fields).forEach((input) => {
    if (!input) return;
    const syncPreview = () => syncLocalProjectPreviewFromFields();
    input.oninput = syncPreview;
    input.onchange = syncPreview;
  });
}

function mountNovelBackgroundDialogContent() {
  if (!els.novelBackgroundDialogBody || !els.novelBackgroundCard) return;
  if (els.novelBackgroundCard.parentElement === els.novelBackgroundDialogBody) return;
  els.novelBackgroundCard.classList.add("novel-background-modal-card");
  els.novelBackgroundDialogBody.append(els.novelBackgroundCard);
}

function openNovelBackgroundDialog() {
  mountNovelBackgroundDialogContent();
  if (els.novelBackgroundDialog?.open) return;
  els.novelBackgroundDialog?.showModal();
}

function closeNovelBackgroundDialog() {
  if (!els.novelBackgroundDialog?.open) return false;
  els.novelBackgroundDialog.close("dismiss");
  return true;
}

async function openCreateDialog() {
  if (isOperationBusy() || els.dialog?.open) return;
  if (els.newFields.model) {
    els.newFields.model.value = "";
    els.newFields.model.disabled = true;
  }
  els.dialog.showModal();
  await loadAvailableModelsForNovelPage({ force: true });
  if (els.newFields.model) {
    els.newFields.model.disabled = false;
    if (els.newFields.model.tagName !== "SELECT" && !els.newFields.model.value.trim()) {
      els.newFields.model.value = state.currentModel || getSavedModelForNovelPage();
    }
  }
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

els.createProject.onclick = () => openCreateDialog().catch((error) => {
  setStatusBar(error?.message || "读取模型列表失败", "error");
});
els.emptyCreateProject.onclick = () => openCreateDialog().catch((error) => {
  setStatusBar(error?.message || "读取模型列表失败", "error");
});
els.closeCreateDialog.onclick = requestCloseCreateDialog;
els.cancelCreate.onclick = requestCloseCreateDialog;
els.dialog.oncancel = requestCloseCreateDialog;
Object.assign(WORKSPACE_STATES.empty, {
  meta: "请先新建项目，创建后点击左侧项目查看详情。",
  status: "请先新建项目。创建完成后，从左侧点击项目开始编辑。",
  emptyTitle: "请新建项目",
  emptyBody: "当前还没有小说项目。先点击左侧“新建项目”，创建完成后再从左侧选择项目，右侧才会显示项目信息、设定文件和章节内容。",
});
Object.assign(WORKSPACE_STATES.idle, {
  meta: "请选择左侧项目查看详情。",
  status: "请点击左侧项目查看详情，右侧将显示项目信息、设定文件和章节内容。",
  emptyTitle: "请选择左侧项目",
  emptyBody: "项目已经创建完成。点击左侧项目卡片后，右侧才会显示项目信息、设定文件和章节内容。",
});
Object.assign(WORKSPACE_STATES.created, {
  meta: "项目已创建，请点击左侧项目查看详情。",
  status: "项目已创建。现在请从左侧点击项目，右侧才会展示完整内容。",
  emptyTitle: "项目已创建",
  emptyBody: "新项目已经准备好了。请从左侧点击刚创建的项目卡片，继续编辑项目信息、设定文件和章节内容。",
});
Object.assign(WORKSPACE_STATES.draftCreated, {
  meta: "草稿已保存，请从左侧选择项目继续完善。",
  status: "草稿项目已经保存。请从左侧点击该项目，继续补充项目信息、设定和章节规划。",
  emptyTitle: "草稿已保存",
  emptyBody: "草稿项目已经保存成功。你可以从左侧点击这个项目，继续填写资料、保存设定或开始生成内容。",
});
Object.assign(WORKSPACE_STATES.deleted, {
  meta: "项目已删除，请重新从左侧选择项目。",
  status: "项目已删除。请从左侧选择其他项目，或新建项目继续。",
  emptyTitle: "项目已删除",
  emptyBody: "当前工作区已回到初始状态。你可以从左侧选择其他项目，或点击“新建项目”继续创建新的小说项目。",
});

Object.assign(OPERATION_CONFIGS.create, {
  title: "正在创建项目",
  buttonText: "创建中...",
  successTitle: "创建完成",
  successHint: "项目已创建，请点击左侧项目查看详情。",
  errorTitle: "创建失败",
  stages: [
    { progress: 8, hint: "正在保存项目信息..." },
    { progress: 38, hint: "正在生成基础设定，这一步可能需要一点时间..." },
    { progress: 72, hint: "正在整理项目列表..." },
  ],
});
Object.assign(OPERATION_CONFIGS.saveDraft, {
  title: "正在保存草稿项目",
  buttonText: "保存中...",
  successTitle: "草稿已保存",
  successHint: "草稿项目已保存，可以稍后继续完善。",
  errorTitle: "保存草稿失败",
  stages: [
    { progress: 8, hint: "正在保存草稿项目信息..." },
    { progress: 42, hint: "正在整理草稿内容..." },
    { progress: 72, hint: "正在刷新项目列表..." },
  ],
});
Object.assign(OPERATION_CONFIGS.save, {
  title: "正在保存项目",
  buttonText: "保存中...",
  successTitle: "保存完成",
  successHint: "已刷新为最新的项目内容。",
  errorTitle: "保存失败",
  stages: [
    { progress: 14, hint: "正在提交最新修改..." },
    { progress: 52, hint: "正在刷新项目详情..." },
    { progress: 76, hint: "马上就好..." },
  ],
});
Object.assign(OPERATION_CONFIGS.saveSetting, {
  title: "正在保存设定",
  buttonText: "保存中...",
  successTitle: "设定已保存",
  successHint: "当前设定内容已经刷新为最新版本。",
  errorTitle: "保存设定失败",
  stages: [
    { progress: 16, hint: "正在提交当前设定..." },
    { progress: 48, hint: "正在刷新设定内容..." },
    { progress: 74, hint: "正在同步项目状态..." },
  ],
});
Object.assign(OPERATION_CONFIGS.generateCurrentSetting, {
  title: "正在生成当前设定",
  buttonText: "生成中...",
  successTitle: "当前设定已生成",
  successHint: "当前设定文件已经刷新为最新生成结果。",
  errorTitle: "生成当前设定失败",
  stages: [
    { progress: 12, hint: "正在分析当前选中的设定..." },
    { progress: 44, hint: "正在生成当前设定内容..." },
    { progress: 74, hint: "正在刷新设定编辑区..." },
  ],
});
Object.assign(OPERATION_CONFIGS.reconcileCurrentSetting, {
  title: "正在按正文整理当前设定",
  buttonText: "整理中...",
  successTitle: "当前设定已按正文整理",
  successHint: "当前设定文件已经根据正文内容完成整理。",
  errorTitle: "按正文整理当前设定失败",
  stages: [
    { progress: 12, hint: "正在读取已写章节与当前设定..." },
    { progress: 44, hint: "正在按正文整理当前设定..." },
    { progress: 74, hint: "正在刷新设定编辑区..." },
  ],
});
Object.assign(OPERATION_CONFIGS.generateSettings, {
  title: "正在重新生成设定",
  buttonText: "生成中...",
  successTitle: "设定生成完成",
  successHint: "设定文件已经更新为最新生成结果。",
  errorTitle: "生成设定失败",
  stages: [
    { progress: 10, hint: "正在分析当前项目信息..." },
    { progress: 36, hint: "正在生成新的设定文件..." },
    { progress: 68, hint: "正在整理并刷新设定列表..." },
  ],
});
Object.assign(OPERATION_CONFIGS.reconcileSettings, {
  title: "正在按已写章节整理设定",
  buttonText: "整理中...",
  successTitle: "设定整理完成",
  successHint: "设定文件已根据已写章节重新对齐。",
  errorTitle: "整理设定失败",
  stages: [
    { progress: 10, hint: "正在读取已写章节与当前设定..." },
    { progress: 36, hint: "正在根据既成正文整理设定文件..." },
    { progress: 68, hint: "正在刷新设定内容..." },
  ],
});
Object.assign(OPERATION_CONFIGS.batchGenerate, {
  title: "正在连续写作",
  buttonText: "写作中...",
  successTitle: "连续写作完成",
  successHint: "章节结果已刷新，可以继续查看最新草稿。",
  errorTitle: "连续写作失败",
  stages: [
    { progress: 12, hint: "正在提交连续写作请求..." },
    { progress: 34, hint: "正在按顺序生成章节内容..." },
    { progress: 66, hint: "正在整理最新章节与草稿..." },
  ],
});
Object.assign(OPERATION_CONFIGS.generateChapter, {
  title: "正在生成下一章",
  buttonText: "生成中...",
  successTitle: "下一章已生成",
  successHint: "最新草稿已载入到右侧章节区。",
  errorTitle: "生成章节失败",
  stages: [
    { progress: 12, hint: "正在准备章节上下文..." },
    { progress: 44, hint: "正在生成下一章草稿..." },
    { progress: 72, hint: "正在刷新章节列表..." },
  ],
});
Object.assign(OPERATION_CONFIGS.approveChapter, {
  title: "正在通过待审章节",
  buttonText: "处理中...",
  successTitle: "章节已通过",
  successHint: "待审章节已经转为正式章节。",
  errorTitle: "通过章节失败",
  stages: [
    { progress: 18, hint: "正在提交通过操作..." },
    { progress: 54, hint: "正在刷新章节状态..." },
    { progress: 78, hint: "马上完成..." },
  ],
});
Object.assign(OPERATION_CONFIGS.rewriteChapter, {
  title: "正在重写章节",
  buttonText: "重写中...",
  successTitle: "章节已重写",
  successHint: "新的待审草稿已经准备好。",
  errorTitle: "重写章节失败",
  stages: [
    { progress: 14, hint: "正在提交重写意见..." },
    { progress: 42, hint: "正在重新生成章节内容..." },
    { progress: 74, hint: "正在刷新待审草稿..." },
  ],
});
Object.assign(OPERATION_CONFIGS.deleteChapter, {
  title: "正在删除章节并回退进度",
  buttonText: "删除中...",
  successTitle: "章节已删除",
  successHint: "已删除当前章节及后续内容，并同步回退写作进度。",
  errorTitle: "删除章节失败",
  stages: [
    { progress: 16, hint: "正在删除当前章节及后续文件..." },
    { progress: 48, hint: "正在回退章节进度与审阅状态..." },
    { progress: 76, hint: "正在刷新章节列表..." },
  ],
});
Object.assign(OPERATION_CONFIGS.readerGenerateNext, {
  title: "正在继续生成下一章",
  buttonText: "生成中...",
  successTitle: "下一章已生成",
  successHint: "新的章节草稿已经载入阅读器。",
  errorTitle: "继续生成失败",
  stages: [
    { progress: 10, hint: "正在检查待审章节状态..." },
    { progress: 36, hint: "正在自动通过上一章待审..." },
    { progress: 64, hint: "正在生成下一章草稿..." },
    { progress: 82, hint: "正在刷新阅读器内容..." },
  ],
});
Object.assign(OPERATION_CONFIGS.readerRegenerateChapter, {
  title: "正在重新生成当前章",
  buttonText: "重生成中...",
  successTitle: "当前章已重生成",
  successHint: "新的草稿已经载入阅读器。",
  errorTitle: "重新生成失败",
  stages: [
    { progress: 12, hint: "正在准备当前章节上下文..." },
    { progress: 46, hint: "正在重新生成当前章节..." },
    { progress: 76, hint: "正在刷新阅读器内容..." },
  ],
});

function syncSettingActionButtons() {
  if (!els.generateCurrentSetting && !els.reconcileCurrentSetting) return;
  if (!els.generateCurrentSetting.dataset.defaultText) {
    els.generateCurrentSetting.dataset.defaultText = els.generateCurrentSetting.textContent || "生成当前设定";
  }
  if (els.reconcileCurrentSetting && !els.reconcileCurrentSetting.dataset.defaultText) {
    els.reconcileCurrentSetting.dataset.defaultText = els.reconcileCurrentSetting.textContent || "按正文整理当前设定";
  }
  if (!uiState.busy) {
    els.generateCurrentSetting.textContent = els.generateCurrentSetting.dataset.defaultText;
    if (els.reconcileCurrentSetting) {
      els.reconcileCurrentSetting.textContent = els.reconcileCurrentSetting.dataset.defaultText;
    }
  }
  const isBaseInfo = String(state.activeSetting || "").trim() === "base-info";
  const disabledTitle = "基础信息请通过项目信息保存，不支持单独生成或整理。";
  els.generateCurrentSetting.disabled = isBaseInfo;
  els.generateCurrentSetting.title = isBaseInfo ? disabledTitle : "";
  if (els.reconcileCurrentSetting) {
    els.reconcileCurrentSetting.disabled = isBaseInfo;
    els.reconcileCurrentSetting.title = isBaseInfo ? disabledTitle : "";
  }
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
  syncSettingActionButtons();
  setElementHidden(els.projectActions, true);
  setElementHidden(els.projectContent, true);
  setElementHidden(els.emptyState, false);
}

function getProjectStatusLabel(project = {}) {
  return String(project?.status || "").trim().toLowerCase() === "draft" ? "草稿" : "已创建";
}

function renderProjectHeader(detail = state.detail) {
  if (!detail?.project) return;
  const project = detail.project;
  const projectState = detail.state || {};
  const metaParts = [
    `状态：${getProjectStatusLabel(project)}`,
    project.genre || "未设题材",
    project.theme ? `主题：${project.theme}` : "",
    `已通过 ${projectState.lastApprovedChapter || 0} 章`,
    `待审 ${projectState.pendingDraftChapter || 0}`,
  ].filter(Boolean);
  const currentModel = getActiveProjectModelLabel(project);
  if (currentModel) {
    metaParts.push(`${project.model ? "项目模型" : "基础模型"} ${currentModel}`);
  }
  els.title.textContent = getProjectDisplayName(project);
  els.meta.textContent = metaParts.join(" · ");
}

function renderProjectList() {
  els.list.innerHTML = "";
  renderCurrentModelMeta();

  if (!state.projects.length) {
    els.listMeta.textContent = "当前还没有小说项目。";
    els.list.innerHTML = '<div class="file-empty">还没有小说项目。</div>';
    return;
  }

  const activeProject = state.projects.find((project) => project.id === state.activeId);
  els.listMeta.textContent = activeProject
    ? `共 ${state.projects.length} 个项目，当前选中：《${getProjectDisplayName(activeProject)}》`
    : `共 ${state.projects.length} 个项目。点击左侧项目卡片查看详情。`;

  state.projects.forEach((project) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `project-item ${project.id === state.activeId ? "active" : ""}`;
    item.innerHTML = [
      `<strong>${escapeHtml(getProjectDisplayName(project))}</strong>`,
      `<div class="muted">状态：${escapeHtml(getProjectStatusLabel(project))}</div>`,
      `<div class="muted">${escapeHtml(project.genre || "未设题材")}</div>`,
      `<div class="muted">${escapeHtml(project.theme || "未设主题")}</div>`,
      `<div class="muted">已通过 ${project.lastApprovedChapter || 0} 章 / 待审 ${project.pendingDraftChapter || 0}</div>`,
    ].join("");
    item.onclick = () => loadProject(project.id);
    els.list.append(item);
  });
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

async function generateCurrentSetting() {
  const projectId = requireActiveProject("生成当前设定");
  const key = String(state.activeSetting || "").trim() || "base-info";
  if (key === "base-info") {
    throw new Error("基础信息由项目信息生成，请修改项目信息后保存项目。");
  }
  await runWithOperation(OPERATION_CONFIGS.generateCurrentSetting, els.generateCurrentSetting, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/settings/${encodeURIComponent(key)}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite: true }),
    });
    await loadProject(projectId);
  });
}

async function reconcileCurrentSetting() {
  const projectId = requireActiveProject("按正文整理当前设定");
  const key = String(state.activeSetting || "").trim() || "base-info";
  if (key === "base-info") {
    throw new Error("基础信息由项目信息生成，请修改项目信息后保存项目。");
  }
  await runWithOperation(OPERATION_CONFIGS.reconcileCurrentSetting, els.reconcileCurrentSetting, async () => {
    await j(`/novels/projects/${encodeURIComponent(projectId)}/settings/${encodeURIComponent(key)}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite: true }),
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

els.openNovelBackgroundDialog?.addEventListener("click", () => {
  if (isOperationBusy()) return;
  openNovelBackgroundDialog();
});
els.closeNovelBackgroundDialog?.addEventListener("click", () => closeNovelBackgroundDialog());
if (els.novelBackgroundDialog) {
  els.novelBackgroundDialog.oncancel = (event) => {
    if (event?.preventDefault) {
      event.preventDefault();
    }
    closeNovelBackgroundDialog();
  };
}
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
bindAsyncAction(els.saveCreateDraft, () => createDraftProject(), { preventDefault: true });
bindAsyncAction(els.inferProject, () => inferProjectFromBrief(), { preventDefault: true });
els.openChat.onclick = () => {
  if (isOperationBusy()) return;
  window.location.href = "/";
};
els.uploadNovelBackground?.addEventListener("click", () => {
  if (isOperationBusy()) return;
  els.novelBackgroundInput?.click();
});
els.clearNovelBackground?.addEventListener("click", () => {
  updateNovelPageBackgroundSetting({ image: "", softImage: "" });
  renderNovelBackgroundControls();
  setStatusBar("已恢复小说页默认背景");
});
els.novelBackgroundInput?.addEventListener("change", async (event) => {
  try {
    const [file] = Array.from(event?.target?.files || []);
    if (!file) return;
    if (file.size > MAX_BACKGROUND_SIZE) {
      throw new Error("背景图片不能超过 8MB");
    }
    updateNovelPageBackgroundSetting(await processBackgroundImageFile(file));
    renderNovelBackgroundControls();
    setStatusBar(`已更新小说页背景：${file.name}`);
  } catch (error) {
    setStatusBar(error?.message || "小说页背景上传失败。", "error");
  } finally {
    if (event?.target) {
      event.target.value = "";
    }
  }
});
els.novelBackgroundBlur?.addEventListener("input", () => {
  const blur = Number(els.novelBackgroundBlur.value || 0);
  renderNovelBackgroundControls({ blur });
  scheduleNovelPageBackgroundSettingSave({ blur });
});
els.novelBackgroundShellOpacity?.addEventListener("input", () => {
  const shellOpacity = Number(els.novelBackgroundShellOpacity.value || 70);
  renderNovelBackgroundControls({ shellOpacity });
  scheduleNovelPageBackgroundSettingSave({ shellOpacity });
});
bindAsyncAction(els.saveProject, () => saveProject());
bindAsyncAction(els.deleteProject, () => deleteProject());
bindAsyncAction(els.saveSetting, () => saveSetting());
bindAsyncAction(els.generateCurrentSetting, () => generateCurrentSetting());
bindAsyncAction(els.reconcileCurrentSetting, () => reconcileCurrentSetting());
els.settingSelect.onchange = () => loadSetting(els.settingSelect.value).catch((error) => alert(error.message));
bindAsyncAction(els.generateSettings, () => generateSettings());
bindAsyncAction(els.reconcileSettings, () => reconcileSettings());
bindAsyncAction(els.batchGenerate, () => batchGenerate());
bindAsyncAction(els.generateChapter, () => generateChapter());
bindAsyncAction(els.exportChapters, () => exportChaptersMarkdown());
bindAsyncAction(els.deleteChapter, () => deleteChapterAndProgress({
  triggerButton: els.deleteChapter,
}));
bindAsyncAction(els.approveChapter, () => approveChapter());
bindAsyncAction(els.rewriteChapter, () => rewriteChapter());
COLLAPSIBLE_SECTION_CONFIGS.forEach(bindCollapsibleSection);
bindLiveProjectFieldSync();
setReaderReviewExpanded(false);
hideOperationFeedback("workspace");
hideOperationFeedback("dialog");
hideOperationFeedback("reader");
mountNovelBackgroundDialogContent();
renderCurrentModelMeta();
renderNovelBackgroundControls();
loadAvailableModelsForNovelPage().catch(() => {});
syncCurrentModel({ quiet: true }).catch(() => {});

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("focus", () => {
    syncCurrentModel({ quiet: true }).catch(() => {});
  });
  window.addEventListener("storage", (event) => {
    if (event?.key && event.key !== SETTINGS_KEY) return;
    renderNovelBackgroundControls();
    const fallbackModel = getSavedModelForNovelPage();
    if (fallbackModel && fallbackModel !== state.currentModel) {
      state.currentModel = fallbackModel;
      renderCurrentModelMeta();
      if (state.detail?.project) {
        renderProjectHeader();
      }
    } else {
      renderCurrentModelMeta();
    }
    syncCurrentModel({ quiet: true }).catch(() => {});
  });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    syncCurrentModel({ quiet: true }).catch(() => {});
  });
}

refreshProjects({ autoSelect: false }).catch((error) => {
  setStatusBar(error.message, "error");
  els.meta.textContent = error.message;
});
