const SETTINGS_KEY = "local-ai-chat-settings";
const TOOL_ACTIVITY_CACHE_KEY = "local-ai-tool-activity-cache";
const PREVIEW_WIDTH_KEY = "local-ai-preview-width";
const SCHEDULED_TASK_DELIVERY_KEY = "local-ai-scheduled-task-delivery-state";
const SCHEDULED_TASK_POLL_MS = 30000;
const MAX_FILE_SIZE = 200 * 1024;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_FILE_CONTENT = 12000;
const MAX_TOOL_ROUNDS = 6;
const MODEL_HISTORY_LIMIT = 8;
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const PERSONA_PRESETS = [
  ["none", "不使用预设", "保留当前手写的人设内容，不自动覆盖。", ""],
  ["precise-assistant", "精准助手", "偏冷静、结构化，适合问答和分析。", "你是一名严谨、可靠、表达清晰的 AI 助手。\n优先保证事实准确，先给结论，再给关键依据。"],
  ["coding-mentor", "编程导师", "适合代码讲解、调试和排错。", "你是一名耐心、专业、擅长教学的编程导师型 AI。\n优先帮助用户完成任务，并主动指出潜在 bug。"],
  ["cyber-companion", "赛博伴侣", "更有氛围感，适合当前界面。", "你是一个带有赛博伙伴气质的智能搭档，语气冷静、敏锐、略带未来感。"],
  ["product-strategist", "产品经理", "适合需求梳理和方案比较。", "你是一名逻辑清晰、重视用户体验和业务目标的产品策略助手。"],
  ["gentle-companion", "温柔伴侣", "语气柔和，适合陪伴式交流。", "你是一名温柔、耐心、情绪稳定的陪伴型 AI。"],
].map(([id, name, description, prompt]) => ({ id, name, description, prompt }));
const TOOLS = ["list_dir", "read_file", "write_file", "delete_file"].map((name) => ({
  type: "function",
  function: { name, description: `Workspace tool: ${name}`, parameters: { type: "object", properties: {} } },
}));
TOOLS.push(
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city or location.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_clawhub_skills",
      description: "Search ClawHub skills first. If the user's request is vague, recommend hot non-suspicious skills from ClawHub downloads.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "install_clawhub_skill",
      description: "Install a confirmed ClawHub skill into the current workspace skills directory only after the user explicitly confirms download/install.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          name: { type: "string" },
          url: { type: "string" },
          clawhubUrl: { type: "string" },
          targetName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_qq_message",
      description: "Send a QQ message through a configured local OneBot or NapCat compatible HTTP bridge when the user explicitly asks to send or push to QQ.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          targetType: { type: "string", enum: ["private", "group"] },
          targetId: { type: "string" },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_scheduled_task",
      description: "Create a scheduled task only when the user explicitly asks to create/schedule an automatic recurring task.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          prompt: { type: "string" },
          model: { type: "string" },
          scheduleType: { type: "string", enum: ["cron"] },
          cronExpression: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["name", "prompt", "model"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_tasks",
      description: "List existing scheduled tasks.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_scheduled_task",
      description: "Update an existing scheduled task only when the user explicitly asks to modify, pause, resume, or change it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          prompt: { type: "string" },
          model: { type: "string" },
          scheduleType: { type: "string", enum: ["cron"] },
          cronExpression: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_scheduled_task",
      description: "Delete a scheduled task only when the user explicitly asks to remove it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_scheduled_task",
      description: "Run a scheduled task immediately when the user explicitly asks for it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
  }
);
const READ_ONLY_TOOL_NAMES = new Set(["list_dir", "read_file", "get_weather"]);
const WRITE_TOOL_NAMES = new Set(["write_file", "delete_file"]);
const SKILL_DISCOVERY_TOOL_NAMES = new Set(["search_clawhub_skills"]);
const SKILL_INSTALL_TOOL_NAMES = new Set(["install_clawhub_skill"]);
const SCHEDULER_TOOL_NAMES = new Set(["create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task", "run_scheduled_task"]);
const QQ_TOOL_NAMES = new Set(["send_qq_message"]);
let workspacePersonaPresets = [];

const state = { messages: [], files: [], skills: [], selectedSkill: null, activeSkill: null, settingBundle: null, sending: false, previewMaximized: false, toolActivities: [] };
const $ = (s) => document.querySelector(s);
const els = {
  chatForm: $("#chat-form"), chatMessages: $("#chat-messages"), userInput: $("#user-input"), sendButton: $("#send-button"),
  statusBar: $("#status-bar"), baseUrl: $("#base-url"), apiPath: $("#api-path"), modelSelect: $("#model-select"),
  assistantName: $("#assistant-name"), userName: $("#user-name"), systemPrompt: $("#system-prompt"), contextLimit: $("#context-limit"),
  qqPushEnabled: $("#qq-push-enabled"), qqBridgeUrl: $("#qq-bridge-url"), qqAccessToken: $("#qq-access-token"), qqTargetType: $("#qq-target-type"), qqTargetId: $("#qq-target-id"), qqPushMeta: $("#qq-push-meta"), testQqPush: $("#test-qq-push"),
  qqBotEnabled: $("#qq-bot-enabled"), qqBotGroupMentionOnly: $("#qq-bot-group-mention-only"), qqTaskPushEnabled: $("#qq-task-push-enabled"), qqBotTriggerPrefix: $("#qq-bot-trigger-prefix"), qqBotAllowedUsers: $("#qq-bot-allowed-users"), qqBotAllowedGroups: $("#qq-bot-allowed-groups"), qqBotPersona: $("#qq-bot-persona"), qqBotPersonaPreset: $("#qq-bot-persona-preset"), qqBotPersonaPresetDescription: $("#qq-bot-persona-preset-description"), qqBotPersonaFileInput: $("#qq-bot-persona-file-input"), importQqBotPersona: $("#import-qq-bot-persona"), exportQqBotPersona: $("#export-qq-bot-persona"), clearQqBotPersona: $("#clear-qq-bot-persona"), qqBotMeta: $("#qq-bot-meta"), qqBotModelSelect: $("#qq-bot-model-select"),
  assistantAvatarInput: $("#assistant-avatar-input"), userAvatarInput: $("#user-avatar-input"),
  uploadAssistantAvatar: $("#upload-assistant-avatar"), uploadUserAvatar: $("#upload-user-avatar"),
  clearAssistantAvatar: $("#clear-assistant-avatar"), clearUserAvatar: $("#clear-user-avatar"),
  assistantAvatarPreview: $("#assistant-avatar-preview"), userAvatarPreview: $("#user-avatar-preview"),
  metricContextChars: $("#metric-context-chars-chip"), metricEstimatedPrompt: $("#metric-est-prompt-chip"), metricTotal: $("#metric-total-chip"), metricSpeed: $("#metric-speed-chip"),
  metricContextUsage: $("#metric-context-usage-chip"), usageBarFill: $("#usage-bar-fill"), modelSelectionMeta: $("#model-selection-meta"),
  fileInput: $("#file-input"), fileList: $("#file-list"), composerFiles: $("#composer-files"), clearFiles: $("#clear-files"), attachFilesInline: $("#attach-files-inline"),
  clearChat: $("#clear-chat"), deleteChatSession: $("#delete-chat-session"), testConnection: $("#test-connection"), loadModels: $("#load-models"),
  personaPrompt: $("#persona-prompt"), personaPreset: $("#persona-preset"), personaPresetDescription: $("#persona-preset-description"),
  applyPersonaPreset: $("#apply-persona-preset"), importPersona: $("#import-persona"), exportPersona: $("#export-persona"), clearPersona: $("#clear-persona"), personaFileInput: $("#persona-file-input"),
  importSettingFolder: $("#import-setting-folder"), clearSettingFolder: $("#clear-setting-folder"), settingFolderInput: $("#setting-folder-input"), settingFolderSummary: $("#setting-folder-summary"), settingFolderPreview: $("#setting-folder-preview"),
  loadSkills: $("#load-skills"), applySkill: $("#apply-skill"), disableSkill: $("#disable-skill"), skillsList: $("#skills-list"), skillPreview: $("#skill-preview"),
  toolActivityTrigger: $("#tool-activity-trigger"), toolActivitySummary: $("#tool-activity-summary"), toolActivityList: $("#tool-activity-list"), toolActivityStatus: $("#tool-activity-status"),
  toolActivityModal: $("#tool-activity-modal"), toolActivityBackdrop: $("#tool-activity-backdrop"), toolActivityClose: $("#tool-activity-close"),
  workspaceBody: $(".workspace-body"), previewPanel: $("#preview-panel"), previewResizer: $("#preview-resizer"), previewFrame: $("#preview-frame"), previewEmpty: $("#preview-empty"),
  togglePreviewSize: $("#toggle-preview-size"), closePreview: $("#close-preview"),
};

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const endpoint = (path, base = (els.baseUrl?.value.trim() || location.origin)) => new URL(path, `${base}/`).toString();
const chatEndpoint = () => endpoint(els.apiPath?.value.trim() || "/api/v1/chat/completions");
const modelsEndpoint = () => endpoint("/api/v1/models");
const selectedModel = () => els.modelSelect?.value?.trim() || "";
const roleName = (r) => r === "user" ? (els.userName?.value.trim() || "文远") : r === "assistant" ? (els.assistantName?.value.trim() || "繁星") : "系统";
const formatBytes = (n) => !n ? "0 B" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const setStatus = (t) => { if (els.statusBar) els.statusBar.textContent = t; };
const spark = (b) => { if (!b) return; b.classList.remove("is-sparking"); void b.offsetWidth; b.classList.add("is-sparking"); setTimeout(() => b.classList.remove("is-sparking"), 400); };
const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
  reader.readAsDataURL(file);
});

function hasExplicitLocalSaveIntent(text = "") {
  const normalized = String(text).toLowerCase();
  const keywords = [
    "保存到本地",
    "保存本地",
    "写入本地",
    "写到本地",
    "保存成文件",
    "写入文件",
    "落盘",
    "保存到文件",
    "帮我保存",
    "create file",
    "write file",
    "save to local",
    "save locally",
    "save to file",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function isAffirmativeConfirmation(text = "") {
  const normalized = String(text).trim().toLowerCase();
  if (!normalized) return false;
  const keywords = [
    "是",
    "好的",
    "确认",
    "可以",
    "继续",
    "执行",
    "确认执行",
    "确认删除",
    "yes",
    "ok",
    "okay",
    "confirm",
    "proceed",
  ];
  return keywords.includes(normalized);
}

function lastAssistantAskedForWriteConfirmation() {
  const lastAssistantMessage = [...state.messages].reverse().find((message) => message.role === "assistant" && typeof message.content === "string");
  if (!lastAssistantMessage?.content) return false;
  const normalized = lastAssistantMessage.content.toLowerCase();
  const confirmationHints = [
    "确认后执行",
    "回复“是”",
    "回复是",
    "回复“确认”",
    "回复确认",
    "是否继续",
    "永久删除",
    "无法恢复",
    "写入文件",
    "保存到本地",
  ];
  return confirmationHints.some((hint) => normalized.includes(hint));
}

function canUseWriteTools(userText = "") {
  return hasExplicitLocalSaveIntent(userText) || (isAffirmativeConfirmation(userText) && lastAssistantAskedForWriteConfirmation());
}

function hasExplicitSchedulerIntent(text = "") {
  const normalized = String(text).toLowerCase();
  const keywords = [
    "定时任务",
    "定时",
    "每天",
    "每周",
    "每月",
    "cron",
    "提醒我",
    "自动执行",
    "周期执行",
    "创建任务",
    "schedule",
    "scheduled task",
    "every day",
    "every morning",
    "every week",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function hasExplicitQqIntent(text = "") {
  const normalized = String(text).toLowerCase();
  const keywords = [
    "qq",
    "发送到qq",
    "推送到qq",
    "发到qq",
    "qq提醒",
    "qq消息",
    "send to qq",
    "send qq",
    "push to qq",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function getQqPushSettings() {
  const persisted = saved();
  return {
    enabled: Boolean(els.qqPushEnabled?.checked ?? persisted.qqPushEnabled),
    bridgeUrl: els.qqBridgeUrl?.value?.trim() || persisted.qqBridgeUrl || "",
    accessToken: els.qqAccessToken?.value?.trim() || persisted.qqAccessToken || "",
    targetType: els.qqTargetType?.value || persisted.qqTargetType || "private",
    targetId: els.qqTargetId?.value?.trim() || persisted.qqTargetId || "",
  };
}

function isQqPushConfigured() {
  const config = getQqPushSettings();
  return Boolean(config.enabled && config.bridgeUrl && config.targetId);
}

function renderQqPushMeta() {
  if (!els.qqPushMeta) return;
  const config = getQqPushSettings();
  if (!config.enabled) {
    els.qqPushMeta.textContent = "当前未配置 QQ 推送。";
    return;
  }
  const readiness = config.bridgeUrl && config.targetId ? "已就绪" : "配置未完成";
  const targetText = config.targetType === "group" ? "群聊" : "私聊";
  els.qqPushMeta.textContent = `QQ 推送${readiness} · ${targetText} · ${config.targetId || "未填写目标 ID"}`;
}

function getQqBotSettings() {
  const persisted = saved();
  return {
    enabled: Boolean(els.qqBotEnabled?.checked ?? persisted.qqBotEnabled),
    groupMentionOnly: Boolean(els.qqBotGroupMentionOnly?.checked ?? persisted.qqBotGroupMentionOnly ?? true),
    taskPushEnabled: Boolean(els.qqTaskPushEnabled?.checked ?? persisted.qqTaskPushEnabled),
    model: els.qqBotModelSelect?.value?.trim() || persisted.qqBotModel || "",
    triggerPrefix: els.qqBotTriggerPrefix?.value?.trim() || persisted.qqBotTriggerPrefix || "",
    allowedUsers: els.qqBotAllowedUsers?.value || persisted.qqBotAllowedUsers || "",
    allowedGroups: els.qqBotAllowedGroups?.value || persisted.qqBotAllowedGroups || "",
    persona: els.qqBotPersona?.value || persisted.qqBotPersona || "",
  };
}

function renderQqBotMeta() {
  if (!els.qqBotMeta) return;
  const config = getQqBotSettings();
  if (!config.enabled) {
    els.qqBotMeta.textContent = "当前未启用 QQ 机器人自动回复。";
    return;
  }
  const prefixText = config.triggerPrefix ? ` · 前缀：${config.triggerPrefix}` : "";
  const taskPushText = config.taskPushEnabled ? " · 定时任务推送已开启" : "";
  els.qqBotMeta.textContent = `QQ 机器人已启用 · 群聊模式：${config.groupMentionOnly ? "仅 @ 时回复" : "允许直接回复"}${prefixText}${taskPushText}`;
}

function renderQqBotPersonaPresetDescription() {
  if (!els.qqBotPersonaPresetDescription) return;
  const presetId = els.qqBotPersonaPreset?.value || "none";
  els.qqBotPersonaPresetDescription.textContent = presetById(presetId).description || "选择模板后会立即应用到 QQ 机器人专属人设。";
}

function renderQqBotPersonaPresets() {
  if (!els.qqBotPersonaPreset) return;
  const nodes = [];
  const builtInGroup = document.createElement("optgroup");
  builtInGroup.label = "内置模板";
  builtInGroup.append(...PERSONA_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    return option;
  }));
  nodes.push(builtInGroup);

  if (workspacePersonaPresets.length) {
    const workspaceGroup = document.createElement("optgroup");
    workspaceGroup.label = "工作区人设";
    workspaceGroup.append(...workspacePersonaPresets.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      return option;
    }));
    nodes.push(workspaceGroup);
  }

  const persistedValue = saved().qqBotPersonaPreset || "none";
  const currentValue = els.qqBotPersonaPreset.value || persistedValue || "none";
  const optionValues = ["none", ...PERSONA_PRESETS.map((preset) => preset.id), ...workspacePersonaPresets.map((preset) => preset.id)];
  els.qqBotPersonaPreset.replaceChildren(...nodes);
  els.qqBotPersonaPreset.value = optionValues.includes(currentValue) ? currentValue : "none";
  renderQqBotPersonaPresetDescription();
}

function hasSkillDiscoveryIntent(text = "") {
  const normalized = String(text).toLowerCase();
  const keywords = [
    "技能",
    "skill",
    "skills",
    "clawhub",
    "下载技能",
    "安装技能",
    "推荐技能",
    "找技能",
    "热门技能",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function lastAssistantAskedForSkillInstallConfirmation() {
  const lastAssistantMessage = [...state.messages].reverse().find((message) => message.role === "assistant" && typeof message.content === "string");
  if (!lastAssistantMessage?.content) return false;
  const normalized = lastAssistantMessage.content.toLowerCase();
  const hints = [
    "确认下载",
    "确认安装",
    "安装到当前 skills",
    "要我下载哪一个技能",
    "请选择要安装的技能",
    "告诉我安装哪一个",
  ];
  return hints.some((hint) => normalized.includes(hint));
}

function canInstallSkillTools(userText = "") {
  const normalized = String(userText).toLowerCase();
  const explicitKeywords = [
    "下载这个技能",
    "安装这个技能",
    "下载技能",
    "安装技能",
    "确认下载",
    "确认安装",
    "下载到 skills",
    "安装到 skills",
    "install this skill",
    "download this skill",
  ];
  const hasVerbAndSkill = (
    ((normalized.includes("下载") || normalized.includes("安装")) && normalized.includes("技能")) ||
    ((normalized.includes("download") || normalized.includes("install")) && normalized.includes("skill"))
  );
  return explicitKeywords.some((keyword) => normalized.includes(keyword)) || hasVerbAndSkill || (isAffirmativeConfirmation(userText) && lastAssistantAskedForSkillInstallConfirmation());
}

function getAllowedToolsForUserText(userText = "") {
  const allowWrite = canUseWriteTools(userText);
  const allowScheduler = hasExplicitSchedulerIntent(userText);
  const allowQqPush = hasExplicitQqIntent(userText) && isQqPushConfigured();
  const allowSkillDiscovery = hasSkillDiscoveryIntent(userText);
  const allowSkillInstall = canInstallSkillTools(userText);
  return TOOLS.filter((tool) => {
    const name = tool.function.name;
    if (READ_ONLY_TOOL_NAMES.has(name)) return true;
    if (WRITE_TOOL_NAMES.has(name)) return allowWrite;
    if (QQ_TOOL_NAMES.has(name)) return allowQqPush;
    if (SKILL_DISCOVERY_TOOL_NAMES.has(name)) return allowSkillDiscovery;
    if (SKILL_INSTALL_TOOL_NAMES.has(name)) return allowSkillInstall;
    if (SCHEDULER_TOOL_NAMES.has(name)) return allowScheduler;
    return false;
  });
}

function saved() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } }
function getResizableTextareaState() {
  return {
    systemPromptHeight: els.systemPrompt ? els.systemPrompt.style.height || "" : "",
    personaPromptHeight: els.personaPrompt ? els.personaPrompt.style.height || "" : "",
  };
}
function applyResizableTextareaState(state = {}) {
  if (els.systemPrompt && state.systemPromptHeight) {
    els.systemPrompt.style.height = state.systemPromptHeight;
  }
  if (els.personaPrompt && state.personaPromptHeight) {
    els.personaPrompt.style.height = state.personaPromptHeight;
  }
}
function getAvatarSettings() {
  const s = saved();
  return {
    assistantAvatar: s.assistantAvatar || "",
    userAvatar: s.userAvatar || "",
  };
}
function initialsForRole(role) {
  const raw = role === "assistant" ? (els.assistantName?.value || "AI") : (els.userName?.value || "我");
  return String(raw).trim().slice(0, 2) || (role === "assistant" ? "AI" : "我");
}
function renderAvatarPreview(role) {
  const avatars = getAvatarSettings();
  const el = role === "assistant" ? els.assistantAvatarPreview : els.userAvatarPreview;
  const dataUrl = role === "assistant" ? avatars.assistantAvatar : avatars.userAvatar;
  if (!el) return;
  el.innerHTML = "";
  el.classList.toggle("has-image", Boolean(dataUrl));
  if (dataUrl) {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = role === "assistant" ? "AI 头像" : "用户头像";
    el.append(img);
    return;
  }
  el.textContent = initialsForRole(role);
}
function renderAllAvatarPreviews() {
  renderAvatarPreview("assistant");
  renderAvatarPreview("user");
}
function cloneSkillForStorage(skill) {
  if (!skill || typeof skill !== "object") return null;
  return {
    name: skill.name || "",
    source: skill.source || "workspace",
    summary: skill.summary || "",
    content: skill.content || "",
    files: Array.isArray(skill.files) ? skill.files.map((file) => ({
      path: file.path || "",
      content: file.content || "",
    })) : [],
  };
}

function cloneSettingBundleForStorage(bundle) {
  if (!bundle || typeof bundle !== "object") return null;
  return {
    name: bundle.name || "",
    importedAt: bundle.importedAt || Date.now(),
    files: Array.isArray(bundle.files) ? bundle.files.map((file) => ({
      path: file.path || "",
      content: file.content || "",
      size: Number(file.size || 0) || 0,
      type: file.type || "",
    })) : [],
  };
}

function renderSettingBundlePreview() {
  if (!els.settingFolderSummary || !els.settingFolderPreview) return;
  const bundle = state.settingBundle;
  if (!bundle?.files?.length) {
    els.settingFolderSummary.textContent = "当前还没有导入设定文件夹。";
    els.settingFolderPreview.textContent = "导入设定文件夹后，这里会显示文件摘要，并在后续对话里自动加载这些设定。";
    return;
  }

  const totalChars = bundle.files.reduce((sum, file) => sum + String(file.content || "").length, 0);
  els.settingFolderSummary.textContent = `已加载设定文件夹：${bundle.name || "未命名设定"} · ${bundle.files.length} 个文件 · ${totalChars} 字符`;
  els.settingFolderPreview.textContent = [
    `设定文件夹：${bundle.name || "未命名设定"}`,
    `导入时间：${formatHistoryTime(bundle.importedAt || Date.now())}`,
    `文件数量：${bundle.files.length}`,
    "",
    ...bundle.files.map((file) => `# ${file.path}\n\n${file.content}`),
  ].join("\n");
}
function sameSkill(left, right) {
  if (!left || !right) return false;
  return String(left.name || "") === String(right.name || "") && String(left.source || "") === String(right.source || "");
}
function renderSkillPreview(skill = state.selectedSkill) {
  if (!els.skillPreview) return;
  if (!skill) {
    els.skillPreview.textContent = "选择一个技能后，会在这里显示整个技能目录的文本内容摘要。";
    return;
  }
  els.skillPreview.textContent = [
    `技能：${skill.name}`,
    `来源：${skill.source}`,
    `已载入文件：${(skill.files || []).length}`,
    "",
    ...(skill.files || []).map((f) => `# ${f.path}\n\n${f.content}`),
  ].join("\n");
}
function save() {
  const old = saved();
  const history = [selectedModel(), ...(old.modelHistory || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, MODEL_HISTORY_LIMIT);
  const configGroupState = Object.fromEntries(
    Array.from(document.querySelectorAll(".config-group[data-config-group]")).map((group) => [
      group.dataset.configGroup,
      group.open,
    ])
  );
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...old,
    baseUrl: els.baseUrl?.value.trim() || "", apiPath: els.apiPath?.value.trim() || "/api/v1/chat/completions", model: selectedModel(), modelHistory: history,
    assistantName: els.assistantName?.value.trim() || "繁星", userName: els.userName?.value.trim() || "文远", systemPrompt: els.systemPrompt?.value.trim() || "",
    personaPrompt: els.personaPrompt?.value.trim() || "", personaPreset: els.personaPreset?.value || "none", contextLimit: els.contextLimit?.value.trim() || "32768",
    qqPushEnabled: Boolean(els.qqPushEnabled?.checked),
    qqBridgeUrl: els.qqBridgeUrl?.value.trim() || "",
    qqAccessToken: els.qqAccessToken?.value.trim() || "",
    qqTargetType: els.qqTargetType?.value || "private",
    qqTargetId: els.qqTargetId?.value.trim() || "",
    assistantAvatar: old.assistantAvatar || "",
    userAvatar: old.userAvatar || "",
    configGroupState,
    skillsCache: state.skills.map((skill) => cloneSkillForStorage(skill)).filter(Boolean),
    selectedSkill: cloneSkillForStorage(state.selectedSkill),
    activeSkill: cloneSkillForStorage(state.activeSkill),
    settingBundle: cloneSettingBundleForStorage(state.settingBundle),
    ...getResizableTextareaState(),
  }));
  renderModelMeta(); refreshMetrics(); renderAllAvatarPreviews(); renderSettingBundlePreview(); renderQqPushMeta();
}
function load() {
  const s = saved();
  if (els.baseUrl) els.baseUrl.value = s.baseUrl || "";
  if (els.apiPath) els.apiPath.value = s.apiPath || "/api/v1/chat/completions";
  if (els.assistantName) els.assistantName.value = s.assistantName || "繁星";
  if (els.userName) els.userName.value = s.userName || "文远";
  if (els.systemPrompt) els.systemPrompt.value = s.systemPrompt || "";
  if (els.personaPrompt) els.personaPrompt.value = s.personaPrompt || "";
  if (els.contextLimit) els.contextLimit.value = s.contextLimit || "32768";
  if (els.qqPushEnabled) els.qqPushEnabled.checked = Boolean(s.qqPushEnabled);
  if (els.qqBridgeUrl) els.qqBridgeUrl.value = s.qqBridgeUrl || "";
  if (els.qqAccessToken) els.qqAccessToken.value = s.qqAccessToken || "";
  if (els.qqTargetType) els.qqTargetType.value = s.qqTargetType || "private";
  if (els.qqTargetId) els.qqTargetId.value = s.qqTargetId || "";
  if (els.personaPreset) els.personaPreset.value = s.personaPreset || "none";
  if (els.modelSelect && s.model) { const o = document.createElement("option"); o.value = s.model; o.textContent = s.model; els.modelSelect.replaceChildren(o); els.modelSelect.value = s.model; }
  state.skills = Array.isArray(s.skillsCache) ? s.skillsCache.filter(Boolean) : [];
  state.selectedSkill = cloneSkillForStorage(s.selectedSkill);
  state.activeSkill = cloneSkillForStorage(s.activeSkill);
  state.settingBundle = cloneSettingBundleForStorage(s.settingBundle);
  if (!state.selectedSkill && state.activeSkill) state.selectedSkill = cloneSkillForStorage(state.activeSkill);
  applyConfigGroupState(s.configGroupState || {});
  applyResizableTextareaState(s);
  renderSkills();
  renderSkillPreview();
  renderSettingBundlePreview();
  renderAllAvatarPreviews();
  renderQqPushMeta();
}

function applyConfigGroupState(configGroupState = {}) {
  document.querySelectorAll(".config-group[data-config-group]").forEach((group) => {
    const key = group.dataset.configGroup;
    if (Object.prototype.hasOwnProperty.call(configGroupState, key)) {
      group.open = Boolean(configGroupState[key]);
    }
  });
}
function renderModelMeta() {
  if (!els.modelSelectionMeta) return;
  els.modelSelectionMeta.textContent = selectedModel() ? `当前模型：${selectedModel()}` : "当前未选择模型";
}
function refreshMetrics(usage = null, elapsedMs = null) {
  const sys = [els.systemPrompt?.value || "", els.personaPrompt?.value || "", state.activeSkill ? JSON.stringify(state.activeSkill).slice(0, 3000) : ""].join("\n").length;
  const his = state.messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n").length;
  const files = state.files.reduce((n, f) => n + (f.isImage ? 120 : f.content.length), 0);
  const draft = els.userInput?.value.length || 0;
  const chars = sys + his + files + draft;
  const est = Math.ceil(chars / 4);
  const limit = Number(els.contextLimit?.value || 32768) || 32768;
  const totalText = usage?.total_tokens != null ? String(usage.total_tokens) : (els.metricTotal?.dataset.value || "-");
  const speedText = usage?.completion_tokens && elapsedMs ? `${(usage.completion_tokens / Math.max(elapsedMs / 1000, 0.1)).toFixed(1)} tok/s` : (els.metricSpeed?.dataset.value || "-");
  const usageText = `${est} / ${limit} · ${Math.min(est / limit * 100, 100).toFixed(1)}%`;
  setMetricChip(els.metricContextChars, "上下文字符", String(chars));
  setMetricChip(els.metricEstimatedPrompt, "预估 Prompt", String(est));
  setMetricChip(els.metricTotal, "Total", totalText);
  setMetricChip(els.metricSpeed, "速率", speedText);
  setMetricChip(els.metricContextUsage, "上下文使用情况", usageText);
  if (els.usageBarFill) els.usageBarFill.style.width = `${Math.min(est / limit * 100, 100)}%`;
}

function setMetricChip(el, label, value) {
  if (!el) return;
  const text = `${label}：${value}`;
  el.dataset.value = value;
  el.dataset.tooltip = text;
  el.title = text;
  el.setAttribute("aria-label", text);
}

function rich(text) {
  const html = String(text || "").replace(/```([a-z0-9_-]*)\n?([\s\S]*?)```/gi, (_, lang, code) => `@@CODE:${btoa(unescape(encodeURIComponent(`${lang}\n${code}`)))}@@`);
  return html.split(/@@CODE:[A-Za-z0-9+/=]+@@/g).map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`).join("")
    .replace(/@@CODE:([A-Za-z0-9+/=]+)@@/g, (_, data) => {
      const [lang, ...rest] = decodeURIComponent(escape(atob(data))).split("\n");
      return `<pre><code class="language-${esc(lang)}">${esc(rest.join("\n").trim())}</code></pre>`;
    });
}
function htmlPreview(text) { const m = String(text || "").match(/```html\s*([\s\S]*?)```/i); return m ? m[1].trim() : ""; }
function formatMessageTimestamp(timestamp = Date.now()) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function messageAvatarMarkup(role) {
  const avatars = getAvatarSettings();
  const dataUrl = role === "assistant" ? avatars.assistantAvatar : role === "user" ? avatars.userAvatar : "";
  const avatar = document.createElement("div");
  avatar.className = `message-avatar ${role}`;
  if (dataUrl) {
    avatar.classList.add("has-image");
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = `${roleName(role)}头像`;
    avatar.append(img);
  } else {
    avatar.textContent = initialsForRole(role);
  }
  return avatar;
}
function appendMessage(role, content, cls = role, images = [], timestamp = Date.now()) {
  const card = document.createElement("article"); card.className = `message ${cls}`;
  const avatar = messageAvatarMarkup(role);
  const bubble = document.createElement("div"); bubble.className = "message-bubble";
  const head = document.createElement("div"); head.className = "message-head";
  const r = document.createElement("div"); r.className = "message-role"; r.textContent = roleName(role);
  const time = document.createElement("time"); time.className = "message-time"; time.dateTime = new Date(timestamp).toISOString(); time.textContent = formatMessageTimestamp(timestamp);
  const c = document.createElement("div"); c.className = "message-content"; c.innerHTML = rich(content);
  enhanceMessageCodeBlocks(c);
  head.append(r, time);
  bubble.append(head, c);
  if (images.length) {
    const wrap = document.createElement("div"); wrap.className = "file-list compact image-strip";
    images.forEach((img, i) => { const item = document.createElement("div"); item.className = "file-item"; const el = document.createElement("img"); el.className = "file-thumb"; el.src = img.dataUrl; el.alt = img.name; el.addEventListener("dblclick", () => openLightbox(images, i)); item.append(el); wrap.append(item); });
    bubble.append(wrap);
  }
  const html = htmlPreview(content);
  if (html) { const row = document.createElement("div"); row.className = "button-row left"; const b = document.createElement("button"); b.type = "button"; b.className = "ghost-button"; b.textContent = "预览 HTML"; b.onclick = () => openPreview(html); row.append(b); bubble.append(row); }
  card.append(avatar, bubble);
  els.chatMessages?.append(card); requestAnimationFrame(() => els.chatMessages?.scrollTo({ top: els.chatMessages.scrollHeight, behavior: "smooth" }));
  return card;
}

function appendPendingMessage() {
  const card = document.createElement("article");
  card.className = "message assistant pending";
  const avatar = messageAvatarMarkup("assistant");
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  const head = document.createElement("div");
  head.className = "message-head";
  const role = document.createElement("div");
  role.className = "message-role";
  role.textContent = roleName("assistant");
  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = new Date().toISOString();
  time.textContent = formatMessageTimestamp();
  const content = document.createElement("div");
  content.className = "message-content";
  content.innerHTML = '<div class="thinking-line"><span class="thinking-text">正在处理请求</span><span class="thinking-dots"><span></span><span></span><span></span></span></div>';
  head.append(role, time);
  bubble.append(head, content);
  card.append(avatar, bubble);
  els.chatMessages?.append(card);
  requestAnimationFrame(() => els.chatMessages?.scrollTo({ top: els.chatMessages.scrollHeight, behavior: "smooth" }));
  return card;
}

function renderToolActivity() {
  if (!els.toolActivityList || !els.toolActivityStatus) return;
  if (!state.toolActivities.length) {
    els.toolActivityStatus.textContent = "空闲";
    if (els.toolActivitySummary) els.toolActivitySummary.textContent = "点击查看完整记录";
    if (els.toolActivityTrigger) els.toolActivityTrigger.classList.remove("is-busy");
    els.toolActivityList.innerHTML = '<div class="file-empty">暂无工具记录</div>';
    return;
  }
  const latest = state.toolActivities[0];
  const running = state.toolActivities.some((x) => x.status === "running");
  els.toolActivityStatus.textContent = running ? "执行中" : "最近活动";
  if (els.toolActivitySummary) els.toolActivitySummary.textContent = `${latest.name} · ${latest.text}`;
  if (els.toolActivityTrigger) els.toolActivityTrigger.classList.toggle("is-busy", running);
  els.toolActivityList.replaceChildren(...state.toolActivities.map((x) => {
    const el = document.createElement("div"); el.className = `tool-activity-item ${x.status}`;
    const updatedAt = x.updatedAt ? new Date(x.updatedAt) : null;
    const timeText = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    el.innerHTML = `<div class="tool-activity-head"><strong class="tool-activity-title">${esc(x.name)}</strong><span class="tool-activity-badge">${x.status === "running" ? "执行中" : "已完成"}</span></div><div class="tool-activity-text">${esc(x.text)}</div>${timeText ? `<div class="tool-activity-time">${esc(timeText)}</div>` : ""}`; return el;
  }));
}
function toolActivity(id, status, name, text) {
  const i = state.toolActivities.findIndex((x) => x.id === id); const next = { id, status, name, text, updatedAt: Date.now() };
  if (i >= 0) state.toolActivities.splice(i, 1, next); else state.toolActivities.unshift(next);
  state.toolActivities = state.toolActivities.slice(0, 12);
  localStorage.setItem(TOOL_ACTIVITY_CACHE_KEY, JSON.stringify(state.toolActivities)); renderToolActivity();
}
function loadToolActivity() { try { state.toolActivities = JSON.parse(localStorage.getItem(TOOL_ACTIVITY_CACHE_KEY) || "[]"); } catch { state.toolActivities = []; } renderToolActivity(); }

function setToolActivityModal(open) {
  if (!els.toolActivityModal) return;
  els.toolActivityModal.classList.toggle("is-hidden", !open);
  els.toolActivityModal.setAttribute("aria-hidden", open ? "false" : "true");
  els.toolActivityTrigger?.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.classList.toggle("activity-modal-open", open);
}

function setPreview(show) { els.workspaceBody?.classList.toggle("preview-active", show); els.previewPanel?.classList.toggle("is-hidden", !show); els.previewResizer?.classList.toggle("is-hidden", !show); }
function setPreviewMax(v) { state.previewMaximized = v; document.body.classList.toggle("preview-maximized", v); els.previewPanel?.classList.toggle("is-maximized", v); if (els.togglePreviewSize) els.togglePreviewSize.textContent = v ? "还原" : "最大化"; }
function openPreview(html) { setPreview(true); setPreviewMax(false); if (els.previewFrame) { els.previewFrame.classList.remove("is-hidden"); els.previewFrame.srcdoc = html; } els.previewEmpty?.classList.add("is-hidden"); }
function closePreview() { setPreview(false); setPreviewMax(false); if (els.previewFrame) els.previewFrame.srcdoc = ""; els.previewFrame?.classList.add("is-hidden"); els.previewEmpty?.classList.remove("is-hidden"); }
function initPreviewResizer() {
  const width = Number(localStorage.getItem(PREVIEW_WIDTH_KEY)); if (Number.isFinite(width)) document.documentElement.style.setProperty("--preview-width", `${width}px`);
  let drag = false; const move = (e) => { if (!drag || !els.workspaceBody) return; const r = els.workspaceBody.getBoundingClientRect(); document.documentElement.style.setProperty("--preview-width", `${Math.min(720, Math.max(320, r.right - e.clientX))}px`); };
  const up = () => { if (!drag) return; drag = false; document.body.style.userSelect = ""; localStorage.setItem(PREVIEW_WIDTH_KEY, getComputedStyle(document.documentElement).getPropertyValue("--preview-width").replace("px", "").trim()); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  els.previewResizer?.addEventListener("pointerdown", () => { drag = true; document.body.style.userSelect = "none"; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); });
}

function renderPersonaPresets() {
  if (!els.personaPreset) return;
  const previousValue = els.personaPreset.value || saved().personaPreset || "none";
  const nodes = [];

  const builtInGroup = document.createElement("optgroup");
  builtInGroup.label = "内置模板";
  builtInGroup.append(...PERSONA_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    return option;
  }));
  nodes.push(builtInGroup);

  if (workspacePersonaPresets.length) {
    const workspaceGroup = document.createElement("optgroup");
    workspaceGroup.label = "工作区人设";
    workspaceGroup.append(...workspacePersonaPresets.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      return option;
    }));
    nodes.push(workspaceGroup);
  }

  els.personaPreset.replaceChildren(...nodes);
  const allPresetIds = allPersonaPresets().map((preset) => preset.id);
  els.personaPreset.value = allPresetIds.includes(previousValue) ? previousValue : "none";
}
function allPersonaPresets() { return [...PERSONA_PRESETS, ...workspacePersonaPresets]; }
function presetById(id) { return allPersonaPresets().find((p) => p.id === id) || PERSONA_PRESETS[0]; }
function renderPersonaPresetDescription() { if (els.personaPresetDescription) els.personaPresetDescription.textContent = presetById(els.personaPreset?.value || "none").description; }
async function loadWorkspacePersonaPresets() {
  try {
    const data = await j("/personas/list");
    workspacePersonaPresets = Array.isArray(data.presets) ? data.presets : [];
    renderPersonaPresets();
    renderPersonaPresetDescription();
    save();
  } catch (error) {
    workspacePersonaPresets = [];
    renderPersonaPresets();
    renderPersonaPresetDescription();
    setStatus(`工作区人设模板读取失败：${error.message}`);
  }
}

async function readText(file) { return await file.text(); }
async function readImage(file) { return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || "")); r.onerror = () => reject(new Error(`读取图片失败：${file.name}`)); r.readAsDataURL(file); }); }
async function consumeFiles(files) {
  for (const file of Array.from(files || [])) {
    const isImage = file.type.startsWith("image/");
    const limit = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
    if (file.size > limit) { appendMessage("system", `文件过大，已跳过：${file.name}`, "error"); continue; }
    state.files.push(isImage ? { id: nowId(), name: file.name || `图片-${Date.now()}.png`, type: file.type || "image/png", size: file.size, isImage: true, dataUrl: await readImage(file) } : { id: nowId(), name: file.name, type: file.type || "text/plain", size: file.size, isImage: false, content: (await readText(file)).slice(0, MAX_FILE_CONTENT), truncated: file.size > MAX_FILE_CONTENT });
  }
  renderFiles(); refreshMetrics(); setStatus(`已附加 ${state.files.length} 个附件`);
}
function renderFiles() {
  if (!els.fileList || !els.composerFiles) return;
  if (!state.files.length) {
    els.fileList.classList.remove("image-strip");
    els.fileList.replaceChildren();
    els.composerFiles.classList.add("is-hidden");
    return;
  }
  els.composerFiles.classList.remove("is-hidden");
  els.fileList.classList.toggle("image-strip", state.files.every((file) => file.isImage));
  els.fileList.replaceChildren(...state.files.map((file, i) => {
    const item = document.createElement("div"); item.className = `file-item${file.isImage ? " image-item" : ""}`;
    if (file.isImage) { const img = document.createElement("img"); img.className = "file-thumb"; img.src = file.dataUrl; img.alt = file.name; img.ondblclick = () => openLightbox(state.files.filter((f) => f.isImage), state.files.filter((f) => f.isImage).findIndex((f) => f.id === file.id)); item.append(img); }
    const name = document.createElement("strong"); name.textContent = file.name;
    const meta = document.createElement("div"); meta.className = "tool-activity-text"; meta.textContent = `${formatBytes(file.size)} · ${file.isImage ? "图片附件" : `已注入 ${file.content.length} 字符`}`;
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "ghost-button"; btn.textContent = "移除"; btn.onclick = () => { state.files.splice(i, 1); renderFiles(); refreshMetrics(); };
    item.append(name, meta, btn); return item;
  }));
}
function clearFiles() { state.files = []; renderFiles(); refreshMetrics(); setStatus("附件已清空"); }

async function j(url, options) {
  const r = await fetch(url, options); let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || data.details || `请求失败：${r.status}`);
  return data;
}
function normalizeContent(content) { return typeof content === "string" ? content : Array.isArray(content) ? content.map((x) => x?.text || "").join("\n") : ""; }
function systemMessages() {
  const list = [];
  if (els.systemPrompt?.value.trim()) list.push({ role: "system", content: els.systemPrompt.value.trim() });
  list.push({ role: "system", content: "默认不要把结果保存到本地文件。只有当用户明确要求保存到本地、写入文件、落盘时，才允许执行 write_file 或 delete_file；否则只返回内容，不保存。" });
  list.push({ role: "system", content: "如果在对话过程中需要创建临时文件，请统一放在当前工作目录下的 ./temp-files/ 目录中，不要散落到其他位置。" });
  list.push({ role: "system", content: "如果用户明确要求创建、修改、删除、查看或执行定时任务，可以使用 scheduled task 相关工具；例如每天、每周、cron、定时执行等请求。" });
  list.push({ role: "system", content: "在修改、删除、暂停、启用或立即执行定时任务时，如果已经知道任务名称，可以直接按任务名称调用相关工具，不必强依赖任务 id。" });
  list.push({ role: "system", content: "如果用户要求下载、安装、推荐或查找技能，请优先从 https://clawhub.ai/skills?sort=downloads&nonSuspicious=true 寻找。若用户需求模糊，先推荐热门且非可疑的技能，再等待用户确认；只有在用户明确确认下载/安装后，才允许把技能安装到当前工作区的 ./skills/ 目录。" });
  if (els.personaPrompt?.value.trim()) list.push({ role: "system", content: `以下是当前启用的 AI 人设，请在后续回答中保持一致：\n\n${els.personaPrompt.value.trim()}` });
  if (state.activeSkill) {
    const files = (state.activeSkill.files || []).map((f) => `文件：${f.path}\n${f.content}`).join("\n\n");
    list.push({ role: "system", content: `你当前启用了技能：${state.activeSkill.name}\n技能来源：${state.activeSkill.source}\n请优先遵循 SKILL.md 的规则。\n\n${files}` });
  }
  const texts = state.files.filter((f) => !f.isImage).map((f, i) => `文件 ${i + 1}：${f.name}\n类型：${f.type}\n内容：\n${f.content}${f.truncated ? "\n[注意] 已截断" : ""}`).join("\n\n---\n\n");
  if (texts) list.push({ role: "system", content: `以下是用户附加的文件内容，请结合这些内容完成分析、回答或生成结果：\n\n${texts}` });
  return list;
}
function userPayload(text) {
  const images = state.files.filter((f) => f.isImage);
  return images.length ? [{ type: "text", text: text || "请结合已附加的图片继续回答。" }, ...images.map((f) => ({ type: "image_url", image_url: { url: f.dataUrl } }))] : (text || "请结合附件继续回答。");
}
async function executeTool(toolCall) {
  const id = toolCall?.id || nowId(); const name = toolCall?.function?.name || "unknown"; let args = {};
  try { args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {}; } catch { throw new Error("工具参数不是合法 JSON"); }
  if (name === "delete_file" && args.path && !window.confirm(`AI 请求删除文件：${args.path}\n\n是否允许继续？`)) return { role: "tool", tool_call_id: id, content: JSON.stringify({ cancelled: true }) };
  toolActivity(id, "running", name, "正在执行...");
  const data = await j("/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: args }) });
  toolActivity(id, "done", name, "执行完成");
  return { role: "tool", tool_call_id: id, content: JSON.stringify(data.result, null, 2) };
}
async function askModel(userText) {
  if (!selectedModel()) throw new Error("请先选择模型。");
  let messages = [...systemMessages(), ...state.messages, { role: "user", content: userPayload(userText) }], final = "";
  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const t0 = performance.now();
    const data = await j(chatEndpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selectedModel(), messages, temperature: 0.7, tools: TOOLS, tool_choice: "auto", stream: false }) });
    refreshMetrics(data.usage || null, performance.now() - t0);
    const msg = data.choices?.[0]?.message; if (!msg) throw new Error("接口返回成功，但没有找到 assistant message。");
    const content = normalizeContent(msg.content); if (content) final = content;
    messages.push({ role: "assistant", content: msg.content || content, tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) break;
    for (const tc of msg.tool_calls) messages.push(await executeTool(tc));
  }
  if (!final) throw new Error("模型进行了工具调用，但没有返回最终文本结果。");
  const messageTimestamp = Date.now();
  state.messages.push(
    { role: "user", content: userText || "请结合附件继续回答。", timestamp: messageTimestamp },
    { role: "assistant", content: final, timestamp: Date.now() }
  ); save(); refreshMetrics(); return final;
}

async function testConnection() {
  spark(els.testConnection); setStatus("正在测试连接...");
  try { const data = await j(modelsEndpoint()); const models = (data.data || []).map((x) => x.id).filter(Boolean); appendMessage("system", models.length ? `连接成功，可用模型：${models.join("、")}` : "连接成功，模型服务在线。", "success"); setStatus("连接测试成功"); } catch (e) { appendMessage("system", `连接测试失败：${e.message}`, "error"); setStatus("连接测试失败"); }
}
function renderModels(models) {
  if (!els.modelSelect) return;
  const current = selectedModel(); const history = saved().modelHistory || []; const names = [...history, ...models].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  els.modelSelect.replaceChildren(...(names.length ? names : [""]).map((name) => { const o = document.createElement("option"); o.value = name; o.textContent = name || "未读取到模型"; return o; }));
  els.modelSelect.value = names.includes(current) ? current : (names[0] || "");
}
async function loadModels() {
  spark(els.loadModels); setStatus("正在读取模型列表...");
  try { const data = await j(modelsEndpoint()); const models = (data.data || []).map((x) => x.id).filter(Boolean); renderModels(models); save(); appendMessage("system", models.length ? `已读取 ${models.length} 个模型。` : "未读取到模型。", models.length ? "success" : "error"); setStatus(models.length ? "模型列表已更新" : "未读取到模型"); } catch (e) { appendMessage("system", `读取模型失败：${e.message}`, "error"); setStatus("读取模型失败"); }
}

function renderSkills() {
  if (!els.skillsList) return;
  if (!state.skills.length) { els.skillsList.innerHTML = '<div class="file-empty">当前没有读取到技能列表。</div>'; return; }
  els.skillsList.replaceChildren(...state.skills.map((skill) => {
    const item = document.createElement("div"); item.className = "file-item";
    const t = document.createElement("strong"); t.textContent = skill.name;
    const m = document.createElement("div"); m.className = "tool-activity-text"; m.textContent = `${skill.source} · ${skill.summary}`;
    const b = document.createElement("button"); b.type = "button"; b.className = "ghost-button"; b.textContent = skill.source === "workspace" ? "读取" : "安装到当前目录";
    b.onclick = async () => { spark(b); skill.source === "workspace" ? await readSkill(skill) : await installSkill(skill); };
    item.append(t, m, b); return item;
  }));
}
async function loadSkills() {
  setStatus("正在读取技能...");
  try {
    let data = await j("/skills/list?source=workspace"); state.skills = data.skills || [];
    if (!state.skills.length) { data = await j("/skills/list?source=codex"); state.skills = data.skills || []; }
    renderSkills(); setStatus(state.skills.length ? `已读取 ${state.skills.length} 个技能` : "没有找到可用技能");
  } catch (e) { appendMessage("system", `读取技能失败：${e.message}`, "error"); setStatus("读取技能失败"); }
}
async function readSkill(skill) {
  setStatus(`正在读取技能：${skill.name}`);
  const data = await j(`/skills/read?source=${encodeURIComponent(skill.source)}&name=${encodeURIComponent(skill.name)}`);
  state.selectedSkill = data.skill; if (els.skillPreview) els.skillPreview.textContent = [`技能：${data.skill.name}`, `来源：${data.skill.source}`, `已载入文件：${(data.skill.files || []).length}`, "", ...(data.skill.files || []).map((f) => `# ${f.path}\n\n${f.content}`)].join("\n");
  setStatus(`已读取技能：${skill.name}`);
}
async function installSkill(skill) {
  setStatus(`正在安装技能：${skill.name}`);
  const data = await j("/skills/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: skill.source, name: skill.name }) });
  appendMessage("system", `已安装技能：${skill.name}\n位置：${data.result.installedTo}`, "success"); await loadSkills();
}
function applySelectedSkill() { if (!state.selectedSkill) return setStatus("请先读取一个技能"); state.activeSkill = state.selectedSkill; appendMessage("system", `已启用技能：${state.selectedSkill.name}\n后续对话会自动附带该技能内容。`, "success"); refreshMetrics(); setStatus(`已启用技能：${state.selectedSkill.name}`); }

function resetChat() { state.messages = []; els.chatMessages.replaceChildren(); appendMessage("assistant", "你好，我已经准备好连接本地 AI。你可以先测试连接、读取模型、上传文件，或者启用某个技能后再开始提问。"); refreshMetrics(); setStatus("会话已清空"); }

const lightboxState = { images: [], index: 0 };
function drawLightbox() { const img = $("#lightbox-image"), cap = $("#lightbox-caption"), box = $("#image-lightbox"), cur = lightboxState.images[lightboxState.index]; if (!img || !cap || !box || !cur) return; img.src = cur.dataUrl; cap.textContent = cur.name || "图片预览"; box.classList.remove("is-hidden"); }
function openLightbox(images, index = 0) { if (!images?.length) return; lightboxState.images = images; lightboxState.index = index; drawLightbox(); }
function closeLightbox() { $("#image-lightbox")?.classList.add("is-hidden"); lightboxState.images = []; lightboxState.index = 0; }
function navLightbox(d) { if (!lightboxState.images.length) return; lightboxState.index = (lightboxState.index + d + lightboxState.images.length) % lightboxState.images.length; drawLightbox(); }

async function submit(ev) {
  ev.preventDefault(); if (state.sending) return;
  const text = els.userInput?.value.trim() || ""; if (!text && !state.files.length) return setStatus("请输入要发送的内容");
  appendMessage("user", text || "请结合附件继续回答。", "user", state.files.filter((f) => f.isImage)); if (els.userInput) els.userInput.value = ""; refreshMetrics();
  state.sending = true; if (els.sendButton) { els.sendButton.disabled = true; els.sendButton.textContent = "发送中..."; } setStatus("正在处理请求...");
  try { const reply = await askModel(text); appendMessage("assistant", reply); clearFiles(); setStatus("回复完成"); }
  catch (e) { appendMessage("system", `${e.message}\n\n请确认你是通过 node server.js 启动页面，并且本地模型服务仍在 http://127.0.0.1:1234 运行。`, "error"); setStatus("请求失败"); }
  finally { state.sending = false; if (els.sendButton) { els.sendButton.disabled = false; els.sendButton.textContent = "发送消息"; } }
}

function bind() {
  els.chatForm?.addEventListener("submit", submit);
  els.userInput?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); els.chatForm?.requestSubmit(); } });
  els.userInput?.addEventListener("input", () => refreshMetrics());
  els.toolActivityTrigger?.addEventListener("click", () => setToolActivityModal(true));
  els.toolActivityClose?.addEventListener("click", () => setToolActivityModal(false));
  els.toolActivityBackdrop?.addEventListener("click", () => setToolActivityModal(false));
  document.querySelectorAll(".config-group[data-config-group]").forEach((group) => {
    group.addEventListener("toggle", () => save());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.toolActivityModal?.classList.contains("is-hidden")) {
      setToolActivityModal(false);
    }
  });
  [els.baseUrl, els.apiPath, els.modelSelect, els.assistantName, els.userName, els.systemPrompt, els.contextLimit].forEach((el) => el?.addEventListener("change", () => { save(); setStatus(`已保存配置，当前接口：${chatEndpoint()}`); }));
  [els.assistantName, els.userName].forEach((el) => el?.addEventListener("input", () => renderAllAvatarPreviews()));
  els.personaPrompt?.addEventListener("input", () => { save(); refreshMetrics(); });
  [els.systemPrompt, els.personaPrompt].forEach((el) => {
    el?.addEventListener("mouseup", () => save());
    el?.addEventListener("touchend", () => save(), { passive: true });
  });
  els.personaPreset?.addEventListener("change", () => { renderPersonaPresetDescription(); save(); });
  els.applyPersonaPreset?.addEventListener("click", () => { spark(els.applyPersonaPreset); const p = presetById(els.personaPreset?.value || "none"); if (p.prompt && els.personaPrompt) els.personaPrompt.value = p.prompt; renderPersonaPresetDescription(); save(); setStatus(p.prompt ? `已应用人设模板：${p.name}` : "当前预设不会覆盖现有人设"); });
  els.importPersona?.addEventListener("click", () => { spark(els.importPersona); els.personaFileInput?.click(); });
  els.personaFileInput?.addEventListener("change", async (e) => { try { const [file] = Array.from(e.target.files || []); if (file && els.personaPrompt) els.personaPrompt.value = await file.text(); save(); setStatus(`已导入人设文件：${file?.name || ""}`); } catch (err) { appendMessage("system", `导入人设失败：${err.message}`, "error"); } finally { e.target.value = ""; } });
  els.exportPersona?.addEventListener("click", () => { spark(els.exportPersona); const blob = new Blob([els.personaPrompt?.value.trim() || "# AI 人设\n\n"], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ai-persona.md"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); setStatus("已导出 AI 人设文件"); });
  els.clearPersona?.addEventListener("click", () => { spark(els.clearPersona); if (els.personaPrompt) els.personaPrompt.value = ""; if (els.personaPreset) els.personaPreset.value = "none"; renderPersonaPresetDescription(); save(); setStatus("已清空 AI 人设"); });
  els.attachFilesInline?.addEventListener("click", () => { spark(els.attachFilesInline); els.fileInput?.click(); });
  els.uploadAssistantAvatar?.addEventListener("click", () => { spark(els.uploadAssistantAvatar); els.assistantAvatarInput?.click(); });
  els.uploadUserAvatar?.addEventListener("click", () => { spark(els.uploadUserAvatar); els.userAvatarInput?.click(); });
  els.clearAssistantAvatar?.addEventListener("click", () => {
    const next = { ...saved(), assistantAvatar: "" };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    renderAllAvatarPreviews();
    save();
  });
  els.clearUserAvatar?.addEventListener("click", () => {
    const next = { ...saved(), userAvatar: "" };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    renderAllAvatarPreviews();
    save();
  });
  els.assistantAvatarInput?.addEventListener("change", async (e) => {
    try {
      const [file] = Array.from(e.target.files || []);
      if (!file) return;
      if (file.size > MAX_AVATAR_SIZE) throw new Error("头像文件不能超过 2MB");
      const next = { ...saved(), assistantAvatar: await readFileAsDataUrl(file) };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      renderAllAvatarPreviews();
      save();
    } catch (error) {
      appendMessage("system", `AI 头像上传失败：${error.message}`, "error");
    } finally {
      e.target.value = "";
    }
  });
  els.userAvatarInput?.addEventListener("change", async (e) => {
    try {
      const [file] = Array.from(e.target.files || []);
      if (!file) return;
      if (file.size > MAX_AVATAR_SIZE) throw new Error("头像文件不能超过 2MB");
      const next = { ...saved(), userAvatar: await readFileAsDataUrl(file) };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      renderAllAvatarPreviews();
      save();
    } catch (error) {
      appendMessage("system", `用户头像上传失败：${error.message}`, "error");
    } finally {
      e.target.value = "";
    }
  });
  els.fileInput?.addEventListener("change", async (e) => { await consumeFiles(e.target.files); e.target.value = ""; });
  els.clearFiles?.addEventListener("click", () => { spark(els.clearFiles); clearFiles(); });
  els.clearChat?.addEventListener("click", () => { spark(els.clearChat); resetChat(); });
  els.testConnection?.addEventListener("click", testConnection); els.loadModels?.addEventListener("click", loadModels);
  els.loadSkills?.addEventListener("click", () => { spark(els.loadSkills); loadSkills(); }); els.applySkill?.addEventListener("click", () => { spark(els.applySkill); applySelectedSkill(); });
  els.closePreview?.addEventListener("click", () => { spark(els.closePreview); closePreview(); }); els.togglePreviewSize?.addEventListener("click", () => { spark(els.togglePreviewSize); setPreviewMax(!state.previewMaximized); });
  document.addEventListener("paste", async (e) => { if (e.clipboardData?.files?.length) await consumeFiles(e.clipboardData.files); });
  ["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  document.addEventListener("drop", async (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) await consumeFiles(e.dataTransfer.files); });
  $("#lightbox-close")?.addEventListener("click", closeLightbox); $("#lightbox-prev")?.addEventListener("click", () => navLightbox(-1)); $("#lightbox-next")?.addEventListener("click", () => navLightbox(1)); $("#image-lightbox")?.addEventListener("click", (e) => { if (e.target?.id === "image-lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (!$("#image-lightbox")?.classList.contains("is-hidden")) { if (e.key === "Escape") closeLightbox(); if (e.key === "ArrowLeft") navLightbox(-1); if (e.key === "ArrowRight") navLightbox(1); } else if (e.key === "Escape" && state.previewMaximized) setPreviewMax(false); });
}

async function init() {
  renderPersonaPresets(); load(); renderPersonaPresetDescription(); renderModelMeta(); loadToolActivity(); initPreviewResizer(); closePreview(); setToolActivityModal(false); bind(); renderFiles(); resetChat(); refreshMetrics(); setStatus(`准备就绪，当前接口：${chatEndpoint()}`);
  try { const data = await j(modelsEndpoint()); const models = (data.data || []).map((x) => x.id).filter(Boolean); if (models.length) { renderModels(models); save(); setStatus("连接正常，模型已加载"); } } catch {}
}

renderFiles = function renderFilesOverride() {
  if (!els.fileList || !els.composerFiles) return;
  if (!state.files.length) {
    els.fileList.classList.remove("image-strip");
    els.fileList.replaceChildren();
    els.composerFiles.classList.add("is-hidden");
    return;
  }

  els.composerFiles.classList.remove("is-hidden");
  els.fileList.classList.toggle("image-strip", state.files.every((file) => file.isImage));
  els.fileList.replaceChildren(...state.files.map((file, i) => {
    const item = document.createElement("div");
    item.className = `file-item${file.isImage ? " image-item" : ""}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = file.isImage ? "image-remove-button" : "ghost-button";
    remove.textContent = file.isImage ? "×" : "移除";
    remove.onclick = () => {
      state.files.splice(i, 1);
      renderFiles();
      refreshMetrics();
    };

    if (file.isImage) {
      const img = document.createElement("img");
      img.className = "file-thumb";
      img.src = file.dataUrl;
      img.alt = file.name;
      img.ondblclick = () => openLightbox(
        state.files.filter((f) => f.isImage),
        state.files.filter((f) => f.isImage).findIndex((f) => f.id === file.id)
      );
      item.append(remove, img);
    }

    const name = document.createElement("strong");
    name.textContent = file.name;

    const meta = document.createElement("div");
    meta.className = "tool-activity-text";
    meta.textContent = file.isImage
      ? `${formatBytes(file.size)} · 图片附件`
      : `${formatBytes(file.size)} · 已注入 ${file.content.length} 字符`;

    item.append(name, meta);
    if (!file.isImage) {
      item.append(remove);
    }
    return item;
  }));
};
init().then(() => loadWorkspacePersonaPresets()).catch(() => {});

const CHAT_HISTORY_KEY = "local-ai-chat-history-records";
const CURRENT_CHAT_KEY = "local-ai-current-chat-id";

function historyElements() {
  return {
    saveButton: $("#save-chat-history"),
    newButton: $("#new-chat-session"),
    deleteButton: $("#delete-chat-session"),
    list: $("#chat-history-list"),
    meta: $("#chat-history-meta"),
    undo: $("#chat-history-undo"),
    title: $("#current-chat-title"),
  };
}

const chatHistoryRuntime = {
  currentId: null,
  suppressAutoSave: false,
  pendingDelete: null,
  pendingDeleteTimer: null,
  pendingDeleteCountdownTimer: null,
};

const scheduledTaskDeliveryRuntime = {
  initialized: false,
  timer: null,
};

const conversationTurnDeleteRuntime = {
  pending: null,
  timer: null,
  countdownTimer: null,
};

function readChatHistoryRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]");
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeChatHistoryRecords(records) {
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(records));
  renderChatHistoryUndo();
}

function readScheduledTaskDeliveryState() {
  try {
    const stateMap = JSON.parse(localStorage.getItem(SCHEDULED_TASK_DELIVERY_KEY) || "{}");
    return stateMap && typeof stateMap === "object" ? stateMap : {};
  } catch {
    return {};
  }
}

function writeScheduledTaskDeliveryState(stateMap) {
  localStorage.setItem(SCHEDULED_TASK_DELIVERY_KEY, JSON.stringify(stateMap));
}

function conversationTurnUndoElement() {
  return $("#conversation-turn-undo");
}

function clearPendingConversationTurnDelete({ preserveUi = false } = {}) {
  if (conversationTurnDeleteRuntime.timer) {
    clearTimeout(conversationTurnDeleteRuntime.timer);
    conversationTurnDeleteRuntime.timer = null;
  }
  if (conversationTurnDeleteRuntime.countdownTimer) {
    clearInterval(conversationTurnDeleteRuntime.countdownTimer);
    conversationTurnDeleteRuntime.countdownTimer = null;
  }
  conversationTurnDeleteRuntime.pending = null;
  if (!preserveUi) {
    renderConversationTurnUndo();
  }
}

function renderConversationTurnUndo() {
  const el = conversationTurnUndoElement();
  if (!el) return;

  const pending = conversationTurnDeleteRuntime.pending;
  if (!pending) {
    el.classList.add("is-hidden");
    el.replaceChildren();
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
  el.classList.remove("is-hidden");

  const text = document.createElement("div");
  text.className = "chat-history-undo-text";
  text.textContent = `已删除这一轮对话，${secondsLeft} 秒内可撤销。`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button chat-history-undo-button";
  button.textContent = "撤销";
  button.addEventListener("click", () => undoDeleteConversationTurn());

  el.replaceChildren(text, button);
}

function findConversationTurnRange(messages, assistantIndex) {
  if (!Array.isArray(messages) || assistantIndex < 0 || assistantIndex >= messages.length) return null;
  if (messages[assistantIndex]?.role !== "assistant") return null;

  let userIndex = -1;
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    const role = messages[i]?.role;
    if (role === "assistant") break;
    if (role === "user") {
      userIndex = i;
      break;
    }
  }

  if (userIndex < 0) return null;
  return { start: userIndex, end: assistantIndex };
}

function persistCurrentConversationAfterTurnDelete(previousRecords = null) {
  const records = previousRecords || readChatHistoryRecords();
  if (!chatHistoryRuntime.currentId) {
    renderChatHistoryList();
    updateChatHistoryMeta();
    updateCurrentChatTitle();
    return;
  }

  if (!state.messages.length) {
    writeChatHistoryRecords(records.filter((record) => record.id !== chatHistoryRuntime.currentId));
    chatHistoryRuntime.currentId = null;
    persistCurrentChatId();
    renderChatHistoryList();
    updateChatHistoryMeta();
    updateCurrentChatTitle();
    return;
  }

  const current = records.find((record) => record.id === chatHistoryRuntime.currentId);
  const updatedRecord = {
    id: chatHistoryRuntime.currentId,
    title: buildChatTitle(state.messages),
    createdAt: current?.createdAt || Date.now(),
    updatedAt: Date.now(),
    model: selectedModel(),
    assistantName: els.assistantName?.value.trim() || "繁星",
    userName: els.userName?.value.trim() || "文远",
    messages: JSON.parse(JSON.stringify(state.messages)),
  };
  const nextRecords = records.filter((record) => record.id !== updatedRecord.id);
  nextRecords.unshift(updatedRecord);
  writeChatHistoryRecords(nextRecords);
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
}

function deleteConversationTurn(assistantIndex) {
  const range = findConversationTurnRange(state.messages, assistantIndex);
  if (!range) {
    setStatus("这一轮对话暂时无法删除");
    return;
  }

  const snapshot = {
    messages: JSON.parse(JSON.stringify(state.messages)),
    records: JSON.parse(JSON.stringify(readChatHistoryRecords())),
    currentId: chatHistoryRuntime.currentId,
  };

  state.messages.splice(range.start, range.end - range.start + 1);
  clearPendingConversationTurnDelete({ preserveUi: true });
  conversationTurnDeleteRuntime.pending = {
    snapshot,
    expiresAt: Date.now() + 15000,
  };

  conversationTurnDeleteRuntime.timer = window.setTimeout(() => {
    clearPendingConversationTurnDelete();
  }, 15000);

  conversationTurnDeleteRuntime.countdownTimer = window.setInterval(() => {
    if (!conversationTurnDeleteRuntime.pending) {
      clearPendingConversationTurnDelete();
      return;
    }
    if (Date.now() >= conversationTurnDeleteRuntime.pending.expiresAt) {
      clearPendingConversationTurnDelete();
      return;
    }
    renderConversationTurnUndo();
  }, 1000);

  renderConversationFromMessages(state.messages);
  persistCurrentConversationAfterTurnDelete(snapshot.records);
  renderConversationTurnUndo();
  setStatus("已删除这一轮对话");
}

function undoDeleteConversationTurn() {
  const pending = conversationTurnDeleteRuntime.pending;
  if (!pending?.snapshot) return;

  state.messages = JSON.parse(JSON.stringify(pending.snapshot.messages || []));
  writeChatHistoryRecords(JSON.parse(JSON.stringify(pending.snapshot.records || [])));
  chatHistoryRuntime.currentId = pending.snapshot.currentId || null;
  persistCurrentChatId();
  clearPendingConversationTurnDelete();
  renderConversationFromMessages(state.messages);
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
  setStatus("已恢复这一轮对话");
}

function decorateConversationTurnDeleteButtons() {
  if (!els.chatMessages) return;
  const cards = Array.from(els.chatMessages.querySelectorAll("article.message"));
  cards.forEach((card) => card.querySelector(".conversation-turn-delete-button")?.remove());

  if (!state.messages.length) return;
  cards.forEach((card, index) => {
    const message = state.messages[index];
    if (!message || message.role !== "assistant") return;
    const range = findConversationTurnRange(state.messages, index);
    if (!range) return;

    const head = card.querySelector(".message-head");
    if (!head) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-turn-delete-button";
    button.textContent = "删除这轮";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteConversationTurn(index);
    });
    head.append(button);
  });
}

function persistCurrentChatId() {
  if (chatHistoryRuntime.currentId) {
    localStorage.setItem(CURRENT_CHAT_KEY, chatHistoryRuntime.currentId);
  } else {
    localStorage.removeItem(CURRENT_CHAT_KEY);
  }
}

function clearPendingDeletedChat({ preserveUi = false } = {}) {
  if (chatHistoryRuntime.pendingDeleteTimer) {
    clearTimeout(chatHistoryRuntime.pendingDeleteTimer);
    chatHistoryRuntime.pendingDeleteTimer = null;
  }
  if (chatHistoryRuntime.pendingDeleteCountdownTimer) {
    clearInterval(chatHistoryRuntime.pendingDeleteCountdownTimer);
    chatHistoryRuntime.pendingDeleteCountdownTimer = null;
  }
  chatHistoryRuntime.pendingDelete = null;
  if (!preserveUi) {
    renderChatHistoryUndo();
  }
}

function renderChatHistoryUndo() {
  const { undo } = historyElements();
  if (!undo) return;

  const pending = chatHistoryRuntime.pendingDelete;
  if (!pending) {
    undo.classList.add("is-hidden");
    undo.replaceChildren();
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
  undo.classList.remove("is-hidden");

  const text = document.createElement("div");
  text.className = "chat-history-undo-text";
  text.textContent = `已删除会话「${pending.record.title || "未命名会话"}」，${secondsLeft} 秒内可撤销。`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button chat-history-undo-button";
  button.textContent = "撤销";
  button.addEventListener("click", () => undoDeleteChatRecord());

  undo.replaceChildren(text, button);
}

function beginDeletedChatUndo(record, { wasCurrent = false } = {}) {
  clearPendingDeletedChat({ preserveUi: true });
  const expiresAt = Date.now() + 15000;
  chatHistoryRuntime.pendingDelete = { record, wasCurrent, expiresAt };

  chatHistoryRuntime.pendingDeleteTimer = window.setTimeout(() => {
    clearPendingDeletedChat();
    renderChatHistoryList();
    updateChatHistoryMeta();
    updateCurrentChatTitle();
  }, 15000);

  chatHistoryRuntime.pendingDeleteCountdownTimer = window.setInterval(() => {
    if (!chatHistoryRuntime.pendingDelete) {
      clearPendingDeletedChat();
      return;
    }
    if (Date.now() >= chatHistoryRuntime.pendingDelete.expiresAt) {
      clearPendingDeletedChat();
      renderChatHistoryList();
      updateChatHistoryMeta();
      updateCurrentChatTitle();
      return;
    }
    renderChatHistoryUndo();
  }, 1000);

  renderChatHistoryUndo();
}

function undoDeleteChatRecord() {
  const pending = chatHistoryRuntime.pendingDelete;
  if (!pending?.record) return;

  const records = readChatHistoryRecords();
  const nextRecords = records.filter((record) => record.id !== pending.record.id);
  nextRecords.unshift(pending.record);
  writeChatHistoryRecords(nextRecords);

  if (pending.wasCurrent) {
    chatHistoryRuntime.currentId = pending.record.id;
    persistCurrentChatId();
    renderConversationFromMessages(pending.record.messages || []);
  }

  clearPendingDeletedChat();
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
  setStatus(`已恢复聊天记录：${pending.record.title || "未命名会话"}`);
}

function clearDeletedChatContext() {
  chatHistoryRuntime.currentId = null;
  persistCurrentChatId();
  if (els.userInput) {
    els.userInput.value = "";
  }
  clearFiles();
  renderConversationFromMessages([]);
  refreshMetrics();
}

function deleteCurrentChatSession() {
  if (chatHistoryRuntime.currentId) {
    deleteChatRecord(chatHistoryRuntime.currentId);
    return;
  }

  if (!state.messages.length) {
    setStatus("当前没有可删除的会话");
    return;
  }

  const confirmed = window.confirm("当前会话还没有保存到聊天记录中，删除后将直接清空当前对话。是否继续？");
  if (!confirmed) return;

  clearDeletedChatContext();
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
  setStatus("已删除当前未保存会话");
}

function getCurrentChatRecord() {
  return readChatHistoryRecords().find((record) => record.id === chatHistoryRuntime.currentId) || null;
}

function buildChatTitle(messages = state.messages) {
  const firstUser = messages.find((message) => message.role === "user" && typeof message.content === "string" && message.content.trim());
  const raw = firstUser?.content?.trim() || "未命名会话";
  return raw.length > 24 ? `${raw.slice(0, 24)}...` : raw;
}

function formatHistoryTime(timestamp) {
  if (!timestamp) {
    return "刚刚";
  }
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mi = `${date.getMinutes()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function updateChatHistoryMeta() {
  const { meta } = historyElements();
  if (!meta) {
    return;
  }

  renderChatHistoryUndo();

  const current = getCurrentChatRecord();
  if (!state.messages.length && !current) {
    meta.textContent = "当前还没有保存的聊天记录。";
    return;
  }

  if (!current) {
    meta.textContent = `当前会话未入库，已有 ${state.messages.length} 条消息。`;
    return;
  }

  meta.textContent = `当前会话：${current.title} · ${current.messages.length} 条消息 · 更新于 ${formatHistoryTime(current.updatedAt)}`;
}

function updateCurrentChatTitle() {
  const { title } = historyElements();
  if (!title) {
    return;
  }

  const current = getCurrentChatRecord();
  if (current?.title) {
    title.textContent = current.title;
    return;
  }

  if (state.messages.length) {
    title.textContent = `${buildChatTitle(state.messages)}（未保存）`;
    return;
  }

  title.textContent = "未命名会话";
}

function renderChatHistoryList() {
  const { list } = historyElements();
  if (!list) {
    return;
  }

  const records = readChatHistoryRecords().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!records.length) {
    list.innerHTML = '<div class="file-empty">还没有聊天记录。</div>';
    updateChatHistoryMeta();
    updateCurrentChatTitle();
    return;
  }

  list.replaceChildren(...records.map((record) => {
    const item = document.createElement("div");
    item.className = `chat-history-item${record.id === chatHistoryRuntime.currentId ? " is-active" : ""}`;
    item.addEventListener("click", () => loadChatRecord(record.id));

    const main = document.createElement("div");
    main.className = "chat-history-main";

    const title = document.createElement("p");
    title.className = "chat-history-title";
    title.textContent = record.title || "未命名会话";

    const meta = document.createElement("div");
    meta.className = "chat-history-meta-line";
    meta.textContent = `${record.messages.length} 条消息 · ${formatHistoryTime(record.updatedAt)}`;

    main.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "chat-history-actions";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost-button history-delete-button";
    remove.textContent = "删除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChatRecord(record.id);
    });

    actions.append(remove);
    item.append(main, actions);
    return item;
  }));

  updateChatHistoryMeta();
}

function renderConversationFromMessages(messages) {
  chatHistoryRuntime.suppressAutoSave = true;
  state.messages = Array.isArray(messages) ? JSON.parse(JSON.stringify(messages)) : [];
  els.chatMessages?.replaceChildren();

  if (!state.messages.length) {
    appendMessage("assistant", "你好，我已经准备好连接本地 AI。你可以先测试连接、读取模型、上传文件，或者启用某个技能后再开始提问。");
  } else {
    state.messages.forEach((message) => {
      appendMessage(
        message.role,
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        message.role,
        [],
        message.timestamp || Date.now()
      );
    });
  }

  refreshMetrics();
  chatHistoryRuntime.suppressAutoSave = false;
  updateCurrentChatTitle();
}

function upsertChatRecord(options = {}) {
  if (chatHistoryRuntime.suppressAutoSave || !state.messages.length) {
    renderChatHistoryList();
    return null;
  }

  const manualTitle = options.title?.trim();
  const forceNew = Boolean(options.forceNew);
  const records = readChatHistoryRecords();
  const now = Date.now();
  const nextId = forceNew || !chatHistoryRuntime.currentId ? `chat-${nowId()}` : chatHistoryRuntime.currentId;
  const nextRecord = {
    id: nextId,
    title: manualTitle || buildChatTitle(),
    createdAt: forceNew ? now : (records.find((record) => record.id === nextId)?.createdAt || now),
    updatedAt: now,
    model: selectedModel(),
    assistantName: els.assistantName?.value.trim() || "繁星",
    userName: els.userName?.value.trim() || "文远",
    messages: JSON.parse(JSON.stringify(state.messages)),
  };

  const nextRecords = records.filter((record) => record.id !== nextId);
  nextRecords.unshift(nextRecord);
  writeChatHistoryRecords(nextRecords);
  chatHistoryRuntime.currentId = nextId;
  persistCurrentChatId();
  renderChatHistoryList();
  updateCurrentChatTitle();
  return nextRecord;
}

function autoSaveCurrentChat() {
  upsertChatRecord();
}

function loadChatRecord(recordId) {
  const record = readChatHistoryRecords().find((item) => item.id === recordId);
  if (!record) {
    return;
  }

  chatHistoryRuntime.currentId = record.id;
  persistCurrentChatId();
  renderConversationFromMessages(record.messages || []);
  renderChatHistoryList();
  setStatus(`已载入聊天记录：${record.title}`);
}

function deleteChatRecord(recordId) {
  const records = readChatHistoryRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) {
    return;
  }

  const confirmed = window.confirm(`确定删除聊天记录“${target.title}”吗？`);
  if (!confirmed) {
    return;
  }

  writeChatHistoryRecords(records.filter((record) => record.id !== recordId));
  if (chatHistoryRuntime.currentId === recordId) {
    chatHistoryRuntime.currentId = null;
    persistCurrentChatId();
    renderConversationFromMessages([]);
  }
  renderChatHistoryList();
  setStatus(`已删除聊天记录：${target.title}`);
}

function saveCurrentChatAsManualRecord() {
  if (!state.messages.length) {
    setStatus("当前会话还没有可保存的内容");
    return;
  }

  const defaultTitle = buildChatTitle();
  const title = window.prompt("请输入这条聊天记录的名称：", defaultTitle);
  if (title == null) {
    return;
  }

  const record = upsertChatRecord({
    title: title.trim() || defaultTitle,
    forceNew: true,
  });
  if (record) {
    setStatus(`已保存聊天记录：${record.title}`);
  }
}

function startNewChatSession() {
  chatHistoryRuntime.currentId = null;
  persistCurrentChatId();
  renderConversationFromMessages([]);
  renderChatHistoryList();
  setStatus("已新建空白会话");
  updateCurrentChatTitle();
}

function restoreLastChatSession() {
  const records = readChatHistoryRecords().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const savedCurrentId = localStorage.getItem(CURRENT_CHAT_KEY);
  const record = records.find((item) => item.id === savedCurrentId) || records[0];
  if (!record) {
    renderChatHistoryList();
    return;
  }
  loadChatRecord(record.id);
}

function buildScheduledTaskDeliverySignature(task) {
  return `${task.lastRunAt || 0}:${task.lastStatus || "idle"}`;
}

function markScheduledTaskDelivery(task) {
  if (!task?.id || !task?.lastRunAt) {
    return;
  }
  const stateMap = readScheduledTaskDeliveryState();
  stateMap[task.id] = buildScheduledTaskDeliverySignature(task);
  writeScheduledTaskDeliveryState(stateMap);
}

function shouldDeliverScheduledTask(task) {
  if (!task?.id || !task?.lastRunAt) {
    return false;
  }
  if (task.lastStatus !== "success" && task.lastStatus !== "error") {
    return false;
  }
  const stateMap = readScheduledTaskDeliveryState();
  return stateMap[task.id] !== buildScheduledTaskDeliverySignature(task);
}

function pushScheduledTaskResultToChat(task) {
  const taskName = task?.name || "未命名任务";
  const runTime = formatScheduleTime(task.lastRunAt);
  const summary = task.lastStatus === "error"
    ? `定时任务「${taskName}」执行失败\n执行时间：${runTime}`
    : `定时任务「${taskName}」已执行\n执行时间：${runTime}`;
  const detail = task.lastError || task.lastResult || "任务已执行，但没有返回内容。";
  const shouldCreateFreshSession = !chatHistoryRuntime.currentId && !state.messages.length;

  if (shouldCreateFreshSession) {
    els.chatMessages?.replaceChildren();
  }

  const taskTimestamp = task.lastRunAt || Date.now();
  appendMessage("system", summary, task.lastStatus === "error" ? "error" : "success", [], taskTimestamp);
  appendMessage("assistant", detail, "assistant", [], taskTimestamp);
  state.messages.push(
    { role: "system", content: summary, timestamp: taskTimestamp },
    { role: "assistant", content: detail, timestamp: taskTimestamp }
  );

  upsertChatRecord({
    title: shouldCreateFreshSession ? `${taskName} · 定时任务` : undefined,
    forceNew: shouldCreateFreshSession,
  });
  refreshMetrics();
  setStatus(`定时任务结果已推送到当前会话：${taskName}`);
}

function syncScheduledTaskDeliveries(tasks, { baselineOnly = false } = {}) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return;
  }

  if (baselineOnly) {
    tasks.forEach((task) => markScheduledTaskDelivery(task));
    return;
  }

  tasks
    .filter((task) => shouldDeliverScheduledTask(task))
    .sort((left, right) => (left.lastRunAt || 0) - (right.lastRunAt || 0))
    .forEach((task) => {
      pushScheduledTaskResultToChat(task);
      markScheduledTaskDelivery(task);
    });
}

function setupChatHistoryFeature() {
  const { saveButton, newButton, deleteButton } = historyElements();

  saveButton?.addEventListener("click", () => {
    spark(saveButton);
    saveCurrentChatAsManualRecord();
  });

  newButton?.addEventListener("click", () => {
    spark(newButton);
    startNewChatSession();
  });

  deleteButton?.addEventListener("click", () => {
    spark(deleteButton);
    deleteCurrentChatSession();
  });

  const originalAskModel = askModel;
  askModel = async function askModelWithHistory(userText) {
    const result = await originalAskModel(userText);
    autoSaveCurrentChat();
    return result;
  };

  const originalResetChat = resetChat;
  resetChat = function resetChatWithHistory() {
    originalResetChat();
    chatHistoryRuntime.currentId = null;
    persistCurrentChatId();
    renderChatHistoryList();
  };

  els.clearChat?.addEventListener("click", () => {
    chatHistoryRuntime.currentId = null;
    persistCurrentChatId();
    renderChatHistoryList();
  });

  renderChatHistoryList();
  restoreLastChatSession();
}

setupChatHistoryFeature();

function getHistoryGroupLabel(timestamp) {
  const date = new Date(timestamp || Date.now());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  if (target.getTime() === today.getTime()) {
    return "今天";
  }
  if (target.getTime() === yesterday.getTime()) {
    return "昨天";
  }
  return "更早";
}

function renameChatRecord(recordId) {
  const records = readChatHistoryRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) {
    return;
  }

  const nextTitle = window.prompt("请输入新的聊天记录名称：", target.title || "未命名会话");
  if (nextTitle == null) {
    return;
  }

  const trimmed = nextTitle.trim();
  if (!trimmed) {
    setStatus("聊天记录名称不能为空");
    return;
  }

  target.title = trimmed;
  target.updatedAt = Date.now();
  writeChatHistoryRecords(records);
  renderChatHistoryList();
  setStatus(`已重命名聊天记录：${trimmed}`);
}

renderChatHistoryList = function renderChatHistoryListGrouped() {
  const { list } = historyElements();
  if (!list) {
    return;
  }

  const records = readChatHistoryRecords().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!records.length) {
    list.innerHTML = '<div class="file-empty">还没有聊天记录。</div>';
    updateChatHistoryMeta();
    return;
  }

  const groups = new Map();
  records.forEach((record) => {
    const label = getHistoryGroupLabel(record.updatedAt);
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(record);
  });

  const fragments = [];
  ["今天", "昨天", "更早"].forEach((label) => {
    const groupRecords = groups.get(label);
    if (!groupRecords?.length) {
      return;
    }

    const group = document.createElement("section");
    group.className = "chat-history-group";

    const heading = document.createElement("div");
    heading.className = "chat-history-group-label";
    heading.textContent = label;
    group.append(heading);

    groupRecords.forEach((record) => {
      const item = document.createElement("div");
      item.className = `chat-history-item${record.id === chatHistoryRuntime.currentId ? " is-active" : ""}`;
      item.addEventListener("click", () => loadChatRecord(record.id));

      const main = document.createElement("div");
      main.className = "chat-history-main";

      const title = document.createElement("p");
      title.className = "chat-history-title";
      title.textContent = record.title || "未命名会话";

      const meta = document.createElement("div");
      meta.className = "chat-history-meta-line";
      meta.textContent = `${record.messages.length} 条消息 · ${formatHistoryTime(record.updatedAt)}`;

      main.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "chat-history-actions";

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "ghost-button history-rename-button";
      rename.textContent = "重命名";
      rename.addEventListener("click", (event) => {
        event.stopPropagation();
        renameChatRecord(record.id);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ghost-button history-delete-button";
      remove.textContent = "删除";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteChatRecord(record.id);
      });

      actions.append(rename, remove);
      item.append(main, actions);
      group.append(item);
    });

    fragments.push(group);
  });

  list.replaceChildren(...fragments);
  updateChatHistoryMeta();
  updateCurrentChatTitle();
};

renderChatHistoryList();

function collectQqSettingsSnapshot() {
  return {
    qqPushEnabled: Boolean(els.qqPushEnabled?.checked),
    qqBridgeUrl: els.qqBridgeUrl?.value?.trim() || "",
    qqAccessToken: els.qqAccessToken?.value?.trim() || "",
    qqTargetType: els.qqTargetType?.value || "private",
    qqTargetId: els.qqTargetId?.value?.trim() || "",
    qqBotEnabled: Boolean(els.qqBotEnabled?.checked),
    qqBotGroupMentionOnly: Boolean(els.qqBotGroupMentionOnly?.checked),
    qqTaskPushEnabled: Boolean(els.qqTaskPushEnabled?.checked),
    qqBotModel: els.qqBotModelSelect?.value || "",
    qqBotTriggerPrefix: els.qqBotTriggerPrefix?.value?.trim() || "",
    qqBotAllowedUsers: els.qqBotAllowedUsers?.value || "",
    qqBotAllowedGroups: els.qqBotAllowedGroups?.value || "",
    qqBotPersona: els.qqBotPersona?.value || "",
    qqBotPersonaPreset: els.qqBotPersonaPreset?.value || "none",
  };
}

function restoreQqSettingsSnapshot(snapshot = {}) {
  if (els.qqPushEnabled) els.qqPushEnabled.checked = Boolean(snapshot.qqPushEnabled);
  if (els.qqBridgeUrl) els.qqBridgeUrl.value = snapshot.qqBridgeUrl || "";
  if (els.qqAccessToken) els.qqAccessToken.value = snapshot.qqAccessToken || "";
  if (els.qqTargetType) els.qqTargetType.value = snapshot.qqTargetType || "private";
  if (els.qqTargetId) els.qqTargetId.value = snapshot.qqTargetId || "";
  if (els.qqBotEnabled) els.qqBotEnabled.checked = Boolean(snapshot.qqBotEnabled);
  if (els.qqBotGroupMentionOnly) els.qqBotGroupMentionOnly.checked = snapshot.qqBotGroupMentionOnly !== false;
  if (els.qqTaskPushEnabled) els.qqTaskPushEnabled.checked = Boolean(snapshot.qqTaskPushEnabled);
  if (els.qqBotModelSelect) els.qqBotModelSelect.value = snapshot.qqBotModel || "";
  if (els.qqBotTriggerPrefix) els.qqBotTriggerPrefix.value = snapshot.qqBotTriggerPrefix || "";
  if (els.qqBotAllowedUsers) els.qqBotAllowedUsers.value = snapshot.qqBotAllowedUsers || "";
  if (els.qqBotAllowedGroups) els.qqBotAllowedGroups.value = snapshot.qqBotAllowedGroups || "";
  if (els.qqBotPersona) els.qqBotPersona.value = snapshot.qqBotPersona || "";
  if (els.qqBotPersonaPreset) els.qqBotPersonaPreset.value = snapshot.qqBotPersonaPreset || "none";
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqBotPersonaPresetDescription();
}

function persistQqSettingsIndependently() {
  const current = saved();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    ...collectQqSettingsSnapshot(),
  }));
}

function restoreQqSettingsIndependently() {
  restoreQqSettingsSnapshot(saved());
}

function bindQqSettingsPersistence() {
  const targets = [
    els.qqPushEnabled,
    els.qqBridgeUrl,
    els.qqAccessToken,
    els.qqTargetType,
    els.qqTargetId,
    els.qqBotEnabled,
    els.qqBotGroupMentionOnly,
    els.qqTaskPushEnabled,
    els.qqBotModelSelect,
    els.qqBotTriggerPrefix,
    els.qqBotAllowedUsers,
    els.qqBotAllowedGroups,
    els.qqBotPersona,
    els.qqBotPersonaPreset,
  ].filter(Boolean);

  targets.forEach((el) => {
    if (el.dataset.qqPersistenceBound === "true") return;
    el.dataset.qqPersistenceBound = "true";
    ["input", "change", "blur"].forEach((eventName) => {
      el.addEventListener(eventName, () => {
        persistQqSettingsIndependently();
        renderQqPushMeta();
        renderQqBotMeta();
        renderQqBotPersonaPresetDescription();
      });
    });
  });
}

bindQqSettingsPersistence();
restoreQqSettingsIndependently();
window.setTimeout(() => {
  restoreQqSettingsIndependently();
  bindQqSettingsPersistence();
}, 0);

renderQqBotPersonaPresets = function renderQqBotPersonaPresetsMirrorMain() {
  if (!els.qqBotPersonaPreset) return;

  const persistedValue = saved().qqBotPersonaPreset || "none";
  const currentValue = els.qqBotPersonaPreset.value || persistedValue || "none";

  if (els.personaPreset) {
    const sourceNodes = Array.from(els.personaPreset.children || []).map((node) => node.cloneNode(true));
    const optionValues = Array.from(els.personaPreset.querySelectorAll("option")).map((option) => option.value);
    if (sourceNodes.length) {
      els.qqBotPersonaPreset.replaceChildren(...sourceNodes);
      els.qqBotPersonaPreset.value = optionValues.includes(currentValue) ? currentValue : "none";
      renderQqBotPersonaPresetDescription();
      return;
    }
  }

  const fallback = document.createElement("option");
  fallback.value = "none";
  fallback.textContent = "不使用预设";
  els.qqBotPersonaPreset.replaceChildren(fallback);
  els.qqBotPersonaPreset.value = "none";
  renderQqBotPersonaPresetDescription();
};

renderQqBotPersonaPresets();

const renderPersonaPresetsBeforeQqMirrorFinal = renderPersonaPresets;
renderPersonaPresets = function renderPersonaPresetsWithQqMirrorFinal() {
  renderPersonaPresetsBeforeQqMirrorFinal();
  renderQqBotPersonaPresets();
};

const loadWorkspacePersonaPresetsBeforeQqMirrorFinal = loadWorkspacePersonaPresets;
loadWorkspacePersonaPresets = async function loadWorkspacePersonaPresetsWithQqMirrorFinal() {
  await loadWorkspacePersonaPresetsBeforeQqMirrorFinal();
  renderQqBotPersonaPresets();
};

const loadBeforeQqMirrorFinal = load;
load = function loadWithQqMirrorFinal() {
  loadBeforeQqMirrorFinal();
  renderQqBotPersonaPresets();
};

let qqBotPersonaPresetMirrorObserver = null;

function syncQqBotPersonaPresetsFromMainSelect() {
  if (!els.personaPreset || !els.qqBotPersonaPreset) return;
  const preservedValue = saved().qqBotPersonaPreset || els.qqBotPersonaPreset.value || "none";
  renderQqBotPersonaPresets();
  const availableValues = Array.from(els.qqBotPersonaPreset.querySelectorAll("option")).map((option) => option.value);
  els.qqBotPersonaPreset.value = availableValues.includes(preservedValue) ? preservedValue : "none";
  renderQqBotPersonaPresetDescription();
}

function bindQqBotPersonaPresetMirrorObserver() {
  if (!els.personaPreset || !els.qqBotPersonaPreset) return;
  if (qqBotPersonaPresetMirrorObserver) {
    qqBotPersonaPresetMirrorObserver.disconnect();
  }
  qqBotPersonaPresetMirrorObserver = new MutationObserver(() => {
    syncQqBotPersonaPresetsFromMainSelect();
  });
  qqBotPersonaPresetMirrorObserver.observe(els.personaPreset, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["label", "value"],
  });
  syncQqBotPersonaPresetsFromMainSelect();
}

bindQqBotPersonaPresetMirrorObserver();
window.setTimeout(() => {
  bindQqBotPersonaPresetMirrorObserver();
  syncQqBotPersonaPresetsFromMainSelect();
}, 0);
window.setTimeout(() => {
  syncQqBotPersonaPresetsFromMainSelect();
}, 400);
window.setTimeout(() => {
  syncQqBotPersonaPresetsFromMainSelect();
}, 1200);

function renderQqBotModelOptions() {
  if (!els.qqBotModelSelect || !els.modelSelect) return;
  const persistedValue = saved().qqBotModel || els.qqBotModelSelect.value || "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "跟随基础连接当前模型";
  const sourceNodes = Array.from(els.modelSelect.querySelectorAll("option"))
    .filter((option) => option.value)
    .map((option) => option.cloneNode(true));
  els.qqBotModelSelect.replaceChildren(placeholder, ...sourceNodes);
  const validValues = ["", ...sourceNodes.map((option) => option.value)];
  els.qqBotModelSelect.value = validValues.includes(persistedValue) ? persistedValue : "";
}

let qqBotModelMirrorObserver = null;

function bindQqBotModelMirrorObserver() {
  if (!els.qqBotModelSelect || !els.modelSelect) return;
  if (qqBotModelMirrorObserver) {
    qqBotModelMirrorObserver.disconnect();
  }
  qqBotModelMirrorObserver = new MutationObserver(() => {
    renderQqBotModelOptions();
    renderQqBotMeta();
  });
  qqBotModelMirrorObserver.observe(els.modelSelect, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["label", "value"],
  });
  renderQqBotModelOptions();
}

bindQqBotModelMirrorObserver();
window.setTimeout(() => {
  bindQqBotModelMirrorObserver();
  renderQqBotModelOptions();
  renderQqBotMeta();
}, 0);
window.setTimeout(() => {
  renderQqBotModelOptions();
  renderQqBotMeta();
}, 600);

renderQqBotMeta = function renderQqBotMetaFinal() {
  if (!els.qqBotMeta) return;
  const config = getQqBotSettings();
  if (!config.enabled) {
    els.qqBotMeta.textContent = "当前未启用 QQ 机器人自动回复。";
    return;
  }
  const modelText = config.model || selectedModel() || "未选择";
  const prefixText = config.triggerPrefix ? ` · 前缀：${config.triggerPrefix}` : "";
  const taskPushText = config.taskPushEnabled ? " · 定时任务推送已开启" : "";
  els.qqBotMeta.textContent = `QQ 机器人已启用 · 模型：${modelText} · 群聊模式：${config.groupMentionOnly ? "仅 @ 时回复" : "允许直接回复"}${prefixText}${taskPushText}`;
};
renderQqBotMeta();
els.modelSelect?.addEventListener("change", () => {
  renderQqBotModelOptions();
  renderQqBotMeta();
  syncQqBotConfig().catch(() => {});
});

const systemMessagesBeforeQqRuleFinal = systemMessages;
systemMessages = function systemMessagesWithQqRuleFinal() {
  const list = systemMessagesBeforeQqRuleFinal().filter((message) => !String(message?.content || "").includes("当前已配置 QQ 推送通道"));
  const config = getQqPushSettings();
  if (config.enabled && config.bridgeUrl && config.targetId) {
    list.push({
      role: "system",
      content: `当前已配置 QQ 推送通道。若用户明确要求发送到 QQ、推送到 QQ 或发 QQ 提醒，你可以调用 send_qq_message。默认目标类型：${config.targetType === "group" ? "group" : "private"}；默认目标 ID：${config.targetId}。`,
    });
  }
  return list;
};

const renderPersonaPresetsBeforeQqBotPresets = renderPersonaPresets;
renderPersonaPresets = function renderPersonaPresetsWithQqBotPresets() {
  renderPersonaPresetsBeforeQqBotPresets();
  renderQqBotPersonaPresets();
};

const loadWorkspacePersonaPresetsBeforeQqBotPresets = loadWorkspacePersonaPresets;
loadWorkspacePersonaPresets = async function loadWorkspacePersonaPresetsWithQqBotPresets() {
  await loadWorkspacePersonaPresetsBeforeQqBotPresets();
  renderQqBotPersonaPresets();
};

const initBeforeQqBotPersonaPresetRefresh = init;
init = async function initWithQqBotPersonaPresetRefresh() {
  await initBeforeQqBotPersonaPresetRefresh();
  renderQqBotPersonaPresets();
};

window.setTimeout(() => {
  renderQqBotPersonaPresets();
}, 0);

const executeToolBeforeQqInjectionFinal = executeTool;
executeTool = async function executeToolWithQqConfigInjectionFinal(toolCall) {
  const name = toolCall?.function?.name || "unknown";
  if (!QQ_TOOL_NAMES.has(name)) {
    return executeToolBeforeQqInjectionFinal(toolCall);
  }

  let args = {};
  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("QQ 工具参数不是合法 JSON");
  }

  const config = getQqPushSettings();
  if (!config.enabled || !config.bridgeUrl || !config.targetId) {
    throw new Error("QQ 推送未配置完成，请先在基础连接配置里填写桥接地址和目标 ID。");
  }

  const mergedArgs = {
    ...args,
    bridgeUrl: config.bridgeUrl,
    accessToken: config.accessToken,
    targetType: args.targetType || config.targetType || "private",
    targetId: args.targetId || config.targetId,
  };

  return executeToolBeforeQqInjectionFinal({
    ...toolCall,
    function: {
      ...(toolCall?.function || {}),
      arguments: JSON.stringify(mergedArgs),
    },
  });
};

const buildToolOnlyFallbackReplyBeforeQqFinal = buildToolOnlyFallbackReply;
buildToolOnlyFallbackReply = function buildToolOnlyFallbackReplyWithQqFinal(messages = []) {
  const original = buildToolOnlyFallbackReplyBeforeQqFinal(messages);
  if (typeof original === "string" && original.trim()) {
    return original.trim();
  }

  const parsed = parseLastToolResult(messages);
  if (parsed?.ok && parsed?.targetId && parsed?.message && parsed?.bridgeUrl) {
    return `已经帮你把消息发送到 QQ 了。\n目标：${parsed.targetType === "group" ? "群" : "QQ"} ${parsed.targetId}`;
  }

  return "";
};

const saveBeforeQqPersistence = save;
save = function saveWithQqPersistence() {
  saveBeforeQqPersistence();
  const current = saved();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    qqPushEnabled: Boolean(els.qqPushEnabled?.checked),
    qqBridgeUrl: els.qqBridgeUrl?.value.trim() || "",
    qqAccessToken: els.qqAccessToken?.value.trim() || "",
    qqTargetType: els.qqTargetType?.value || "private",
    qqTargetId: els.qqTargetId?.value.trim() || "",
    qqBotEnabled: Boolean(els.qqBotEnabled?.checked),
    qqBotGroupMentionOnly: Boolean(els.qqBotGroupMentionOnly?.checked),
    qqTaskPushEnabled: Boolean(els.qqTaskPushEnabled?.checked),
    qqBotModel: els.qqBotModelSelect?.value || "",
    qqBotTriggerPrefix: els.qqBotTriggerPrefix?.value.trim() || "",
    qqBotAllowedUsers: els.qqBotAllowedUsers?.value || "",
    qqBotAllowedGroups: els.qqBotAllowedGroups?.value || "",
    qqBotPersona: els.qqBotPersona?.value || "",
    qqBotPersonaPreset: els.qqBotPersonaPreset?.value || "none",
  }));
  renderQqPushMeta();
  renderQqBotMeta();
};

const loadBeforeQqPersistence = load;
load = function loadWithQqPersistence() {
  loadBeforeQqPersistence();
  const current = saved();
  if (els.qqPushEnabled) els.qqPushEnabled.checked = Boolean(current.qqPushEnabled);
  if (els.qqBridgeUrl) els.qqBridgeUrl.value = current.qqBridgeUrl || "";
  if (els.qqAccessToken) els.qqAccessToken.value = current.qqAccessToken || "";
  if (els.qqTargetType) els.qqTargetType.value = current.qqTargetType || "private";
  if (els.qqTargetId) els.qqTargetId.value = current.qqTargetId || "";
  if (els.qqBotEnabled) els.qqBotEnabled.checked = Boolean(current.qqBotEnabled);
  if (els.qqBotGroupMentionOnly) els.qqBotGroupMentionOnly.checked = current.qqBotGroupMentionOnly !== false;
  if (els.qqTaskPushEnabled) els.qqTaskPushEnabled.checked = Boolean(current.qqTaskPushEnabled);
  if (els.qqBotModelSelect) els.qqBotModelSelect.value = current.qqBotModel || "";
  if (els.qqBotTriggerPrefix) els.qqBotTriggerPrefix.value = current.qqBotTriggerPrefix || "";
  if (els.qqBotAllowedUsers) els.qqBotAllowedUsers.value = current.qqBotAllowedUsers || "";
  if (els.qqBotAllowedGroups) els.qqBotAllowedGroups.value = current.qqBotAllowedGroups || "";
  if (els.qqBotPersona) els.qqBotPersona.value = current.qqBotPersona || "";
  if (els.qqBotPersonaPreset) els.qqBotPersonaPreset.value = current.qqBotPersonaPreset || "none";
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqBotPersonaPresetDescription();
};

function collectStructuredContentText(content, parts = []) {
  if (content == null) return parts;

  if (typeof content === "string") {
    if (content.trim()) {
      parts.push(content);
    }
    return parts;
  }

  if (Array.isArray(content)) {
    content.forEach((item) => collectStructuredContentText(item, parts));
    return parts;
  }

  if (typeof content !== "object") {
    return parts;
  }

  const directTextKeys = ["text", "output_text", "content", "value", "message"];
  directTextKeys.forEach((key) => {
    const value = content[key];
    if (typeof value === "string" && value.trim()) {
      parts.push(value);
    }
  });

  const nestedKeys = ["content", "output", "parts", "items"];
  nestedKeys.forEach((key) => {
    const value = content[key];
    if (Array.isArray(value) || (value && typeof value === "object")) {
      collectStructuredContentText(value, parts);
    }
  });

  return parts;
}

normalizeContent = function normalizeContentStructured(content) {
  const text = collectStructuredContentText(content, [])
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || "";
};

function parseLastToolResult(messages = []) {
  const lastToolMessage = [...messages].reverse().find((message) => message?.role === "tool" && typeof message.content === "string");
  if (!lastToolMessage?.content) return null;

  try {
    const parsed = JSON.parse(lastToolMessage.content);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const buildToolOnlyFallbackReplyBeforeRichToolResult = buildToolOnlyFallbackReply;
buildToolOnlyFallbackReply = function buildToolOnlyFallbackReplyWithFileResult(messages = []) {
  const original = buildToolOnlyFallbackReplyBeforeRichToolResult(messages);
  if (typeof original === "string" && original.trim()) {
    return original.trim();
  }

  const parsed = parseLastToolResult(messages);
  if (!parsed) return "";

  if (parsed.path && typeof parsed.bytesWritten === "number") {
    return `已保存到本地：${parsed.path}\n写入 ${parsed.bytesWritten} 字节。`;
  }

  if (parsed.path && typeof parsed.content === "string") {
    return `已读取文件：${parsed.path}`;
  }

  if (parsed.path && parsed.deleted) {
    return `已删除文件：${parsed.path}`;
  }

  if (parsed.path && Array.isArray(parsed.entries)) {
    return `已读取目录：${parsed.path}\n共找到 ${parsed.entries.length} 项。`;
  }

  return "";
};

const explicitContextResetRuntime = {
  allowResetChat: false,
};

els.clearChat?.addEventListener("click", () => {
  explicitContextResetRuntime.allowResetChat = true;
}, true);

const resetChatBeforeExplicitOnlyGuard = resetChat;
resetChat = function resetChatExplicitOnly() {
  const hasRecoverableConversation =
    state.messages.length > 0 ||
    readChatHistoryRecords().length > 0 ||
    Boolean(localStorage.getItem(CURRENT_CHAT_KEY));

  const allowReset = explicitContextResetRuntime.allowResetChat || !hasRecoverableConversation;
  explicitContextResetRuntime.allowResetChat = false;

  if (!allowReset) {
    refreshMetrics();
    renderChatHistoryList();
    updateChatHistoryMeta();
    updateCurrentChatTitle();
    setStatus("已阻止非显式触发的会话清空，当前上下文保持不变。");
    return;
  }

  resetChatBeforeExplicitOnlyGuard();
};

function wireQqPushFeature() {
  [els.qqPushEnabled, els.qqBridgeUrl, els.qqAccessToken, els.qqTargetType, els.qqTargetId, els.qqBotEnabled, els.qqBotGroupMentionOnly, els.qqTaskPushEnabled, els.qqBotModelSelect, els.qqBotTriggerPrefix, els.qqBotAllowedUsers, els.qqBotAllowedGroups, els.qqBotPersona].forEach((el) => {
    el?.addEventListener("change", () => {
      save();
      renderQqPushMeta();
      renderQqBotMeta();
      syncQqBotConfig().catch(() => {});
    });
    el?.addEventListener("input", () => {
      renderQqPushMeta();
      renderQqBotMeta();
    });
  });

  els.testQqPush?.addEventListener("click", async () => {
    spark(els.testQqPush);
    const config = getQqPushSettings();
    if (!config.enabled || !config.bridgeUrl || !config.targetId) {
      setStatus("请先完整填写 QQ 推送配置后再测试");
      return;
    }
    try {
      await j("/tools/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "send_qq_message",
          arguments: {
            ...config,
            message: `本地 AI QQ 推送测试成功。时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
          },
        }),
      });
      appendMessage("system", `QQ 测试推送已发送到${config.targetType === "group" ? "群" : "QQ"}：${config.targetId}`, "success");
      setStatus("QQ 推送测试成功");
    } catch (error) {
      appendMessage("system", `QQ 推送测试失败：${error.message}`, "error");
      setStatus("QQ 推送测试失败");
    }
  });

  renderQqPushMeta();
  renderQqBotMeta();
  syncQqBotConfig().catch(() => {});
}

wireQqPushFeature();

els.qqBotPersonaPreset?.addEventListener("change", () => {
  const preset = presetById(els.qqBotPersonaPreset?.value || "none");
  if (els.qqBotPersona) {
    els.qqBotPersona.value = preset.prompt || "";
  }
  renderQqBotPersonaPresetDescription();
  save();
  syncQqBotConfig().catch(() => {});
  setStatus(preset.prompt ? `已应用 QQ 机器人模板：${preset.name}` : "当前 QQ 预设不会覆盖现有专属人设");
});

els.importQqBotPersona?.addEventListener("click", () => {
  spark(els.importQqBotPersona);
  els.qqBotPersonaFileInput?.click();
});

els.qqBotPersonaFileInput?.addEventListener("change", async (event) => {
  try {
    const [file] = Array.from(event.target.files || []);
    if (file && els.qqBotPersona) {
      els.qqBotPersona.value = await file.text();
      if (els.qqBotPersonaPreset) {
        els.qqBotPersonaPreset.value = "none";
      }
      renderQqBotPersonaPresetDescription();
      save();
      await syncQqBotConfig();
      setStatus(`已导入 QQ 机器人人设：${file.name || ""}`);
    }
  } catch (error) {
    appendMessage("system", `导入 QQ 机器人人设失败：${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
});

els.exportQqBotPersona?.addEventListener("click", () => {
  spark(els.exportQqBotPersona);
  const blob = new Blob([els.qqBotPersona?.value || "# QQ 机器人人设\n\n"], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "qq-bot-persona.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
  setStatus("已导出 QQ 机器人人设");
});

els.clearQqBotPersona?.addEventListener("click", async () => {
  spark(els.clearQqBotPersona);
  if (els.qqBotPersona) {
    els.qqBotPersona.value = "";
  }
  if (els.qqBotPersonaPreset) {
    els.qqBotPersonaPreset.value = "none";
  }
  renderQqBotPersonaPresetDescription();
  save();
  await syncQqBotConfig().catch(() => {});
  setStatus("已清空 QQ 机器人人设");
});

async function syncQqBotConfig() {
  const push = getQqPushSettings();
  const bot = getQqBotSettings();
  await j("/qq-bot/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: bot.enabled,
      groupMentionOnly: bot.groupMentionOnly,
      taskPushEnabled: bot.taskPushEnabled,
      triggerPrefix: bot.triggerPrefix,
      allowedUsers: bot.allowedUsers,
      allowedGroups: bot.allowedGroups,
      persona: bot.persona,
      bridgeUrl: push.bridgeUrl,
      accessToken: push.accessToken,
      defaultTargetType: push.targetType,
      defaultTargetId: push.targetId,
      model: bot.model || selectedModel(),
      systemPrompt: els.systemPrompt?.value.trim() || "",
      assistantName: els.assistantName?.value.trim() || "繁星",
    }),
  });
}

const systemMessagesBeforeQqRule = systemMessages;
systemMessages = function systemMessagesWithQqRule() {
  const list = systemMessagesBeforeQqRule();
  const config = getQqPushSettings();
  if (config.enabled && config.bridgeUrl && config.targetId) {
    list.push({
      role: "system",
      content: `当前已配置 QQ 推送通道。若用户明确要求发送到 QQ、推送到 QQ 或发 QQ 提醒，你可以调用 send_qq_message。默认目标类型：${config.targetType === "group" ? "group" : "private"}；默认目标 ID：${config.targetId}。`,
    });
  }
  return list;
};

const executeToolBeforeQqInjection = executeTool;
executeTool = async function executeToolWithQqConfigInjection(toolCall) {
  const name = toolCall?.function?.name || "unknown";
  if (!QQ_TOOL_NAMES.has(name)) {
    return executeToolBeforeQqInjection(toolCall);
  }

  let args = {};
  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("QQ 工具参数不是合法 JSON");
  }

  const config = getQqPushSettings();
  if (!config.enabled || !config.bridgeUrl || !config.targetId) {
    throw new Error("QQ 推送未配置完成，请先在基础连接配置里填写桥接地址和目标 ID。");
  }

  const mergedArgs = {
    ...args,
    bridgeUrl: config.bridgeUrl,
    accessToken: config.accessToken,
    targetType: args.targetType || config.targetType || "private",
    targetId: args.targetId || config.targetId,
  };

  return executeToolBeforeQqInjection({
    ...toolCall,
    function: {
      ...(toolCall?.function || {}),
      arguments: JSON.stringify(mergedArgs),
    },
  });
};

const buildToolOnlyFallbackReplyBeforeQq = buildToolOnlyFallbackReply;
buildToolOnlyFallbackReply = function buildToolOnlyFallbackReplyWithQq(messages = []) {
  const original = buildToolOnlyFallbackReplyBeforeQq(messages);
  if (typeof original === "string" && original.trim()) {
    return original.trim();
  }

  const parsed = parseLastToolResult(messages);
  if (parsed?.ok && parsed?.targetId && parsed?.message && parsed?.bridgeUrl) {
    return `已经帮你把消息发送到 QQ 了。\n目标：${parsed.targetType === "group" ? "群" : "QQ"} ${parsed.targetId}`;
  }

  return "";
};

const refreshMetricsBeforeStableContextUsage = refreshMetrics;
refreshMetrics = function refreshMetricsStableContextUsage(usage = null, elapsedMs = null) {
  refreshMetricsBeforeStableContextUsage(usage, elapsedMs);

  const limit = getConfiguredContextLimit();
  const totalValue = Number(usage?.total_tokens ?? els.metricTotal?.dataset.value);
  const estimatedCurrentContext = Math.ceil((
    [
      els.systemPrompt?.value || "",
      els.personaPrompt?.value || "",
      state.activeSkill ? JSON.stringify(state.activeSkill).slice(0, 3000) : "",
      state.settingBundle ? JSON.stringify(state.settingBundle).slice(0, 6000) : "",
      state.messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n"),
      state.files.map((f) => (f.isImage ? f.name || "image" : f.content || "")).join("\n"),
      els.userInput?.value || "",
    ].join("\n").length
  ) / 4);

  const stableUsage = Math.max(
    Number.isFinite(totalValue) ? totalValue : 0,
    Number.isFinite(estimatedCurrentContext) ? estimatedCurrentContext : 0
  );
  const usageText = `${stableUsage} / ${limit} 路 ${Math.min(stableUsage / limit * 100, 100).toFixed(1)}%`;
  setMetricChip(els.metricContextUsage, "上下文使用情况", usageText);
  if (els.usageBarFill) {
    els.usageBarFill.style.width = `${Math.min(stableUsage / limit * 100, 100)}%`;
  }
};

function buildChatTitle(messages = state.messages) {
  const firstUser = Array.isArray(messages)
    ? messages.find((message) => message?.role === "user" && typeof message.content === "string" && message.content.trim())
    : null;
  const raw = firstUser?.content?.trim() || "未命名会话";
  const firstLine = raw.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || raw;
  const firstSentence = firstLine.split(/(?<=[。！？!?；;])/).map((part) => part.trim()).find(Boolean) || firstLine;
  return firstSentence.length > 36 ? `${firstSentence.slice(0, 36)}...` : firstSentence;
}

function updateChatHistoryMeta() {
  const { meta } = historyElements();
  if (!meta) return;

  renderChatHistoryUndo();

  const current = getCurrentChatRecord();
  if (!state.messages.length && !current) {
    meta.textContent = "当前还没有保存的聊天记录。";
    return;
  }

  if (!current) {
    meta.textContent = `当前会话会在首轮对话后自动保存，已有 ${state.messages.length} 条消息。`;
    return;
  }

  meta.textContent = `当前会话：${current.title} · ${current.messages.length} 条消息 · 更新于 ${formatHistoryTime(current.updatedAt)}`;
}

function updateCurrentChatTitle() {
  const { title } = historyElements();
  if (!title) return;

  const current = getCurrentChatRecord();
  if (current?.title) {
    title.textContent = current.title;
    return;
  }

  if (state.messages.length) {
    title.textContent = buildChatTitle(state.messages);
    return;
  }

  title.textContent = "未命名会话";
}

function startNewChatSession() {
  if (state.messages.length) {
    autoSaveCurrentChat();
  }
  chatHistoryRuntime.currentId = null;
  persistCurrentChatId();
  renderConversationFromMessages([]);
  renderChatHistoryList();
  setStatus("已新建空白会话");
  updateCurrentChatTitle();
}

historyElements().saveButton?.remove();
renderChatHistoryList();
updateChatHistoryMeta();
updateCurrentChatTitle();

rich = function richCompactBreaks(text) {
  const html = String(text || "").replace(/```([a-z0-9_-]*)\n?([\s\S]*?)```/gi, (_, lang, code) => `@@CODE:${btoa(unescape(encodeURIComponent(`${lang}\n${code}`)))}@@`);
  return html
    .split(/@@CODE:[A-Za-z0-9+/=]+@@/g)
    .map((part) => esc(part)
      .replace(/\r\n/g, "\n")
      .split(/\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => `<p>${segment}</p>`)
      .join(""))
    .join("")
    .replace(/@@CODE:([A-Za-z0-9+/=]+)@@/g, (_, data) => {
      const [lang, ...rest] = decodeURIComponent(escape(atob(data))).split("\n");
      return `<pre><code class="language-${esc(lang)}">${esc(rest.join("\n").trim())}</code></pre>`;
    });
};

startNewChatSession = function startNewChatSessionWithHardReset() {
  if (state.messages.length) {
    autoSaveCurrentChat();
  }

  clearPendingConversationTurnDelete();
  clearPendingDeletedChat();

  state.sending = false;
  state.lastRequestedUserText = "";
  state.messages = [];

  chatHistoryRuntime.currentId = null;
  persistCurrentChatId();

  if (els.userInput) {
    els.userInput.value = "";
  }
  if (els.sendButton) {
    els.sendButton.disabled = false;
    els.sendButton.textContent = "发送消息";
  }

  clearFiles();
  renderConversationFromMessages([]);
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
  refreshMetrics();
  setStatus("已新建空白会话，并重置当前模型上下文");
};

const contextLimitWarningRuntime = {
  lastSignature: "",
};

function getConfiguredContextLimit() {
  const value = Number(els.contextLimit?.value || 32768);
  return Number.isFinite(value) && value > 0 ? value : 32768;
}

const systemMessagesBeforeContextLimitRule = systemMessages;
systemMessages = function systemMessagesWithContextLimitRule() {
  const list = systemMessagesBeforeContextLimitRule();
  const limit = getConfiguredContextLimit();
  list.push({
    role: "system",
    content: `当前会话的总上下文上限为 ${limit} tokens。请在回答时主动控制输出长度，避免让本次请求的总 token 使用量超过这个上限；如果预计会超出，请先压缩回答、分段回答或提醒用户。`,
  });
  return list;
};

const refreshMetricsBeforeContextLimitWarning = refreshMetrics;
refreshMetrics = function refreshMetricsWithContextLimitWarning(usage = null, elapsedMs = null) {
  refreshMetricsBeforeContextLimitWarning(usage, elapsedMs);

  const limit = getConfiguredContextLimit();
  const totalValue = Number(usage?.total_tokens ?? els.metricTotal?.dataset.value);
  const overLimit = Number.isFinite(totalValue) && totalValue > limit;

  els.metricContextUsage?.classList.toggle("is-alert", overLimit);
  els.usageBarFill?.classList.toggle("is-alert", overLimit);

  const totalTokens = Number(usage?.total_tokens);
  if (!Number.isFinite(totalTokens)) {
    return;
  }

  const signature = `${totalTokens}:${limit}`;
  if (totalTokens <= limit) {
    contextLimitWarningRuntime.lastSignature = "";
    return;
  }

  if (contextLimitWarningRuntime.lastSignature === signature) {
    return;
  }
  contextLimitWarningRuntime.lastSignature = signature;

  const overflow = totalTokens - limit;
  appendMessage("system", `警示：本次请求总 token 使用量为 ${totalTokens}，已超过你设置的上限 ${limit}，超出 ${overflow}。建议缩短问题、减少附件内容，或调大“总上下文上限 Token”。`, "error");
  setStatus(`上下文超限：${totalTokens} / ${limit}`);
};

function hasExistingProjectAdjustmentIntent(text = "") {
  const normalized = String(text).toLowerCase();
  const keywords = [
    "修改",
    "调整",
    "优化",
    "微调",
    "改一下",
    "改成",
    "按钮",
    "样式",
    "布局",
    "页面",
    "界面",
    "动画",
    "效果",
    "交互",
    "现有",
    "项目",
    "页面里",
    "前端",
    "adjust",
    "modify",
    "tweak",
    "refine",
    "update the existing",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

const systemMessagesBeforeExistingFileRule = systemMessages;
systemMessages = function systemMessagesWithExistingFileRule() {
  const list = systemMessagesBeforeExistingFileRule();
  const latestUserText = state.lastRequestedUserText || "";
  if (hasExistingProjectAdjustmentIntent(latestUserText)) {
    list.push({
      role: "system",
      content: "如果用户是在修改、调整或优化当前项目里的现有页面/样式/交互，你必须先通过 list_dir 和 read_file 查看当前工作区里的真实文件，再基于已读取内容给出修改方案。不要臆造或依赖 temp-files/*.html、dashboard.html 等临时文件路径，也不要假设它们已经存在。除非用户明确要求保存到本地，否则只返回建议、补丁思路或代码片段，不要创建、读取或依赖临时落盘文件。",
    });
  }
  return list;
};

const executeToolBeforeExistingFileGuard = executeTool;
executeTool = async function executeToolWithExistingFileGuard(toolCall) {
  const name = toolCall?.function?.name || "unknown";
  let args = {};
  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    args = {};
  }

  const latestUserText = state.lastRequestedUserText || "";
  const requestedPath = String(args.path || "").replace(/\\/g, "/").toLowerCase();
  if (
    name === "read_file" &&
    requestedPath.includes("/temp-files/") &&
    !canUseWriteTools(latestUserText)
  ) {
    throw new Error("当前请求是在调整现有内容，但没有授权保存到本地。请先读取当前项目中的真实文件，不要读取或依赖 temp-files 下的临时文件。");
  }

  return executeToolBeforeExistingFileGuard(toolCall);
};

const refreshMetricsBeforeUsageTotalRule = refreshMetrics;
refreshMetrics = function refreshMetricsUseTotalForUsage(usage = null, elapsedMs = null) {
  refreshMetricsBeforeUsageTotalRule(usage, elapsedMs);

  const limit = getConfiguredContextLimit();
  const totalValue = Number(usage?.total_tokens ?? els.metricTotal?.dataset.value);
  const fallbackEstimate = Math.ceil(([
    els.systemPrompt?.value || "",
    els.personaPrompt?.value || "",
    state.activeSkill ? JSON.stringify(state.activeSkill).slice(0, 3000) : "",
    state.messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n"),
    state.files.reduce((n, f) => n + (f.isImage ? 120 : f.content.length), 0) ? String(state.files.reduce((n, f) => n + (f.isImage ? 120 : f.content.length), 0)) : "",
    els.userInput?.value || "",
  ].join("\n").length) / 4);

  const usageNumerator = Number.isFinite(totalValue) ? totalValue : fallbackEstimate;
  const usageText = `${usageNumerator} / ${limit} · ${Math.min(usageNumerator / limit * 100, 100).toFixed(1)}%`;
  setMetricChip(els.metricContextUsage, "上下文使用情况", usageText);
  if (els.usageBarFill) {
    els.usageBarFill.style.width = `${Math.min(usageNumerator / limit * 100, 100)}%`;
  }
};

loadChatRecord = function loadChatRecordWithContextRestore(recordId) {
  const record = readChatHistoryRecords().find((item) => item.id === recordId);
  if (!record) {
    setStatus("未找到对应的聊天记录");
    return;
  }

  clearPendingConversationTurnDelete();
  clearPendingDeletedChat();

  state.sending = false;
  state.lastRequestedUserText = "";
  chatHistoryRuntime.currentId = record.id;
  persistCurrentChatId();

  if (els.userInput) {
    els.userInput.value = "";
  }
  if (els.sendButton) {
    els.sendButton.disabled = false;
    els.sendButton.textContent = "发送消息";
  }

  clearFiles();
  state.messages = JSON.parse(JSON.stringify(record.messages || []));
  renderConversationFromMessages(state.messages);
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
  refreshMetrics();
  setStatus(`已加载聊天记录，并恢复会话上下文：${record.title || "未命名会话"}`);
};

function guardSessionOperationWhileSending(actionLabel = "当前操作") {
  if (!state.sending) {
    return false;
  }
  setStatus(`正在输入中，暂时不能执行“${actionLabel}”`);
  return true;
}

function updateSessionOperationAvailability() {
  const disabled = Boolean(state.sending);
  historyElements().newButton?.toggleAttribute("disabled", disabled);
  historyElements().deleteButton?.toggleAttribute("disabled", disabled);
  els.clearChat?.toggleAttribute("disabled", disabled);
  document.querySelectorAll(".chat-history-item, .history-delete-button, .history-rename-button").forEach((el) => {
    el.classList.toggle("is-disabled", disabled);
    if (el instanceof HTMLButtonElement) {
      el.disabled = disabled;
    }
  });
}

function resetConversationUsageMetrics() {
  setMetricChip(els.metricTotal, "Total", "-");
  setMetricChip(els.metricSpeed, "速率", "-");
  contextLimitWarningRuntime.lastSignature = "";
  els.metricContextUsage?.classList.remove("is-alert");
  els.usageBarFill?.classList.remove("is-alert");
}

const startNewChatSessionBeforeSendingGuard = startNewChatSession;
startNewChatSession = function startNewChatSessionWithSendingGuard() {
  if (guardSessionOperationWhileSending("新建会话")) return;
  resetConversationUsageMetrics();
  startNewChatSessionBeforeSendingGuard();
};

const loadChatRecordBeforeSendingGuard = loadChatRecord;
loadChatRecord = function loadChatRecordWithSendingGuard(recordId) {
  if (guardSessionOperationWhileSending("切换会话")) return;
  resetConversationUsageMetrics();
  loadChatRecordBeforeSendingGuard(recordId);
};

const deleteCurrentChatSessionBeforeSendingGuard = deleteCurrentChatSession;
deleteCurrentChatSession = function deleteCurrentChatSessionWithSendingGuard() {
  if (guardSessionOperationWhileSending("删除会话")) return;
  deleteCurrentChatSessionBeforeSendingGuard();
};

const deleteChatRecordBeforeSendingGuard = deleteChatRecord;
deleteChatRecord = function deleteChatRecordWithSendingGuard(recordId) {
  if (guardSessionOperationWhileSending("删除聊天记录")) return;
  deleteChatRecordBeforeSendingGuard(recordId);
};

const renameChatRecordBeforeSendingGuard = typeof renameChatRecord === "function" ? renameChatRecord : null;
if (renameChatRecordBeforeSendingGuard) {
  renameChatRecord = function renameChatRecordWithSendingGuard(recordId) {
    if (guardSessionOperationWhileSending("重命名会话")) return;
    renameChatRecordBeforeSendingGuard(recordId);
  };
}

const resetChatBeforeSendingGuard = resetChat;
resetChat = function resetChatWithSendingGuard() {
  if (guardSessionOperationWhileSending("清空会话")) return;
  resetConversationUsageMetrics();
  resetChatBeforeSendingGuard();
};

const submitBeforeSessionOperationGuard = submit;
els.chatForm?.removeEventListener("submit", submitBeforeSessionOperationGuard, true);
submit = async function submitWithSessionOperationGuard(ev) {
  updateSessionOperationAvailability();
  try {
    await submitBeforeSessionOperationGuard(ev);
  } finally {
    updateSessionOperationAvailability();
  }
};
els.chatForm?.addEventListener("submit", submit, true);

updateSessionOperationAvailability();

function isSettingTextFile(file) {
  const path = String(file?.webkitRelativePath || file?.name || "").toLowerCase();
  return /\.(txt|md|markdown|json|yaml|yml|toml|ini|cfg|csv|tsv|xml|html|css|js|ts|py|java|go|rs|sql)$/i.test(path);
}

async function importSettingFolder(files) {
  const allFiles = Array.from(files || []);
  if (!allFiles.length) {
    setStatus("请选择要导入的设定文件夹");
    return;
  }

  const textFiles = allFiles.filter((file) => isSettingTextFile(file) && file.size <= MAX_FILE_SIZE).slice(0, 60);
  if (!textFiles.length) {
    setStatus("设定文件夹中没有可用的文本文件");
    return;
  }

  const firstPath = textFiles[0].webkitRelativePath || textFiles[0].name || "setting-folder";
  const folderName = firstPath.split("/")[0] || "setting-folder";
  const importedFiles = [];
  for (const file of textFiles) {
    importedFiles.push({
      path: file.webkitRelativePath || file.name,
      content: await file.text(),
      size: file.size,
      type: file.type || "",
    });
  }

  state.settingBundle = {
    name: folderName,
    importedAt: Date.now(),
    files: importedFiles,
  };
  renderSettingBundlePreview();
  save();
  refreshMetrics();
  setStatus(`已导入设定文件夹：${folderName}`);
}

els.importSettingFolder?.addEventListener("click", () => {
  spark(els.importSettingFolder);
  els.settingFolderInput?.click();
});

els.settingFolderInput?.addEventListener("change", async (event) => {
  try {
    await importSettingFolder(event.target.files);
  } catch (error) {
    appendMessage("system", `导入设定文件夹失败：${error.message}`, "error");
    setStatus("导入设定文件夹失败");
  } finally {
    event.target.value = "";
  }
});

els.clearSettingFolder?.addEventListener("click", () => {
  spark(els.clearSettingFolder);
  state.settingBundle = null;
  renderSettingBundlePreview();
  save();
  refreshMetrics();
  setStatus("已清空设定文件夹");
});

const systemMessagesBeforeSettingBundle = systemMessages;
systemMessages = function systemMessagesWithSettingBundle() {
  const list = systemMessagesBeforeSettingBundle();
  if (state.settingBundle?.files?.length) {
    const settingContent = state.settingBundle.files
      .map((file) => `文件：${file.path}\n${file.content}`)
      .join("\n\n");
    list.push({
      role: "system",
      content: `以下是当前已加载的设定文件夹「${state.settingBundle.name}」，请在后续对话中持续遵循这些设定内容：\n\n${settingContent}`,
    });
  }
  return list;
};

const refreshMetricsBeforeSettingBundle = refreshMetrics;
refreshMetrics = function refreshMetricsWithSettingBundle(usage = null, elapsedMs = null) {
  refreshMetricsBeforeSettingBundle(usage, elapsedMs);
  renderSettingBundlePreview();
};

const saveBeforeSettingBundle = save;
save = function saveWithSettingBundle() {
  const previous = saved();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...previous,
    settingBundle: cloneSettingBundleForStorage(state.settingBundle),
  }));
  saveBeforeSettingBundle();
};

const loadBeforeSettingBundle = load;
load = function loadWithSettingBundle() {
  loadBeforeSettingBundle();
  const s = saved();
  state.settingBundle = cloneSettingBundleForStorage(s.settingBundle);
  renderSettingBundlePreview();
};

state.settingBundle = cloneSettingBundleForStorage(saved().settingBundle);
renderSettingBundlePreview();

renderPersonaPresets = function renderPersonaPresetsPersistSelection() {
  if (!els.personaPreset) return;
  const persistedValue = saved().personaPreset || "none";
  const currentValue = els.personaPreset.value || "none";
  const preferredValue = currentValue !== "none" ? currentValue : persistedValue;
  const nodes = [];

  const builtInGroup = document.createElement("optgroup");
  builtInGroup.label = "内置模板";
  builtInGroup.append(...PERSONA_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    return option;
  }));
  nodes.push(builtInGroup);

  if (workspacePersonaPresets.length) {
    const workspaceGroup = document.createElement("optgroup");
    workspaceGroup.label = "工作区人设";
    workspaceGroup.append(...workspacePersonaPresets.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      return option;
    }));
    nodes.push(workspaceGroup);
  }

  els.personaPreset.replaceChildren(...nodes);
  const allPresetIds = allPersonaPresets().map((preset) => preset.id);
  els.personaPreset.value = allPresetIds.includes(preferredValue) ? preferredValue : "none";
  renderPersonaPresetDescription();
};

const loadWorkspacePersonaPresetsBeforePersistSelection = loadWorkspacePersonaPresets;
loadWorkspacePersonaPresets = async function loadWorkspacePersonaPresetsKeepSelection() {
  await loadWorkspacePersonaPresetsBeforePersistSelection();
  const persistedValue = saved().personaPreset || "none";
  const allPresetIds = allPersonaPresets().map((preset) => preset.id);
  if (els.personaPreset) {
    els.personaPreset.value = allPresetIds.includes(persistedValue) ? persistedValue : "none";
  }
  renderPersonaPresetDescription();
};

function disableActiveSkill() {
  if (!state.activeSkill) {
    setStatus("当前没有启用中的技能");
    return;
  }
  const previousName = state.activeSkill.name || "当前技能";
  state.activeSkill = null;
  if (sameSkill(state.selectedSkill, { name: previousName, source: state.selectedSkill?.source })) {
    // keep selected skill for preview/read state, only remove active context
  }
  renderSkills();
  renderSkillPreview();
  save();
  refreshMetrics();
  appendMessage("system", `已取消启用技能：${previousName}\n后续对话将不再自动附带该技能内容。`, "success");
  setStatus(`已取消启用技能：${previousName}`);
}

els.disableSkill?.addEventListener("click", () => {
  spark(els.disableSkill);
  disableActiveSkill();
});

renderSkills = function renderSkillsWithEnableDisable() {
  if (!els.skillsList) return;
  if (!state.skills.length) {
    els.skillsList.innerHTML = '<div class="file-empty">当前还没有读取到技能列表。</div>';
    if (els.disableSkill) els.disableSkill.disabled = !state.activeSkill;
    return;
  }

  els.skillsList.replaceChildren(...state.skills.map((skill) => {
    const item = document.createElement("div");
    item.className = `skill-item${sameSkill(skill, state.selectedSkill) ? " is-selected" : ""}${sameSkill(skill, state.activeSkill) ? " is-active" : ""}`;

    const head = document.createElement("div");
    head.className = "skill-item-head";

    const titleWrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = skill.name;
    const meta = document.createElement("div");
    meta.className = "skill-summary";
    meta.textContent = [skill.source, skill.summary].filter(Boolean).join(" · ");
    titleWrap.append(title, meta);

    const status = document.createElement("div");
    status.className = "button-row left wrap-row";
    if (sameSkill(skill, state.selectedSkill)) {
      const readBadge = document.createElement("span");
      readBadge.className = "mini-status-tag";
      readBadge.textContent = "已读取";
      status.append(readBadge);
    }
    if (sameSkill(skill, state.activeSkill)) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "mini-status-tag active";
      activeBadge.textContent = "已启用";
      status.append(activeBadge);
    }
    head.append(titleWrap, status);

    const actions = document.createElement("div");
    actions.className = "button-row left wrap-row";

    const readButton = document.createElement("button");
    readButton.type = "button";
    readButton.className = "ghost-button mini-action-button";
    readButton.textContent = skill.source === "workspace" ? "读取" : "安装到当前目录";
    readButton.onclick = async () => {
      spark(readButton);
      if (skill.source === "workspace") {
        await readSkill(skill);
      } else {
        await installSkill(skill);
      }
    };
    actions.append(readButton);

    if (skill.source === "workspace") {
      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "ghost-button mini-action-button";
      const isActive = sameSkill(skill, state.activeSkill);
      toggleButton.textContent = isActive ? "取消启用" : "启用";
      toggleButton.onclick = async () => {
        spark(toggleButton);
        if (isActive) {
          disableActiveSkill();
          return;
        }
        if (!sameSkill(skill, state.selectedSkill)) {
          await readSkill(skill);
        }
        applySelectedSkill();
      };
      actions.append(toggleButton);
    }

    item.append(head, actions);
    return item;
  }));

  if (els.disableSkill) {
    els.disableSkill.disabled = !state.activeSkill;
  }
};

const applySelectedSkillBeforeDisableSupport = applySelectedSkill;
applySelectedSkill = function applySelectedSkillWithDisableSupport() {
  applySelectedSkillBeforeDisableSupport();
  renderSkills();
  if (els.disableSkill) {
    els.disableSkill.disabled = !state.activeSkill;
  }
};

renderSkills();
if (els.disableSkill) {
  els.disableSkill.disabled = !state.activeSkill;
}

function reduceSkillToSkillMdOnly(skill) {
  if (!skill || typeof skill !== "object") return null;
  const files = Array.isArray(skill.files) ? skill.files : [];
  const skillMd = files.find((file) => String(file.path || "").toUpperCase() === "SKILL.MD");
  const content = String(skillMd?.content || skill.content || "").trim();
  return {
    name: skill.name || "",
    source: skill.source || "workspace",
    summary: skill.summary || "",
    content,
    files: content ? [{ path: "SKILL.md", content }] : [],
  };
}

renderSkillPreview = function renderSkillPreviewSkillMdOnly(skill = state.selectedSkill) {
  if (!els.skillPreview) return;
  const normalized = reduceSkillToSkillMdOnly(skill);
  if (!normalized?.content) {
    els.skillPreview.textContent = "选择一个技能后，这里会显示该技能的 SKILL.md 内容摘要。";
    return;
  }
  els.skillPreview.textContent = [
    `技能：${normalized.name}`,
    `来源：${normalized.source}`,
    "已载入文件：1",
    "",
    "# SKILL.md",
    "",
    normalized.content,
  ].join("\n");
};

readSkill = async function readSkillSkillMdOnly(skill) {
  setStatus(`正在读取技能：${skill.name}`);
  const data = await j(`/skills/read?source=${encodeURIComponent(skill.source)}&name=${encodeURIComponent(skill.name)}`);
  state.selectedSkill = reduceSkillToSkillMdOnly(data.skill);
  const existingIndex = state.skills.findIndex((item) => sameSkill(item, skill));
  if (existingIndex >= 0) {
    state.skills[existingIndex] = { ...state.skills[existingIndex], ...cloneSkillForStorage(state.selectedSkill) };
  }
  renderSkillPreview(state.selectedSkill);
  renderSkills();
  save();
  setStatus(`已读取技能：${skill.name}（仅 SKILL.md）`);
};

applySelectedSkill = function applySelectedSkillSkillMdOnly() {
  if (!state.selectedSkill) {
    setStatus("请先读取一个技能");
    return;
  }
  state.activeSkill = reduceSkillToSkillMdOnly(state.selectedSkill);
  renderSkills();
  renderSkillPreview(state.activeSkill);
  save();
  appendMessage("system", `已启用技能：${state.activeSkill.name}\n后续对话会按照 SKILL.md 中的要求执行。`, "success");
  refreshMetrics();
  setStatus(`已启用技能：${state.activeSkill.name}`);
  if (els.disableSkill) {
    els.disableSkill.disabled = !state.activeSkill;
  }
};

const systemMessagesBeforeSkillMdOnly = systemMessages;
systemMessages = function systemMessagesSkillMdOnly() {
  const list = systemMessagesBeforeSkillMdOnly().filter((message) => !String(message?.content || "").includes("你当前启用了技能："));
  if (state.activeSkill?.content) {
    list.push({
      role: "system",
      content: `你当前启用了技能：${state.activeSkill.name}\n技能来源：${state.activeSkill.source}\n接下来只按该技能的 SKILL.md 要求执行，不要额外带入技能目录中的其他文件内容。\n\nSKILL.md:\n${state.activeSkill.content}`,
    });
  }
  return list;
};

state.selectedSkill = reduceSkillToSkillMdOnly(state.selectedSkill);
state.activeSkill = reduceSkillToSkillMdOnly(state.activeSkill);
renderSkillPreview();
renderSkills();

if (els.applyPersonaPreset) {
  els.applyPersonaPreset.remove();
}

els.personaPreset?.addEventListener("change", () => {
  const preset = presetById(els.personaPreset?.value || "none");
  if (preset.prompt && els.personaPrompt) {
    els.personaPrompt.value = preset.prompt;
  }
  renderPersonaPresetDescription();
  save();
  refreshMetrics();
  setStatus(preset.prompt ? `已应用人设模板：${preset.name}` : "当前预设不会覆盖现有人设");
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderInlineMarkdown(text) {
  return esc(String(text || ""))
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function renderRichTextBlocks(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraphBuffer = [];
  let listBuffer = null;

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraphBuffer.join(" "))}</p>`);
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!listBuffer?.items?.length) return;
    const tag = listBuffer.type === "ordered" ? "ol" : "ul";
    blocks.push(`<${tag}>${listBuffer.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    listBuffer = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(6, headingMatch[1].length);
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== "unordered") {
        flushList();
        listBuffer = { type: "unordered", items: [] };
      }
      listBuffer.items.push(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== "ordered") {
        flushList();
        listBuffer = { type: "ordered", items: [] };
      }
      listBuffer.items.push(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function normalizeCodeLanguageLabel(language = "") {
  const lang = String(language || "").trim().toLowerCase();
  if (!lang) return "TEXT";
  return lang.length <= 18 ? lang.toUpperCase() : lang.slice(0, 18).toUpperCase();
}

rich = function richCodeFriendly(text) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const codeBlocks = [];
  const placeholderWrapped = source.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, language, code) => {
    const placeholder = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push({
      placeholder,
      language: String(language || "").trim(),
      code: String(code || "").replace(/\n$/, ""),
    });
    return `\n${placeholder}\n`;
  });

  let html = renderRichTextBlocks(placeholderWrapped);
  for (const block of codeBlocks) {
    const replacement = [
      '<div class="code-block">',
      `<div class="code-block-head"><span class="code-block-lang">${esc(normalizeCodeLanguageLabel(block.language))}</span></div>`,
      `<pre><code class="language-${esc(block.language || "text")}">${esc(block.code)}</code></pre>`,
      "</div>",
    ].join("");
    html = html.replace(new RegExp(escapeRegExp(block.placeholder), "g"), replacement);
  }

  return html || `<p>${renderInlineMarkdown(source)}</p>`;
};

async function copyCodeText(text) {
  const value = String(text || "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function enhanceMessageCodeBlocks(container) {
  if (!container) return;
  const blocks = container.querySelectorAll(".code-block");
  blocks.forEach((block) => {
    if (block.dataset.enhanced === "true") return;
    block.dataset.enhanced = "true";

    const head = block.querySelector(".code-block-head");
    const code = block.querySelector("pre code");
    if (!head || !code) return;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "ghost-button code-block-copy";
    copyButton.textContent = "复制";
    copyButton.title = "复制代码";
    copyButton.addEventListener("click", async () => {
      try {
        await copyCodeText(code.textContent || "");
        copyButton.textContent = "已复制";
        setStatus("代码已复制到剪贴板");
      } catch (error) {
        copyButton.textContent = "复制失败";
        setStatus(`复制代码失败：${error.message}`);
      } finally {
        window.setTimeout(() => {
          copyButton.textContent = "复制";
        }, 1400);
      }
    });

    head.append(copyButton);
  });
}

const systemMessagesBeforeCodeFormatRule = systemMessages;
systemMessages = function systemMessagesWithCodeFormatRule() {
  const list = systemMessagesBeforeCodeFormatRule();
  list.push({
    role: "system",
    content: "当你输出代码时，必须优先使用标准 Markdown fenced code block，并带上语言标识，例如 ```python、```javascript、```html、```css、```bash。不要把多行代码写成普通段落或列表。",
  });
  return list;
};

const submitBeforeDuplicateReplyFix = submit;
els.chatForm?.removeEventListener("submit", submitBeforeDuplicateReplyFix, true);
submit = async function submitInChatPendingWithoutDuplicate(ev) {
  ev.preventDefault();
  ev.stopImmediatePropagation();
  if (state.sending) return;

  const text = els.userInput?.value.trim() || "";
  if (!text && !state.files.length) {
    setStatus("请输入要发送的内容");
    return;
  }

  appendMessage("user", text || "请结合附件继续回答。", "user", state.files.filter((f) => f.isImage));
  if (els.userInput) {
    els.userInput.value = "";
  }
  refreshMetrics();

  const pendingMessage = appendPendingMessage();
  state.sending = true;
  if (els.sendButton) {
    els.sendButton.disabled = true;
    els.sendButton.textContent = "发送中...";
  }

  try {
    await askModel(text);
    pendingMessage?.remove();
    renderConversationFromMessages(state.messages);
    clearFiles();
    setStatus("回复完成");
  } catch (error) {
    pendingMessage?.remove();
    appendMessage("system", `${error.message}\n\n请确认你是通过 node server.js 启动页面，并且本地模型服务仍在 http://127.0.0.1:1234 运行。`, "error");
    setStatus("请求失败");
  } finally {
    state.sending = false;
    if (els.sendButton) {
      els.sendButton.disabled = false;
      els.sendButton.textContent = "发送消息";
    }
  }
};
els.chatForm?.addEventListener("submit", submit, true);

function schedulerElements() {
  return {
    name: $("#schedule-task-name"),
    interval: $("#schedule-task-interval"),
    cron: $("#schedule-task-cron"),
    prompt: $("#schedule-task-prompt"),
    createButton: $("#create-schedule-task"),
    refreshButton: $("#refresh-schedule-tasks"),
    meta: $("#schedule-task-meta"),
    list: $("#schedule-task-list"),
  };
}

function formatScheduleTime(timestamp) {
  if (!timestamp) {
    return "未安排";
  }
  const date = new Date(timestamp);
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mi = `${date.getMinutes()}`.padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

async function schedulerRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function describeScheduledTaskFrequency(task) {
  return task.scheduleType === "cron"
    ? `cron:${task.cronExpression || ""}`
    : `every:${task.intervalMinutes}`;
}

async function editScheduledTask(task) {
  const nextPrompt = window.prompt("请输入新的任务内容：", task.prompt || "");
  if (nextPrompt == null) {
    return;
  }

  const trimmedPrompt = nextPrompt.trim();
  if (!trimmedPrompt) {
    setStatus("任务内容不能为空");
    return;
  }

  const nextFrequency = window.prompt(
    "请输入新的执行频率：\n- 每隔分钟：every:60\n- Cron：cron:0 9 * * *",
    describeScheduledTaskFrequency(task)
  );
  if (nextFrequency == null) {
    return;
  }

  const normalizedFrequency = nextFrequency.trim();
  if (!normalizedFrequency) {
    setStatus("执行频率不能为空");
    return;
  }

  const payload = { prompt: trimmedPrompt };
  if (/^cron\s*:/i.test(normalizedFrequency)) {
    payload.scheduleType = "cron";
    payload.cronExpression = normalizedFrequency.replace(/^cron\s*:/i, "").trim();
    if (!payload.cronExpression) {
      setStatus("Cron 表达式不能为空");
      return;
    }
  } else if (/^every\s*:/i.test(normalizedFrequency)) {
    const intervalMinutes = Number(normalizedFrequency.replace(/^every\s*:/i, "").trim());
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      setStatus("请输入有效的分钟数");
      return;
    }
    payload.scheduleType = "interval";
    payload.intervalMinutes = intervalMinutes;
  } else if (/\s/.test(normalizedFrequency)) {
    payload.scheduleType = "cron";
    payload.cronExpression = normalizedFrequency;
  } else {
    const intervalMinutes = Number(normalizedFrequency);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      setStatus("频率格式无效，请输入 every:60 或 cron:0 9 * * *");
      return;
    }
    payload.scheduleType = "interval";
    payload.intervalMinutes = intervalMinutes;
  }

  await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await loadScheduledTasksUI();
  setStatus(`已更新定时任务：${task.name}`);
}

function renderScheduledTasks(tasks) {
  const { list, meta } = schedulerElements();
  if (!list || !meta) {
    return;
  }

  if (!tasks.length) {
    meta.textContent = "当前还没有定时任务。";
    list.innerHTML = '<div class="file-empty">还没有定时任务。</div>';
    return;
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;
  meta.textContent = `共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用。`;

  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement("div");
    item.className = "schedule-task-item";

    const head = document.createElement("div");
    head.className = "schedule-task-head";

    const title = document.createElement("p");
    title.className = "schedule-task-title";
    title.textContent = task.name;

    const badges = document.createElement("div");
    badges.className = "schedule-task-badges";

    const statusBadge = document.createElement("span");
    statusBadge.className = `schedule-task-badge ${task.running ? "running" : task.lastStatus === "success" ? "success" : task.lastStatus === "error" ? "error" : ""}`;
    statusBadge.textContent = task.running ? "运行中" : task.enabled ? "已启用" : "已暂停";

    const intervalBadge = document.createElement("span");
    intervalBadge.className = "schedule-task-badge";
    intervalBadge.textContent = task.scheduleType === "cron"
      ? `Cron: ${task.cronExpression}`
      : `每 ${task.intervalMinutes} 分钟`;

    badges.append(statusBadge, intervalBadge);
    head.append(title, badges);

    const metaLine = document.createElement("div");
    metaLine.className = "schedule-task-meta-line";
    metaLine.textContent = `模型：${task.model} · 下次：${formatScheduleTime(task.nextRunAt)} · 上次：${formatScheduleTime(task.lastRunAt)}`;

    const result = document.createElement("div");
    result.className = "schedule-task-result";
    result.textContent = task.lastError || task.lastResult || "最近还没有执行结果。";

    const actions = document.createElement("div");
    actions.className = "schedule-task-actions";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "ghost-button";
    toggleButton.textContent = task.enabled ? "暂停" : "启用";
    toggleButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !task.enabled }),
        });
        await loadScheduledTasksUI();
      } catch (error) {
        appendMessage("system", `更新定时任务失败：${error.message}`, "error");
      }
    });

    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "ghost-button";
    runButton.textContent = "立即执行";
    runButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}/run`, {
          method: "POST",
        });
        await loadScheduledTasksUI();
        setStatus(`已执行定时任务：${task.name}`);
      } catch (error) {
        appendMessage("system", `执行定时任务失败：${error.message}`, "error");
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost-button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(`确定删除定时任务“${task.name}”吗？`);
      if (!confirmed) {
        return;
      }
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
          method: "DELETE",
        });
        await loadScheduledTasksUI();
        setStatus(`已删除定时任务：${task.name}`);
      } catch (error) {
        appendMessage("system", `删除定时任务失败：${error.message}`, "error");
      }
    });

    actions.append(toggleButton, runButton, deleteButton);
    item.append(head, metaLine, result, actions);
    return item;
  }));
}

async function loadScheduledTasksUI(options = {}) {
  const { meta, list } = schedulerElements();
  try {
    const data = await schedulerRequest("/scheduler/tasks");
    const tasks = data.tasks || [];
    renderScheduledTasks(tasks);
    syncScheduledTaskDeliveries(tasks, options);
  } catch (error) {
    if (error.status === 404) {
      if (meta) meta.textContent = "当前服务暂未启用定时任务接口，重启 node server.js 后可用。";
      if (list) list.innerHTML = '<div class="file-empty">当前运行中的服务版本还不支持定时任务，请重启服务。</div>';
      return;
    }
    throw error;
  }
}

async function createScheduledTask() {
  const { name, interval, cron, prompt } = schedulerElements();
  const taskName = name?.value.trim() || "";
  const taskModel = selectedModel();
  const taskPrompt = prompt?.value.trim() || "";
  const intervalMinutes = Number(interval?.value || 0);
  const cronExpression = cron?.value.trim() || "";

  if (!taskName) {
    setStatus("请输入任务名称");
    return;
  }
  if (!taskModel) {
    setStatus("请填写任务模型或先选择当前模型");
    return;
  }
  if (!taskPrompt) {
    setStatus("请输入任务提示词");
    return;
  }
  if (!cronExpression && (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0)) {
    setStatus("请输入有效的间隔分钟");
    return;
  }

  await schedulerRequest("/scheduler/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: taskName,
      model: taskModel,
      prompt: taskPrompt,
      scheduleType: cronExpression ? "cron" : "interval",
      intervalMinutes: cronExpression ? undefined : intervalMinutes,
      cronExpression: cronExpression || undefined,
      enabled: true,
    }),
  });

  if (name) name.value = "";
  if (prompt) prompt.value = "";
  if (interval) interval.value = "60";
  if (cron) cron.value = "";
  await loadScheduledTasksUI();
  setStatus(`已创建定时任务：${taskName}`);
}

function setupScheduledTasksFeature() {
  const { createButton, refreshButton } = schedulerElements();

  createButton?.addEventListener("click", async () => {
    spark(createButton);
    try {
      await createScheduledTask();
    } catch (error) {
      appendMessage("system", `创建定时任务失败：${error.message}`, "error");
      setStatus("创建定时任务失败");
    }
  });

  refreshButton?.addEventListener("click", async () => {
    spark(refreshButton);
    try {
      await loadScheduledTasksUI();
      setStatus("定时任务列表已刷新");
    } catch (error) {
      if (error.status !== 404) appendMessage("system", `读取定时任务失败：${error.message}`, "error");
      setStatus("读取定时任务失败");
    }
  });

  loadScheduledTasksUI({ baselineOnly: true })
    .then(() => {
      scheduledTaskDeliveryRuntime.initialized = true;
      scheduledTaskDeliveryRuntime.timer = window.setInterval(() => {
        loadScheduledTasksUI().catch(() => {});
      }, SCHEDULED_TASK_POLL_MS);
    })
    .catch((error) => {
      if (error.status !== 404) appendMessage("system", `读取定时任务失败：${error.message}`, "error");
    });
}

setupScheduledTasksFeature();

renderScheduledTasks = function renderScheduledTasksEditable(tasks) {
  const { list, meta } = schedulerElements();
  if (!list || !meta) return;

  if (!tasks.length) {
    meta.textContent = "当前还没有定时任务。";
    list.innerHTML = '<div class="file-empty">还没有定时任务。</div>';
    return;
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;
  meta.textContent = `共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用。`;

  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement("div");
    item.className = "schedule-task-item";

    const head = document.createElement("div");
    head.className = "schedule-task-head";

    const title = document.createElement("p");
    title.className = "schedule-task-title";
    title.textContent = task.name;

    const badges = document.createElement("div");
    badges.className = "schedule-task-badges";

    const statusBadge = document.createElement("span");
    statusBadge.className = `schedule-task-badge ${task.running ? "running" : task.lastStatus === "success" ? "success" : task.lastStatus === "error" ? "error" : ""}`;
    statusBadge.textContent = task.running ? "运行中" : task.enabled ? "已启用" : "已暂停";

    const intervalBadge = document.createElement("span");
    intervalBadge.className = "schedule-task-badge";
    intervalBadge.textContent = task.scheduleType === "cron"
      ? `Cron: ${task.cronExpression}`
      : `每 ${task.intervalMinutes} 分钟`;

    badges.append(statusBadge, intervalBadge);
    head.append(title, badges);

    const metaLine = document.createElement("div");
    metaLine.className = "schedule-task-meta-line";
    metaLine.textContent = `模型：${task.model} · 下次：${formatScheduleTime(task.nextRunAt)} · 上次：${formatScheduleTime(task.lastRunAt)}`;

    const promptPreview = document.createElement("div");
    promptPreview.className = "schedule-task-prompt";
    promptPreview.textContent = `任务内容：${task.prompt || "暂无内容"}`;

    const result = document.createElement("div");
    result.className = "schedule-task-result";
    result.textContent = task.lastError || task.lastResult || "最近还没有执行结果。";

    const actions = document.createElement("div");
    actions.className = "schedule-task-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "ghost-button";
    editButton.textContent = "编辑";
    editButton.addEventListener("click", async () => {
      try {
        await editScheduledTask(task);
      } catch (error) {
        appendMessage("system", `更新定时任务失败：${error.message}`, "error");
        setStatus("更新定时任务失败");
      }
    });

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "ghost-button";
    toggleButton.textContent = task.enabled ? "暂停" : "启用";
    toggleButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !task.enabled }),
        });
        await loadScheduledTasksUI();
      } catch (error) {
        appendMessage("system", `更新定时任务失败：${error.message}`, "error");
      }
    });

    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "ghost-button";
    runButton.textContent = "立即执行";
    runButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}/run`, {
          method: "POST",
        });
        await loadScheduledTasksUI();
        setStatus(`已执行定时任务：${task.name}`);
      } catch (error) {
        appendMessage("system", `执行定时任务失败：${error.message}`, "error");
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost-button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(`确定删除定时任务“${task.name}”吗？`);
      if (!confirmed) return;
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
          method: "DELETE",
        });
        await loadScheduledTasksUI();
        setStatus(`已删除定时任务：${task.name}`);
      } catch (error) {
        appendMessage("system", `删除定时任务失败：${error.message}`, "error");
      }
    });

    actions.append(editButton, toggleButton, runButton, deleteButton);
    item.append(head, metaLine, promptPreview, result, actions);
    return item;
  }));
};

renderToolActivity = function renderToolActivityCompactChip() {
  if (!els.toolActivityList) return;
  if (!state.toolActivities.length) {
    if (els.toolActivityStatus) els.toolActivityStatus.textContent = "空闲";
    if (els.toolActivitySummary) els.toolActivitySummary.textContent = "点击查看完整记录";
    if (els.toolActivityTrigger) {
      els.toolActivityTrigger.classList.remove("is-busy");
      els.toolActivityTrigger.dataset.tooltip = "工具活动：点击查看完整记录";
      els.toolActivityTrigger.title = "工具活动：点击查看完整记录";
      els.toolActivityTrigger.setAttribute("aria-label", "工具活动：点击查看完整记录");
    }
    els.toolActivityList.innerHTML = '<div class="file-empty">暂无工具记录</div>';
    return;
  }

  const latest = state.toolActivities[0];
  const running = state.toolActivities.some((x) => x.status === "running");
  const summaryText = `${latest.name} · ${latest.text}`;
  if (els.toolActivityStatus) els.toolActivityStatus.textContent = running ? "执行中" : summaryText;
  if (els.toolActivitySummary) els.toolActivitySummary.textContent = summaryText;
  if (els.toolActivityTrigger) {
    const tooltip = `工具活动：${summaryText}`;
    els.toolActivityTrigger.classList.toggle("is-busy", running);
    els.toolActivityTrigger.dataset.tooltip = tooltip;
    els.toolActivityTrigger.title = tooltip;
    els.toolActivityTrigger.setAttribute("aria-label", tooltip);
  }

  els.toolActivityList.replaceChildren(...state.toolActivities.map((x) => {
    const el = document.createElement("div");
    el.className = `tool-activity-item ${x.status}`;
    const updatedAt = x.updatedAt ? new Date(x.updatedAt) : null;
    const timeText = updatedAt && !Number.isNaN(updatedAt.getTime())
      ? updatedAt.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";
    el.innerHTML = `<div class="tool-activity-head"><strong class="tool-activity-title">${esc(x.name)}</strong><span class="tool-activity-badge">${x.status === "running" ? "执行中" : "已完成"}</span></div><div class="tool-activity-text">${esc(x.text)}</div>${timeText ? `<div class="tool-activity-time">${esc(timeText)}</div>` : ""}`;
    return el;
  }));
};

state.lastRequestedUserText = "";

executeTool = async function executeToolWithExplicitLocalSave(toolCall) {
  const id = toolCall?.id || nowId();
  const name = toolCall?.function?.name || "unknown";
  let args = {};

  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }

  if ((name === "create_scheduled_task" || name === "update_scheduled_task") && !String(args.model || "").trim()) {
    args.model = selectedModel();
  }

  const latestUserText = state.lastRequestedUserText || "";
  if (WRITE_TOOL_NAMES.has(name) && !canUseWriteTools(latestUserText)) {
    throw new Error("当前请求没有明确授权保存到本地，已阻止文件写入或删除。若需要保存，请明确说明“保存到本地”或“写入文件”。");
  }

  if (name === "delete_file" && args.path && !window.confirm(`AI 请求删除文件：${args.path}\n\n是否允许继续？`)) {
    return { role: "tool", tool_call_id: id, content: JSON.stringify({ cancelled: true }) };
  }

  toolActivity(id, "running", name, "正在执行...");
  const data = await j("/tools/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  if (name === "install_clawhub_skill") {
    await loadSkills();
  }
  toolActivity(id, "done", name, "执行完成");
  return { role: "tool", tool_call_id: id, content: JSON.stringify(data.result, null, 2) };
};

askModel = async function askModelWithExplicitSaveGuard(userText) {
  if (!selectedModel()) throw new Error("请先选择模型。");

  state.lastRequestedUserText = userText || "";
  const allowedTools = getAllowedToolsForUserText(userText);
  let messages = [...systemMessages(), ...state.messages, { role: "user", content: userPayload(userText) }];
  let final = "";

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const t0 = performance.now();
    const data = await j(chatEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel(),
        messages,
        temperature: 0.7,
        tools: allowedTools,
        tool_choice: allowedTools.length ? "auto" : "none",
        stream: false,
      }),
    });

    refreshMetrics(data.usage || null, performance.now() - t0);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("接口返回成功，但没有找到 assistant message。");

    const content = normalizeContent(msg.content);
    if (content) final = content;
    messages.push({ role: "assistant", content: msg.content || content, tool_calls: msg.tool_calls });

    if (!msg.tool_calls?.length) break;
    for (const tc of msg.tool_calls) messages.push(await executeTool(tc));
  }

  if (!final) throw new Error("模型进行了工具调用，但没有返回最终文本结果。");
  const messageTimestamp = Date.now();
  state.messages.push(
    { role: "user", content: userText || "请结合附件继续回答。", timestamp: messageTimestamp },
    { role: "assistant", content: final, timestamp: Date.now() }
  );
  save();
  refreshMetrics();
  autoSaveCurrentChat();
  return final;
};

submit = async function submitInChatPending(ev) {
  ev.preventDefault();
  ev.stopImmediatePropagation();
  if (state.sending) return;

  const text = els.userInput?.value.trim() || "";
  if (!text && !state.files.length) {
    return setStatus("请输入要发送的内容");
  }

  appendMessage("user", text || "请结合附件继续回答。", "user", state.files.filter((f) => f.isImage));
  if (els.userInput) {
    els.userInput.value = "";
  }
  refreshMetrics();

  const pendingMessage = appendPendingMessage();
  state.sending = true;
  if (els.sendButton) {
    els.sendButton.disabled = true;
    els.sendButton.textContent = "发送中...";
  }

  try {
    const reply = await askModel(text);
    pendingMessage?.remove();
    appendMessage("assistant", reply);
    clearFiles();
    setStatus("已完成");
  } catch (error) {
    pendingMessage?.remove();
    appendMessage("system", `${error.message}\n\n请确认你是通过 node server.js 启动页面，并且本地模型服务仍在 http://127.0.0.1:1234 运行。`, "error");
    setStatus("请求失败");
  } finally {
    state.sending = false;
    if (els.sendButton) {
      els.sendButton.disabled = false;
      els.sendButton.textContent = "发送消息";
    }
  }
};

els.chatForm?.addEventListener("submit", submit, true);

renderSkills = function renderSkillsWithPersistence() {
  if (!els.skillsList) return;
  if (!state.skills.length) {
    els.skillsList.innerHTML = '<div class="file-empty">当前还没有读取到技能列表。</div>';
    return;
  }

  els.skillsList.replaceChildren(...state.skills.map((skill) => {
    const item = document.createElement("div");
    item.className = `skill-item${sameSkill(skill, state.selectedSkill) ? " is-selected" : ""}${sameSkill(skill, state.activeSkill) ? " is-active" : ""}`;

    const head = document.createElement("div");
    head.className = "skill-item-head";

    const titleWrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = skill.name;
    const meta = document.createElement("div");
    meta.className = "skill-summary";
    meta.textContent = [skill.source, skill.summary].filter(Boolean).join(" · ");
    titleWrap.append(title, meta);

    const status = document.createElement("div");
    status.className = "button-row left wrap-row";
    if (sameSkill(skill, state.selectedSkill)) {
      const readBadge = document.createElement("span");
      readBadge.className = "mini-status-tag";
      readBadge.textContent = "已读取";
      status.append(readBadge);
    }
    if (sameSkill(skill, state.activeSkill)) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "mini-status-tag active";
      activeBadge.textContent = "已启用";
      status.append(activeBadge);
    }
    head.append(titleWrap, status);

    const actions = document.createElement("div");
    actions.className = "button-row left wrap-row";

    const readButton = document.createElement("button");
    readButton.type = "button";
    readButton.className = "ghost-button mini-action-button";
    readButton.textContent = skill.source === "workspace" ? "读取" : "安装到当前目录";
    readButton.onclick = async () => {
      spark(readButton);
      if (skill.source === "workspace") {
        await readSkill(skill);
      } else {
        await installSkill(skill);
      }
    };
    actions.append(readButton);

    if (skill.source === "workspace") {
      const enableButton = document.createElement("button");
      enableButton.type = "button";
      enableButton.className = "ghost-button mini-action-button";
      enableButton.textContent = sameSkill(skill, state.activeSkill) ? "已启用" : "直接启用";
      enableButton.disabled = sameSkill(skill, state.activeSkill);
      enableButton.onclick = async () => {
        spark(enableButton);
        if (!sameSkill(skill, state.selectedSkill)) {
          await readSkill(skill);
        }
        applySelectedSkill();
      };
      actions.append(enableButton);
    }

    item.append(head, actions);
    return item;
  }));
};

loadSkills = async function loadSkillsWithPersistence() {
  setStatus("正在读取技能列表...");
  try {
    let data = await j("/skills/list?source=workspace");
    state.skills = data.skills || [];
    if (!state.skills.length) {
      data = await j("/skills/list?source=codex");
      state.skills = data.skills || [];
    }
    renderSkills();
    renderSkillPreview();
    save();
    setStatus(state.skills.length ? `已读取 ${state.skills.length} 个技能` : "没有找到可用技能");
  } catch (error) {
    appendMessage("system", `读取技能失败：${error.message}`, "error");
    setStatus("读取技能失败");
  }
};

readSkill = async function readSkillWithPersistence(skill) {
  setStatus(`正在读取技能：${skill.name}`);
  const data = await j(`/skills/read?source=${encodeURIComponent(skill.source)}&name=${encodeURIComponent(skill.name)}`);
  state.selectedSkill = data.skill;
  const existingIndex = state.skills.findIndex((item) => sameSkill(item, data.skill));
  if (existingIndex >= 0) {
    state.skills[existingIndex] = { ...state.skills[existingIndex], ...cloneSkillForStorage(data.skill) };
  }
  renderSkillPreview(data.skill);
  renderSkills();
  save();
  setStatus(`已读取技能：${skill.name}`);
};

applySelectedSkill = function applySelectedSkillWithPersistence() {
  if (!state.selectedSkill) {
    setStatus("请先读取一个技能");
    return;
  }
  state.activeSkill = cloneSkillForStorage(state.selectedSkill);
  renderSkills();
  renderSkillPreview();
  save();
  appendMessage("system", `已启用技能：${state.selectedSkill.name}\n后续对话会自动附带该技能内容。`, "success");
  refreshMetrics();
  setStatus(`已启用技能：${state.selectedSkill.name}`);
};

renderSkills();
renderSkillPreview();
refreshMetrics();

executeTool = async function executeToolWithSkillInstallGuard(toolCall) {
  const id = toolCall?.id || nowId();
  const name = toolCall?.function?.name || "unknown";
  let args = {};

  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }

  const latestUserText = state.lastRequestedUserText || "";
  if (WRITE_TOOL_NAMES.has(name) && !canUseWriteTools(latestUserText)) {
    throw new Error("当前请求没有明确授权保存到本地，已阻止文件写入或删除。若需要保存，请明确说明“保存到本地”或“写入文件”。");
  }
  if (SKILL_INSTALL_TOOL_NAMES.has(name) && !canInstallSkillTools(latestUserText)) {
    throw new Error("当前还没有拿到明确的技能下载或安装确认。请先让我推荐技能，再明确告诉我要安装哪一个。");
  }

  if (name === "delete_file" && args.path && !window.confirm(`AI 请求删除文件：${args.path}\n\n是否允许继续？`)) {
    return { role: "tool", tool_call_id: id, content: JSON.stringify({ cancelled: true }) };
  }

  toolActivity(id, "running", name, "正在执行...");
  const data = await j("/tools/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  toolActivity(id, "done", name, "执行完成");
  return { role: "tool", tool_call_id: id, content: JSON.stringify(data.result, null, 2) };
};

loadWorkspacePersonaPresets = async function loadWorkspacePersonaPresetsSafe() {
  try {
    const data = await j("/personas/list");
    workspacePersonaPresets = Array.isArray(data.presets) ? data.presets : [];
    renderPersonaPresets();
    renderPersonaPresetDescription();
    save();
  } catch (error) {
    workspacePersonaPresets = [];
    renderPersonaPresets();
    renderPersonaPresetDescription();
    const message = String(error?.message || "");
    if (!/not found/i.test(message)) {
      setStatus(`工作区人设模板读取失败：${message}`);
    }
  }
};

function restoreSavedPersonaPresetSelection() {
  if (!els.personaPreset) return;
  const persistedValue = rememberedPersonaPresetId || saved().personaPreset || "none";
  const allPresetIds = allPersonaPresets().map((preset) => preset.id);
  const nextValue = allPresetIds.includes(persistedValue) ? persistedValue : "none";
  els.personaPreset.value = nextValue;
  renderPersonaPresetDescription();
}

let rememberedPersonaPresetId = saved().personaPreset || "none";

const loadBeforePersonaPresetSelectionRestore = load;
load = function loadWithPersonaPresetSelectionRestore() {
  loadBeforePersonaPresetSelectionRestore();
  rememberedPersonaPresetId = saved().personaPreset || rememberedPersonaPresetId || "none";
  restoreSavedPersonaPresetSelection();
};

const renderPersonaPresetsBeforeFinalRestore = renderPersonaPresets;
renderPersonaPresets = function renderPersonaPresetsWithFinalRestore() {
  renderPersonaPresetsBeforeFinalRestore();
  restoreSavedPersonaPresetSelection();
};

const loadWorkspacePersonaPresetsBeforeFinalRestore = loadWorkspacePersonaPresets;
loadWorkspacePersonaPresets = async function loadWorkspacePersonaPresetsWithFinalRestore() {
  await loadWorkspacePersonaPresetsBeforeFinalRestore();
  restoreSavedPersonaPresetSelection();
};

const saveBeforeStablePersonaPresetMemory = save;
save = function saveWithStablePersonaPresetMemory() {
  saveBeforeStablePersonaPresetMemory();
  const currentSaved = saved();
  const optionValues = els.personaPreset ? Array.from(els.personaPreset.options || []).map((option) => option.value) : [];
  const currentValue = els.personaPreset?.value || "none";
  const nextPersonaPreset =
    currentValue !== "none"
      ? currentValue
      : (!optionValues.includes(rememberedPersonaPresetId) && rememberedPersonaPresetId !== "none"
          ? rememberedPersonaPresetId
          : currentValue);
  rememberedPersonaPresetId = nextPersonaPreset || "none";
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...currentSaved,
    personaPreset: rememberedPersonaPresetId,
  }));
};

els.personaPreset?.addEventListener("change", () => {
  rememberedPersonaPresetId = els.personaPreset?.value || "none";
});

restoreSavedPersonaPresetSelection();

function hasNovelWritingIntent(text = "") {
  const normalized = String(text).toLowerCase();
  const keywords = [
    "小说",
    "正文",
    "章节",
    "设定",
    "世界观",
    "角色卡",
    "角色设定",
    "卷纲",
    "总纲",
    "大纲",
    "番外",
    "续写",
    "润色",
    "细化",
    "写一章",
    "写章节",
    "创作",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function isNovelWorkspacePath(targetPath = "") {
  const normalized = String(targetPath || "").replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  return /^[^/]+\/(设定|正文)\/[^/].+/u.test(normalized);
}

function normalizeNovelFileName(fileName = "", fallbackBase = "未命名文档") {
  const raw = String(fileName || "").replace(/\\/g, "/").split("/").pop()?.trim() || "";
  const safeBase = raw || fallbackBase;
  return /\.md$/i.test(safeBase) ? safeBase : `${safeBase}.md`;
}

function inferNovelSectionFromPathOrContent(targetPath = "", content = "") {
  const normalizedPath = String(targetPath || "").replace(/\\/g, "/");
  const normalizedContent = String(content || "");
  if (/设定|世界观|角色|卷纲|总纲|大纲|时间线|规则/u.test(normalizedPath) || /世界观|角色设定|设定|卷纲|总纲|大纲|时间线|规则/u.test(normalizedContent)) {
    return "设定";
  }
  if (/正文|章节|番外/u.test(normalizedPath) || /第.{0,6}章|正文|番外|章节/u.test(normalizedContent)) {
    return "正文";
  }
  return "正文";
}

function extractNovelNameFromUserText(text = "") {
  const raw = String(text || "");
  const patterns = [
    /小说[《〈<]?([^》〉>\n]{1,40})[》〉>]/u,
    /《([^》\n]{1,40})》/u,
    /小说名称[是为:：\s]+([^\n，。,；;]{1,40})/u,
    /书名[是为:：\s]+([^\n，。,；;]{1,40})/u,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function getNovelExecutionContextText(currentText = "") {
  const current = String(currentText || "").trim();
  if (hasNovelWritingIntent(current)) {
    return current;
  }
  const previousUser = [...state.messages].reverse().find((message) => message?.role === "user" && typeof message.content === "string" && hasNovelWritingIntent(message.content));
  return [previousUser?.content || "", current].filter(Boolean).join("\n");
}

function fillNovelWorkspacePath(args = {}, userText = "") {
  const nextArgs = { ...args };
  const normalizedPath = String(nextArgs.path || "").replace(/\\/g, "/").trim();
  if (normalizedPath && isNovelWorkspacePath(normalizedPath)) {
    return nextArgs;
  }
  const novelName = extractNovelNameFromUserText(userText);
  if (!novelName) {
    return nextArgs;
  }
  const section = inferNovelSectionFromPathOrContent(normalizedPath, nextArgs.content);
  const fileName = normalizeNovelFileName(
    normalizedPath && !normalizedPath.includes("/") ? normalizedPath : "",
    section === "设定" ? "设定.md" : "正文.md"
  );
  nextArgs.path = `${novelName}/${section}/${fileName}`;
  return nextArgs;
}

function isDirectoryLikePath(targetPath = "") {
  const normalized = String(targetPath || "").replace(/\\/g, "/").trim();
  if (!normalized) return true;
  if (/[\/]$/.test(normalized)) return true;
  if (/^[a-zA-Z]:\/?$/.test(normalized)) return true;
  const tail = normalized.split("/").pop() || "";
  if (!tail || tail === "." || tail === "..") return true;
  return !/\.[a-zA-Z0-9]{1,12}$/.test(tail);
}

const fillNovelWorkspacePathBeforeDirectoryFix = fillNovelWorkspacePath;
fillNovelWorkspacePath = function fillNovelWorkspacePathWithDirectoryFix(args = {}, userText = "") {
  const nextArgs = fillNovelWorkspacePathBeforeDirectoryFix(args, userText);
  const normalizedPath = String(nextArgs.path || "").replace(/\\/g, "/").trim();
  if (!normalizedPath) {
    return nextArgs;
  }

  if (isNovelWorkspacePath(normalizedPath) && !isDirectoryLikePath(normalizedPath)) {
    return nextArgs;
  }

  const novelName = extractNovelNameFromUserText(userText);
  if (!novelName) {
    return nextArgs;
  }

  const section = inferNovelSectionFromPathOrContent(normalizedPath, nextArgs.content);
  const fallbackFileName = section === "设定" ? "设定.md" : "正文.md";

  if (isNovelWorkspacePath(normalizedPath) && isDirectoryLikePath(normalizedPath)) {
    nextArgs.path = `${normalizedPath.replace(/[\/]+$/, "")}/${fallbackFileName}`;
    return nextArgs;
  }

  if (isDirectoryLikePath(normalizedPath)) {
    nextArgs.path = `${novelName}/${section}/${fallbackFileName}`;
    return nextArgs;
  }

  return nextArgs;
};

const systemMessagesBeforeNovelSaveRule = systemMessages;
systemMessages = function systemMessagesWithNovelSaveRule() {
  const list = systemMessagesBeforeNovelSaveRule();
  list.push({
    role: "system",
    content: "如果当前任务是在创作、续写、整理或保存小说文档，默认允许保存到当前工作区，不需要用户再次强调“保存到本地”。小说相关文件必须按“小说名称/设定/”和“小说名称/正文/”组织：世界观、角色卡、设定、大纲、卷纲、时间线等存放到“小说名称/设定/”；章节正文、番外、修订稿等存放到“小说名称/正文/”。如果用户没有额外指定路径，就按这套规则落盘。",
  });
  return list;
};

const getAllowedToolsForUserTextBeforeNovelSaveRule = getAllowedToolsForUserText;
getAllowedToolsForUserText = function getAllowedToolsForUserTextWithNovelSaveRule(userText = "") {
  const baseTools = getAllowedToolsForUserTextBeforeNovelSaveRule(userText);
  if (!hasNovelWritingIntent(userText)) {
    return baseTools;
  }
  const hasWriteFile = baseTools.some((tool) => tool?.function?.name === "write_file");
  if (hasWriteFile) {
    return baseTools;
  }
  const writeFileTool = TOOLS.find((tool) => tool?.function?.name === "write_file");
  return writeFileTool ? [...baseTools, writeFileTool] : baseTools;
};

const executeToolBeforeNovelSaveRule = executeTool;
executeTool = async function executeToolWithNovelSaveRule(toolCall) {
  const name = toolCall?.function?.name || "unknown";
  let args = {};

  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }

  const latestUserText = state.lastRequestedUserText || "";
  const novelWriteAllowed = hasNovelWritingIntent(latestUserText);

  if (name === "write_file" && novelWriteAllowed) {
    if (!String(args.path || "").trim()) {
      throw new Error("当前是小说写作保存任务。请把文件保存到“小说名称/设定/文件名.md”或“小说名称/正文/文件名.md”这类路径后再执行。");
    }
    if (!isNovelWorkspacePath(args.path)) {
      throw new Error("小说文档只能保存到当前工作区下的“小说名称/设定/”或“小说名称/正文/”目录中。请调整保存路径后再执行。");
    }
  }

  return executeToolBeforeNovelSaveRule({
    ...toolCall,
    function: {
      ...(toolCall?.function || {}),
      arguments: JSON.stringify(args),
    },
  });
};

const executeToolBeforeNovelPathAutofill = executeTool;
executeTool = async function executeToolWithNovelPathAutofill(toolCall) {
  const name = toolCall?.function?.name || "unknown";
  let args = {};

  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }

  const latestUserText = state.lastRequestedUserText || "";
  if (name === "write_file" && hasNovelWritingIntent(latestUserText)) {
    args = fillNovelWorkspacePath(args, latestUserText);
    if (!String(args.path || "").trim()) {
      throw new Error("当前是小说写作保存任务。请提供小说名称，或把文件保存到“小说名称/设定/文件名.md”或“小说名称/正文/文件名.md”这类路径后再执行。");
    }
    if (!isNovelWorkspacePath(args.path)) {
      throw new Error("小说文档只能保存到当前工作区下的“小说名称/设定/”或“小说名称/正文/”目录中。请调整保存路径后再执行。");
    }
  }

  return executeToolBeforeNovelPathAutofill({
    ...toolCall,
    function: {
      ...(toolCall?.function || {}),
      arguments: JSON.stringify(args),
    },
  });
};

const canUseWriteToolsBeforeNovelDefaultSave = canUseWriteTools;
canUseWriteTools = function canUseWriteToolsWithNovelDefaultSave(userText = "") {
  return canUseWriteToolsBeforeNovelDefaultSave(userText) || hasNovelWritingIntent(userText);
};

const executeToolBeforeNovelDefaultSaveBypass = executeTool;
executeTool = async function executeToolWithNovelDefaultSaveBypass(toolCall) {
  const id = toolCall?.id || nowId();
  const name = toolCall?.function?.name || "unknown";
  let args = {};

  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }

  const latestUserText = state.lastRequestedUserText || "";
  const novelContextText = getNovelExecutionContextText(latestUserText);
  const isNovelWrite = name === "write_file" && hasNovelWritingIntent(novelContextText);

  if (!isNovelWrite) {
    return executeToolBeforeNovelDefaultSaveBypass(toolCall);
  }

  args = fillNovelWorkspacePath(args, novelContextText);
  if (!String(args.path || "").trim()) {
    throw new Error("当前是小说写作保存任务。请提供小说名称，或把文件保存到“小说名称/设定/文件名.md”或“小说名称/正文/文件名.md”这类路径后再执行。");
  }
  if (!isNovelWorkspacePath(args.path)) {
    throw new Error("小说文档只能保存到当前工作区下的“小说名称/设定/”或“小说名称/正文/”目录中。请调整保存路径后再执行。");
  }

  toolActivity(id, "running", name, "正在执行...");
  const data = await j("/tools/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  toolActivity(id, "done", name, "执行完成");
  return { role: "tool", tool_call_id: id, content: JSON.stringify(data.result, null, 2) };
};

const executeToolBeforeNovelDirectoryGuard = executeTool;
executeTool = async function executeToolWithNovelDirectoryGuard(toolCall) {
  const name = toolCall?.function?.name || "unknown";
  let args = {};

  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }

  const latestUserText = state.lastRequestedUserText || "";
  const novelContextText = getNovelExecutionContextText(latestUserText);
  if (name === "write_file" && hasNovelWritingIntent(novelContextText)) {
    args = fillNovelWorkspacePath(args, novelContextText);
    if (!String(args.path || "").trim()) {
      throw new Error("当前是小说写作保存任务。请提供小说名称，或使用“小说名称/设定/文件名.md”或“小说名称/正文/文件名.md”这样的完整文件路径。");
    }
    if (isDirectoryLikePath(args.path)) {
      throw new Error("当前保存路径还是目录，不是具体文件，所以无法写入。请使用“小说名称/设定/文件名.md”或“小说名称/正文/文件名.md”这样的完整文件路径。");
    }
  }

  return executeToolBeforeNovelDirectoryGuard({
    ...toolCall,
    function: {
      ...(toolCall?.function || {}),
      arguments: JSON.stringify(args),
    },
  });
};

appendPendingMessage = function appendPendingMessageTyping() {
  const card = document.createElement("article");
  card.className = "message assistant pending";
  const avatar = messageAvatarMarkup("assistant");
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  const head = document.createElement("div");
  head.className = "message-head";
  const role = document.createElement("div");
  role.className = "message-role";
  role.textContent = roleName("assistant");
  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = new Date().toISOString();
  time.textContent = formatMessageTimestamp();
  const content = document.createElement("div");
  content.className = "message-content";
  content.innerHTML = '<div class="thinking-line"><span class="thinking-text">正在输入中</span><span class="thinking-dots"><span></span><span></span><span></span></span></div>';
  head.append(role, time);
  bubble.append(head, content);
  card.append(avatar, bubble);
  els.chatMessages?.append(card);
  requestAnimationFrame(() => els.chatMessages?.scrollTo({ top: els.chatMessages.scrollHeight, behavior: "smooth" }));
  return card;
};

pushScheduledTaskResultToChat = function pushScheduledTaskResultToChatCompact(task) {
  const detail = String(task?.lastError || task?.lastResult || task?.prompt || "").trim();
  if (!detail) {
    return;
  }

  const shouldCreateFreshSession = !chatHistoryRuntime.currentId && !state.messages.length;
  if (shouldCreateFreshSession) {
    els.chatMessages?.replaceChildren();
  }

  const taskTimestamp = task.lastRunAt || Date.now();
  appendMessage("assistant", detail, "assistant", [], taskTimestamp);
  state.messages.push({ role: "assistant", content: detail, timestamp: taskTimestamp });

  upsertChatRecord({
    title: shouldCreateFreshSession ? `${task?.name || "定时任务"}` : undefined,
    forceNew: shouldCreateFreshSession,
  });
  refreshMetrics();
  setStatus(`定时任务内容已推送到当前会话：${task?.name || "未命名任务"}`);
};

schedulerElements = function schedulerElementsCronOnly() {
  return {
    name: $("#schedule-task-name"),
    cron: $("#schedule-task-cron"),
    prompt: $("#schedule-task-prompt"),
    createButton: $("#create-schedule-task"),
    refreshButton: $("#refresh-schedule-tasks"),
    meta: $("#schedule-task-meta"),
    list: $("#schedule-task-list"),
  };
};

describeScheduledTaskFrequency = function describeScheduledTaskFrequencyCronOnly(task) {
  return String(task?.cronExpression || "").trim();
};

editScheduledTask = async function editScheduledTaskCronOnly(task) {
  const nextPrompt = window.prompt("请输入新的任务内容：", task.prompt || "");
  if (nextPrompt == null) return;

  const trimmedPrompt = nextPrompt.trim();
  if (!trimmedPrompt) {
    setStatus("任务内容不能为空");
    return;
  }

  const nextCron = window.prompt("请输入新的 Cron 表达式：", describeScheduledTaskFrequency(task));
  if (nextCron == null) return;
  const cronExpression = nextCron.trim();
  if (!cronExpression) {
    setStatus("Cron 表达式不能为空");
    return;
  }

  await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: trimmedPrompt,
      scheduleType: "cron",
      cronExpression,
    }),
  });
  await loadScheduledTasksUI();
  setStatus(`已更新定时任务：${task.name}`);
};

createScheduledTask = async function createScheduledTaskCronOnly() {
  const { name, cron, prompt } = schedulerElements();
  const taskName = name?.value.trim() || "";
  const cronExpression = cron?.value.trim() || "";
  const taskPrompt = prompt?.value.trim() || "";

  if (!taskName) {
    setStatus("请输入任务名称");
    return;
  }
  if (!cronExpression) {
    setStatus("请输入 Cron 表达式");
    return;
  }
  if (!taskPrompt) {
    setStatus("请输入任务提示词");
    return;
  }

  await schedulerRequest("/scheduler/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: taskName,
      prompt: taskPrompt,
      model: selectedModel(),
      scheduleType: "cron",
      cronExpression,
      enabled: true,
    }),
  });

  if (name) name.value = "";
  if (cron) cron.value = "";
  if (prompt) prompt.value = "";
  await loadScheduledTasksUI();
  setStatus(`已创建定时任务：${taskName}`);
};

renderScheduledTasks = function renderScheduledTasksCronOnly(tasks) {
  const { list, meta } = schedulerElements();
  if (!list || !meta) return;

  if (!tasks.length) {
    meta.textContent = "当前还没有定时任务。";
    list.innerHTML = '<div class="file-empty">还没有定时任务。</div>';
    return;
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;
  meta.textContent = `共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用。`;

  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement("div");
    item.className = "schedule-task-item";

    const head = document.createElement("div");
    head.className = "schedule-task-head";

    const title = document.createElement("p");
    title.className = "schedule-task-title";
    title.textContent = task.name;

    const badges = document.createElement("div");
    badges.className = "schedule-task-badges";

    const statusBadge = document.createElement("span");
    statusBadge.className = `schedule-task-badge ${task.running ? "running" : task.lastStatus === "success" ? "success" : task.lastStatus === "error" ? "error" : ""}`;
    statusBadge.textContent = task.running ? "运行中" : task.enabled ? "已启用" : "已暂停";

    const cronBadge = document.createElement("span");
    cronBadge.className = "schedule-task-badge";
    cronBadge.textContent = `Cron: ${task.cronExpression || ""}`;

    badges.append(statusBadge, cronBadge);
    head.append(title, badges);

    const metaLine = document.createElement("div");
    metaLine.className = "schedule-task-meta-line";
    metaLine.textContent = `模型：${task.model} · 下次：${formatScheduleTime(task.nextRunAt)} · 上次：${formatScheduleTime(task.lastRunAt)}`;

    const promptPreview = document.createElement("div");
    promptPreview.className = "schedule-task-prompt";
    promptPreview.textContent = `任务内容：${task.prompt || "暂无内容"}`;

    const result = document.createElement("div");
    result.className = "schedule-task-result";
    result.textContent = task.lastError || task.lastResult || "最近还没有执行结果。";

    const actions = document.createElement("div");
    actions.className = "schedule-task-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "ghost-button";
    editButton.textContent = "编辑";
    editButton.addEventListener("click", async () => {
      try {
        await editScheduledTask(task);
      } catch (error) {
        appendMessage("system", `更新定时任务失败：${error.message}`, "error");
        setStatus("更新定时任务失败");
      }
    });

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "ghost-button";
    toggleButton.textContent = task.enabled ? "暂停" : "启用";
    toggleButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !task.enabled }),
        });
        await loadScheduledTasksUI();
      } catch (error) {
        appendMessage("system", `更新定时任务失败：${error.message}`, "error");
      }
    });

    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "ghost-button";
    runButton.textContent = "立即执行";
    runButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}/run`, { method: "POST" });
        await loadScheduledTasksUI();
        setStatus(`已执行定时任务：${task.name}`);
      } catch (error) {
        appendMessage("system", `执行定时任务失败：${error.message}`, "error");
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost-button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`确定删除定时任务“${task.name}”吗？`)) return;
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
        await loadScheduledTasksUI();
        setStatus(`已删除定时任务：${task.name}`);
      } catch (error) {
        appendMessage("system", `删除定时任务失败：${error.message}`, "error");
      }
    });

    actions.append(editButton, toggleButton, runButton, deleteButton);
    item.append(head, metaLine, promptPreview, result, actions);
    return item;
  }));
};

loadScheduledTasksUI().catch(() => {});

deleteChatRecord = function deleteChatRecordWithUndo(recordId) {
  const records = readChatHistoryRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) return;

  const confirmed = window.confirm(`确定删除聊天记录“${target.title || "未命名会话"}”吗？\n\n删除后 15 秒内可以撤销。`);
  if (!confirmed) return;

  writeChatHistoryRecords(records.filter((record) => record.id !== recordId));
  const wasCurrent = chatHistoryRuntime.currentId === recordId;
  if (wasCurrent) {
    clearDeletedChatContext();
  }

  beginDeletedChatUndo(target, { wasCurrent });
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
  setStatus(`已删除聊天记录：${target.title || "未命名会话"}`);
};

pushScheduledTaskResultToChat = function pushScheduledTaskResultToChatAsAssistant(task) {
  const taskTimestamp = task?.lastRunAt || Date.now();
  const content = String(task?.lastError || task?.lastResult || "").trim();
  if (!content) return;

  const shouldCreateFreshSession = !chatHistoryRuntime.currentId && !state.messages.length;
  if (shouldCreateFreshSession) {
    els.chatMessages?.replaceChildren();
  }

  appendMessage("assistant", content, "assistant", [], taskTimestamp);
  state.messages.push({
    role: "assistant",
    content,
    timestamp: taskTimestamp,
  });

  upsertChatRecord({
    title: shouldCreateFreshSession ? `${task?.name || "定时提醒"}` : undefined,
    forceNew: shouldCreateFreshSession,
  });
  refreshMetrics();
  setStatus(`定时任务消息已作为 AI 回复推送到当前会话：${task?.name || "未命名任务"}`);
};

const scheduledTaskEditorRuntime = {
  editingId: null,
  drafts: {},
};

function startInlineEditScheduledTask(task) {
  scheduledTaskEditorRuntime.editingId = task.id;
  scheduledTaskEditorRuntime.drafts[task.id] = {
    cronExpression: String(task.cronExpression || "").trim(),
    prompt: String(task.prompt || ""),
  };
  loadScheduledTasksUI().catch(() => {});
}

function cancelInlineEditScheduledTask(taskId) {
  if (scheduledTaskEditorRuntime.editingId === taskId) {
    scheduledTaskEditorRuntime.editingId = null;
  }
  delete scheduledTaskEditorRuntime.drafts[taskId];
  loadScheduledTasksUI().catch(() => {});
}

async function saveInlineEditScheduledTask(task) {
  const draft = scheduledTaskEditorRuntime.drafts[task.id] || {};
  const cronExpression = String(draft.cronExpression || "").trim();
  const prompt = String(draft.prompt || "").trim();

  if (!cronExpression) {
    setStatus("Cron 表达式不能为空");
    return;
  }
  if (!prompt) {
    setStatus("任务内容不能为空");
    return;
  }

  await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      scheduleType: "cron",
      cronExpression,
    }),
  });

  scheduledTaskEditorRuntime.editingId = null;
  delete scheduledTaskEditorRuntime.drafts[task.id];
  await loadScheduledTasksUI();
  setStatus(`已更新定时任务：${task.name}`);
}

editScheduledTask = async function editScheduledTaskInline(task) {
  if (scheduledTaskEditorRuntime.editingId === task.id) {
    cancelInlineEditScheduledTask(task.id);
    return;
  }
  startInlineEditScheduledTask(task);
};

renderScheduledTasks = function renderScheduledTasksInlineEditable(tasks) {
  const { list, meta } = schedulerElements();
  if (!list || !meta) return;

  if (!tasks.length) {
    meta.textContent = "当前还没有定时任务。";
    list.innerHTML = '<div class="file-empty">还没有定时任务。</div>';
    return;
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;
  meta.textContent = `共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用。`;

  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement("div");
    item.className = "schedule-task-item";

    const head = document.createElement("div");
    head.className = "schedule-task-head";

    const title = document.createElement("p");
    title.className = "schedule-task-title";
    title.textContent = task.name;

    const badges = document.createElement("div");
    badges.className = "schedule-task-badges";

    const statusBadge = document.createElement("span");
    statusBadge.className = `schedule-task-badge ${task.running ? "running" : task.lastStatus === "success" ? "success" : task.lastStatus === "error" ? "error" : ""}`;
    statusBadge.textContent = task.running ? "运行中" : task.enabled ? "已启用" : "已暂停";

    const cronBadge = document.createElement("span");
    cronBadge.className = "schedule-task-badge";
    cronBadge.textContent = `Cron: ${task.cronExpression || ""}`;

    badges.append(statusBadge, cronBadge);
    head.append(title, badges);

    const metaLine = document.createElement("div");
    metaLine.className = "schedule-task-meta-line";
    metaLine.textContent = `模型：${task.model} · 下次：${formatScheduleTime(task.nextRunAt)} · 上次：${formatScheduleTime(task.lastRunAt)}`;

    const isEditing = scheduledTaskEditorRuntime.editingId === task.id;
    let bodyBlock;

    if (isEditing) {
      const draft = scheduledTaskEditorRuntime.drafts[task.id] || {
        cronExpression: String(task.cronExpression || "").trim(),
        prompt: String(task.prompt || ""),
      };
      scheduledTaskEditorRuntime.drafts[task.id] = draft;

      const editor = document.createElement("div");
      editor.className = "schedule-task-editor";

      const editorHead = document.createElement("div");
      editorHead.className = "schedule-task-editor-head";

      const editorTitle = document.createElement("strong");
      editorTitle.className = "schedule-task-editor-title";
      editorTitle.textContent = "编辑任务";

      const editorClose = document.createElement("button");
      editorClose.type = "button";
      editorClose.className = "ghost-button schedule-task-editor-close";
      editorClose.textContent = "×";
      editorClose.title = "退出编辑";
      editorClose.addEventListener("click", () => cancelInlineEditScheduledTask(task.id));

      const cronLabel = document.createElement("label");
      const cronText = document.createElement("span");
      cronText.textContent = "Cron 表达式";
      const cronInput = document.createElement("input");
      cronInput.type = "text";
      cronInput.value = draft.cronExpression;
      cronInput.placeholder = "例如 0 9 * * *";
      cronInput.addEventListener("input", (event) => {
        draft.cronExpression = event.target.value;
      });
      cronLabel.append(cronText, cronInput);

      const promptLabel = document.createElement("label");
      const promptText = document.createElement("span");
      promptText.textContent = "任务内容";
      const promptInput = document.createElement("textarea");
      promptInput.rows = 4;
      promptInput.value = draft.prompt;
      promptInput.placeholder = "请输入任务执行时发送给模型的内容";
      promptInput.addEventListener("input", (event) => {
        draft.prompt = event.target.value;
      });
      promptLabel.append(promptText, promptInput);

      editorHead.append(editorTitle, editorClose);
      editor.append(editorHead, cronLabel, promptLabel);
      bodyBlock = editor;
    } else {
      const bodyWrap = document.createElement("div");

      const promptPreview = document.createElement("div");
      promptPreview.className = "schedule-task-prompt";
      promptPreview.textContent = `任务内容：${task.prompt || "暂无内容"}`;

      const result = document.createElement("div");
      result.className = "schedule-task-result";
      result.textContent = task.lastError || task.lastResult || "最近还没有执行结果。";

      bodyWrap.append(promptPreview, result);
      bodyBlock = bodyWrap;
    }

    const actions = document.createElement("div");
    actions.className = "schedule-task-actions";

    if (isEditing) {
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "ghost-button";
      saveButton.textContent = "保存";
      saveButton.addEventListener("click", async () => {
        try {
          await saveInlineEditScheduledTask(task);
        } catch (error) {
          appendMessage("system", `更新定时任务失败：${error.message}`, "error");
          setStatus("更新定时任务失败");
        }
      });

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "ghost-button";
      cancelButton.textContent = "取消";
      cancelButton.addEventListener("click", () => cancelInlineEditScheduledTask(task.id));

      actions.append(saveButton, cancelButton);
    } else {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "ghost-button";
      editButton.textContent = "编辑";
      editButton.addEventListener("click", () => editScheduledTask(task));

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "ghost-button";
      toggleButton.textContent = task.enabled ? "暂停" : "启用";
      toggleButton.addEventListener("click", async () => {
        try {
          await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !task.enabled }),
          });
          await loadScheduledTasksUI();
        } catch (error) {
          appendMessage("system", `更新定时任务失败：${error.message}`, "error");
        }
      });

      const runButton = document.createElement("button");
      runButton.type = "button";
      runButton.className = "ghost-button";
      runButton.textContent = "立即执行";
      runButton.addEventListener("click", async () => {
        try {
          await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}/run`, { method: "POST" });
          await loadScheduledTasksUI();
          setStatus(`已执行定时任务：${task.name}`);
        } catch (error) {
          appendMessage("system", `执行定时任务失败：${error.message}`, "error");
        }
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "ghost-button";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`确定删除定时任务“${task.name}”吗？`)) return;
        try {
          await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
          cancelInlineEditScheduledTask(task.id);
          await loadScheduledTasksUI();
          setStatus(`已删除定时任务：${task.name}`);
        } catch (error) {
          appendMessage("system", `删除定时任务失败：${error.message}`, "error");
        }
      });

      actions.append(editButton, toggleButton, runButton, deleteButton);
    }

    item.append(head, metaLine, bodyBlock, actions);
    return item;
  }));
};

loadScheduledTasksUI().catch(() => {});

function buildToolOnlyFallbackReply(messages = []) {
  const lastToolMessage = [...messages].reverse().find((message) => message?.role === "tool" && typeof message.content === "string");
  if (!lastToolMessage?.content) return "";

  let parsed;
  try {
    parsed = JSON.parse(lastToolMessage.content);
  } catch {
    return "";
  }

  if (parsed && typeof parsed === "object") {
    if (parsed.id && parsed.name && parsed.cronExpression) {
      return `已创建定时任务：${parsed.name}\nCron：${parsed.cronExpression}`;
    }
    if (parsed.deleted && parsed.id) {
      return `已删除定时任务：${parsed.id}`;
    }
    if (parsed.id && Object.prototype.hasOwnProperty.call(parsed, "enabled") && parsed.cronExpression) {
      return `已更新定时任务：${parsed.name || parsed.id}\nCron：${parsed.cronExpression}`;
    }
  }

  return "";
}

const askModelBeforeToolOnlyFallback = askModel;
askModel = async function askModelWithToolOnlyFallback(userText) {
  if (!selectedModel()) throw new Error("请先选择模型。");

  state.lastRequestedUserText = userText || "";
  const allowedTools = getAllowedToolsForUserText(userText);
  let messages = [...systemMessages(), ...state.messages, { role: "user", content: userPayload(userText) }];
  let final = "";

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const t0 = performance.now();
    const data = await j(chatEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel(),
        messages,
        temperature: 0.7,
        tools: allowedTools,
        tool_choice: allowedTools.length ? "auto" : "none",
        stream: false,
      }),
    });

    refreshMetrics(data.usage || null, performance.now() - t0);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("接口返回成功，但没有找到 assistant message。");

    const content = normalizeContent(msg.content);
    if (content) final = content;
    messages.push({ role: "assistant", content: msg.content || content, tool_calls: msg.tool_calls });

    if (!msg.tool_calls?.length) break;
    for (const tc of msg.tool_calls) messages.push(await executeTool(tc));
  }

  if (!final) {
    final = buildToolOnlyFallbackReply(messages);
  }
  if (!final) throw new Error("模型进行了工具调用，但没有返回最终文本结果。");

  const messageTimestamp = Date.now();
  state.messages.push(
    { role: "user", content: userText || "请结合附件继续回答。", timestamp: messageTimestamp },
    { role: "assistant", content: final, timestamp: Date.now() }
  );
  save();
  refreshMetrics();
  autoSaveCurrentChat();
  return final;
};

buildToolOnlyFallbackReply = function buildToolOnlyFallbackReplyNatural(messages = []) {
  const lastToolMessage = [...messages].reverse().find((message) => message?.role === "tool" && typeof message.content === "string");
  if (!lastToolMessage?.content) return "";

  let parsed;
  try {
    parsed = JSON.parse(lastToolMessage.content);
  } catch {
    return "";
  }

  if (!parsed || typeof parsed !== "object") return "";

  if (parsed.id && parsed.name && parsed.cronExpression) {
    return `已经帮你创建好定时任务了：${parsed.name}。\n执行时间使用 Cron 表达式：${parsed.cronExpression}`;
  }
  if (parsed.deleted && parsed.id) {
    return `已经帮你删除这个定时任务了：${parsed.id}。`;
  }
  if (parsed.id && Object.prototype.hasOwnProperty.call(parsed, "enabled") && parsed.cronExpression) {
    const taskName = parsed.name || parsed.id;
    const enabledText = parsed.enabled ? "已启用" : "已暂停";
    return `已经更新定时任务了：${taskName}。\n当前状态：${enabledText}\nCron 表达式：${parsed.cronExpression}`;
  }
  if (parsed.id && parsed.lastStatus && Object.prototype.hasOwnProperty.call(parsed, "lastRunAt")) {
    return `已经执行了定时任务：${parsed.name || parsed.id}。`;
  }

  return "";
};

const renderConversationFromMessagesBeforeTurnDelete = renderConversationFromMessages;
renderConversationFromMessages = function renderConversationFromMessagesWithTurnDelete(messages) {
  renderConversationFromMessagesBeforeTurnDelete(messages);
  decorateConversationTurnDeleteButtons();
  renderConversationTurnUndo();
};

const askModelBeforeTurnDeleteDecorate = askModel;
askModel = async function askModelWithTurnDeleteDecorate(userText) {
  const result = await askModelBeforeTurnDeleteDecorate(userText);
  renderConversationFromMessages(state.messages);
  return result;
};

function isNovelExecutionReplyStalled(userText = "", replyText = "") {
  if (!hasNovelWritingIntent(userText)) return false;
  const normalized = String(replyText || "").trim().toLowerCase();
  if (!normalized) return false;
  const planHints = [
    "先让我看看",
    "先查看",
    "先看一下",
    "我先看",
    "我先查看",
    "我先帮你查看",
    "首先让我查看",
    "先读取",
    "先创建",
    "我先创建",
    "我来先看",
    "first let me",
    "let me check",
    "i'll first",
  ];
  const actionHints = [
    "已保存",
    "已创建",
    "已写入",
    "已生成",
    "完成",
    "保存到",
    "写入到",
    "created",
    "saved",
    "written",
  ];
  return planHints.some((hint) => normalized.includes(hint.toLowerCase())) &&
    !actionHints.some((hint) => normalized.includes(hint.toLowerCase()));
}

const askModelBeforeNovelExecutionPush = askModel;
askModel = async function askModelWithNovelExecutionPush(userText) {
  const firstReply = await askModelBeforeNovelExecutionPush(userText);
  if (!isNovelExecutionReplyStalled(userText, firstReply)) {
    return firstReply;
  }

  const nudgeText = `${userText}\n\n不要只说明下一步计划。请立即执行必要的读取、生成或写入操作；如果当前信息已足够，就直接完成本轮任务。`;
  const secondReply = await askModelBeforeNovelExecutionPush(nudgeText);

  if (state.messages.length >= 4) {
    const latestAssistant = state.messages[state.messages.length - 1];
    const latestUser = state.messages[state.messages.length - 2];
    const previousAssistant = state.messages[state.messages.length - 3];
    const previousUser = state.messages[state.messages.length - 4];
    if (
      latestAssistant?.role === "assistant" &&
      latestUser?.role === "user" &&
      previousAssistant?.role === "assistant" &&
      previousUser?.role === "user" &&
      previousUser.content === userText &&
      latestUser.content === nudgeText
    ) {
      state.messages.splice(state.messages.length - 4, 2);
      save();
      renderConversationFromMessages(state.messages);
    }
  }

  return secondReply;
};

function renderConversationFromMessagesStable(messages) {
  chatHistoryRuntime.suppressAutoSave = true;
  state.messages = Array.isArray(messages) ? JSON.parse(JSON.stringify(messages)) : [];
  els.chatMessages?.replaceChildren();

  if (!state.messages.length) {
    appendMessage("assistant", "你好，我已经准备好连接本地 AI。你可以先测试连接、读取模型、上传文件，或者启用某个技能后再开始提问。");
  } else {
    state.messages.forEach((message) => {
      appendMessage(
        message.role,
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        message.role,
        [],
        message.timestamp || Date.now()
      );
    });
  }

  decorateConversationTurnDeleteButtons();
  renderConversationTurnUndo();
  refreshMetrics();
  chatHistoryRuntime.suppressAutoSave = false;
  updateCurrentChatTitle();
}

renderConversationFromMessages = function renderConversationFromMessagesFinalStable(messages) {
  renderConversationFromMessagesStable(messages);
};

loadChatRecord = function loadChatRecordFinalStable(recordId) {
  if (guardSessionOperationWhileSending("切换会话")) {
    return;
  }

  const record = readChatHistoryRecords().find((item) => item.id === recordId);
  if (!record) {
    return;
  }

  clearPendingDeletedChat({ preserveUi: true });
  clearPendingConversationTurnDelete();
  resetConversationUsageMetrics();

  state.sending = false;
  state.lastRequestedUserText = "";
  chatHistoryRuntime.currentId = record.id;
  persistCurrentChatId();

  if (els.userInput) {
    els.userInput.value = "";
  }
  if (els.sendButton) {
    els.sendButton.disabled = false;
    els.sendButton.textContent = "发送消息";
  }

  clearFiles();
  renderConversationFromMessagesStable(record.messages || []);
  renderChatHistoryList();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
  refreshMetrics();
  setStatus(`已加载聊天记录，并恢复会话上下文：${record.title || "未命名会话"}`);
};

renderConversationTurnUndo();
decorateConversationTurnDeleteButtons();

for (const tool of TOOLS) {
  const fn = tool?.function;
  if (!fn) continue;
  if (fn.name === "update_scheduled_task" || fn.name === "delete_scheduled_task" || fn.name === "run_scheduled_task") {
    fn.parameters = {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string" },
        scheduleType: { type: "string", enum: ["cron"] },
        cronExpression: { type: "string" },
        enabled: { type: "boolean" },
      },
    };
  }
}

renderChatHistoryList = function renderChatHistoryListGroupedWithUndo() {
  const { list } = historyElements();
  if (!list) return;

  const records = readChatHistoryRecords().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!records.length) {
    list.innerHTML = '<div class="file-empty">还没有聊天记录。</div>';
    renderChatHistoryUndo();
    updateChatHistoryMeta();
    updateCurrentChatTitle();
    return;
  }

  const groups = new Map();
  records.forEach((record) => {
    const label = getHistoryGroupLabel(record.updatedAt);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(record);
  });

  const fragments = [];
  ["今天", "昨天", "更早"].forEach((label) => {
    const groupRecords = groups.get(label);
    if (!groupRecords?.length) return;

    const group = document.createElement("section");
    group.className = "chat-history-group";

    const heading = document.createElement("div");
    heading.className = "chat-history-group-label";
    heading.textContent = label;
    group.append(heading);

    groupRecords.forEach((record) => {
      const item = document.createElement("div");
      item.className = `chat-history-item${record.id === chatHistoryRuntime.currentId ? " is-active" : ""}`;
      item.addEventListener("click", () => loadChatRecord(record.id));

      const main = document.createElement("div");
      main.className = "chat-history-main";

      const title = document.createElement("p");
      title.className = "chat-history-title";
      title.textContent = record.title || "未命名会话";

      const meta = document.createElement("div");
      meta.className = "chat-history-meta-line";
      meta.textContent = `${record.messages.length} 条消息 · ${formatHistoryTime(record.updatedAt)}`;
      main.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "chat-history-actions";

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "ghost-button history-rename-button";
      rename.textContent = "重命名";
      rename.addEventListener("click", (event) => {
        event.stopPropagation();
        renameChatRecord(record.id);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ghost-button history-delete-button";
      remove.textContent = "删除";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteChatRecord(record.id);
      });

      actions.append(rename, remove);
      item.append(main, actions);
      group.append(item);
    });

    fragments.push(group);
  });

  list.replaceChildren(...fragments);
  renderChatHistoryUndo();
  updateChatHistoryMeta();
  updateCurrentChatTitle();
};

renderChatHistoryList();
