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
      name: "web_search",
      description: "Search the live web for current information and return titles, links, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
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
      name: "run_workspace_skill",
      description: "Run a workspace skill entry script in the local skills directory. Only use this for explicitly-enabled local automation skills that need script execution, such as lxj.",
      parameters: {
        type: "object",
        properties: {
          skillName: { type: "string" },
          username: { type: "string" },
          headless: { type: "boolean" },
          notify: { type: "boolean" },
        },
        required: ["skillName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell_command",
      description: "Run a PowerShell command inside the current workspace when shell execution or command-line work is explicitly needed.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          workingDirectory: { type: "string" },
          timeoutMs: { type: "number" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_cli_command",
      description: "Run a CLI executable with arguments inside the current workspace when direct command-line invocation is explicitly needed.",
      parameters: {
        type: "object",
        properties: {
          executable: { type: "string" },
          args: {
            type: "array",
            items: { type: "string" },
          },
          workingDirectory: { type: "string" },
          timeoutMs: { type: "number" },
        },
        required: ["executable"],
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
      description: "Create a scheduled task only when the user explicitly asks to create/schedule an automatic recurring task. You must provide a cronExpression, for example daily 8:10 is `10 8 * * *`.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          prompt: { type: "string" },
          scheduleType: { type: "string", enum: ["cron"] },
          cronExpression: { type: "string" },
          enabled: { type: "boolean" },
          qqPushEnabled: { type: "boolean" },
          qqTargetType: { type: "string", enum: ["private", "group"] },
          qqTargetId: { type: "string" },
        },
        required: ["name", "prompt", "cronExpression"],
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
          scheduleType: { type: "string", enum: ["cron"] },
          cronExpression: { type: "string" },
          enabled: { type: "boolean" },
          qqPushEnabled: { type: "boolean" },
          qqTargetType: { type: "string", enum: ["private", "group"] },
          qqTargetId: { type: "string" },
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
const READ_ONLY_TOOL_NAMES = new Set(["list_dir", "read_file", "get_weather", "web_search"]);
const WRITE_TOOL_NAMES = new Set(["write_file", "delete_file"]);
const SKILL_DISCOVERY_TOOL_NAMES = new Set(["search_clawhub_skills"]);
const SKILL_INSTALL_TOOL_NAMES = new Set(["install_clawhub_skill"]);
const SKILL_EXECUTION_TOOL_NAMES = new Set(["run_workspace_skill"]);
const COMMAND_EXECUTION_TOOL_NAMES = new Set(["run_shell_command", "run_cli_command"]);
const SCHEDULER_TOOL_NAMES = new Set(["create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task", "run_scheduled_task"]);
const QQ_TOOL_NAMES = new Set(["send_qq_message"]);
const SUPPORTED_TOOL_NAMES = new Set(TOOLS.map((tool) => tool?.function?.name).filter(Boolean));
let workspacePersonaPresets = [];
const BEIJING_TIME_ZONE = "Asia/Shanghai";

const state = { messages: [], files: [], skills: [], selectedSkill: null, activeSkill: null, sending: false, previewMaximized: false, toolActivities: [] };
const DEFAULT_QQ_PUSH_TARGET_TYPE = "private";
const DEFAULT_QQ_PUSH_TARGET_ID = "1036986718";
const $ = (s) => document.querySelector(s);
const els = {
  chatForm: $("#chat-form"), chatMessages: $("#chat-messages"), userInput: $("#user-input"), sendButton: $("#send-button"),
  statusBar: $("#status-bar"), baseUrl: $("#base-url"), apiPath: $("#api-path"), modelSelect: $("#model-select"),
  remoteApiEnabled: $("#remote-api-enabled"), remoteBaseUrl: $("#remote-base-url"), remoteApiPath: $("#remote-api-path"),
  remoteModelsPath: $("#remote-models-path"), remoteApiKey: $("#remote-api-key"), remoteConnectionMeta: $("#remote-connection-meta"),
  assistantName: $("#assistant-name"), userName: $("#user-name"), systemPrompt: $("#system-prompt"), contextLimit: $("#context-limit"),
  qqPushEnabled: $("#qq-push-enabled"), qqBridgeUrl: $("#qq-bridge-url"), qqAccessToken: $("#qq-access-token"), qqWebhookEndpoint: $("#qq-webhook-endpoint"), copyQqWebhookEndpoint: $("#copy-qq-webhook-endpoint"), qqTargetType: $("#qq-target-type"), qqTargetId: $("#qq-target-id"), qqTargetProfileSelect: $("#qq-target-profile-select"), qqTargetProfileMeta: $("#qq-target-profile-meta"), saveQqTargetProfile: $("#save-qq-target-profile"), deleteQqTargetProfile: $("#delete-qq-target-profile"), qqPushMeta: $("#qq-push-meta"), testQqPush: $("#test-qq-push"),
  qqBotEnabled: $("#qq-bot-enabled"), qqBotGroupMentionOnly: $("#qq-bot-group-mention-only"), qqTaskPushEnabled: $("#qq-task-push-enabled"), qqBotTriggerPrefix: $("#qq-bot-trigger-prefix"), qqBotAllowedUsers: $("#qq-bot-allowed-users"), qqBotAllowedGroups: $("#qq-bot-allowed-groups"), qqBotPersona: $("#qq-bot-persona"), qqBotPersonaPreset: $("#qq-bot-persona-preset"), qqBotPersonaPresetDescription: $("#qq-bot-persona-preset-description"), qqBotPersonaFileInput: $("#qq-bot-persona-file-input"), importQqBotPersona: $("#import-qq-bot-persona"), exportQqBotPersona: $("#export-qq-bot-persona"), clearQqBotPersona: $("#clear-qq-bot-persona"), qqBotMeta: $("#qq-bot-meta"), qqBotModelSelect: $("#qq-bot-model-select"), qqToolsReadEnabled: $("#qq-tools-read-enabled"), qqToolsWriteEnabled: $("#qq-tools-write-enabled"), qqToolsCommandEnabled: $("#qq-tools-command-enabled"), qqToolsSkillEnabled: $("#qq-tools-skill-enabled"), qqToolsFileSendEnabled: $("#qq-tools-file-send-enabled"), qqFileShareRoots: $("#qq-file-share-roots"), qqToolPermissionMeta: $("#qq-tool-permission-meta"), qqProfileToolsReadEnabled: $("#qq-profile-tools-read-enabled"), qqProfileToolsWriteEnabled: $("#qq-profile-tools-write-enabled"), qqProfileToolsCommandEnabled: $("#qq-profile-tools-command-enabled"), qqProfileToolsSkillEnabled: $("#qq-profile-tools-skill-enabled"), qqProfileToolsFileSendEnabled: $("#qq-profile-tools-file-send-enabled"), qqProfileFileShareRoots: $("#qq-profile-file-share-roots"), qqProfileToolPermissionMeta: $("#qq-profile-tool-permission-meta"), qqLoadSkills: $("#qq-load-skills"), qqApplySkill: $("#qq-apply-skill"), qqClearSkillSelection: $("#qq-clear-skill-selection"), qqDisableSkill: $("#qq-disable-skill"), qqSkillsList: $("#qq-skills-list"), qqSkillMeta: $("#qq-skill-meta"), qqSkillPreview: $("#qq-skill-preview"),
  assistantAvatarInput: $("#assistant-avatar-input"), userAvatarInput: $("#user-avatar-input"),
  uploadAssistantAvatar: $("#upload-assistant-avatar"), uploadUserAvatar: $("#upload-user-avatar"),
  clearAssistantAvatar: $("#clear-assistant-avatar"), clearUserAvatar: $("#clear-user-avatar"),
  assistantAvatarPreview: $("#assistant-avatar-preview"), userAvatarPreview: $("#user-avatar-preview"),
  metricContextChars: $("#metric-context-chars-chip"), metricEstimatedPrompt: $("#metric-est-prompt-chip"), metricTotal: $("#metric-total-chip"), metricSpeed: $("#metric-speed-chip"),
  metricContextUsage: $("#metric-context-usage-chip"), usageBarFill: $("#usage-bar-fill"), modelSelectionMeta: $("#model-selection-meta"),
  conversationMiniheadText: document.querySelector(".section-minihead-text"),
  fileInput: $("#file-input"), fileList: $("#file-list"), composerFiles: $("#composer-files"), clearFiles: $("#clear-files"), attachFilesInline: $("#attach-files-inline"),
  clearChat: $("#clear-chat"), deleteChatSession: $("#delete-chat-session"), testConnection: $("#test-connection"), loadModels: $("#load-models"),
  personaPrompt: $("#persona-prompt"), personaPreset: $("#persona-preset"), personaPresetDescription: $("#persona-preset-description"),
  applyPersonaPreset: $("#apply-persona-preset"), importPersona: $("#import-persona"), exportPersona: $("#export-persona"), clearPersona: $("#clear-persona"), savePersonaPreset: $("#save-persona-preset"), deletePersonaPreset: $("#delete-persona-preset"), personaFileInput: $("#persona-file-input"),
  loadSkills: $("#load-skills"), uploadSkillZip: $("#upload-skill-zip"), downloadSkillZip: $("#download-skill-zip"), skillZipInput: $("#skill-zip-input"), applySkill: $("#apply-skill"), clearSkillSelection: $("#clear-skill-selection"), disableSkill: $("#disable-skill"), skillsList: $("#skills-list"), skillPreview: $("#skill-preview"),
  toolActivityTrigger: $("#tool-activity-trigger"), toolActivitySummary: $("#tool-activity-summary"), toolActivityList: $("#tool-activity-list"), toolActivityStatus: $("#tool-activity-status"),
  toolActivityModal: $("#tool-activity-modal"), toolActivityBackdrop: $("#tool-activity-backdrop"), toolActivityClose: $("#tool-activity-close"),
  settingsTrigger: $("#settings-trigger"), novelStudioTrigger: $("#novel-studio-trigger"), settingsModal: $("#settings-modal"), settingsBackdrop: $("#settings-backdrop"), settingsClose: $("#settings-close"),
  inlinePromptModal: $("#inline-prompt-modal"), inlinePromptBackdrop: $("#inline-prompt-backdrop"), inlinePromptEyebrow: $("#inline-prompt-eyebrow"), inlinePromptTitle: $("#inline-prompt-title"), inlinePromptDescription: $("#inline-prompt-description"), inlinePromptInput: $("#inline-prompt-input"), inlinePromptCancel: $("#inline-prompt-cancel"), inlinePromptConfirm: $("#inline-prompt-confirm"),
  workspaceBody: $(".workspace-body"), previewPanel: $("#preview-panel"), previewResizer: $("#preview-resizer"), previewFrame: $("#preview-frame"), previewEmpty: $("#preview-empty"),
  togglePreviewSize: $("#toggle-preview-size"), closePreview: $("#close-preview"),
};

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const endpoint = (path, base = (els.baseUrl?.value.trim() || location.origin)) => new URL(path, `${base}/`).toString();
const normalizeProxyPath = (value, fallback) => {
  const normalized = String(value || fallback || "").trim() || fallback || "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};
const chatEndpoint = () => {
  if (!(els.baseUrl?.value.trim()) && getRemoteApiEnabled()) {
    return endpoint(`/api${normalizeProxyPath(els.remoteApiPath?.value, "/v1/chat/completions")}`, location.origin);
  }
  return endpoint(els.apiPath?.value.trim() || "/api/v1/chat/completions");
};
const modelsEndpoint = () => {
  if (!(els.baseUrl?.value.trim()) && getRemoteApiEnabled()) {
    return endpoint(`/api${normalizeProxyPath(els.remoteModelsPath?.value, "/v1/models")}`, location.origin);
  }
  return endpoint("/api/v1/models");
};
const selectedModel = () => els.modelSelect?.value?.trim() || "";
function formatBeijingDateTime(value = Date.now(), options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    hour12: false,
    ...options,
  }).replace(/\//g, "-");
}
function getSavedModelContextLimits() {
  const s = saved();
  const mapping = s.modelContextLimits;
  return mapping && typeof mapping === "object" ? { ...mapping } : {};
}
function getDefaultContextLimitValue() {
  const s = saved();
  const legacy = String(s.contextLimit || "").trim();
  return legacy || "32768";
}
function getContextLimitForModel(modelName = selectedModel()) {
  const normalized = String(modelName || "").trim();
  const limits = getSavedModelContextLimits();
  if (normalized && String(limits[normalized] || "").trim()) {
    return String(limits[normalized]).trim();
  }
  return getDefaultContextLimitValue();
}
function applyContextLimitForModel(modelName = selectedModel()) {
  if (!els.contextLimit) return;
  els.contextLimit.value = getContextLimitForModel(modelName);
}
function persistContextLimitForSelectedModel() {
  const modelName = selectedModel();
  if (!modelName || !els.contextLimit) return;
  const old = saved();
  const nextLimits = {
    ...(old.modelContextLimits && typeof old.modelContextLimits === "object" ? old.modelContextLimits : {}),
    [modelName]: els.contextLimit.value.trim() || "32768",
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...old,
    modelContextLimits: nextLimits,
  }));
}
const roleName = (r) => r === "user" ? (els.userName?.value.trim() || "文远") : r === "assistant" ? (els.assistantName?.value.trim() || "繁星") : "系统";
const formatBytes = (n) => !n ? "0 B" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function statusTextFromContent(content = "") {
  const text = String(content || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || "就绪";
}

const setStatus = (t, tone = "default") => {
  if (!els.statusBar) return;
  els.statusBar.textContent = statusTextFromContent(t);
  if (tone && tone !== "default") {
    els.statusBar.dataset.tone = tone;
  } else {
    delete els.statusBar.dataset.tone;
  }
};
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
    targetType: els.qqTargetType?.value || persisted.qqTargetType || DEFAULT_QQ_PUSH_TARGET_TYPE,
    targetId: els.qqTargetId?.value?.trim() || persisted.qqTargetId || DEFAULT_QQ_PUSH_TARGET_ID,
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
    personaPreset: els.qqBotPersonaPreset?.value || persisted.qqBotPersonaPreset || "none",
    fileShareRoots: els.qqFileShareRoots?.value || persisted.qqFileShareRoots || "data/personas",
    toolReadEnabled: Boolean(els.qqToolsReadEnabled?.checked ?? (persisted.qqToolReadEnabled !== false)),
    toolWriteEnabled: Boolean(els.qqToolsWriteEnabled?.checked ?? persisted.qqToolWriteEnabled),
    toolCommandEnabled: Boolean(els.qqToolsCommandEnabled?.checked ?? persisted.qqToolCommandEnabled),
    toolSkillEnabled: Boolean(els.qqToolsSkillEnabled?.checked ?? persisted.qqToolSkillEnabled),
    toolFileSendEnabled: Boolean(els.qqToolsFileSendEnabled?.checked ?? persisted.qqToolFileSendEnabled),
  };
}

function getQqProfileToolSettings() {
  const bot = getQqBotSettings();
  return {
    toolReadEnabled: Boolean(els.qqProfileToolsReadEnabled?.checked ?? bot.toolReadEnabled),
    toolWriteEnabled: Boolean(els.qqProfileToolsWriteEnabled?.checked ?? bot.toolWriteEnabled),
    toolCommandEnabled: Boolean(els.qqProfileToolsCommandEnabled?.checked ?? bot.toolCommandEnabled),
    toolSkillEnabled: Boolean(els.qqProfileToolsSkillEnabled?.checked ?? bot.toolSkillEnabled),
    toolFileSendEnabled: Boolean(els.qqProfileToolsFileSendEnabled?.checked ?? bot.toolFileSendEnabled),
  };
}

function formatQqToolPermissionSummary(config = {}) {
  const enabled = [];
  if (config.toolReadEnabled !== false) enabled.push("读取");
  if (config.toolWriteEnabled) enabled.push("写入");
  if (config.toolCommandEnabled) enabled.push("命令");
  if (config.toolSkillEnabled) enabled.push("技能");
  if (config.toolFileSendEnabled) enabled.push("发文件");
  return enabled.length ? enabled.join("、") : "未开放";
}

function renderQqToolPermissionMeta() {
  const bot = getQqBotSettings();
  if (els.qqToolPermissionMeta) {
    const roots = String(bot.fileShareRoots || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    els.qqToolPermissionMeta.textContent = `公共工具权限：${formatQqToolPermissionSummary(bot)}。共享目录：${roots.length ? roots.join("、") : "data/personas"}。默认建议仅开放读取，危险操作按对象单独开启。`;
  }
  if (els.qqProfileToolPermissionMeta) {
    const profileTools = getQqProfileToolSettings();
    const roots = String(els.qqProfileFileShareRoots?.value || els.qqFileShareRoots?.value || "data/personas").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    els.qqProfileToolPermissionMeta.textContent = `当前对象工具权限：${formatQqToolPermissionSummary(profileTools)}。共享目录：${roots.length ? roots.join("、") : "data/personas"}。保存对象配置后，QQ 回复会按这组权限决定是否允许写文件、执行命令、运行技能或发送文件。`;
  }
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
    const allowSkillExecution = getActiveSkills().length > 0;
    return TOOLS.filter((tool) => {
      const name = tool.function.name;
      if (READ_ONLY_TOOL_NAMES.has(name)) return true;
      if (WRITE_TOOL_NAMES.has(name)) return allowWrite;
      if (QQ_TOOL_NAMES.has(name)) return allowQqPush;
      if (SKILL_DISCOVERY_TOOL_NAMES.has(name)) return allowSkillDiscovery;
      if (SKILL_INSTALL_TOOL_NAMES.has(name)) return allowSkillInstall;
      if (SKILL_EXECUTION_TOOL_NAMES.has(name)) return allowSkillExecution;
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

const ACTIVE_SKILL_SUMMARY_MAX_CHARS = 320;
const ACTIVE_SKILL_DETAIL_MAX_CHARS = 1600;

function clampText(text, limit = ACTIVE_SKILL_SUMMARY_MAX_CHARS) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  return normalized.length > limit ? `${normalized.slice(0, limit).trim()}…` : normalized;
}

function skillSummaryText(skill, limit = ACTIVE_SKILL_SUMMARY_MAX_CHARS) {
  if (!skill) return "";
  const summary = String(skill.summary || "").trim();
  if (summary) return clampText(summary, limit);
  const content = String(skill.content || skill.files?.[0]?.content || "").trim();
  if (!content) return "";
  const firstParagraph = content
    .split(/\n\s*\n/)
    .map((part) => String(part || "").trim())
    .find(Boolean) || content;
  return clampText(firstParagraph, limit);
}

function toApiMessage(message) {
  if (!message || typeof message !== "object") return message;
  const apiMessage = { role: message.role };
  if (Object.prototype.hasOwnProperty.call(message, "content")) apiMessage.content = message.content;
  if (Object.prototype.hasOwnProperty.call(message, "tool_calls")) apiMessage.tool_calls = message.tool_calls;
  if (Object.prototype.hasOwnProperty.call(message, "tool_call_id")) apiMessage.tool_call_id = message.tool_call_id;
  if (Object.prototype.hasOwnProperty.call(message, "name")) apiMessage.name = message.name;
  return apiMessage;
}

function toApiMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => toApiMessage(message));
}

function estimateContentChars(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((sum, item) => {
      if (typeof item === "string") return sum + item.length;
      if (!item || typeof item !== "object") return sum;
      if (typeof item.text === "string") return sum + item.text.length;
      if (item.type === "image_url") return sum + 120;
      return sum + JSON.stringify(item).length;
    }, 0);
  }
  if (!content || typeof content !== "object") return 0;
  return JSON.stringify(content).length;
}

function estimateSystemMessageChars() {
  return toApiMessages(systemMessages()).reduce((sum, message) => sum + estimateContentChars(message?.content), 0);
}

function estimateConversationHistoryChars() {
  return state.messages.reduce((sum, message) => sum + estimateContentChars(message?.content), 0);
}

function estimateAttachedFileChars() {
  return state.files.reduce((sum, file) => sum + (file.isImage ? 120 : String(file.content || "").length), 0);
}

function estimateDraftChars() {
  return els.userInput?.value.length || 0;
}

function estimateCurrentPromptTokens() {
  const chars = estimateSystemMessageChars() + estimateConversationHistoryChars() + estimateAttachedFileChars() + estimateDraftChars();
  return {
    chars,
    estimatedTokens: Math.ceil(chars / 4),
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
  const contextLimits = {
    ...(old.modelContextLimits && typeof old.modelContextLimits === "object" ? old.modelContextLimits : {}),
  };
  if (selectedModel() && els.contextLimit) {
    contextLimits[selectedModel()] = els.contextLimit.value.trim() || "32768";
  }
  const configGroupState = Object.fromEntries(
    Array.from(document.querySelectorAll(".config-group[data-config-group], .sub-config-fold[data-config-group]")).map((group) => [
      group.dataset.configGroup,
      group.open,
    ])
  );
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...old,
    baseUrl: els.baseUrl?.value.trim() || "", apiPath: els.apiPath?.value.trim() || "/api/v1/chat/completions", model: selectedModel(), modelHistory: history,
    assistantName: els.assistantName?.value.trim() || "繁星", userName: els.userName?.value.trim() || "文远", systemPrompt: els.systemPrompt?.value.trim() || "",
    personaPrompt: els.personaPrompt?.value.trim() || "", personaPreset: els.personaPreset?.value || "none", contextLimit: els.contextLimit?.value.trim() || "32768", modelContextLimits: contextLimits,
    qqPushEnabled: Boolean(els.qqPushEnabled?.checked),
    qqBridgeUrl: els.qqBridgeUrl?.value.trim() || "",
    qqAccessToken: els.qqAccessToken?.value.trim() || "",
    qqTargetType: els.qqTargetType?.value || DEFAULT_QQ_PUSH_TARGET_TYPE,
    qqTargetId: els.qqTargetId?.value.trim() || DEFAULT_QQ_PUSH_TARGET_ID,
    qqBotEnabled: Boolean(els.qqBotEnabled?.checked),
    qqBotGroupMentionOnly: Boolean(els.qqBotGroupMentionOnly?.checked),
    qqTaskPushEnabled: Boolean(els.qqTaskPushEnabled?.checked),
    qqBotModel: els.qqBotModelSelect?.value || "",
    qqBotTriggerPrefix: els.qqBotTriggerPrefix?.value.trim() || "",
    qqBotAllowedUsers: els.qqBotAllowedUsers?.value || "",
    qqBotAllowedGroups: els.qqBotAllowedGroups?.value || "",
    qqBotPersona: els.qqBotPersona?.value || "",
    qqBotPersonaPreset: els.qqBotPersonaPreset?.value || "none",
    qqFileShareRoots: els.qqFileShareRoots?.value || "",
    qqToolReadEnabled: Boolean(els.qqToolsReadEnabled?.checked ?? true),
    qqToolWriteEnabled: Boolean(els.qqToolsWriteEnabled?.checked),
    qqToolCommandEnabled: Boolean(els.qqToolsCommandEnabled?.checked),
    qqToolSkillEnabled: Boolean(els.qqToolsSkillEnabled?.checked),
    qqToolFileSendEnabled: Boolean(els.qqToolsFileSendEnabled?.checked),
    assistantAvatar: old.assistantAvatar || "",
    userAvatar: old.userAvatar || "",
    configGroupState,
    skillsCache: state.skills.map((skill) => cloneSkillForStorage(skill)).filter(Boolean),
    selectedSkill: cloneSkillForStorage(state.selectedSkill),
    activeSkill: cloneSkillForStorage(state.activeSkill),
    ...getResizableTextareaState(),
  }));
  renderModelMeta(); refreshMetrics(); renderAllAvatarPreviews(); renderQqPushMeta();
}
function load() {
  const s = saved();
  if (els.baseUrl) els.baseUrl.value = s.baseUrl || "";
  if (els.apiPath) els.apiPath.value = s.apiPath || "/api/v1/chat/completions";
  if (els.assistantName) els.assistantName.value = s.assistantName || "繁星";
  if (els.userName) els.userName.value = s.userName || "文远";
  if (els.systemPrompt) els.systemPrompt.value = s.systemPrompt || "";
  if (els.personaPrompt) els.personaPrompt.value = s.personaPrompt || "";
  if (els.contextLimit) els.contextLimit.value = getContextLimitForModel(s.model || "");
  if (els.qqPushEnabled) els.qqPushEnabled.checked = Boolean(s.qqPushEnabled);
  if (els.qqBridgeUrl) els.qqBridgeUrl.value = s.qqBridgeUrl || "";
  if (els.qqAccessToken) els.qqAccessToken.value = s.qqAccessToken || "";
  if (els.qqTargetType) els.qqTargetType.value = s.qqTargetType || DEFAULT_QQ_PUSH_TARGET_TYPE;
  if (els.qqTargetId) els.qqTargetId.value = s.qqTargetId || DEFAULT_QQ_PUSH_TARGET_ID;
  if (els.qqBotEnabled) els.qqBotEnabled.checked = Boolean(s.qqBotEnabled);
  if (els.qqBotGroupMentionOnly) els.qqBotGroupMentionOnly.checked = s.qqBotGroupMentionOnly !== false;
  if (els.qqTaskPushEnabled) els.qqTaskPushEnabled.checked = Boolean(s.qqTaskPushEnabled);
  if (els.qqBotModelSelect) els.qqBotModelSelect.value = s.qqBotModel || "";
  if (els.qqBotTriggerPrefix) els.qqBotTriggerPrefix.value = s.qqBotTriggerPrefix || "";
  if (els.qqBotAllowedUsers) els.qqBotAllowedUsers.value = s.qqBotAllowedUsers || "";
  if (els.qqBotAllowedGroups) els.qqBotAllowedGroups.value = s.qqBotAllowedGroups || "";
  if (els.qqBotPersona) els.qqBotPersona.value = s.qqBotPersona || "";
  if (els.qqBotPersonaPreset) els.qqBotPersonaPreset.value = s.qqBotPersonaPreset || "none";
  if (els.qqToolsReadEnabled) els.qqToolsReadEnabled.checked = s.qqToolReadEnabled !== false;
  if (els.qqToolsWriteEnabled) els.qqToolsWriteEnabled.checked = Boolean(s.qqToolWriteEnabled);
  if (els.qqToolsCommandEnabled) els.qqToolsCommandEnabled.checked = Boolean(s.qqToolCommandEnabled);
  if (els.qqToolsSkillEnabled) els.qqToolsSkillEnabled.checked = Boolean(s.qqToolSkillEnabled);
  if (els.qqToolsFileSendEnabled) els.qqToolsFileSendEnabled.checked = Boolean(s.qqToolFileSendEnabled);
  if (els.personaPreset) els.personaPreset.value = s.personaPreset || "none";
  if (els.modelSelect && s.model) { const o = document.createElement("option"); o.value = s.model; o.textContent = s.model; els.modelSelect.replaceChildren(o); els.modelSelect.value = s.model; }
  applyContextLimitForModel(s.model || "");
  state.skills = Array.isArray(s.skillsCache) ? s.skillsCache.filter(Boolean) : [];
  state.selectedSkill = cloneSkillForStorage(s.selectedSkill);
  state.activeSkill = cloneSkillForStorage(s.activeSkill);
  if (!state.selectedSkill && state.activeSkill) state.selectedSkill = cloneSkillForStorage(state.activeSkill);
  applyConfigGroupState(s.configGroupState || {});
  applyResizableTextareaState(s);
  renderSkills();
  renderSkillPreview();
  renderAllAvatarPreviews();
  renderQqPushMeta();
}

function applyConfigGroupState(configGroupState = {}) {
  document.querySelectorAll(".config-group[data-config-group], .sub-config-fold[data-config-group]").forEach((group) => {
    const key = group.dataset.configGroup;
    if (Object.prototype.hasOwnProperty.call(configGroupState, key)) {
      group.open = Boolean(configGroupState[key]);
    }
  });
}
function renderConversationMiniheadMeta() {
  if (!els.conversationMiniheadText) return;
  const modelText = selectedModel() || "未选择模型";
  const personaContent = String(els.personaPrompt?.value || "").trim();
  const personaPresetId = els.personaPreset?.value || "none";
  const personaPresetName = personaPresetId !== "none"
    ? String(els.personaPreset?.selectedOptions?.[0]?.textContent || "").trim()
    : "";
  const personaText = personaPresetName || (personaContent ? "自定义人设" : "无人设");
  const activeSkills = getActiveSkills();
  const shownSkills = activeSkills.slice(0, 5);
  const skillMarkup = shownSkills.length
    ? shownSkills.map((skill) => {
      const summary = String(skill.summary || "").trim();
      const content = String(skill.content || "").trim();
      const tooltip = summary || content || skill.name;
      return `<span class="minihead-meta-value is-hoverable" title="${esc(tooltip)}">${esc(skill.name)}</span>`;
    }).join("、")
    : '<span class="minihead-meta-value">无技能</span>';
  const overflowText = activeSkills.length > 5
    ? `<span class="minihead-meta-overflow"> 等 ${activeSkills.length} 个</span>`
    : "";
  const personaMarkup = `<span class="minihead-meta-value${personaContent ? " is-hoverable" : ""}"${personaContent ? ` title="${esc(personaContent)}"` : ""}>${esc(personaText)}</span>`;
  els.conversationMiniheadText.innerHTML = [
    `<span class="minihead-meta-item"><span class="minihead-meta-label">模型</span><span class="minihead-meta-value">${esc(modelText)}</span></span>`,
    `<span class="minihead-meta-separator">·</span>`,
    `<span class="minihead-meta-item"><span class="minihead-meta-label">人设</span>${personaMarkup}</span>`,
    `<span class="minihead-meta-separator">·</span>`,
    `<span class="minihead-meta-item"><span class="minihead-meta-label">技能</span>${skillMarkup}${overflowText}</span>`,
  ].join("");
}

function renderModelMeta() {
  if (!els.modelSelectionMeta) return;
  els.modelSelectionMeta.textContent = selectedModel() ? `当前模型：${selectedModel()}` : "当前未选择模型";
  renderConversationMiniheadMeta();
}
function refreshMetrics(usage = null, elapsedMs = null) {
  const { chars, estimatedTokens: est } = estimateCurrentPromptTokens();
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
  return formatBeijingDateTime(timestamp, {
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

function scrollChatToBottom(behavior = "smooth") {
  if (!els.chatMessages) return;
  if (behavior === "auto") {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    return;
  }
  requestAnimationFrame(() => els.chatMessages?.scrollTo({ top: els.chatMessages.scrollHeight, behavior }));
}

function appendMessageImages(bubble, images = []) {
  if (!bubble || !images.length) return;
  const wrap = document.createElement("div");
  wrap.className = "file-list compact image-strip";
  images.forEach((img, i) => {
    const item = document.createElement("div");
    item.className = "file-item";
    const el = document.createElement("img");
    el.className = "file-thumb";
    el.src = img.dataUrl;
    el.alt = img.name;
    el.addEventListener("dblclick", () => openLightbox(images, i));
    item.append(el);
    wrap.append(item);
  });
  bubble.append(wrap);
}

function appendMessageHtmlPreview(bubble, content) {
  if (!bubble) return;
  const html = htmlPreview(content);
  if (!html) return;
  const row = document.createElement("div");
  row.className = "button-row left";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button";
  button.textContent = "预览 HTML";
  button.onclick = () => openPreview(html);
  row.append(button);
  bubble.append(row);
}

function buildMessageCard(role, cls = role, images = [], timestamp = Date.now()) {
  const card = document.createElement("article");
  card.className = `message ${cls}`;
  const avatar = messageAvatarMarkup(role);
  const stack = document.createElement("div");
  stack.className = "message-stack";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  const head = document.createElement("div");
  head.className = "message-head";
  const r = document.createElement("div");
  r.className = "message-role";
  r.textContent = roleName(role);
  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = new Date(timestamp).toISOString();
  time.textContent = formatMessageTimestamp(timestamp);
  const contentEl = document.createElement("div");
  contentEl.className = "message-content";
  head.append(r, time);
  bubble.append(contentEl);
  appendMessageImages(bubble, images);
  stack.append(head, bubble);
  card.append(avatar, stack);
  els.chatMessages?.append(card);
  scrollChatToBottom("smooth");
  return { card, bubble, contentEl };
}

function getAssistantTypingCharactersPerStep() {
  const speedLabel = String(els.metricSpeed?.dataset.value || "").trim();
  const tokensPerSecond = Number.parseFloat(speedLabel);
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return 2;
  }
  const charactersPerSecond = Math.min(Math.max(tokensPerSecond * 2.2, 12), 72);
  return Math.max(1, Math.round(charactersPerSecond / 24));
}

function getAssistantTypingFrameDelay() {
  const speedLabel = String(els.metricSpeed?.dataset.value || "").trim();
  const tokensPerSecond = Number.parseFloat(speedLabel);
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return 42;
  }
  return Math.min(Math.max(Math.round(1000 / Math.max(tokensPerSecond * 1.2, 10)), 22), 56);
}

function finalizeAssistantMessageContent(contentEl, bubble, content = "") {
  if (!contentEl || !bubble) return;
  contentEl.classList.remove("is-typing");
  contentEl.innerHTML = rich(content);
  enhanceMessageCodeBlocks(contentEl);
  appendMessageHtmlPreview(bubble, content);
}

async function appendAssistantMessageWithTyping(content, cls = "assistant", images = [], timestamp = Date.now()) {
  const { card, bubble, contentEl } = buildMessageCard("assistant", cls, images, timestamp);
  const fullText = String(content || "");
  if (!fullText) {
    finalizeAssistantMessageContent(contentEl, bubble, fullText);
    return card;
  }

  contentEl.classList.add("is-typing");
  let index = 0;
  const step = getAssistantTypingCharactersPerStep();
  const delay = getAssistantTypingFrameDelay();
  const minDurationMs = Math.min(Math.max(fullText.length * 18, 420), 2400);
  const startedAt = Date.now();

  await new Promise((resolve) => {
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const progress = minDurationMs > 0 ? Math.min(elapsed / minDurationMs, 1) : 1;
      const targetIndex = Math.max(index + step, Math.ceil(fullText.length * progress));
      index = Math.min(fullText.length, targetIndex);
      contentEl.textContent = fullText.slice(0, index);
      scrollChatToBottom("auto");
      if (index >= fullText.length && elapsed >= minDurationMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, delay);
    };
    tick();
  });

  finalizeAssistantMessageContent(contentEl, bubble, fullText);
  scrollChatToBottom("smooth");
  return card;
}

function appendMessage(role, content, cls = role, images = [], timestamp = Date.now()) {
  if (role === "system") {
    setStatus(content, cls === "error" ? "error" : cls === "success" ? "success" : "default");
    return null;
  }
  if (role === "system" && cls === "error" && isDesktopAutomationRestrictionMessage(content)) {
    content = String(content || "")
      .split(/\n\s*\n/)
      .find((part) => isDesktopAutomationRestrictionMessage(part)) || String(content || "");
  }
  const { card, bubble, contentEl } = buildMessageCard(role, cls, images, timestamp);
  contentEl.innerHTML = rich(content);
  enhanceMessageCodeBlocks(contentEl);
  appendMessageHtmlPreview(bubble, content);
  return card;
}

function renderScheduledTaskChatCardContent(contentEl, renderMeta = {}, fallbackContent = "") {
  if (!contentEl) return;

  const title = String(renderMeta?.title || "").trim();
  const subtitle = String(renderMeta?.subtitle || "").trim();
  const footer = String(renderMeta?.footer || "").trim();
  const chips = Array.isArray(renderMeta?.chips) ? renderMeta.chips : [];
  const previewItems = Array.isArray(renderMeta?.previewItems) ? renderMeta.previewItems : [];
  const tone = String(renderMeta?.tone || "").trim();

  if (!title && !subtitle && !chips.length && !previewItems.length && !footer) {
    contentEl.innerHTML = rich(fallbackContent);
    enhanceMessageCodeBlocks(contentEl);
    return;
  }

  contentEl.replaceChildren();

  const card = document.createElement("div");
  card.className = `scheduled-task-chat-card${tone ? ` ${tone}` : ""}`;

  const titleEl = document.createElement("div");
  titleEl.className = "scheduled-task-chat-title";
  titleEl.textContent = title || "定时任务已处理";
  card.append(titleEl);

  if (subtitle) {
    const subtitleEl = document.createElement("div");
    subtitleEl.className = "scheduled-task-chat-subtitle";
    subtitleEl.textContent = subtitle;
    card.append(subtitleEl);
  }

  if (chips.length) {
    const chipsWrap = document.createElement("div");
    chipsWrap.className = "scheduled-task-chat-chips";
    chips.forEach((chip) => {
      const label = String(chip?.label || "").trim();
      const value = String(chip?.value || "").trim();
      if (!label || !value) return;
      const chipEl = document.createElement("div");
      chipEl.className = `scheduled-task-chat-chip${chip?.accent ? ` ${chip.accent}` : ""}`;

      const chipLabel = document.createElement("span");
      chipLabel.className = "scheduled-task-chat-chip-label";
      chipLabel.textContent = label;

      const chipValue = document.createElement("span");
      chipValue.className = "scheduled-task-chat-chip-value";
      chipValue.textContent = value;

      chipEl.append(chipLabel, chipValue);
      chipsWrap.append(chipEl);
    });
    if (chipsWrap.childElementCount) {
      card.append(chipsWrap);
    }
  }

  if (previewItems.length) {
    const list = document.createElement("div");
    list.className = "scheduled-task-chat-list";
    previewItems.forEach((item) => {
      const itemTitle = String(item?.title || "").trim();
      if (!itemTitle) return;

      const itemEl = document.createElement("div");
      itemEl.className = "scheduled-task-chat-item";

      const itemHead = document.createElement("div");
      itemHead.className = "scheduled-task-chat-item-head";

      const itemIndex = document.createElement("span");
      itemIndex.className = "scheduled-task-chat-item-index";
      itemIndex.textContent = String(item?.indexLabel || "任务");

      const itemTitleEl = document.createElement("strong");
      itemTitleEl.className = "scheduled-task-chat-item-title";
      itemTitleEl.textContent = itemTitle;

      itemHead.append(itemIndex, itemTitleEl);
      itemEl.append(itemHead);

      const itemMetaText = String(item?.meta || "").trim();
      if (itemMetaText) {
        const itemMeta = document.createElement("div");
        itemMeta.className = "scheduled-task-chat-item-meta";
        itemMeta.textContent = itemMetaText;
        itemEl.append(itemMeta);
      }

      list.append(itemEl);
    });
    if (list.childElementCount) {
      card.append(list);
    }
  }

  if (footer) {
    const footerEl = document.createElement("div");
    footerEl.className = "scheduled-task-chat-footer";
    footerEl.textContent = footer;
    card.append(footerEl);
  }

  contentEl.append(card);
}

function appendScheduledTaskChatMessage(message = {}) {
  const timestamp = message.timestamp || Date.now();
  const content = typeof message.content === "string"
    ? message.content
    : normalizeContent(message.content) || JSON.stringify(message.content ?? "");
  const { card, contentEl } = buildMessageCard("assistant", "assistant scheduled-task-chat", [], timestamp);
  renderScheduledTaskChatCardContent(contentEl, message.renderMeta || {}, content);
  return card;
}

function appendPendingMessage() {
  const card = document.createElement("article");
  card.className = "message assistant pending";
  const avatar = messageAvatarMarkup("assistant");
  const stack = document.createElement("div");
  stack.className = "message-stack";
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
  bubble.append(content);
  stack.append(head, bubble);
  card.append(avatar, stack);
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
    const timeText = updatedAt && !Number.isNaN(updatedAt.getTime())
      ? formatBeijingDateTime(updatedAt, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";
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

function formatToolResultForChat(name, payload, status = "success") {
  const safeName = String(name || "unknown");
  const title = status === "error" ? "工具执行失败" : "工具执行结果";
  const lines = [`### ${title}`, `工具：\`${safeName}\``];

  if (payload && typeof payload === "object") {
    if (payload.cancelled) {
      lines.push("", "结果：本次工具调用已取消。");
      return lines.join("\n");
    }
    if (payload.ignored && payload.message) {
      lines.push("", String(payload.message));
      return lines.join("\n");
    }
    if (payload.error && typeof payload.error === "string" && status === "error") {
      lines.push("", payload.error);
    }
  }

  let serialized = "";
  if (typeof payload === "string") {
    serialized = payload.trim();
  } else if (payload != null) {
    try {
      serialized = JSON.stringify(payload, null, 2);
    } catch {
      serialized = String(payload);
    }
  }

  if (serialized) {
    const limited = serialized.length > 3200 ? `${serialized.slice(0, 3200).trim()}\n...` : serialized;
    const looksLikeJson = limited.startsWith("{") || limited.startsWith("[");
    lines.push("", looksLikeJson ? `\`\`\`json\n${limited}\n\`\`\`` : limited);
  }

  return lines.join("\n");
}

function appendToolResultToChat(name, payload, status = "success") {
  const message = formatToolResultForChat(name, payload, status);
  return appendMessage("assistant", message, status === "error" ? "error" : "success");
}

formatToolResultForChat = function formatToolResultForChatCompact(name, payload, status = "success") {
  const safeName = String(name || "unknown");
  const title = status === "error" ? "工具失败" : "工具结果";
  const lines = [`### ${title}`, `\`${safeName}\``];

  if (payload && typeof payload === "object") {
    if (payload.cancelled) {
      lines.push("", "本次工具调用已取消。");
      return lines.join("\n");
    }
    if (payload.ignored && payload.message) {
      lines.push("", String(payload.message));
      return lines.join("\n");
    }
    if (payload.error && typeof payload.error === "string" && status === "error") {
      lines.push("", payload.error);
    }
  }

  if (typeof payload === "string") {
    const text = payload.trim();
    if (text) {
      lines.push("", text.length > 320 ? `${text.slice(0, 320).trim()}...` : text);
    }
    return lines.join("\n");
  }

  if (Array.isArray(payload)) {
    lines.push("", `返回 ${payload.length} 项结果。`);
    return lines.join("\n");
  }

  if (payload && typeof payload === "object") {
    const preferredKeys = [
      "message",
      "path",
      "installedTo",
      "name",
      "skillName",
      "targetId",
      "targetType",
      "bytesWritten",
      "deleted",
      "exitCode",
      "stdout",
      "stderr",
      "content",
      "entries",
    ];
    const summaryLines = [];
    preferredKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(payload, key)) return;
      const value = payload[key];
      if (value == null || value === "") return;
      if (Array.isArray(value)) {
        summaryLines.push(`${key}: ${value.length} 项`);
        return;
      }
      if (typeof value === "object") {
        summaryLines.push(`${key}: 已返回`);
        return;
      }
      const text = String(value).trim();
      if (!text) return;
      summaryLines.push(`${key}: ${text.length > 140 ? `${text.slice(0, 140).trim()}...` : text}`);
    });

    if (summaryLines.length) {
      lines.push("", ...summaryLines.slice(0, 5));
      const remainingKeys = Object.keys(payload).filter((key) => !preferredKeys.includes(key));
      if (remainingKeys.length) {
        lines.push(`其余字段: ${remainingKeys.slice(0, 5).join("、")}${remainingKeys.length > 5 ? " 等" : ""}`);
      }
      return lines.join("\n");
    }
  }

  return lines.join("\n");
};

function setToolActivityModal(open) {
  if (!els.toolActivityModal) return;
  els.toolActivityModal.classList.toggle("is-hidden", !open);
  els.toolActivityModal.setAttribute("aria-hidden", open ? "false" : "true");
  els.toolActivityTrigger?.setAttribute("aria-expanded", open ? "true" : "false");
  syncOverlayModalState();
}

function isDesktopAutomationRestrictionMessage(message = "") {
  const text = String(message || "");
  return /受限运行身份|本机正常桌面用户会话|codexsandbox|scripts\/skill-runner\.ps1/i.test(text);
}

function setSettingsModal(open) {
  if (!els.settingsModal) return;
  els.settingsModal.classList.toggle("is-hidden", !open);
  els.settingsModal.setAttribute("aria-hidden", open ? "false" : "true");
  els.settingsTrigger?.setAttribute("aria-expanded", open ? "true" : "false");
  syncOverlayModalState();
}

function syncOverlayModalState() {
  const anyOpen = !els.toolActivityModal?.classList.contains("is-hidden") || !els.settingsModal?.classList.contains("is-hidden");
  document.body.classList.toggle("activity-modal-open", Boolean(anyOpen));
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
function selectedWorkspacePersonaPreset() {
  const presetId = els.personaPreset?.value || "none";
  const preset = allPersonaPresets().find((item) => item.id === presetId);
  return preset?.source === "workspace" ? preset : null;
}
function syncPersonaPresetActions() {
  if (!els.deletePersonaPreset) return;
  els.deletePersonaPreset.disabled = !selectedWorkspacePersonaPreset();
}
function renderPersonaPresetDescription() {
  if (els.personaPresetDescription) els.personaPresetDescription.textContent = presetById(els.personaPreset?.value || "none").description;
  syncPersonaPresetActions();
}
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
function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 32768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
function pathExt(name = "") {
  const normalized = String(name || "").trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}
function isZipFileName(name = "") {
  return pathExt(name) === ".zip";
}
function isZipUrlCandidate(value = "") {
  try {
    const target = new URL(String(value || "").trim());
    const fileName = decodeURIComponent(target.pathname.split("/").pop() || "");
    const extension = fileName.includes(".") ? pathExt(fileName) : "";
    return !extension || extension === ".zip";
  } catch {
    return false;
  }
}
async function uploadSkillZipFile(file) {
  if (!file) return;
  if (!isZipFileName(file.name)) {
    setStatus("技能上传仅支持 ZIP 格式");
    return;
  }
  const suggestedName = String(file.name || "").replace(/\.zip$/i, "").trim();
  const targetNameInput = window.prompt("请输入安装后的技能名称（可留空自动识别）：", suggestedName);
  if (targetNameInput == null) return;
  const targetName = String(targetNameInput || "").trim();
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const data = await j("/skills/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentBase64, targetName }),
  });
  await loadSkills();
  setStatus(`已上传技能：${data.result.name}`);
}
async function downloadSkillZipFromLink() {
  const input = window.prompt("请输入技能 ZIP 下载链接：", "");
  if (input == null) return;
  const url = String(input || "").trim();
  if (!url) {
    setStatus("请输入技能下载链接");
    return;
  }
  if (!isZipUrlCandidate(url)) {
    setStatus("技能下载仅支持 ZIP 格式链接");
    return;
  }
  let suggestedName = "";
  try {
    const parsed = new URL(url);
    const lastSegment = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    suggestedName = isZipFileName(lastSegment) ? lastSegment.replace(/\.zip$/i, "") : "";
  } catch {}
  const targetNameInput = window.prompt("请输入安装后的技能名称（可留空自动识别）：", suggestedName);
  if (targetNameInput == null) return;
  const targetName = String(targetNameInput || "").trim();
  const data = await j("/skills/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, targetName }),
  });
  await loadSkills();
  setStatus(`已下载技能：${data.result.name}`);
}
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
  if (!SUPPORTED_TOOL_NAMES.has(name)) {
    const activeSkillName = String(state.activeSkill?.name || "").trim().toLowerCase();
    const normalizedName = String(name || "").trim().toLowerCase();
    const reason = activeSkillName && normalizedName === activeSkillName
      ? `技能「${state.activeSkill.name}」是执行说明，不是工具名。请改用受支持的工具完成任务，或直接输出结果。`
      : `工具「${name}」当前不存在。只能调用系统已提供的真实工具。`;
    toolActivity(id, "done", name, "未支持的工具调用已拦截");
    return {
      role: "tool",
      tool_call_id: id,
      content: JSON.stringify({
        ignored: true,
        reason: "unsupported-tool-name",
        message: reason,
      }),
    };
  }
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
  applyContextLimitForModel(selectedModel());
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

function resetChat() { state.messages = []; els.chatMessages.replaceChildren(); refreshMetrics(); setStatus("已清空"); }

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

const initialSubmitHandler = submit;

function bind() {
  els.chatForm?.addEventListener("submit", initialSubmitHandler);
  els.userInput?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); els.chatForm?.requestSubmit(); } });
  els.userInput?.addEventListener("input", () => refreshMetrics());
  els.settingsTrigger?.addEventListener("click", () => setSettingsModal(true));
  els.novelStudioTrigger?.addEventListener("click", () => {
    window.location.href = "/novels.html";
  });
  els.settingsClose?.addEventListener("click", () => setSettingsModal(false));
  els.settingsBackdrop?.addEventListener("click", () => setSettingsModal(false));
  els.toolActivityTrigger?.addEventListener("click", () => setToolActivityModal(true));
  els.toolActivityClose?.addEventListener("click", () => setToolActivityModal(false));
  els.toolActivityBackdrop?.addEventListener("click", () => setToolActivityModal(false));
  document.querySelectorAll(".config-group[data-config-group]").forEach((group) => {
    group.addEventListener("toggle", () => save());
  });
  document.querySelectorAll(".sub-config-fold[data-config-group]").forEach((group) => {
    group.addEventListener("toggle", () => save());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.settingsModal?.classList.contains("is-hidden")) {
      setSettingsModal(false);
    } else if (e.key === "Escape" && !els.toolActivityModal?.classList.contains("is-hidden")) {
      setToolActivityModal(false);
    }
  });
  [els.baseUrl, els.apiPath, els.assistantName, els.userName, els.systemPrompt].forEach((el) => el?.addEventListener("change", () => { save(); setStatus(`已保存配置，当前接口：${chatEndpoint()}`); }));
  els.contextLimit?.addEventListener("change", () => {
    persistContextLimitForSelectedModel();
    save();
    refreshMetrics();
    setStatus(`已保存模型上下文上限：${selectedModel() || "未选择模型"}`);
  });
  els.modelSelect?.addEventListener("focus", () => {
    persistContextLimitForSelectedModel();
  });
  els.modelSelect?.addEventListener("change", () => {
    applyContextLimitForModel(selectedModel());
    save();
    refreshMetrics();
    setStatus(`已切换模型：${selectedModel() || "未选择模型"}`);
  });
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
  els.loadSkills?.addEventListener("click", () => { spark(els.loadSkills); loadSkills(); });
  els.uploadSkillZip?.addEventListener("click", () => { spark(els.uploadSkillZip); els.skillZipInput?.click(); });
  els.skillZipInput?.addEventListener("change", async (event) => {
    try {
      const [file] = Array.from(event.target.files || []);
      if (file) {
        await uploadSkillZipFile(file);
      }
    } catch (error) {
      appendMessage("system", `上传技能失败：${error.message}`, "error");
      setStatus("上传技能失败");
    } finally {
      event.target.value = "";
    }
  });
  els.downloadSkillZip?.addEventListener("click", async () => {
    spark(els.downloadSkillZip);
    try {
      await downloadSkillZipFromLink();
    } catch (error) {
      appendMessage("system", `下载技能失败：${error.message}`, "error");
      setStatus("下载技能失败");
    }
  });
  els.applySkill?.addEventListener("click", () => { spark(els.applySkill); applySelectedSkill(); });
  els.closePreview?.addEventListener("click", () => { spark(els.closePreview); closePreview(); }); els.togglePreviewSize?.addEventListener("click", () => { spark(els.togglePreviewSize); setPreviewMax(!state.previewMaximized); });
  document.addEventListener("paste", async (e) => { if (e.clipboardData?.files?.length) await consumeFiles(e.clipboardData.files); });
  ["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  document.addEventListener("drop", async (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) await consumeFiles(e.dataTransfer.files); });
  $("#lightbox-close")?.addEventListener("click", closeLightbox); $("#lightbox-prev")?.addEventListener("click", () => navLightbox(-1)); $("#lightbox-next")?.addEventListener("click", () => navLightbox(1)); $("#image-lightbox")?.addEventListener("click", (e) => { if (e.target?.id === "image-lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (!$("#image-lightbox")?.classList.contains("is-hidden")) { if (e.key === "Escape") closeLightbox(); if (e.key === "ArrowLeft") navLightbox(-1); if (e.key === "ArrowRight") navLightbox(1); } else if (e.key === "Escape" && state.previewMaximized) setPreviewMax(false); });
}

async function init() {
  renderPersonaPresets(); load(); renderPersonaPresetDescription(); renderModelMeta(); loadToolActivity(); initPreviewResizer(); closePreview(); setToolActivityModal(false); setSettingsModal(false); bind(); renderFiles(); resetChat(); refreshMetrics(); setStatus("就绪");
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

function collectHistoryMessageText(content, parts = []) {
  if (content == null) return parts;
  if (typeof content === "string" || typeof content === "number" || typeof content === "boolean") {
    parts.push(String(content));
    return parts;
  }
  if (Array.isArray(content)) {
    content.forEach((item) => collectHistoryMessageText(item, parts));
    return parts;
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") {
      parts.push(content.text);
    }
    if (typeof content.content === "string") {
      parts.push(content.content);
    } else if (content.content != null) {
      collectHistoryMessageText(content.content, parts);
    }
    if (typeof content.output_text === "string") {
      parts.push(content.output_text);
    }
    if (typeof content.input_text === "string") {
      parts.push(content.input_text);
    }
    if (content.type === "text" && typeof content.value === "string") {
      parts.push(content.value);
    }
  }
  return parts;
}

function sanitizeHistoryMessage(message) {
  if (!message || typeof message !== "object") return null;
  const normalizedRole = typeof message.role === "string" ? message.role : "assistant";
  const rawContent = Object.prototype.hasOwnProperty.call(message, "content") ? message.content : "";
  const normalizedContent = typeof rawContent === "string"
    ? rawContent
    : collectHistoryMessageText(rawContent, []).join("\n").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    ...message,
    role: normalizedRole,
    content: normalizedContent || "",
    timestamp: Number(message.timestamp || 0) || Date.now(),
  };
}

function sanitizeChatHistoryRecord(record) {
  if (!record || typeof record !== "object") return null;
  const messages = Array.isArray(record.messages)
    ? record.messages.map((message) => sanitizeHistoryMessage(message)).filter(Boolean)
    : [];
  return {
    ...record,
    id: String(record.id || nowId()),
    title: typeof record.title === "string" ? record.title : "未命名会话",
    createdAt: Number(record.createdAt || 0) || Date.now(),
    updatedAt: Number(record.updatedAt || 0) || Date.now(),
    messages,
  };
}

function readChatHistoryRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]");
    if (!Array.isArray(records)) return [];
    const sanitized = records.map((record) => sanitizeChatHistoryRecord(record)).filter(Boolean);
    if (JSON.stringify(records) !== JSON.stringify(sanitized)) {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sanitized));
    }
    return sanitized;
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

function appendStoredConversationMessage(message = {}) {
  if (message?.role === "assistant" && message?.renderType === "scheduled-task-reply") {
    appendScheduledTaskChatMessage(message);
    return;
  }

  const restoredContent = typeof message?.content === "string"
    ? message.content
    : normalizeContent(message?.content) || JSON.stringify(message?.content ?? "");
  appendMessage(
    message?.role || "assistant",
    restoredContent,
    message?.role || "assistant",
    [],
    message?.timestamp || Date.now()
  );
}

function renderConversationFromMessages(messages) {
  chatHistoryRuntime.suppressAutoSave = true;
  state.messages = Array.isArray(messages) ? JSON.parse(JSON.stringify(messages)) : [];
  els.chatMessages?.replaceChildren();

  if (!state.messages.length) {
    els.chatMessages?.replaceChildren();
  } else {
    state.messages.forEach((message) => {
      appendStoredConversationMessage(message);
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
    qqTargetType: els.qqTargetType?.value || DEFAULT_QQ_PUSH_TARGET_TYPE,
    qqTargetId: els.qqTargetId?.value?.trim() || DEFAULT_QQ_PUSH_TARGET_ID,
    qqBotEnabled: Boolean(els.qqBotEnabled?.checked),
    qqBotGroupMentionOnly: Boolean(els.qqBotGroupMentionOnly?.checked),
    qqTaskPushEnabled: Boolean(els.qqTaskPushEnabled?.checked),
    qqBotModel: els.qqBotModelSelect?.value || "",
    qqBotTriggerPrefix: els.qqBotTriggerPrefix?.value?.trim() || "",
    qqBotAllowedUsers: els.qqBotAllowedUsers?.value || "",
    qqBotAllowedGroups: els.qqBotAllowedGroups?.value || "",
    qqBotPersona: els.qqBotPersona?.value || "",
    qqBotPersonaPreset: els.qqBotPersonaPreset?.value || "none",
    qqToolReadEnabled: Boolean(els.qqToolsReadEnabled?.checked ?? true),
    qqToolWriteEnabled: Boolean(els.qqToolsWriteEnabled?.checked),
    qqToolCommandEnabled: Boolean(els.qqToolsCommandEnabled?.checked),
    qqToolSkillEnabled: Boolean(els.qqToolsSkillEnabled?.checked),
    qqToolFileSendEnabled: Boolean(els.qqToolsFileSendEnabled?.checked),
  };
}

function restoreQqSettingsSnapshot(snapshot = {}) {
  if (els.qqPushEnabled) els.qqPushEnabled.checked = Boolean(snapshot.qqPushEnabled);
  if (els.qqBridgeUrl) els.qqBridgeUrl.value = snapshot.qqBridgeUrl || "";
  if (els.qqAccessToken) els.qqAccessToken.value = snapshot.qqAccessToken || "";
  if (els.qqTargetType) els.qqTargetType.value = snapshot.qqTargetType || DEFAULT_QQ_PUSH_TARGET_TYPE;
  if (els.qqTargetId) els.qqTargetId.value = snapshot.qqTargetId || DEFAULT_QQ_PUSH_TARGET_ID;
  if (els.qqBotEnabled) els.qqBotEnabled.checked = Boolean(snapshot.qqBotEnabled);
  if (els.qqBotGroupMentionOnly) els.qqBotGroupMentionOnly.checked = snapshot.qqBotGroupMentionOnly !== false;
  if (els.qqTaskPushEnabled) els.qqTaskPushEnabled.checked = Boolean(snapshot.qqTaskPushEnabled);
  if (els.qqBotModelSelect) els.qqBotModelSelect.value = snapshot.qqBotModel || "";
  if (els.qqBotTriggerPrefix) els.qqBotTriggerPrefix.value = snapshot.qqBotTriggerPrefix || "";
  if (els.qqBotAllowedUsers) els.qqBotAllowedUsers.value = snapshot.qqBotAllowedUsers || "";
  if (els.qqBotAllowedGroups) els.qqBotAllowedGroups.value = snapshot.qqBotAllowedGroups || "";
  if (els.qqBotPersona) els.qqBotPersona.value = snapshot.qqBotPersona || "";
  if (els.qqBotPersonaPreset) els.qqBotPersonaPreset.value = snapshot.qqBotPersonaPreset || "none";
  if (els.qqFileShareRoots) els.qqFileShareRoots.value = snapshot.qqFileShareRoots || "data/personas";
  if (els.qqToolsReadEnabled) els.qqToolsReadEnabled.checked = snapshot.qqToolReadEnabled !== false;
  if (els.qqToolsWriteEnabled) els.qqToolsWriteEnabled.checked = Boolean(snapshot.qqToolWriteEnabled);
  if (els.qqToolsCommandEnabled) els.qqToolsCommandEnabled.checked = Boolean(snapshot.qqToolCommandEnabled);
  if (els.qqToolsSkillEnabled) els.qqToolsSkillEnabled.checked = Boolean(snapshot.qqToolSkillEnabled);
  if (els.qqToolsFileSendEnabled) els.qqToolsFileSendEnabled.checked = Boolean(snapshot.qqToolFileSendEnabled);
  if (els.qqToolsReadEnabled) els.qqToolsReadEnabled.checked = snapshot.qqToolReadEnabled !== false;
  if (els.qqToolsWriteEnabled) els.qqToolsWriteEnabled.checked = Boolean(snapshot.qqToolWriteEnabled);
  if (els.qqToolsCommandEnabled) els.qqToolsCommandEnabled.checked = Boolean(snapshot.qqToolCommandEnabled);
  if (els.qqToolsSkillEnabled) els.qqToolsSkillEnabled.checked = Boolean(snapshot.qqToolSkillEnabled);
  if (els.qqToolsFileSendEnabled) els.qqToolsFileSendEnabled.checked = Boolean(snapshot.qqToolFileSendEnabled);
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
    qqToolReadEnabled: Boolean(els.qqToolsReadEnabled?.checked ?? true),
    qqToolWriteEnabled: Boolean(els.qqToolsWriteEnabled?.checked),
    qqToolCommandEnabled: Boolean(els.qqToolsCommandEnabled?.checked),
    qqToolSkillEnabled: Boolean(els.qqToolsSkillEnabled?.checked),
    qqToolFileSendEnabled: Boolean(els.qqToolsFileSendEnabled?.checked),
  }));
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqToolPermissionMeta();
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
  if (els.qqToolsReadEnabled) els.qqToolsReadEnabled.checked = current.qqToolReadEnabled !== false;
  if (els.qqToolsWriteEnabled) els.qqToolsWriteEnabled.checked = Boolean(current.qqToolWriteEnabled);
  if (els.qqToolsCommandEnabled) els.qqToolsCommandEnabled.checked = Boolean(current.qqToolCommandEnabled);
  if (els.qqToolsSkillEnabled) els.qqToolsSkillEnabled.checked = Boolean(current.qqToolSkillEnabled);
  if (els.qqToolsFileSendEnabled) els.qqToolsFileSendEnabled.checked = Boolean(current.qqToolFileSendEnabled);
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqToolPermissionMeta();
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
  const webhookEndpoint = `${location.origin}/qq/webhook`;
  if (els.qqWebhookEndpoint) {
    els.qqWebhookEndpoint.value = webhookEndpoint;
  }
  els.copyQqWebhookEndpoint?.addEventListener("click", async () => {
    spark(els.copyQqWebhookEndpoint);
    try {
      await copyCodeText(webhookEndpoint);
      if (els.copyQqWebhookEndpoint) {
        const originalText = els.copyQqWebhookEndpoint.textContent;
        els.copyQqWebhookEndpoint.textContent = "已复制";
        window.setTimeout(() => {
          if (els.copyQqWebhookEndpoint) {
            els.copyQqWebhookEndpoint.textContent = originalText || "复制";
          }
        }, 1200);
      }
      setStatus("已复制 QQ webhook 地址", "success");
    } catch (error) {
      setStatus(`复制 QQ webhook 地址失败：${error.message}`, "error");
    }
  });

  [els.qqPushEnabled, els.qqBridgeUrl, els.qqAccessToken, els.qqTargetType, els.qqTargetId, els.qqBotEnabled, els.qqBotGroupMentionOnly, els.qqTaskPushEnabled, els.qqBotModelSelect, els.qqBotTriggerPrefix, els.qqBotAllowedUsers, els.qqBotAllowedGroups, els.qqBotPersona, els.qqFileShareRoots, els.qqToolsReadEnabled, els.qqToolsWriteEnabled, els.qqToolsCommandEnabled, els.qqToolsSkillEnabled, els.qqToolsFileSendEnabled, els.qqProfileToolsReadEnabled, els.qqProfileToolsWriteEnabled, els.qqProfileToolsCommandEnabled, els.qqProfileToolsSkillEnabled, els.qqProfileToolsFileSendEnabled, els.qqProfileFileShareRoots].forEach((el) => {
    el?.addEventListener("change", () => {
      save();
      renderQqPushMeta();
      renderQqBotMeta();
      renderQqToolPermissionMeta();
      syncQqBotConfig().catch(() => {});
    });
    el?.addEventListener("input", () => {
      renderQqPushMeta();
      renderQqBotMeta();
      renderQqToolPermissionMeta();
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
            message: `本地 AI QQ 推送测试成功。时间：${formatBeijingDateTime(Date.now())}`,
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
  renderQqToolPermissionMeta();
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
  const list = systemMessagesBeforeQqRule().filter((message) => !String(message?.content || "").includes("当前已配置 QQ 推送通道"));
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
  const estimatedCurrentContext = estimateCurrentPromptTokens().estimatedTokens;

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
  const fallbackEstimate = estimateCurrentPromptTokens().estimatedTokens;

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

state.settingBundle = null;

const saveBeforeSettingBundleRemoval = save;
save = function saveWithoutSettingBundle() {
  saveBeforeSettingBundleRemoval();
  const current = saved();
  if (current && Object.prototype.hasOwnProperty.call(current, "settingBundle")) {
    const { settingBundle, ...rest } = current;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  }
};

const loadBeforeSettingBundleRemoval = load;
load = function loadWithoutSettingBundle() {
  loadBeforeSettingBundleRemoval();
  state.settingBundle = null;
};

systemMessages = function systemMessagesWithoutSettingBundle() {
  return systemMessagesBeforeSettingBundle();
};

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
      content: `你当前启用了技能：${state.activeSkill.name}
技能来源：${state.activeSkill.source}
技能只是执行说明，不是可调用工具名。不要把“${state.activeSkill.name}”当作 tool name 发起调用。
你只能调用当前系统已提供的真实工具；如果技能要求的是流程执行，请依据 SKILL.md 理解步骤，然后使用受支持的工具完成，或直接输出执行结果。

SKILL.md:
${state.activeSkill.content}`,
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

function seemsNaturalScheduledTaskCreateText(text = "") {
  const source = String(text || "").trim();
  if (!source) return false;
  return /(创建|新建|添加|设定|设置|建立|安排|schedule|create)/i.test(source)
    && /(定时任务|定时|每天|每周|cron|schedule)/i.test(source);
}

async function tryCreateScheduledTaskFromNaturalText(text = "") {
  if (!selectedModel() || !seemsNaturalScheduledTaskCreateText(text)) {
    return null;
  }

  try {
    const data = await schedulerRequest("/scheduler/intent/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: String(text || "").trim(),
        model: selectedModel(),
      }),
    });
    return data?.task ? data : null;
  } catch (error) {
    if (error.status === 400) {
      return null;
    }
    throw error;
  }
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
    return tasks;
  } catch (error) {
    if (error.status === 404) {
      if (meta) meta.textContent = "当前服务暂未启用定时任务接口，重启 node server.js 后可用。";
      if (list) list.innerHTML = '<div class="file-empty">当前运行中的服务版本还不支持定时任务，请重启服务。</div>';
      return [];
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
      ? formatBeijingDateTime(updatedAt, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";
    el.innerHTML = `<div class="tool-activity-head"><strong class="tool-activity-title">${esc(x.name)}</strong><span class="tool-activity-badge">${x.status === "running" ? "执行中" : "已完成"}</span></div><div class="tool-activity-text">${esc(x.text)}</div>${timeText ? `<div class="tool-activity-time">${esc(timeText)}</div>` : ""}`;
    return el;
  }));
};

state.lastRequestedUserText = "";

function inferCronExpressionFromText(text = "") {
  const source = String(text || "").trim();
  if (!source) return "";

  const explicitCron = source.match(/\b(\*|[0-5]?\d)\s+(\*|[01]?\d|2[0-3])\s+(\*|[1-9]|[12]\d|3[01])\s+(\*|[1-9]|1[0-2])\s+(\*|[0-6])\b/);
  if (explicitCron) return explicitCron[0].trim();

  const weekdayMap = { "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6 };

  const dailyMatch = source.match(/每(?:天|日)[^0-9]{0,8}(\d{1,2})\s*点(?:\s*(\d{1,2})\s*分?)?/);
  if (dailyMatch) {
    const hour = Number(dailyMatch[1]);
    const minute = Number(dailyMatch[2] || 0);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return `${minute} ${hour} * * *`;
    }
  }

  const weeklyMatch = source.match(/每(?:周|星期)([一二三四五六日天])[^0-9]{0,8}(\d{1,2})\s*点(?:\s*(\d{1,2})\s*分?)?/);
  if (weeklyMatch) {
    const weekday = weekdayMap[weeklyMatch[1]];
    const hour = Number(weeklyMatch[2]);
    const minute = Number(weeklyMatch[3] || 0);
    if (Number.isInteger(weekday) && Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return `${minute} ${hour} * * ${weekday}`;
    }
  }

  return "";
}

function hasCreateScheduledTaskIntent(text = "") {
  const normalized = String(text || "").toLowerCase();
  const createHints = ["创建", "新建", "添加", "设一个", "设定一个", "schedule", "create"];
  return hasExplicitSchedulerIntent(text) && createHints.some((hint) => normalized.includes(hint));
}

function inferScheduledTaskArgsFromText(text = "") {
  const source = String(text || "").trim();
  if (!hasCreateScheduledTaskIntent(source)) return null;

  const cronExpression = inferCronExpressionFromText(source);
  if (!cronExpression) return null;

  let prompt = "";
  const actionMatch =
    source.match(/(?:用于|内容是|任务是|执行|去|来)(.+?)(?:的)?定时任务/i) ||
    source.match(/创建(?:一个)?(.+?)(?:的)?定时任务/i);
  if (actionMatch) {
    prompt = String(actionMatch[1] || "").trim();
  }

  if (!prompt) {
    if (/启动\s*lxj/i.test(source)) {
      prompt = "启动 lxj";
    } else {
      prompt = source.replace(/创建(?:一个)?/g, "").replace(/定时任务/g, "").trim();
    }
  }

  let name = "";
  const nameFromAction = prompt.replace(/[，。,.]/g, "").trim();
  if (/启动\s*lxj/i.test(source) || /启动\s*lxj/i.test(prompt)) {
    name = "lxj 每日启动";
  } else if (nameFromAction) {
    name = nameFromAction.length > 24 ? `${nameFromAction.slice(0, 24)}...` : nameFromAction;
  } else {
    name = "定时任务";
  }

  return {
    name,
    prompt,
    scheduleType: "cron",
    cronExpression,
    enabled: true,
  };
}

executeTool = async function executeToolWithExplicitLocalSave(toolCall) {
  const id = toolCall?.id || nowId();
  const name = toolCall?.function?.name || "unknown";
  let args = {};

  try {
    args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }

  if (name === "create_scheduled_task" || name === "update_scheduled_task") {
    delete args.model;
  }

  const latestUserText = state.lastRequestedUserText || "";
  if ((name === "create_scheduled_task" || name === "update_scheduled_task") && !String(args.cronExpression || "").trim()) {
    const inferredCronExpression = inferCronExpressionFromText(latestUserText);
    if (inferredCronExpression) {
      args.scheduleType = "cron";
      args.cronExpression = inferredCronExpression;
    }
  }
  if (WRITE_TOOL_NAMES.has(name) && !canUseWriteTools(latestUserText)) {
    throw new Error("当前请求没有明确授权保存到本地，已阻止文件写入或删除。若需要保存，请明确说明“保存到本地”或“写入文件”。");
  }

  if (name === "delete_file" && args.path && !window.confirm(`AI 请求删除文件：${args.path}\n\n是否允许继续？`)) {
    return { role: "tool", tool_call_id: id, content: JSON.stringify({ cancelled: true }) };
  }

  toolActivity(id, "running", name, "正在执行...");
  let data;
  try {
    data = await j("/tools/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: args }),
    });
  } catch (error) {
    const detail = String(error?.message || "工具执行失败");
    toolActivity(id, "done", name, `执行失败：${detail}`);
    throw new Error(`工具 ${name} 执行失败：${detail}`);
  }
  if (name === "install_clawhub_skill") {
    await loadSkills();
  }
  toolActivity(id, "done", name, "执行完成");
  return { role: "tool", tool_call_id: id, content: JSON.stringify(data.result, null, 2) };
};

askModel = async function askModelWithExplicitSaveGuard(userText) {
  if (!selectedModel()) throw new Error("请先选择模型。");

  state.lastRequestedUserText = userText || "";
  const directScheduledTaskArgs = inferScheduledTaskArgsFromText(userText);
  if (directScheduledTaskArgs) {
    const toolResult = await executeTool({
      id: nowId(),
      function: {
        name: "create_scheduled_task",
        arguments: JSON.stringify(directScheduledTaskArgs),
      },
    });
    const summary =
      summarizeToolOnlyReply(toolResult)
      || `已经帮你创建好定时任务了：${directScheduledTaskArgs.name}。\n执行时间使用 Cron 表达式：${directScheduledTaskArgs.cronExpression}`;
    const messageTimestamp = Date.now();
    state.messages.push(
      { role: "user", content: userText || "请继续处理", timestamp: messageTimestamp },
      { role: "assistant", content: summary, timestamp: Date.now() }
    );
    save();
    refreshMetrics();
    return summary;
  }
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
        messages: toApiMessages(messages),
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

const submitBeforeTypingEffect = submit;
els.chatForm?.removeEventListener("submit", initialSubmitHandler);
els.chatForm?.removeEventListener("submit", submitBeforeTypingEffect, true);
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
    const latestMessage = Array.isArray(state.messages) && state.messages.length
      ? state.messages[state.messages.length - 1]
      : null;
    if (latestMessage?.role === "assistant" && latestMessage?.renderType === "scheduled-task-reply") {
      appendStoredConversationMessage(latestMessage);
    } else {
      await appendAssistantMessageWithTyping(reply);
    }
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
  const stack = document.createElement("div");
  stack.className = "message-stack";
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
  bubble.append(content);
  stack.append(head, bubble);
  card.append(avatar, stack);
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

function summarizeToolOnlyReply(toolMessage) {
  if (!toolMessage) return "";
  if (Array.isArray(toolMessage)) {
    return buildToolOnlyFallbackReply(toolMessage);
  }
  if (toolMessage?.role === "tool" && typeof toolMessage.content === "string") {
    return buildToolOnlyFallbackReply([toolMessage]);
  }
  return "";
}

function clampLeanWebSearchSystemText(value = "", maxLength = 480) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildLeanWebSearchSystemMessages() {
  const list = [];
  const baseSystemPrompt = clampLeanWebSearchSystemText(els.systemPrompt?.value || "", 320);
  const personaPrompt = clampLeanWebSearchSystemText(els.personaPrompt?.value || "", 480);
  if (baseSystemPrompt) {
    list.push({ role: "system", content: baseSystemPrompt });
  }
  if (personaPrompt) {
    list.push({
      role: "system",
      content: `保持以下回答风格，但优先简洁、准确、基于最新信息：\n${personaPrompt}`,
    });
  }
  list.push(getCurrentTimeCalibrationSystemMessage());
  list.push({
    role: "system",
    content: "This is a live web search task. Focus on current facts, call web_search when needed, and answer concisely in Chinese without mentioning internal tools.",
  });
  return list;
}

const askModelBeforeToolOnlyFallback = askModel;
askModel = async function askModelWithToolOnlyFallback(userText) {
  if (!selectedModel()) throw new Error("请先选择模型。");

  state.lastRequestedUserText = userText || "";
  const directScheduledTaskArgs = inferScheduledTaskArgsFromText(userText);
  if (directScheduledTaskArgs) {
    const toolResult = await executeTool({
      id: nowId(),
      function: {
        name: "create_scheduled_task",
        arguments: JSON.stringify(directScheduledTaskArgs),
      },
    });
    const summary =
      summarizeToolOnlyReply(toolResult)
      || `已经帮你创建好定时任务了：${directScheduledTaskArgs.name}。\n执行时间使用 Cron 表达式：${directScheduledTaskArgs.cronExpression}`;
    const messageTimestamp = Date.now();
    state.messages.push(
      { role: "user", content: userText || "请继续处理", timestamp: messageTimestamp },
      { role: "assistant", content: summary, timestamp: Date.now() }
    );
    save();
    refreshMetrics();
    return summary;
  }
  const allowedTools = getAllowedToolsForUserText(userText);
  const directWebSearchReply = await maybeRunDirectWebSearchInApp(userText, allowedTools);
  if (directWebSearchReply) {
    const messageTimestamp = Date.now();
    state.messages.push(
      { role: "user", content: userText || "请继续处理", timestamp: messageTimestamp },
      { role: "assistant", content: directWebSearchReply, timestamp: Date.now() }
    );
    save();
    refreshMetrics();
    return directWebSearchReply;
  }
  const leanWebSearchMode = shouldUseLeanWebSearchMode(userText, allowedTools);
  const baseHistory = leanWebSearchMode ? trimConversationForLeanWebSearch(state.messages) : state.messages;
  const leanWebSearchTools = leanWebSearchMode
    ? allowedTools.filter((tool) => tool?.function?.name === "web_search")
    : allowedTools;
  const toolRounds = leanWebSearchMode ? 2 : MAX_TOOL_ROUNDS;
  const baseSystemMessages = leanWebSearchMode ? buildLeanWebSearchSystemMessages() : systemMessages();
  let messages = [...baseSystemMessages, ...baseHistory, { role: "user", content: userPayload(userText) }];
  let final = "";

  for (let i = 0; i < toolRounds; i++) {
    const requestTools = leanWebSearchMode
      ? (i === 0 ? leanWebSearchTools : [])
      : allowedTools;
    const t0 = performance.now();
    const data = await j(chatEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel(),
        messages,
        temperature: leanWebSearchMode ? 0.2 : 0.7,
        tools: requestTools,
        tool_choice: requestTools.length ? (leanWebSearchMode && i === 0 ? "required" : "auto") : "none",
        stream: false,
      }),
    });

    refreshMetrics(data.usage || null, performance.now() - t0);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("接口返回成功，但没有找到 assistant message。");

    const content = normalizeContent(msg.content);
    if (content) final = content;
    messages.push({ role: "assistant", content: msg.content || content, tool_calls: msg.tool_calls });

    if (leanWebSearchMode && i === 0 && !msg.tool_calls?.length) {
      throw new Error("联网查询没有调用 web_search 工具，已中止这次请求。");
    }
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
  decorateConversationTurnDeleteButtons();
  renderConversationTurnUndo();
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

const askModelBeforeServerScheduledTaskCreate = askModel;
askModel = async function askModelWithServerScheduledTaskCreate(userText) {
  if (!selectedModel()) throw new Error("请先选择模型。");

  state.lastRequestedUserText = userText || "";
  const directScheduledTaskResult = await tryCreateScheduledTaskFromNaturalText(userText);
  if (directScheduledTaskResult?.task) {
    const summary =
      String(directScheduledTaskResult.message || "").trim()
      || `已经帮你创建好定时任务了：${directScheduledTaskResult.task.name}。\n执行时间使用 Cron 表达式：${directScheduledTaskResult.task.cronExpression}`;
    const messageTimestamp = Date.now();
    state.messages.push(
      { role: "user", content: userText || "请继续处理", timestamp: messageTimestamp },
      { role: "assistant", content: summary, timestamp: Date.now() }
    );
    save();
    refreshMetrics();
    autoSaveCurrentChat();
    return summary;
  }

  return askModelBeforeServerScheduledTaskCreate(userText);
};

function renderConversationFromMessagesStable(messages) {
  chatHistoryRuntime.suppressAutoSave = true;
  state.messages = Array.isArray(messages) ? JSON.parse(JSON.stringify(messages)) : [];
  els.chatMessages?.replaceChildren();

  if (!state.messages.length) {
    els.chatMessages?.replaceChildren();
  } else {
    state.messages.forEach((message) => {
      appendStoredConversationMessage(message);
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

const initiallyRestoredChatId = chatHistoryRuntime.currentId || localStorage.getItem(CURRENT_CHAT_KEY);
if (initiallyRestoredChatId) {
  const initiallyRestoredChat = readChatHistoryRecords().find((item) => item.id === initiallyRestoredChatId);
  if (initiallyRestoredChat) {
    renderConversationFromMessagesStable(initiallyRestoredChat.messages || []);
    renderChatHistoryList();
    updateChatHistoryMeta();
    updateCurrentChatTitle();
    refreshMetrics();
  }
}

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

async function savePersonaPresetToWorkspace() {
  const prompt = String(els.personaPrompt?.value || "").trim();
  if (!prompt) {
    setStatus("请先填写人设内容");
    return;
  }

  const suggestedName = String(els.personaPreset?.selectedOptions?.[0]?.textContent || "")
    .trim()
    .replace(/^不使用预设$/, "") || "新建人设";
  const inputName = window.prompt("请输入模板名称：", suggestedName);
  if (inputName == null) return;

  const name = inputName.trim();
  if (!name) {
    setStatus("模板名称不能为空");
    return;
  }

  await j("/personas/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, prompt }),
  });

  await loadWorkspacePersonaPresets();
  const workspaceId = `workspace:${name.replace(/\\/g, "/")}.md`;
  const fallbackPreset = allPersonaPresets().find((preset) => preset.name === name && preset.source === "workspace");
  if (els.personaPreset) {
    els.personaPreset.value = fallbackPreset?.id || workspaceId || els.personaPreset.value;
  }
  rememberedPersonaPresetId = els.personaPreset?.value || rememberedPersonaPresetId;
  renderPersonaPresetDescription();
  save();
  setStatus(`已保存人设模板：${name}`);
}

async function deleteSelectedPersonaPresetFromWorkspace() {
  const preset = selectedWorkspacePersonaPreset();
  if (!preset) {
    setStatus("当前选择的不是本地人设模板");
    return;
  }

  const confirmed = window.confirm(`确认删除本地人设模板“${preset.name}”吗？`);
  if (!confirmed) return;

  await j("/personas/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: preset.id, path: preset.path }),
  });

  rememberedPersonaPresetId = "none";
  await loadWorkspacePersonaPresets();
  if (els.personaPreset) {
    els.personaPreset.value = "none";
  }
  renderPersonaPresetDescription();
  save();
  setStatus(`已删除人设模板：${preset.name}`);
}

function normalizeActiveSkills(skills) {
  const list = Array.isArray(skills) ? skills : [];
  const normalized = [];
  list.forEach((skill) => {
    const cloned = cloneSkillForStorage(skill);
    if (!cloned || !cloned.name) return;
    if (normalized.some((item) => sameSkill(item, cloned))) return;
    normalized.push(cloned);
  });
  return normalized;
}

function getActiveSkills() {
  return normalizeActiveSkills(state.activeSkills || (state.activeSkill ? [state.activeSkill] : []));
}

function isSkillActive(skill) {
  return getActiveSkills().some((item) => sameSkill(item, skill));
}

function syncActiveSkillAlias() {
  state.activeSkills = normalizeActiveSkills(state.activeSkills || (state.activeSkill ? [state.activeSkill] : []));
  state.activeSkill = state.activeSkills[0] || null;
}

function buildActiveSkillsSummaryLines() {
  const activeSkills = getActiveSkills();
  if (!activeSkills.length) {
    return ["当前未启用技能。"];
  }
  const names = activeSkills.map((skill) => skill.name);
  const summary = names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")} 等 ${names.length} 个技能`;
  return [
    `已启用技能：${summary}`,
    ...activeSkills.map((skill, index) => `${index + 1}. ${skill.name} · ${skill.source}`),
  ];
}

function getDetailedSkillContextTarget(activeSkills = getActiveSkills()) {
  const selectedSkill = reduceSkillToSkillMdOnly(state.selectedSkill);
  if (selectedSkill && activeSkills.some((skill) => sameSkill(skill, selectedSkill))) {
    return selectedSkill;
  }
  return activeSkills.length === 1 ? activeSkills[0] : null;
}

function buildSkillContextMessage(activeSkills = getActiveSkills()) {
  if (!activeSkills.length) return null;
  const detailSkill = getDetailedSkillContextTarget(activeSkills);
  const summaryLines = activeSkills.map((skill, index) => {
    const normalized = reduceSkillToSkillMdOnly(skill) || skill;
    const summary = skillSummaryText(normalized) || "璇锋牴鎹妧鑳藉悕绉板拰宸ュ叿鑳藉姏鍒ゆ柇鏄惁閫傜敤銆?";
    return [
      `鎶€鑳?${index + 1}锛?{normalized.name}`,
      `鏉ユ簮锛?{normalized.source}`,
      `鎽樿锛?{summary}`,
    ].join("\n");
  }).join("\n\n");
  const detailBlock = detailSkill?.content
    ? `\n\n褰撳墠閲嶇偣鎶€鑳斤細${detailSkill.name}\n璇︾粏璇存槑锛堣妭閫夛級锛歕n${clampText(detailSkill.content, ACTIVE_SKILL_DETAIL_MAX_CHARS)}`
    : "";

  return {
    role: "system",
    _localTag: "skill_context",
    content: `褰撳墠宸插惎鐢?${activeSkills.length} 涓妧鑳姐€傛妧鑳藉彧鏄墽琛岃鏄庯紝涓嶆槸鍙皟鐢ㄧ殑 tool name銆備笉瑕佹妸鎶€鑳藉悕褰撲綔宸ュ叿鍚嶈皟鐢ㄣ€?` +
      `\n浼樺厛鏍规嵁涓嬮潰鐨勬妧鑳芥憳瑕佸垽鏂摢涓妧鑳介€傜敤锛涘彧鏈夊綋鍓嶉噸鐐规妧鑳芥墠浼氶檮甯﹁緝璇︾粏鐨勬墽琛岃鏄庛€俓n\n${summaryLines}${detailBlock}`,
  };
}

function isLegacySingleSkillContextMessage(message) {
  if (message?.role !== "system") return false;
  return String(message?.content || "").trim().startsWith("浣犲綋鍓嶅惎鐢ㄤ簡鎶€鑳斤細");
}

function isManagedSkillContextMessage(message) {
  const content = String(message?.content || "");
  const isLegacyMultiSkillContext = content.includes("tool name") && content.includes("SKILL.md:");
  return message?._localTag === "skill_context" || isLegacySingleSkillContextMessage(message) || isLegacyMultiSkillContext;
}

state.activeSkills = normalizeActiveSkills(saved().activeSkills || (state.activeSkill ? [state.activeSkill] : []));
syncActiveSkillAlias();

const saveBeforeMultiSkillState = save;
save = function saveWithMultiSkillState() {
  saveBeforeMultiSkillState();
  syncActiveSkillAlias();
  const current = saved();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    activeSkills: state.activeSkills,
    activeSkill: state.activeSkill,
  }));
};

const loadBeforeMultiSkillState = load;
load = function loadWithMultiSkillState() {
  loadBeforeMultiSkillState();
  const current = saved();
  state.activeSkills = normalizeActiveSkills(current.activeSkills || (current.activeSkill ? [current.activeSkill] : []));
  syncActiveSkillAlias();
};

renderSkillPreview = function renderSkillPreviewWithMultiSkill(skill = state.selectedSkill) {
  if (!els.skillPreview) return;
  renderConversationMiniheadMeta();
  const normalized = reduceSkillToSkillMdOnly(skill);
  const summaryLines = buildActiveSkillsSummaryLines();
  if (!normalized?.content) {
    els.skillPreview.textContent = [...summaryLines, "", "选择一个技能后，这里会显示该技能的 SKILL.md 摘要。"].join("\n");
    return;
  }
  els.skillPreview.textContent = [...summaryLines, "", `当前查看：${normalized.name}`, `来源：${normalized.source}`, "", "# SKILL.md", "", normalized.content].join("\n");
};

renderSkills = function renderSkillsWithMultiSkill() {
  if (!els.skillsList) return;
  syncActiveSkillAlias();
  const activeSkills = getActiveSkills();
  if (!state.skills.length) {
    els.skillsList.innerHTML = '<div class="file-empty">当前还没有读取到技能列表。</div>';
    if (els.disableSkill) els.disableSkill.disabled = !activeSkills.length;
    return;
  }
  els.skillsList.replaceChildren(...state.skills.map((skill) => {
    const item = document.createElement("div");
    item.className = `skill-item${sameSkill(skill, state.selectedSkill) ? " is-selected" : ""}${isSkillActive(skill) ? " is-active" : ""}`;
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
    if (isSkillActive(skill)) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "mini-status-tag active";
      activeBadge.textContent = `已启用 ${activeSkills.findIndex((item) => sameSkill(item, skill)) + 1}`;
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
      enableButton.textContent = isSkillActive(skill) ? "查看摘要" : "加入启用";
      enableButton.onclick = async () => {
        spark(enableButton);
        if (!sameSkill(skill, state.selectedSkill)) {
          await readSkill(skill);
        }
        if (isSkillActive(skill)) {
          renderSkillPreview(skill);
          return;
        }
        applySelectedSkill();
      };
      actions.append(enableButton);
      if (isSkillActive(skill)) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "ghost-button mini-action-button";
        removeButton.textContent = "移除启用";
        removeButton.onclick = () => {
          spark(removeButton);
          disableActiveSkill(skill);
        };
        actions.append(removeButton);
      }
    }
    item.append(head, actions);
    return item;
  }));
  if (els.disableSkill) {
    els.disableSkill.disabled = !activeSkills.length;
  }
};

applySelectedSkill = function applySelectedSkillWithMultiSkill() {
  if (!state.selectedSkill) {
    setStatus("请先读取一个技能");
    return;
  }
  const normalized = reduceSkillToSkillMdOnly(state.selectedSkill);
  const activeSkills = getActiveSkills();
  if (!activeSkills.some((skill) => sameSkill(skill, normalized))) {
    activeSkills.push(normalized);
  }
  state.activeSkills = normalizeActiveSkills(activeSkills);
  syncActiveSkillAlias();
  renderSkills();
  renderSkillPreview(normalized);
  save();
  appendMessage("system", `已加入技能：${normalized.name}\n${buildActiveSkillsSummaryLines()[0]}`, "success");
  refreshMetrics();
  setStatus(`已启用 ${state.activeSkills.length} 个技能`);
};

disableActiveSkill = function disableActiveSkillWithMultiSkill(targetSkill = null) {
  const activeSkills = getActiveSkills();
  if (!activeSkills.length) {
    setStatus("当前没有启用中的技能");
    return;
  }
  const skillToRemove = targetSkill || state.selectedSkill || activeSkills[activeSkills.length - 1];
  state.activeSkills = activeSkills.filter((skill) => !sameSkill(skill, skillToRemove));
  syncActiveSkillAlias();
  renderSkills();
  renderSkillPreview(state.selectedSkill);
  save();
  refreshMetrics();
  setStatus(`已移除技能：${skillToRemove.name}`);
};

const systemMessagesBeforeMultiSkill = systemMessages;
systemMessages = function systemMessagesWithMultiSkill() {
  const list = systemMessagesBeforeMultiSkill().filter((message) => !String(message?.content || "").includes("你当前启用了技能：") && !String(message?.content || "").includes("当前已启用"));
  const activeSkills = getActiveSkills();
  if (activeSkills.length) {
    list.push({
      role: "system",
      content: `当前已启用 ${activeSkills.length} 个技能。\n技能只是执行说明，不是可调用工具名。不要把技能名当作 tool name 发起调用。你只能调用系统已提供的真实工具；如果技能要求的是流程执行，请依据各自的 SKILL.md 理解步骤，然后使用受支持的工具完成，或直接输出结果。\n\n${activeSkills.map((skill, index) => {
        const normalized = reduceSkillToSkillMdOnly(skill);
        return `技能 ${index + 1}：${normalized.name}\n来源：${normalized.source}\nSKILL.md:\n${normalized.content}`;
      }).join("\n\n---\n\n")}`,
    });
  }
  return list;
};

const systemMessagesBeforeManagedMultiSkillContext = systemMessages;
systemMessages = function systemMessagesWithManagedMultiSkillContext() {
  const list = systemMessagesBeforeManagedMultiSkillContext().filter((message) => !isManagedSkillContextMessage(message));
  const activeSkills = getActiveSkills();
  const skillContextMessage = buildSkillContextMessage(activeSkills);
  if (skillContextMessage) {
    list.push(skillContextMessage);
  }
  return list;
};

function clearSkillSelectionState() {
  state.selectedSkill = null;
  state.activeSkill = null;
  state.activeSkills = [];
  renderSkillPreview(null);
  renderSkills();
  save();
  refreshMetrics();
  setStatus("已清空技能状态");
}

els.savePersonaPreset?.addEventListener("click", async () => {
  spark(els.savePersonaPreset);
  try {
    await savePersonaPresetToWorkspace();
  } catch (error) {
    appendMessage("system", `保存人设模板失败：${error.message}`, "error");
    setStatus("保存人设模板失败");
  }
});

els.deletePersonaPreset?.addEventListener("click", async () => {
  spark(els.deletePersonaPreset);
  try {
    await deleteSelectedPersonaPresetFromWorkspace();
  } catch (error) {
    const message = String(error?.message || "");
    if (/not found/i.test(message)) {
      appendMessage("system", "当前运行中的服务还没有加载人设模板删除接口，请重启 `node server.js` 后再试。", "error");
      setStatus("删除接口未生效，请重启服务");
      return;
    }
    appendMessage("system", `删除人设模板失败：${error.message}`, "error");
    setStatus("删除人设模板失败");
  }
});

els.clearSkillSelection?.addEventListener("click", () => {
  spark(els.clearSkillSelection);
  clearSkillSelectionState();
});

const executeToolBeforeUnsupportedNameFinalGuard = executeTool;
executeTool = async function executeToolWithUnsupportedNameFinalGuard(toolCall) {
  const id = toolCall?.id || nowId();
  const name = toolCall?.function?.name || "unknown";
  if (!SUPPORTED_TOOL_NAMES.has(name)) {
    const activeSkillNames = getActiveSkills().map((skill) => skill.name).filter(Boolean);
    const activeSkillHint = activeSkillNames.length ? `当前已启用技能：${activeSkillNames.join("、")}。` : "";
    toolActivity(id, "done", name, "未支持的工具调用已拦截");
    return {
      role: "tool",
      tool_call_id: id,
      content: JSON.stringify({
        ignored: true,
        reason: "unsupported-tool-name",
        message: `${activeSkillHint}工具「${name}」当前不存在。只能调用系统已提供的真实工具，例如 run_workspace_skill、run_shell_command、run_cli_command，而不能调用未实现的工具名。`,
      }),
    };
  }
  return executeToolBeforeUnsupportedNameFinalGuard(toolCall);
};

renderChatHistoryList();

const qqTargetProfileRuntime = {
  profiles: {},
  baseConfig: {},
};

const inlinePromptRuntime = {
  resolve: null,
  mode: "prompt",
};

function closeInlinePrompt(result = null) {
  if (els.inlinePromptModal) {
    els.inlinePromptModal.classList.add("is-hidden");
    els.inlinePromptModal.setAttribute("aria-hidden", "true");
  }
  const resolver = inlinePromptRuntime.resolve;
  inlinePromptRuntime.resolve = null;
  inlinePromptRuntime.mode = "prompt";
  if (resolver) resolver(result);
}

function openInlinePrompt({ title = "重命名", description = "请输入内容", value = "", placeholder = "请输入内容", confirmText = "确定" } = {}) {
  return new Promise((resolve) => {
    inlinePromptRuntime.resolve = resolve;
    if (els.inlinePromptTitle) els.inlinePromptTitle.textContent = title;
    if (els.inlinePromptDescription) els.inlinePromptDescription.textContent = description;
    if (els.inlinePromptInput) {
      els.inlinePromptInput.value = value;
      els.inlinePromptInput.placeholder = placeholder;
    }
    if (els.inlinePromptConfirm) els.inlinePromptConfirm.textContent = confirmText;
    if (els.inlinePromptModal) {
      els.inlinePromptModal.classList.remove("is-hidden");
      els.inlinePromptModal.setAttribute("aria-hidden", "false");
    }
    requestAnimationFrame(() => {
      els.inlinePromptInput?.focus();
      els.inlinePromptInput?.select();
    });
  });
}

els.inlinePromptBackdrop?.addEventListener("click", () => closeInlinePrompt(null));
els.inlinePromptCancel?.addEventListener("click", () => closeInlinePrompt(null));
els.inlinePromptConfirm?.addEventListener("click", () => closeInlinePrompt(inlinePromptRuntime.mode === "confirm" ? true : (els.inlinePromptInput?.value ?? "")));
els.inlinePromptInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    closeInlinePrompt(els.inlinePromptInput?.value ?? "");
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeInlinePrompt(null);
  }
});

function openInlinePrompt({
  title = "重命名",
  description = "请输入内容",
  value = "",
  placeholder = "请输入内容",
  confirmText = "确定",
  cancelText = "取消",
  eyebrow = "EDIT",
  mode = "prompt",
} = {}) {
  return new Promise((resolve) => {
    inlinePromptRuntime.resolve = resolve;
    inlinePromptRuntime.mode = mode === "confirm" ? "confirm" : "prompt";
    if (els.inlinePromptEyebrow) els.inlinePromptEyebrow.textContent = eyebrow;
    if (els.inlinePromptTitle) els.inlinePromptTitle.textContent = title;
    if (els.inlinePromptDescription) {
      els.inlinePromptDescription.textContent = description;
      els.inlinePromptDescription.hidden = !description;
    }
    if (els.inlinePromptInput) {
      els.inlinePromptInput.value = value;
      els.inlinePromptInput.placeholder = placeholder;
      els.inlinePromptInput.closest(".inline-prompt-body")?.classList.toggle("is-hidden", inlinePromptRuntime.mode !== "prompt");
    }
    if (els.inlinePromptConfirm) els.inlinePromptConfirm.textContent = confirmText;
    if (els.inlinePromptCancel) els.inlinePromptCancel.textContent = cancelText;
    if (els.inlinePromptModal) {
      els.inlinePromptModal.classList.remove("is-hidden");
      els.inlinePromptModal.setAttribute("aria-hidden", "false");
    }
    requestAnimationFrame(() => {
      if (inlinePromptRuntime.mode === "prompt") {
        els.inlinePromptInput?.focus();
        els.inlinePromptInput?.select();
      } else {
        els.inlinePromptConfirm?.focus();
      }
    });
  });
}

function openInlineConfirm({
  title = "确认操作",
  description = "",
  confirmText = "确定",
  cancelText = "取消",
  eyebrow = "ACTION",
} = {}) {
  return openInlinePrompt({
    title,
    description,
    confirmText,
    cancelText,
    eyebrow,
    mode: "confirm",
  }).then((result) => result === true);
}

function qqTargetProfileKey(targetType = els.qqTargetType?.value || "private", targetId = els.qqTargetId?.value || "") {
  const normalizedType = String(targetType || "").trim().toLowerCase() === "group" ? "group" : "private";
  const normalizedId = String(targetId || "").trim();
  return normalizedId ? `${normalizedType}:${normalizedId}` : "";
}

function getSavedQqTargetProfiles() {
  const persisted = saved();
  const profiles = persisted.qqTargetProfiles;
  return profiles && typeof profiles === "object" ? { ...profiles } : {};
}

function persistQqTargetProfiles(nextProfiles = qqTargetProfileRuntime.profiles) {
  qqTargetProfileRuntime.profiles = { ...nextProfiles };
  const current = saved();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    qqTargetProfiles: qqTargetProfileRuntime.profiles,
  }));
}

function collectCurrentQqTargetProfile() {
  const targetType = els.qqTargetType?.value || "private";
  const targetId = els.qqTargetId?.value?.trim() || "";
  if (!targetId) return null;
  const key = qqTargetProfileKey(targetType, targetId);
  const existingProfile = qqTargetProfileRuntime.profiles?.[key] || {};
  return {
    key,
    name: `${targetType === "group" ? "群" : "QQ"} ${targetId}`,
    targetType,
    targetId,
    defaultTargetType: targetType,
    defaultTargetId: targetId,
    // Preserve hidden authorization flags that are not editable in the current UI.
    superPermissionEnabled: Boolean(existingProfile.superPermissionEnabled),
    model: els.qqBotModelSelect?.value || "",
    triggerPrefix: els.qqBotTriggerPrefix?.value?.trim() || "",
    allowedUsers: els.qqBotAllowedUsers?.value || "",
    allowedGroups: els.qqBotAllowedGroups?.value || "",
    persona: els.qqBotPersona?.value || "",
    personaPreset: els.qqBotPersonaPreset?.value || "none",
    fileShareRoots: els.qqProfileFileShareRoots?.value || "",
    toolReadEnabled: Boolean(els.qqProfileToolsReadEnabled?.checked),
    toolWriteEnabled: Boolean(els.qqProfileToolsWriteEnabled?.checked),
    toolCommandEnabled: Boolean(els.qqProfileToolsCommandEnabled?.checked),
    toolSkillEnabled: Boolean(els.qqProfileToolsSkillEnabled?.checked),
    toolFileSendEnabled: Boolean(els.qqProfileToolsFileSendEnabled?.checked),
    assistantName: els.assistantName?.value?.trim() || "Assistant",
    systemPrompt: els.systemPrompt?.value?.trim() || "",
  };
}

function applyQqTargetProfile(profile = null) {
  const fallback = qqTargetProfileRuntime.baseConfig || {};
  const resolved = profile || {};
  const resolvedModel = resolved.model || fallback.model || "";
  const resolvedPreset = resolved.personaPreset || fallback.personaPreset || "none";
  renderQqBotModelOptions();
  if (els.qqBotModelSelect) els.qqBotModelSelect.value = resolvedModel;
  if (els.qqBotTriggerPrefix) els.qqBotTriggerPrefix.value = resolved.triggerPrefix || fallback.triggerPrefix || "";
  if (els.qqBotAllowedUsers) els.qqBotAllowedUsers.value = Array.isArray(resolved.allowedUsers) ? resolved.allowedUsers.join("\n") : (resolved.allowedUsers || fallback.allowedUsers || "");
  if (els.qqBotAllowedGroups) els.qqBotAllowedGroups.value = Array.isArray(resolved.allowedGroups) ? resolved.allowedGroups.join("\n") : (resolved.allowedGroups || fallback.allowedGroups || "");
  if (els.qqBotPersonaPreset) els.qqBotPersonaPreset.value = resolvedPreset;
  if (els.qqBotPersona) els.qqBotPersona.value = resolved.persona || fallback.persona || "";
  if (els.qqProfileFileShareRoots) {
    const resolvedRoots = Array.isArray(resolved.fileShareRoots) ? resolved.fileShareRoots.join("\n") : (resolved.fileShareRoots || "");
    const fallbackRoots = Array.isArray(fallback.fileShareRoots) ? fallback.fileShareRoots.join("\n") : (fallback.fileShareRoots || "data/personas");
    els.qqProfileFileShareRoots.value = resolvedRoots || fallbackRoots;
  }
  if (els.qqProfileToolsReadEnabled) els.qqProfileToolsReadEnabled.checked = resolved.toolReadEnabled !== false && fallback.toolReadEnabled !== false;
  if (els.qqProfileToolsWriteEnabled) els.qqProfileToolsWriteEnabled.checked = typeof resolved.toolWriteEnabled === "boolean" ? resolved.toolWriteEnabled : Boolean(fallback.toolWriteEnabled);
  if (els.qqProfileToolsCommandEnabled) els.qqProfileToolsCommandEnabled.checked = typeof resolved.toolCommandEnabled === "boolean" ? resolved.toolCommandEnabled : Boolean(fallback.toolCommandEnabled);
  if (els.qqProfileToolsSkillEnabled) els.qqProfileToolsSkillEnabled.checked = typeof resolved.toolSkillEnabled === "boolean" ? resolved.toolSkillEnabled : Boolean(fallback.toolSkillEnabled);
  if (els.qqProfileToolsFileSendEnabled) els.qqProfileToolsFileSendEnabled.checked = typeof resolved.toolFileSendEnabled === "boolean" ? resolved.toolFileSendEnabled : Boolean(fallback.toolFileSendEnabled);
  syncQqBotPersonaPresetsFromMainSelect();
  renderQqBotModelOptions();
  if (els.qqBotModelSelect) {
    els.qqBotModelSelect.value = resolvedModel;
  }
  if (els.qqBotPersonaPreset) {
    els.qqBotPersonaPreset.value = resolvedPreset;
  }
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqBotPersonaPresetDescription();
  renderQqToolPermissionMeta();
}

function renderQqTargetProfileMeta() {
  if (!els.qqTargetProfileMeta) return;
  const key = qqTargetProfileKey();
  if (!key) {
    els.qqTargetProfileMeta.textContent = "请先填写 QQ 或群号，再为该对象保存独立配置。";
    return;
  }
  const profile = qqTargetProfileRuntime.profiles[key];
  els.qqTargetProfileMeta.textContent = profile
    ? `当前目标已使用独立配置：${profile.name || key}`
    : "当前目标将使用全局 QQ 配置。";
}

function renderQqTargetProfilesSelect() {
  if (!els.qqTargetProfileSelect) return;
  const currentKey = qqTargetProfileKey();
  const firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = "当前目标未保存为独立配置";
  const options = Object.entries(qqTargetProfileRuntime.profiles)
    .sort((left, right) => left[0].localeCompare(right[0], "zh-CN"))
    .map(([key, profile]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = profile.name || key;
      return option;
    });
  els.qqTargetProfileSelect.replaceChildren(firstOption, ...options);
  els.qqTargetProfileSelect.value = currentKey && qqTargetProfileRuntime.profiles[currentKey] ? currentKey : "";
  if (els.deleteQqTargetProfile) {
    els.deleteQqTargetProfile.disabled = !(currentKey && qqTargetProfileRuntime.profiles[currentKey]);
  }
  renderQqTargetProfileMeta();
}

function applyCurrentQqTargetProfileIfExists() {
  const key = qqTargetProfileKey();
  if (!key) {
    renderQqTargetProfilesSelect();
    renderQqTargetProfileMeta();
    return;
  }
  applyQqTargetProfile(qqTargetProfileRuntime.profiles[key] || null);
  renderQqTargetProfilesSelect();
}

const saveBeforeQqTargetProfiles = save;
save = function saveWithQqTargetProfiles() {
  saveBeforeQqTargetProfiles();
  persistQqTargetProfiles(qqTargetProfileRuntime.profiles);
};

const loadBeforeQqTargetProfiles = load;
load = function loadWithQqTargetProfiles() {
  loadBeforeQqTargetProfiles();
  qqTargetProfileRuntime.profiles = getSavedQqTargetProfiles();
  renderQqTargetProfilesSelect();
};

const getQqPushSettingsBeforeProfiles = getQqPushSettings;
getQqPushSettings = function getQqPushSettingsWithProfiles() {
  const current = getQqPushSettingsBeforeProfiles();
  return {
    ...current,
    targetProfiles: { ...qqTargetProfileRuntime.profiles },
  };
};

const getQqBotSettingsBeforeProfiles = getQqBotSettings;
getQqBotSettings = function getQqBotSettingsWithProfiles() {
  const current = getQqBotSettingsBeforeProfiles();
  return {
    ...current,
    targetProfiles: { ...qqTargetProfileRuntime.profiles },
  };
};

const syncQqBotConfigBeforeProfiles = syncQqBotConfig;
syncQqBotConfig = async function syncQqBotConfigWithProfiles() {
  const push = getQqPushSettingsBeforeProfiles();
  const bot = getQqBotSettingsBeforeProfiles();
  qqTargetProfileRuntime.baseConfig = {
    enabled: Boolean(push.enabled),
    bridgeUrl: push.bridgeUrl,
    accessToken: push.accessToken,
    groupMentionOnly: bot.groupMentionOnly,
    taskPushEnabled: bot.taskPushEnabled,
    triggerPrefix: bot.triggerPrefix,
    allowedUsers: bot.allowedUsers,
    allowedGroups: bot.allowedGroups,
    persona: bot.persona,
    personaPreset: els.qqBotPersonaPreset?.value || saved().qqBotPersonaPreset || "none",
    fileShareRoots: els.qqFileShareRoots?.value || saved().qqFileShareRoots || "data/personas",
    toolReadEnabled: bot.toolReadEnabled,
    toolWriteEnabled: bot.toolWriteEnabled,
    toolCommandEnabled: bot.toolCommandEnabled,
    toolSkillEnabled: bot.toolSkillEnabled,
    toolFileSendEnabled: bot.toolFileSendEnabled,
    model: bot.model || "",
    systemPrompt: els.systemPrompt?.value.trim() || "",
    assistantName: els.assistantName?.value.trim() || "Assistant",
  };
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
      personaPreset: bot.personaPreset || "none",
      fileShareRoots: bot.fileShareRoots || "data/personas",
      toolReadEnabled: bot.toolReadEnabled,
      toolWriteEnabled: bot.toolWriteEnabled,
      toolCommandEnabled: bot.toolCommandEnabled,
      toolSkillEnabled: bot.toolSkillEnabled,
      toolFileSendEnabled: bot.toolFileSendEnabled,
      bridgeUrl: push.bridgeUrl,
      accessToken: push.accessToken,
      defaultTargetType: push.targetType,
      defaultTargetId: push.targetId,
      model: bot.model || "",
      systemPrompt: els.systemPrompt?.value.trim() || "",
      assistantName: els.assistantName?.value.trim() || "Assistant",
      targetProfiles: qqTargetProfileRuntime.profiles,
    }),
  });
};

async function loadQqTargetProfilesFromServer() {
  try {
    const response = await j("/qq-bot/config");
    const config = response?.config || {};
    qqTargetProfileRuntime.profiles = config.targetProfiles && typeof config.targetProfiles === "object"
      ? { ...config.targetProfiles }
      : getSavedQqTargetProfiles();
    qqTargetProfileRuntime.baseConfig = {
      enabled: Boolean(config.enabled),
      bridgeUrl: config.bridgeUrl || "",
      accessToken: config.accessToken || "",
      defaultTargetType: config.defaultTargetType || DEFAULT_QQ_PUSH_TARGET_TYPE,
      defaultTargetId: config.defaultTargetId || DEFAULT_QQ_PUSH_TARGET_ID,
      groupMentionOnly: config.groupMentionOnly !== false,
      taskPushEnabled: Boolean(config.taskPushEnabled),
      triggerPrefix: config.triggerPrefix || "",
      allowedUsers: Array.isArray(config.allowedUsers) ? config.allowedUsers.join("\n") : (config.allowedUsers || ""),
      allowedGroups: Array.isArray(config.allowedGroups) ? config.allowedGroups.join("\n") : (config.allowedGroups || ""),
      persona: config.persona || "",
      personaPreset: config.personaPreset || saved().qqBotPersonaPreset || "none",
      fileShareRoots: Array.isArray(config.fileShareRoots) ? config.fileShareRoots.join("\n") : (config.fileShareRoots || "data/temp"),
      toolReadEnabled: true,
      toolWriteEnabled: false,
      toolCommandEnabled: false,
      toolSkillEnabled: Boolean(config.toolSkillEnabled),
      toolFileSendEnabled: false,
      model: config.model || "",
      systemPrompt: config.systemPrompt || "",
      assistantName: config.assistantName || "Assistant",
    };
    if (els.qqToolsReadEnabled) els.qqToolsReadEnabled.checked = qqTargetProfileRuntime.baseConfig.toolReadEnabled !== false;
    if (els.qqFileShareRoots) els.qqFileShareRoots.value = qqTargetProfileRuntime.baseConfig.fileShareRoots || "data/personas";
    if (els.qqToolsWriteEnabled) els.qqToolsWriteEnabled.checked = Boolean(qqTargetProfileRuntime.baseConfig.toolWriteEnabled);
    if (els.qqToolsCommandEnabled) els.qqToolsCommandEnabled.checked = Boolean(qqTargetProfileRuntime.baseConfig.toolCommandEnabled);
    if (els.qqToolsSkillEnabled) els.qqToolsSkillEnabled.checked = Boolean(qqTargetProfileRuntime.baseConfig.toolSkillEnabled);
    if (els.qqToolsFileSendEnabled) els.qqToolsFileSendEnabled.checked = Boolean(qqTargetProfileRuntime.baseConfig.toolFileSendEnabled);
    persistQqTargetProfiles(qqTargetProfileRuntime.profiles);
    applyCurrentQqTargetProfileIfExists();
    renderQqToolPermissionMeta();
  } catch {
    qqTargetProfileRuntime.profiles = getSavedQqTargetProfiles();
    renderQqTargetProfilesSelect();
  }
}

els.saveQqTargetProfile?.addEventListener("click", async () => {
  spark(els.saveQqTargetProfile);
  pulseQqTargetProfileAction(els.saveQqTargetProfile, "busy");
  const profile = collectCurrentQqTargetProfile();
  if (!profile) {
    pulseQqTargetProfileAction(els.saveQqTargetProfile);
    setQqTargetProfileFeedback("请先填写 QQ 或群号，再保存对象配置。", "danger");
    setStatus("请先填写 QQ 或群号");
    return;
  }
  persistQqTargetProfileState(profile);
  applyQqTargetProfile(profile);
  renderQqBotModelOptions();
  if (els.qqBotModelSelect) {
    els.qqBotModelSelect.value = profile.model || "";
  }
  renderQqTargetProfilesSelect();
  await syncQqBotConfig().catch(() => {});
  pulseQqTargetProfileAction(els.saveQqTargetProfile, "success");
  setQqTargetProfileFeedback(`已保存对象配置：${profile.name}`, "success");
  setStatus(`已保存对象配置：${profile.name}`);
});

els.deleteQqTargetProfile?.addEventListener("click", async () => {
  spark(els.deleteQqTargetProfile);
  pulseQqTargetProfileAction(els.deleteQqTargetProfile, "busy");
  const key = qqTargetProfileKey();
  if (!key || !qqTargetProfileRuntime.profiles[key]) {
    pulseQqTargetProfileAction(els.deleteQqTargetProfile);
    setQqTargetProfileFeedback("当前对象还没有独立配置可删除。", "danger");
    setStatus("当前目标没有独立配置");
    return;
  }
  const removedName = qqTargetProfileRuntime.profiles[key]?.name || key;
  delete qqTargetProfileRuntime.profiles[key];
  persistQqTargetProfiles(qqTargetProfileRuntime.profiles);
  renderQqTargetProfilesSelect();
  applyQqTargetProfile(null);
  await syncQqBotConfig().catch(() => {});
  pulseQqTargetProfileAction(els.deleteQqTargetProfile, "success");
  setQqTargetProfileFeedback(`已删除对象配置：${removedName}`, "danger");
  setStatus("已删除当前对象配置");
});

els.qqTargetProfileSelect?.addEventListener("change", () => {
  const key = els.qqTargetProfileSelect?.value || "";
  if (!key) {
    applyCurrentQqTargetProfileIfExists();
    persistQqSettingsIndependently();
    save();
    return;
  }
  const profile = qqTargetProfileRuntime.profiles[key];
  if (!profile) return;
  if (els.qqTargetType) els.qqTargetType.value = profile.targetType || "private";
  if (els.qqTargetId) els.qqTargetId.value = profile.targetId || "";
  applyQqTargetProfile(profile);
  syncQqBotPersonaPresetsFromMainSelect();
  renderQqTargetProfilesSelect();
  persistQqSettingsIndependently();
  save();
});

[els.qqTargetType, els.qqTargetId].forEach((el) => {
  el?.addEventListener("change", () => {
    applyCurrentQqTargetProfileIfExists();
  });
  el?.addEventListener("input", () => {
    renderQqTargetProfilesSelect();
  });
});

loadQqTargetProfilesFromServer().catch(() => {});

function compactChatHistoryActionButtons() {
  document.querySelectorAll(".history-rename-button").forEach((button) => {
    button.textContent = "✎";
    button.title = "重命名";
    button.setAttribute("aria-label", "重命名");
  });
  document.querySelectorAll(".history-delete-button").forEach((button) => {
    button.textContent = "×";
    button.title = "删除";
    button.setAttribute("aria-label", "删除");
  });
}

const renderChatHistoryListBeforeCompactActionIcons = renderChatHistoryList;
renderChatHistoryList = function renderChatHistoryListWithCompactActionIcons() {
  const result = renderChatHistoryListBeforeCompactActionIcons();
  compactChatHistoryActionButtons();
  return result;
};

compactChatHistoryActionButtons();

renameChatRecord = async function renameChatRecordWithInlinePrompt(recordId) {
  const records = readChatHistoryRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) {
    setStatus("未找到对应的聊天记录", "error");
    return;
  }

  const nextTitle = await openInlinePrompt({
    title: "重命名会话",
    description: "输入新的会话名称",
    value: target.title || "未命名会话",
    placeholder: "请输入会话名称",
    confirmText: "保存",
  });

  if (nextTitle == null) {
    return;
  }

  const trimmed = String(nextTitle || "").trim();
  if (!trimmed) {
    setStatus("聊天记录名称不能为空", "error");
    return;
  }

  target.title = trimmed;
  writeChatHistoryRecords(records);
  renderChatHistoryList();
  setStatus(`已重命名聊天记录：${trimmed}`, "success");
};

saveCurrentChatAsManualRecord = async function saveCurrentChatAsManualRecordWithInlinePrompt() {
  if (!state.messages.length) {
    setStatus("当前会话还没有可保存的内容", "error");
    return;
  }

  const defaultTitle = buildChatTitle();
  const title = await openInlinePrompt({
    title: "保存会话",
    description: "为这条聊天记录输入一个名称",
    value: defaultTitle,
    placeholder: "请输入会话名称",
    confirmText: "保存",
  });
  if (title == null) return;

  const record = upsertChatRecord({
    title: String(title || "").trim() || defaultTitle,
    forceNew: true,
  });
  if (record) {
    setStatus(`已保存聊天记录：${record.title}`, "success");
  }
};

uploadSkillZipFile = async function uploadSkillZipFileWithInlinePrompt(file) {
  if (!file) return;
  if (!isZipFileName(file.name)) {
    setStatus("技能上传仅支持 ZIP 格式", "error");
    return;
  }
  const suggestedName = String(file.name || "").replace(/\.zip$/i, "").trim();
  const targetNameInput = await openInlinePrompt({
    title: "安装技能",
    description: "输入安装后的技能名称，留空则自动识别",
    value: suggestedName,
    placeholder: "技能名称",
    confirmText: "继续",
  });
  if (targetNameInput == null) return;
  const targetName = String(targetNameInput || "").trim();
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const data = await j("/skills/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentBase64, targetName }),
  });
  await loadSkills();
  setStatus(`已上传技能：${data.result.name}`, "success");
};

downloadSkillZipFromLink = async function downloadSkillZipFromLinkWithInlinePrompt() {
  const input = await openInlinePrompt({
    title: "链接下载技能",
    description: "输入技能 ZIP 下载链接",
    value: "",
    placeholder: "https://...",
    confirmText: "继续",
  });
  if (input == null) return;
  const url = String(input || "").trim();
  if (!url) {
    setStatus("请输入技能下载链接", "error");
    return;
  }
  if (!isZipUrlCandidate(url)) {
    setStatus("技能下载仅支持 ZIP 格式链接", "error");
    return;
  }
  let suggestedName = "";
  try {
    const parsed = new URL(url);
    const lastSegment = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    suggestedName = isZipFileName(lastSegment) ? lastSegment.replace(/\.zip$/i, "") : "";
  } catch {}
  const targetNameInput = await openInlinePrompt({
    title: "安装技能",
    description: "输入安装后的技能名称，留空则自动识别",
    value: suggestedName,
    placeholder: "技能名称",
    confirmText: "下载并安装",
  });
  if (targetNameInput == null) return;
  const targetName = String(targetNameInput || "").trim();
  const data = await j("/skills/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, targetName }),
  });
  await loadSkills();
  setStatus(`已下载技能：${data.result.name}`, "success");
};

savePersonaPresetToWorkspace = async function savePersonaPresetToWorkspaceWithInlinePrompt() {
  const prompt = String(els.personaPrompt?.value || "").trim();
  if (!prompt) {
    setStatus("请先填写人设内容", "error");
    return;
  }

  const suggestedName = String(els.personaPreset?.selectedOptions?.[0]?.textContent || "")
    .trim()
    .replace(/^不使用预设/, "") || "新建人设";
  const inputName = await openInlinePrompt({
    title: "保存人设模板",
    description: "输入模板名称",
    value: suggestedName,
    placeholder: "模板名称",
    confirmText: "保存",
  });
  if (inputName == null) return;

  const name = String(inputName || "").trim();
  if (!name) {
    setStatus("模板名称不能为空", "error");
    return;
  }

  await j("/personas/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, prompt }),
  });

  await loadWorkspacePersonaPresets();
  const workspaceId = `workspace:${name.replace(/\\/g, "/")}.md`;
  const fallbackPreset = allPersonaPresets().find((preset) => preset.name === name && preset.source === "workspace");
  if (els.personaPreset) {
    els.personaPreset.value = fallbackPreset?.id || workspaceId || els.personaPreset.value;
  }
  rememberedPersonaPresetId = els.personaPreset?.value || rememberedPersonaPresetId;
  renderPersonaPresetDescription();
  save();
  setStatus(`已保存人设模板：${name}`, "success");
};
deleteChatRecord = async function deleteChatRecordWithInlineConfirm(recordId) {
  const records = readChatHistoryRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) return;

  const confirmed = await openInlineConfirm({
    title: "删除聊天记录",
    description: `确定删除“${target.title || "未命名会话"}”吗？删除后 15 秒内可以撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    eyebrow: "DELETE",
  });
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
  setStatus(`已删除聊天记录：${target.title || "未命名会话"}`, "success");
};

deleteChatRecord = async function deleteChatRecordWithInlineConfirmFinal(recordId) {
  const records = readChatHistoryRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) return;

  const confirmed = await openInlineConfirm({
    title: "删除聊天记录",
    description: `确定删除“${target.title || "未命名会话"}”吗？删除后 15 秒内可以撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    eyebrow: "DELETE",
  });
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
  setStatus(`已删除聊天记录：${target.title || "未命名会话"}`, "success");
};

renderQqTargetProfileMeta = function renderQqTargetProfileMetaByConfigType() {
  if (!els.qqTargetProfileMeta) return;
  const key = qqTargetProfileKey();
  if (!key) {
    els.qqTargetProfileMeta.textContent = "请先填写 QQ 或群号，再为该对象保存独立行为配置。";
    return;
  }
  const profile = qqTargetProfileRuntime.profiles[key];
  els.qqTargetProfileMeta.textContent = profile
    ? `当前对象已保存独立行为配置：${profile.name || key}`
    : "当前对象尚未保存独立配置，将使用当前填写的对象行为。";
};

renderQqTargetProfilesSelect = function renderQqTargetProfilesSelectByConfigType() {
  if (!els.qqTargetProfileSelect) return;
  const currentKey = qqTargetProfileKey();
  const firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = "当前对象未保存独立配置";
  const options = Object.entries(qqTargetProfileRuntime.profiles)
    .sort((left, right) => left[0].localeCompare(right[0], "zh-CN"))
    .map(([key, profile]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = profile.name || key;
      return option;
    });
  els.qqTargetProfileSelect.replaceChildren(firstOption, ...options);
  els.qqTargetProfileSelect.value = currentKey && qqTargetProfileRuntime.profiles[currentKey] ? currentKey : "";
  if (els.deleteQqTargetProfile) {
    els.deleteQqTargetProfile.disabled = !(currentKey && qqTargetProfileRuntime.profiles[currentKey]);
  }
  renderQqTargetProfileMeta();
};

renderQqTargetProfilesSelect();

renderQqBotMeta = function renderQqBotMetaByConfigType() {
  if (!els.qqBotMeta) return;
  const config = getQqBotSettings();
  if (!config.enabled) {
    els.qqBotMeta.textContent = "当前未启用 QQ 机器人自动回复。";
    renderQqToolPermissionMeta();
    return;
  }
  const preset = presetById(config.personaPreset || "none");
  const presetText = config.personaPreset && config.personaPreset !== "none" ? ` · 模板：${preset.name || "已选择"}` : "";
  const prefixText = config.triggerPrefix ? ` · 前缀：${config.triggerPrefix}` : "";
  const permissionsText = ` · 私聊权限：${String(config.allowedUsers || "").trim() ? "已限制" : "不限制"} · 群权限：${String(config.allowedGroups || "").trim() ? "已限制" : "不限制"}`;
  const toolText = ` · 工具：${formatQqToolPermissionSummary(config)}`;
  const taskPushText = config.taskPushEnabled ? " · 定时推送：已开启" : "";
  els.qqBotMeta.textContent = `QQ 机器人已启用 · 群聊模式：${config.groupMentionOnly ? "仅 @ 时回复" : "允许直接回复"}${prefixText}${permissionsText}${toolText}${presetText}${taskPushText}`;
  renderQqToolPermissionMeta();
};

renderQqBotMeta();

function getPreferredQqPersonaPresetValue() {
  const currentKey = qqTargetProfileKey();
  const currentProfile = currentKey ? qqTargetProfileRuntime.profiles[currentKey] : null;
  return currentProfile?.personaPreset || els.qqBotPersonaPreset?.value || saved().qqBotPersonaPreset || "none";
}

function getAllQqPersonaPresetOptions() {
  return [
    ...PERSONA_PRESETS,
    ...workspacePersonaPresets,
  ];
}

function getPreferredQqModelValue() {
  const currentKey = qqTargetProfileKey();
  const currentProfile = currentKey ? qqTargetProfileRuntime.profiles[currentKey] : null;
  return currentProfile?.model || els.qqBotModelSelect?.value || saved().qqBotModel || "";
}

renderQqBotPersonaPresets = function renderQqBotPersonaPresetsByTargetProfile() {
  if (!els.qqBotPersonaPreset) return;
  const preferredValue = getPreferredQqPersonaPresetValue();
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

  const optionValues = ["none", ...getAllQqPersonaPresetOptions().map((preset) => preset.id)];
  els.qqBotPersonaPreset.replaceChildren(...nodes);
  els.qqBotPersonaPreset.value = optionValues.includes(preferredValue) ? preferredValue : "none";
  renderQqBotPersonaPresetDescription();
};

syncQqBotPersonaPresetsFromMainSelect = function syncQqBotPersonaPresetsFromMainSelectByTargetProfile() {
  if (!els.qqBotPersonaPreset) return;
  const preferredValue = getPreferredQqPersonaPresetValue();
  renderQqBotPersonaPresets();
  const availableValues = Array.from(els.qqBotPersonaPreset.querySelectorAll("option")).map((option) => option.value);
  els.qqBotPersonaPreset.value = availableValues.includes(preferredValue) ? preferredValue : "none";
  renderQqBotPersonaPresetDescription();
};

renderQqBotPersonaPresets();
applyCurrentQqTargetProfileIfExists();

function persistCurrentQqPersonaPresetSelection() {
  const selectedPreset = els.qqBotPersonaPreset?.value || "none";
  const current = saved();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    qqBotPersonaPreset: selectedPreset,
  }));

  const key = qqTargetProfileKey();
  if (key && qqTargetProfileRuntime.profiles[key]) {
    qqTargetProfileRuntime.profiles[key] = {
      ...qqTargetProfileRuntime.profiles[key],
      personaPreset: selectedPreset,
      persona: els.qqBotPersona?.value || qqTargetProfileRuntime.profiles[key].persona || "",
    };
    persistQqTargetProfiles(qqTargetProfileRuntime.profiles);
  }
}

function pulseQqTargetProfileAction(button, type = "success") {
  if (!button) return;
  button.classList.remove("is-busy", "is-success");
  if (type === "busy") {
    button.classList.add("is-busy");
    return;
  }
  if (type === "success") {
    button.classList.add("is-success");
    window.setTimeout(() => {
      button.classList.remove("is-success");
    }, 1400);
  }
}

function setQqTargetProfileFeedback(message, tone = "success") {
  if (!els.qqTargetProfileMeta) return;
  els.qqTargetProfileMeta.textContent = message;
  els.qqTargetProfileMeta.classList.remove("is-success", "is-danger");
  if (tone === "success") {
    els.qqTargetProfileMeta.classList.add("is-success");
  } else if (tone === "danger") {
    els.qqTargetProfileMeta.classList.add("is-danger");
  }
}

function persistQqTargetProfileState(profile) {
  if (!profile?.key) return;
  qqTargetProfileRuntime.profiles[profile.key] = { ...profile };
  persistQqTargetProfiles(qqTargetProfileRuntime.profiles);
  persistQqSettingsIndependently();
  save();
}

const loadQqTargetProfilesFromServerBeforePersonaPresetDefault = loadQqTargetProfilesFromServer;
loadQqTargetProfilesFromServer = async function loadQqTargetProfilesFromServerWithPersonaPresetDefault() {
  await loadQqTargetProfilesFromServerBeforePersonaPresetDefault();
  applyCurrentQqTargetProfileIfExists();
  syncQqBotPersonaPresetsFromMainSelect();
};

bindQqBotPersonaPresetMirrorObserver = function bindQqBotPersonaPresetMirrorObserverIndependent() {
  syncQqBotPersonaPresetsFromMainSelect();
};

els.qqBotPersonaPreset?.addEventListener("change", () => {
  persistCurrentQqPersonaPresetSelection();
});

els.qqBotPersonaPreset?.addEventListener("change", () => {
  renderQqBotPersonaPresets();
  renderQqBotPersonaPresetDescription();
});

els.qqBotModelSelect?.addEventListener("change", () => {
  const profile = collectCurrentQqTargetProfile();
  if (!profile) return;
  persistQqTargetProfileState(profile);
  renderQqBotModelOptions();
  if (els.qqBotModelSelect) {
    els.qqBotModelSelect.value = profile.model || "";
  }
  renderQqTargetProfilesSelect();
});

renderPersonaPresets = function renderPersonaPresetsIndependentFinal() {
  renderPersonaPresetsBeforeFinalRestore();
  restoreSavedPersonaPresetSelection();
  renderQqBotPersonaPresets();
};

load = function loadIndependentFinal() {
  loadBeforePersonaPresetSelectionRestore();
  rememberedPersonaPresetId = saved().personaPreset || rememberedPersonaPresetId || "none";
  restoreSavedPersonaPresetSelection();
  renderQqBotModelOptions();
  renderQqBotPersonaPresets();
  applyCurrentQqTargetProfileIfExists();
  syncQqBotPersonaPresetsFromMainSelect();
  renderQqTargetProfilesSelect();
};

loadWorkspacePersonaPresets = async function loadWorkspacePersonaPresetsIndependentFinal() {
  await loadWorkspacePersonaPresetsBeforeFinalRestore();
  restoreSavedPersonaPresetSelection();
  renderQqBotPersonaPresets();
};

bindQqBotPersonaPresetMirrorObserver = function bindQqBotPersonaPresetMirrorObserverDisabled() {
  if (qqBotPersonaPresetMirrorObserver) {
    qqBotPersonaPresetMirrorObserver.disconnect();
    qqBotPersonaPresetMirrorObserver = null;
  }
};

syncQqBotPersonaPresetsFromMainSelect = function syncQqBotPersonaPresetsIndependent() {
  renderQqBotPersonaPresets();
};

bindQqBotPersonaPresetMirrorObserver();

els.modelSelect?.addEventListener("change", () => {
  syncQqBotConfig().catch(() => {});
});

const loadModelsBeforeQqModelSyncFinal = loadModels;
loadModels = async function loadModelsWithQqModelSyncFinal() {
  await loadModelsBeforeQqModelSyncFinal();
  syncQqBotConfig().catch(() => {});
};

renderQqBotModelOptions = function renderQqBotModelOptionsByTargetProfile() {
  if (!els.qqBotModelSelect || !els.modelSelect) return;
  const preferredValue = getPreferredQqModelValue();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "按 QQ 配置选择模型";

  const sourceNodes = Array.from(els.modelSelect.querySelectorAll("option"))
    .filter((option) => option.value)
    .map((option) => option.cloneNode(true));

  const optionValues = ["", ...sourceNodes.map((option) => option.value)];
  if (preferredValue && !optionValues.includes(preferredValue)) {
    const fallbackOption = document.createElement("option");
    fallbackOption.value = preferredValue;
    fallbackOption.textContent = `${preferredValue} (当前对象)`;
    sourceNodes.unshift(fallbackOption);
    optionValues.splice(1, 0, preferredValue);
  }

  els.qqBotModelSelect.replaceChildren(placeholder, ...sourceNodes);
  els.qqBotModelSelect.value = optionValues.includes(preferredValue) ? preferredValue : "";
};

const systemMessagesBeforeCommandToolReminderFinal = systemMessages;
systemMessages = function systemMessagesWithCommandToolReminderFinal() {
  const list = Array.isArray(systemMessagesBeforeCommandToolReminderFinal())
    ? [...systemMessagesBeforeCommandToolReminderFinal()]
    : [];
  list.push({
    role: "system",
    content: "当前项目已经提供真实命令工具：run_shell_command 可执行 PowerShell 命令，run_cli_command 可执行本地 CLI 程序及参数，run_workspace_skill 可执行受支持的本地技能脚本。遇到 shell、Node 脚本、CLI、curl、npm、git、PowerShell、fetch 代理调用等需求时，不要再说无法执行或没有工具，应优先直接调用这些工具完成任务。",
  });
  return list;
};

function getCurrentTimeCalibrationSystemMessage() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const currentTime = formatter.format(now).replace(/\//g, "-");
  return {
    role: "system",
    content: `当前系统时间（以北京时间为准）是：${currentTime}。涉及今天、昨天、明天、当前日期、当前时间、本周、本月等相对时间时，必须以这个时间为准，不要自行假设或沿用过期时间。`,
  };
}

const systemMessagesBeforeCurrentTimeCalibration = systemMessages;
systemMessages = function systemMessagesWithCurrentTimeCalibration() {
  const list = Array.isArray(systemMessagesBeforeCurrentTimeCalibration())
    ? [...systemMessagesBeforeCurrentTimeCalibration()]
    : [];
  list.push(getCurrentTimeCalibrationSystemMessage());
  return list;
};

const systemMessagesBeforeWebSearchReminderFinal = systemMessages;
systemMessages = function systemMessagesWithWebSearchReminderFinal() {
  const list = Array.isArray(systemMessagesBeforeWebSearchReminderFinal())
    ? [...systemMessagesBeforeWebSearchReminderFinal()]
    : [];
  list.push({
    role: "system",
    content: "When the user needs current internet information such as news, prices, releases, or webpage findings, call web_search instead of guessing.",
  });
  return list;
};

const qqSkillRuntime = {
  selectedSkill: null,
  activeSkills: [],
};

function normalizeQqSkill(skill) {
  return reduceSkillToSkillMdOnly(cloneSkillForStorage(skill));
}

function normalizeQqActiveSkills(skills) {
  return normalizeActiveSkills((Array.isArray(skills) ? skills : []).map((skill) => normalizeQqSkill(skill)).filter(Boolean));
}

function getQqSkillStateSnapshot() {
  return {
    selectedSkill: normalizeQqSkill(qqSkillRuntime.selectedSkill),
    activeSkills: normalizeQqActiveSkills(qqSkillRuntime.activeSkills),
  };
}

function getQqActiveSkills() {
  return normalizeQqActiveSkills(qqSkillRuntime.activeSkills);
}

function isQqSkillActive(skill) {
  return getQqActiveSkills().some((item) => sameSkill(item, skill));
}

function buildQqActiveSkillsSummaryLines() {
  const activeSkills = getQqActiveSkills();
  if (!activeSkills.length) {
    return ["当前未启用 QQ 专属技能。"];
  }
  const names = activeSkills.map((skill) => skill.name);
  const summary = names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")} 等 ${names.length} 个技能`;
  return [
    `已启用 QQ 技能：${summary}`,
    ...activeSkills.map((skill, index) => `${index + 1}. ${skill.name} · ${skill.source}`),
  ];
}

function renderQqSkillMeta() {
  if (!els.qqSkillMeta) return;
  const activeSkills = getQqActiveSkills();
  const currentKey = qqTargetProfileKey();
  const profile = currentKey ? qqTargetProfileRuntime.profiles[currentKey] : null;
  if (!activeSkills.length) {
    els.qqSkillMeta.textContent = profile
      ? `当前对象 ${profile.name || currentKey} 未启用 QQ 专属技能。`
      : "当前对象未启用 QQ 专属技能。";
    return;
  }
  const names = activeSkills.map((skill) => skill.name);
  const summary = names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")} 等 ${names.length} 个技能`;
  els.qqSkillMeta.textContent = profile
    ? `当前对象 ${profile.name || currentKey} 已启用：${summary}`
    : `当前已启用 QQ 专属技能：${summary}`;
}

function persistQqSkillStateLocally() {
  const current = saved();
  const snapshot = getQqSkillStateSnapshot();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...current,
    qqSelectedSkill: snapshot.selectedSkill,
    qqActiveSkills: snapshot.activeSkills,
  }));
}

function renderQqSkillPreview(skill = qqSkillRuntime.selectedSkill) {
  if (!els.qqSkillPreview) return;
  renderQqSkillMeta();
  const normalized = normalizeQqSkill(skill);
  const summaryLines = buildQqActiveSkillsSummaryLines();
  if (!normalized?.content) {
    els.qqSkillPreview.textContent = [...summaryLines, "", "选择一个技能后，会在这里显示 QQ 机器人专属技能摘要。"].join("\n");
    return;
  }
  els.qqSkillPreview.textContent = [
    ...summaryLines,
    "",
    `当前查看：${normalized.name}`,
    `来源：${normalized.source}`,
    "",
    "# SKILL.md",
    "",
    normalized.content,
  ].join("\n");
}

function renderQqSkills() {
  if (!els.qqSkillsList) return;
  const activeSkills = getQqActiveSkills();
  if (!state.skills.length) {
    els.qqSkillsList.innerHTML = '<div class="file-empty">当前还没有读取到技能列表。</div>';
    renderQqSkillMeta();
    if (els.qqDisableSkill) els.qqDisableSkill.disabled = !activeSkills.length;
    return;
  }
  els.qqSkillsList.replaceChildren(...state.skills.map((skill) => {
    const item = document.createElement("div");
    item.className = `skill-item${sameSkill(skill, qqSkillRuntime.selectedSkill) ? " is-selected" : ""}${isQqSkillActive(skill) ? " is-active" : ""}`;

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
    if (sameSkill(skill, qqSkillRuntime.selectedSkill)) {
      const readBadge = document.createElement("span");
      readBadge.className = "mini-status-tag";
      readBadge.textContent = "已读取";
      status.append(readBadge);
    }
    if (isQqSkillActive(skill)) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "mini-status-tag active";
      activeBadge.textContent = `已启用 ${activeSkills.findIndex((item) => sameSkill(item, skill)) + 1}`;
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
        await qqReadSkill(skill);
      } else {
        await installSkill(skill);
      }
    };
    actions.append(readButton);

    if (skill.source === "workspace") {
      const enableButton = document.createElement("button");
      enableButton.type = "button";
      enableButton.className = "ghost-button mini-action-button";
      enableButton.textContent = isQqSkillActive(skill) ? "查看摘要" : "加入启用";
      enableButton.onclick = async () => {
        spark(enableButton);
        if (!sameSkill(skill, qqSkillRuntime.selectedSkill)) {
          await qqReadSkill(skill);
        }
        if (isQqSkillActive(skill)) {
          renderQqSkillPreview(skill);
          return;
        }
        qqApplySelectedSkill();
      };
      actions.append(enableButton);
      if (isQqSkillActive(skill)) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "ghost-button mini-action-button";
        removeButton.textContent = "移除启用";
        removeButton.onclick = () => {
          spark(removeButton);
          qqDisableActiveSkill(skill);
        };
        actions.append(removeButton);
      }
    }

    item.append(head, actions);
    return item;
  }));
  if (els.qqDisableSkill) {
    els.qqDisableSkill.disabled = !activeSkills.length;
  }
  renderQqSkillMeta();
}

async function qqReadSkill(skill) {
  setStatus(`正在读取 QQ 技能：${skill.name}`);
  const data = await j(`/skills/read?source=${encodeURIComponent(skill.source)}&name=${encodeURIComponent(skill.name)}`);
  qqSkillRuntime.selectedSkill = normalizeQqSkill(data.skill);
  const existingIndex = state.skills.findIndex((item) => sameSkill(item, skill));
  if (existingIndex >= 0) {
    state.skills[existingIndex] = { ...state.skills[existingIndex], ...cloneSkillForStorage(data.skill) };
  }
  persistQqSkillStateLocally();
  renderQqSkillPreview(qqSkillRuntime.selectedSkill);
  renderQqSkills();
  setStatus(`已读取 QQ 技能：${skill.name}`);
}

function qqApplySelectedSkill() {
  if (!qqSkillRuntime.selectedSkill) {
    setStatus("请先读取一个 QQ 技能");
    return;
  }
  const normalized = normalizeQqSkill(qqSkillRuntime.selectedSkill);
  const activeSkills = getQqActiveSkills();
  if (!activeSkills.some((skill) => sameSkill(skill, normalized))) {
    activeSkills.push(normalized);
  }
  qqSkillRuntime.activeSkills = normalizeQqActiveSkills(activeSkills);
  qqSkillRuntime.selectedSkill = normalized;
  persistQqSkillStateLocally();
  renderQqSkills();
  renderQqSkillPreview(normalized);
  syncQqBotConfig().catch(() => {});
  setStatus(`已启用 ${qqSkillRuntime.activeSkills.length} 个 QQ 技能`);
}

function qqDisableActiveSkill(targetSkill = null) {
  const activeSkills = getQqActiveSkills();
  if (!activeSkills.length) {
    setStatus("当前没有启用中的 QQ 技能");
    return;
  }
  const skillToRemove = targetSkill || qqSkillRuntime.selectedSkill || activeSkills[activeSkills.length - 1];
  qqSkillRuntime.activeSkills = activeSkills.filter((skill) => !sameSkill(skill, skillToRemove));
  persistQqSkillStateLocally();
  renderQqSkills();
  renderQqSkillPreview(qqSkillRuntime.selectedSkill);
  syncQqBotConfig().catch(() => {});
  setStatus(`已移除 QQ 技能：${skillToRemove.name}`);
}

function qqClearSkillSelectionState() {
  qqSkillRuntime.selectedSkill = null;
  qqSkillRuntime.activeSkills = [];
  persistQqSkillStateLocally();
  renderQqSkillPreview(null);
  renderQqSkills();
  syncQqBotConfig().catch(() => {});
  setStatus("已清空 QQ 技能状态");
}

function getPreferredQqSkillProfileState(profile = null) {
  const current = saved();
  const fallback = qqTargetProfileRuntime.baseConfig || {};
  return {
    selectedSkill: normalizeQqSkill(profile?.selectedSkill || fallback.selectedSkill || current.qqSelectedSkill),
    activeSkills: normalizeQqActiveSkills(profile?.activeSkills || fallback.activeSkills || current.qqActiveSkills || []),
  };
}

const collectCurrentQqTargetProfileBeforeSkillIsolation = collectCurrentQqTargetProfile;
collectCurrentQqTargetProfile = function collectCurrentQqTargetProfileWithQqSkills() {
  const profile = collectCurrentQqTargetProfileBeforeSkillIsolation();
  if (!profile) return null;
  const snapshot = getQqSkillStateSnapshot();
  return {
    ...profile,
    selectedSkill: snapshot.selectedSkill,
    activeSkills: snapshot.activeSkills,
  };
};

const applyQqTargetProfileBeforeSkillIsolation = applyQqTargetProfile;
applyQqTargetProfile = function applyQqTargetProfileWithQqSkills(profile = null) {
  applyQqTargetProfileBeforeSkillIsolation(profile);
  const skillState = getPreferredQqSkillProfileState(profile);
  qqSkillRuntime.selectedSkill = skillState.selectedSkill;
  qqSkillRuntime.activeSkills = skillState.activeSkills;
  persistQqSkillStateLocally();
  renderQqSkills();
  renderQqSkillPreview(qqSkillRuntime.selectedSkill);
};

const syncQqBotConfigBeforeSkillIsolationFinal = syncQqBotConfig;
syncQqBotConfig = async function syncQqBotConfigWithQqSkills() {
  const snapshot = getQqSkillStateSnapshot();
  qqTargetProfileRuntime.baseConfig = {
    ...(qqTargetProfileRuntime.baseConfig || {}),
    selectedSkill: snapshot.selectedSkill,
    activeSkills: snapshot.activeSkills,
  };
  await syncQqBotConfigBeforeSkillIsolationFinal();
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
      personaPreset: bot.personaPreset || "none",
      fileShareRoots: bot.fileShareRoots || "data/personas",
      toolReadEnabled: bot.toolReadEnabled,
      toolWriteEnabled: bot.toolWriteEnabled,
      toolCommandEnabled: bot.toolCommandEnabled,
      toolSkillEnabled: bot.toolSkillEnabled,
      toolFileSendEnabled: bot.toolFileSendEnabled,
      bridgeUrl: push.bridgeUrl,
      accessToken: push.accessToken,
      defaultTargetType: push.targetType,
      defaultTargetId: push.targetId,
      model: bot.model || "",
      systemPrompt: els.systemPrompt?.value.trim() || "",
      assistantName: els.assistantName?.value.trim() || "Assistant",
      selectedSkill: snapshot.selectedSkill,
      activeSkills: snapshot.activeSkills,
      targetProfiles: qqTargetProfileRuntime.profiles,
    }),
  });
};

const loadQqTargetProfilesFromServerBeforeSkillIsolationFinal = loadQqTargetProfilesFromServer;
loadQqTargetProfilesFromServer = async function loadQqTargetProfilesFromServerWithQqSkills() {
  await loadQqTargetProfilesFromServerBeforeSkillIsolationFinal();
  const current = saved();
  qqTargetProfileRuntime.baseConfig = {
    ...(qqTargetProfileRuntime.baseConfig || {}),
    selectedSkill: normalizeQqSkill(qqTargetProfileRuntime.baseConfig?.selectedSkill || current.qqSelectedSkill),
    activeSkills: normalizeQqActiveSkills(qqTargetProfileRuntime.baseConfig?.activeSkills || current.qqActiveSkills || []),
  };
  const key = qqTargetProfileKey();
  const profile = key ? qqTargetProfileRuntime.profiles[key] || null : null;
  const skillState = getPreferredQqSkillProfileState(profile);
  qqSkillRuntime.selectedSkill = skillState.selectedSkill;
  qqSkillRuntime.activeSkills = skillState.activeSkills;
  persistQqSkillStateLocally();
  renderQqSkills();
  renderQqSkillPreview(qqSkillRuntime.selectedSkill);
};

const saveBeforeQqSkillIsolation = save;
save = function saveWithQqSkillIsolation() {
  saveBeforeQqSkillIsolation();
  persistQqSkillStateLocally();
};

const loadBeforeQqSkillIsolation = load;
load = function loadWithQqSkillIsolation() {
  loadBeforeQqSkillIsolation();
  const current = saved();
  qqSkillRuntime.selectedSkill = normalizeQqSkill(current.qqSelectedSkill);
  qqSkillRuntime.activeSkills = normalizeQqActiveSkills(current.qqActiveSkills || []);
  renderQqSkills();
  renderQqSkillPreview(qqSkillRuntime.selectedSkill);
};

const loadSkillsBeforeQqSkillIsolation = loadSkills;
loadSkills = async function loadSkillsWithQqSkillIsolation() {
  await loadSkillsBeforeQqSkillIsolation();
  renderQqSkills();
  renderQqSkillPreview(qqSkillRuntime.selectedSkill);
};

const systemMessagesBeforeQqSkillIsolation = systemMessages;
systemMessages = function systemMessagesWithQqSkillIsolation() {
  return systemMessagesBeforeQqSkillIsolation().filter((message) => !String(message?.content || "").includes("当前已启用 QQ 技能："));
};

els.qqLoadSkills?.addEventListener("click", () => {
  spark(els.qqLoadSkills);
  loadSkills().catch((error) => {
    appendMessage("system", `读取 QQ 技能失败：${error.message}`, "error");
    setStatus("读取 QQ 技能失败");
  });
});

els.qqApplySkill?.addEventListener("click", () => {
  spark(els.qqApplySkill);
  qqApplySelectedSkill();
});

els.qqClearSkillSelection?.addEventListener("click", () => {
  spark(els.qqClearSkillSelection);
  qqClearSkillSelectionState();
});

els.qqDisableSkill?.addEventListener("click", () => {
  spark(els.qqDisableSkill);
  qqDisableActiveSkill();
});

renderQqSkills();
renderQqSkillPreview(qqSkillRuntime.selectedSkill);
els.personaPreset?.addEventListener("change", renderConversationMiniheadMeta);
els.personaPrompt?.addEventListener("input", renderConversationMiniheadMeta);

const REMOVED_SKILL_TOOL_NAMES = new Set([
  "search_clawhub_skills",
  "install_clawhub_skill",
  "run_workspace_skill",
]);

function scrubRemovedSkillProfile(profile = {}) {
  if (!profile || typeof profile !== "object") return profile;
  const next = { ...profile };
  delete next.toolSkillEnabled;
  delete next.selectedSkill;
  delete next.activeSkills;
  return next;
}

function scrubRemovedSkillSettingsRecord(record = {}) {
  const next = { ...(record && typeof record === "object" ? record : {}) };
  delete next.skillsCache;
  delete next.selectedSkill;
  delete next.activeSkill;
  delete next.activeSkills;
  delete next.qqSelectedSkill;
  delete next.qqActiveSkills;
  delete next.qqToolSkillEnabled;
  if (next.qqTargetProfiles && typeof next.qqTargetProfiles === "object") {
    next.qqTargetProfiles = Object.fromEntries(
      Object.entries(next.qqTargetProfiles).map(([key, value]) => [key, scrubRemovedSkillProfile(value)])
    );
  }
  return next;
}

function clearRemovedSkillState() {
  state.skills = [];
  state.selectedSkill = null;
  state.activeSkill = null;
  state.activeSkills = [];
  if (typeof qqSkillRuntime === "object" && qqSkillRuntime) {
    qqSkillRuntime.selectedSkill = null;
    qqSkillRuntime.activeSkills = [];
  }
}

for (const toolName of REMOVED_SKILL_TOOL_NAMES) {
  const index = TOOLS.findIndex((tool) => tool?.function?.name === toolName);
  if (index >= 0) {
    TOOLS.splice(index, 1);
  }
  SUPPORTED_TOOL_NAMES.delete(toolName);
}
SKILL_DISCOVERY_TOOL_NAMES.clear();
SKILL_INSTALL_TOOL_NAMES.clear();
SKILL_EXECUTION_TOOL_NAMES.clear();
clearRemovedSkillState();

getActiveSkills = function getActiveSkillsWithoutSkills() {
  return [];
};

renderSkills = function renderSkillsWithoutSkills() {
  if (!els.skillsList) return;
  els.skillsList.innerHTML = '<div class="file-empty">技能配置已移除。</div>';
};

renderSkillPreview = function renderSkillPreviewWithoutSkills() {
  if (!els.skillPreview) return;
  els.skillPreview.textContent = "技能配置已移除。";
};

loadSkills = async function loadSkillsWithoutSkills() {
  clearRemovedSkillState();
  renderSkills();
  renderSkillPreview();
  setStatus("技能配置已移除");
  return [];
};

readSkill = async function readSkillWithoutSkills() {
  throw new Error("技能配置已移除");
};

applySelectedSkill = function applySelectedSkillWithoutSkills() {
  clearRemovedSkillState();
  setStatus("技能配置已移除");
};

disableActiveSkill = function disableActiveSkillWithoutSkills() {
  clearRemovedSkillState();
  renderConversationMiniheadMeta();
};

renderQqSkills = function renderQqSkillsWithoutSkills() {
  if (!els.qqSkillsList) return;
  els.qqSkillsList.innerHTML = '<div class="file-empty">QQ 技能配置已移除。</div>';
};

renderQqSkillPreview = function renderQqSkillPreviewWithoutSkills() {
  if (els.qqSkillMeta) els.qqSkillMeta.textContent = "QQ 技能配置已移除。";
  if (els.qqSkillPreview) els.qqSkillPreview.textContent = "QQ 技能配置已移除。";
};

getQqActiveSkills = function getQqActiveSkillsWithoutSkills() {
  return [];
};

qqApplySelectedSkill = function qqApplySelectedSkillWithoutSkills() {
  clearRemovedSkillState();
  setStatus("QQ 技能配置已移除");
};

qqDisableActiveSkill = function qqDisableActiveSkillWithoutSkills() {
  clearRemovedSkillState();
};

qqClearSkillSelectionState = function qqClearSkillSelectionStateWithoutSkills() {
  clearRemovedSkillState();
};

const getQqBotSettingsBeforeSkillRemovalFinal = getQqBotSettings;
getQqBotSettings = function getQqBotSettingsWithoutSkills() {
  const config = getQqBotSettingsBeforeSkillRemovalFinal();
  return {
    ...config,
    toolSkillEnabled: false,
    selectedSkill: null,
    activeSkills: [],
  };
};

const getQqProfileToolSettingsBeforeSkillRemovalFinal = getQqProfileToolSettings;
getQqProfileToolSettings = function getQqProfileToolSettingsWithoutSkills() {
  const config = getQqProfileToolSettingsBeforeSkillRemovalFinal();
  return {
    ...config,
    toolSkillEnabled: false,
  };
};

formatQqToolPermissionSummary = function formatQqToolPermissionSummaryWithoutSkills(config = {}) {
  const enabled = [];
  if (config.toolReadEnabled !== false) enabled.push("读取");
  if (config.toolWriteEnabled) enabled.push("写入");
  if (config.toolCommandEnabled) enabled.push("命令");
  if (config.toolFileSendEnabled) enabled.push("发文件");
  return enabled.length ? enabled.join("、") : "未开放";
};

renderQqToolPermissionMeta = function renderQqToolPermissionMetaWithoutSkills() {
  const bot = getQqBotSettings();
  if (els.qqToolPermissionMeta) {
    const roots = String(bot.fileShareRoots || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    els.qqToolPermissionMeta.textContent = `公共工具权限：${formatQqToolPermissionSummary(bot)}。共享目录：${roots.length ? roots.join("、") : "data/personas"}。默认建议仅开放读取，危险操作按对象单独开启。`;
  }
  if (els.qqProfileToolPermissionMeta) {
    const profileTools = getQqProfileToolSettings();
    const roots = String(els.qqProfileFileShareRoots?.value || els.qqFileShareRoots?.value || "data/personas").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    els.qqProfileToolPermissionMeta.textContent = `当前对象工具权限：${formatQqToolPermissionSummary(profileTools)}。共享目录：${roots.length ? roots.join("、") : "data/personas"}。保存对象配置后，QQ 回复会按这组权限决定是否允许写文件、执行命令或发送文件。`;
  }
};

renderConversationMiniheadMeta = function renderConversationMiniheadMetaWithoutSkills() {
  if (!els.conversationMiniheadText) return;
  const modelText = selectedModel() || "未选择模型";
  const personaContent = String(els.personaPrompt?.value || "").trim();
  const personaPresetId = els.personaPreset?.value || "none";
  const personaPresetName = personaPresetId !== "none"
    ? String(els.personaPreset?.selectedOptions?.[0]?.textContent || "").trim()
    : "";
  const personaText = personaPresetName || (personaContent ? "自定义人设" : "无人设");
  const personaMarkup = `<span class="minihead-meta-value${personaContent ? " is-hoverable" : ""}"${personaContent ? ` title="${esc(personaContent)}"` : ""}>${esc(personaText)}</span>`;
  els.conversationMiniheadText.innerHTML = [
    `<span class="minihead-meta-item"><span class="minihead-meta-label">模型</span><span class="minihead-meta-value">${esc(modelText)}</span></span>`,
    `<span class="minihead-meta-separator">·</span>`,
    `<span class="minihead-meta-item"><span class="minihead-meta-label">人设</span>${personaMarkup}</span>`,
  ].join("");
};

getAllowedToolsForUserText = function getAllowedToolsForUserTextWithoutSkills(userText = "") {
  const allowWrite = canUseWriteTools(userText);
  const allowScheduler = hasExplicitSchedulerIntent(userText);
  const allowQqPush = hasExplicitQqIntent(userText) && isQqPushConfigured();
  return TOOLS.filter((tool) => {
    const name = tool.function.name;
    if (READ_ONLY_TOOL_NAMES.has(name)) return true;
    if (WRITE_TOOL_NAMES.has(name)) return allowWrite;
    if (QQ_TOOL_NAMES.has(name)) return allowQqPush;
    if (SCHEDULER_TOOL_NAMES.has(name)) return allowScheduler;
    return false;
  });
};

const LIVE_WEB_QUERY_HINT_RE = /(?:\bweb_search\b|联网|上网|网页|网络搜索|联网搜索|搜索工具|联网工具|最新|实时|热搜|新闻|资讯|热点|榜单|要点)/i;
const LIVE_WEB_QUERY_ACTION_RE = /(?:查|查询|搜索|搜|获取|整理|汇总|总结|播报|看下|看看)/i;

const DIRECT_WEB_SEARCH_BLOCK_RE = /(?:定时任务|cron|创建任务|新建任务|添加任务|修改任务|更新任务|删除任务|暂停任务|启用任务|运行任务|执行任务|QQ|群里|私聊|写入文件|保存到|保存为|read_file|write_file|run_shell_command|run_cli_command|代码|脚本|目录|文件|技能|persona)/i;
const DIRECT_WEB_SEARCH_ACTION_RE = /(?:查下|查一下|查一查|查询|搜索|搜下|搜一下|搜一搜|获取|看看|看下|找下|找一下)/i;
const DIRECT_WEB_SEARCH_BRIEF_ACTION_RE = /(?:整理|汇总|总结|播报)/i;
const DIRECT_WEB_SEARCH_ANALYSIS_RE = /(?:并|同时|对比|分析|点评|原因|为什么|怎么|详细|深入|趋势|解读|结合)/i;
const LEADING_ASSISTANT_MENTION_RE = /^@\S+\s*/;
const LEADING_POLITE_PREFIX_RE = /^(?:请|麻烦|帮我|帮忙|请你|请帮我|请帮忙|能否|能不能|可以|可否|想让你|替我)\s*/i;
const LEADING_SEARCH_TOOL_RE = /^(?:(?:用)?(?:联网搜索工具|联网工具|搜索工具|web_search 工具|web_search工具|web_search|联网搜索|网络搜索|网页搜索|上网搜索|上网))\s*/i;
const LEADING_SEARCH_ACTION_RE = /^(?:(?:来)?(?:查下|查一下|查一查|查询|搜索|搜下|搜一下|搜一搜|获取|整理|汇总|总结|播报|看看|看下|找下|找一下))\s*/i;
const TRAILING_DIRECT_WEB_SEARCH_FILLER_RE = /(?:一下|看看|吧|呀|啊|呢|哈|好吗|可以吗|谢谢|谢谢你)[。！!？?]*$/i;

function normalizeDirectWebSearchTextInApp(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function detectDirectWebSearchModeInApp(userText = "", tools = []) {
  const text = normalizeDirectWebSearchTextInApp(userText);
  if (!text) return "";
  if (hasExplicitSchedulerIntent(text) || hasExplicitQqIntent(text) || canUseWriteTools(text)) {
    return "";
  }
  if (DIRECT_WEB_SEARCH_BLOCK_RE.test(text)) {
    return "";
  }
  if (DIRECT_WEB_SEARCH_ANALYSIS_RE.test(text)) {
    return "";
  }
  const toolNames = Array.isArray(tools)
    ? tools.map((tool) => String(tool?.function?.name || "").trim()).filter(Boolean)
    : [];
  if (!toolNames.includes("web_search")) {
    return "";
  }
  if (!LIVE_WEB_QUERY_HINT_RE.test(text)) {
    return "";
  }
  if (DIRECT_WEB_SEARCH_ACTION_RE.test(text)) {
    return "list";
  }
  if (DIRECT_WEB_SEARCH_BRIEF_ACTION_RE.test(text)) {
    return "brief";
  }
  return "";
}

function canHandleDirectWebSearchInApp(userText = "", tools = []) {
  return Boolean(detectDirectWebSearchModeInApp(userText, tools));
}

function extractDirectWebSearchQueryInApp(userText = "") {
  let query = normalizeDirectWebSearchTextInApp(userText);
  if (!query) return "";
  for (const pattern of [
    LEADING_ASSISTANT_MENTION_RE,
    LEADING_POLITE_PREFIX_RE,
    LEADING_SEARCH_TOOL_RE,
    LEADING_SEARCH_ACTION_RE,
  ]) {
    query = query.replace(pattern, "").trim();
  }
  query = query
    .replace(/^(?:请|麻烦|帮我|帮忙)\s*/i, "")
    .replace(TRAILING_DIRECT_WEB_SEARCH_FILLER_RE, "")
    .replace(/[。！!？?]+$/g, "")
    .trim();
  return query || normalizeDirectWebSearchTextInApp(userText);
}

function formatDirectWebSearchReplyInApp(result = {}, options = {}) {
  const query = normalizeDirectWebSearchTextInApp(result?.query || "");
  const results = Array.isArray(result?.results) ? result.results : [];
  const mode = String(options.mode || "list").trim() || "list";
  if (!results.length) {
    return query
      ? `已完成联网搜索：${query}\n未找到可用结果。`
      : "已完成联网搜索\n未找到可用结果。";
  }
  const maxItems = Math.min(Math.max(Number(options.maxItems) || (mode === "brief" ? 4 : 3), 1), 5);
  const lines = [query ? `已完成联网搜索：${query}` : "已完成联网搜索"];
  for (const [index, item] of results.slice(0, maxItems).entries()) {
    const title = normalizeDirectWebSearchTextInApp(item?.title || `结果 ${index + 1}`);
    const snippet = normalizeDirectWebSearchTextInApp(item?.snippet || "");
    const url = normalizeDirectWebSearchTextInApp(item?.url || "");
    lines.push(`${index + 1}. ${title}`);
    if (snippet) lines.push(`   ${mode === "brief" ? "要点" : "摘要"}：${snippet}`);
    if (url) lines.push(`   链接：${url}`);
  }
  return lines.join("\n");
}

async function maybeRunDirectWebSearchInApp(userText = "", tools = []) {
  const mode = detectDirectWebSearchModeInApp(userText, tools);
  if (!mode) {
    return "";
  }
  const query = extractDirectWebSearchQueryInApp(userText);
  if (!query) {
    return "";
  }
  const toolReply = await executeTool({
    id: nowId(),
    function: {
      name: "web_search",
      arguments: JSON.stringify({ query, limit: mode === "brief" ? 4 : 3 }),
    },
  });
  if (toolReply?.role === "tool" && typeof toolReply.content === "string") {
    try {
      const parsed = JSON.parse(toolReply.content);
      if (parsed?.query && Array.isArray(parsed.results)) {
        return formatDirectWebSearchReplyInApp(parsed, { mode });
      }
    } catch {}
  }
  return summarizeToolOnlyReply(toolReply) || buildToolOnlyFallbackReply([toolReply]) || formatDirectWebSearchReplyInApp({ query }, { mode });
}

const buildToolOnlyFallbackReplyBeforeDirectWebSearch = buildToolOnlyFallbackReply;
buildToolOnlyFallbackReply = function buildToolOnlyFallbackReplyWithDirectWebSearch(messages = []) {
  const summary = buildToolOnlyFallbackReplyBeforeDirectWebSearch(messages);
  if (summary) {
    return summary;
  }
  const lastToolMessage = [...messages].reverse().find((message) => message?.role === "tool" && typeof message.content === "string");
  if (!lastToolMessage?.content) {
    return "";
  }
  try {
    const parsed = JSON.parse(lastToolMessage.content);
    if (parsed?.query && Array.isArray(parsed.results)) {
      return formatDirectWebSearchReplyInApp(parsed);
    }
  } catch {}
  return "";
};

function shouldUseLeanWebSearchMode(userText = "", tools = []) {
  const text = String(userText || "").trim();
  if (!text) return false;
  if (hasExplicitSchedulerIntent(text) || hasExplicitQqIntent(text) || canUseWriteTools(text)) {
    return false;
  }
  const toolNames = Array.isArray(tools)
    ? tools.map((tool) => String(tool?.function?.name || "").trim()).filter(Boolean)
    : [];
  if (!toolNames.includes("web_search")) {
    return false;
  }
  return LIVE_WEB_QUERY_HINT_RE.test(text) && LIVE_WEB_QUERY_ACTION_RE.test(text);
}

function trimConversationForLeanWebSearch(messages = []) {
  return Array.isArray(messages) ? messages.slice(-4) : [];
}

const systemMessagesBeforeSkillRemovalFinal = systemMessages;
systemMessages = function systemMessagesWithoutSkills() {
  clearRemovedSkillState();
  const blockedKeywords = [
    "run_workspace_skill",
    "search_clawhub_skills",
    "install_clawhub_skill",
    "ClawHub",
    "SKILL.md",
    "你当前启用了技能",
    "当前已启用 QQ 技能",
    "QQ 技能",
    "技能只是执行说明",
  ];
  const list = systemMessagesBeforeSkillRemovalFinal().filter((message) => {
    const content = String(message?.content || "");
    return !blockedKeywords.some((keyword) => content.includes(keyword));
  });
  return list;
};

const executeToolBeforeSkillRemovalFinal = executeTool;
executeTool = async function executeToolWithoutSkills(toolCall) {
  const id = toolCall?.id || nowId();
  const name = toolCall?.function?.name || "unknown";
  if (REMOVED_SKILL_TOOL_NAMES.has(name)) {
    toolActivity(id, "done", name, "已移除的技能工具调用已拦截");
    return {
      role: "tool",
      tool_call_id: id,
      content: JSON.stringify({
        ignored: true,
        reason: "skill-feature-removed",
        message: "技能配置已移除，请改用聊天、文件、命令、QQ 或定时任务能力完成任务。",
      }),
    };
  }
  return await executeToolBeforeSkillRemovalFinal(toolCall);
};

const getSavedQqTargetProfilesBeforeSkillRemovalFinal = getSavedQqTargetProfiles;
getSavedQqTargetProfiles = function getSavedQqTargetProfilesWithoutSkills() {
  const profiles = getSavedQqTargetProfilesBeforeSkillRemovalFinal();
  return Object.fromEntries(Object.entries(profiles || {}).map(([key, value]) => [key, scrubRemovedSkillProfile(value)]));
};

const persistQqTargetProfilesBeforeSkillRemovalFinal = persistQqTargetProfiles;
persistQqTargetProfiles = function persistQqTargetProfilesWithoutSkills(nextProfiles = qqTargetProfileRuntime.profiles) {
  const sanitized = Object.fromEntries(Object.entries(nextProfiles || {}).map(([key, value]) => [key, scrubRemovedSkillProfile(value)]));
  qqTargetProfileRuntime.profiles = sanitized;
  return persistQqTargetProfilesBeforeSkillRemovalFinal(sanitized);
};

const collectCurrentQqTargetProfileBeforeSkillRemovalFinal = collectCurrentQqTargetProfile;
collectCurrentQqTargetProfile = function collectCurrentQqTargetProfileWithoutSkills() {
  const profile = collectCurrentQqTargetProfileBeforeSkillRemovalFinal();
  if (!profile) return null;
  return {
    ...scrubRemovedSkillProfile(profile),
    toolSkillEnabled: false,
  };
};

const applyQqTargetProfileBeforeSkillRemovalFinal = applyQqTargetProfile;
applyQqTargetProfile = function applyQqTargetProfileWithoutSkills(profile = null) {
  applyQqTargetProfileBeforeSkillRemovalFinal(profile ? scrubRemovedSkillProfile(profile) : null);
  clearRemovedSkillState();
  renderQqToolPermissionMeta();
};

syncQqBotConfig = async function syncQqBotConfigWithoutSkills() {
  const push = getQqPushSettings();
  const bot = getQqBotSettings();
  qqTargetProfileRuntime.baseConfig = {
    enabled: Boolean(push.enabled),
    bridgeUrl: push.bridgeUrl,
    accessToken: push.accessToken,
    groupMentionOnly: bot.groupMentionOnly,
    taskPushEnabled: bot.taskPushEnabled,
    triggerPrefix: bot.triggerPrefix,
    allowedUsers: bot.allowedUsers,
    allowedGroups: bot.allowedGroups,
    persona: bot.persona,
    personaPreset: bot.personaPreset || "none",
    fileShareRoots: bot.fileShareRoots || "data/personas",
    toolReadEnabled: bot.toolReadEnabled,
    toolWriteEnabled: bot.toolWriteEnabled,
    toolCommandEnabled: bot.toolCommandEnabled,
    toolFileSendEnabled: bot.toolFileSendEnabled,
    model: bot.model || "",
    systemPrompt: els.systemPrompt?.value.trim() || "",
    assistantName: els.assistantName?.value.trim() || "Assistant",
  };
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
      personaPreset: bot.personaPreset || "none",
      fileShareRoots: bot.fileShareRoots || "data/personas",
      toolReadEnabled: bot.toolReadEnabled,
      toolWriteEnabled: bot.toolWriteEnabled,
      toolCommandEnabled: bot.toolCommandEnabled,
      toolFileSendEnabled: bot.toolFileSendEnabled,
      bridgeUrl: push.bridgeUrl,
      accessToken: push.accessToken,
      defaultTargetType: push.targetType,
      defaultTargetId: push.targetId,
      model: bot.model || "",
      systemPrompt: els.systemPrompt?.value.trim() || "",
      assistantName: els.assistantName?.value.trim() || "Assistant",
      targetProfiles: Object.fromEntries(
        Object.entries(qqTargetProfileRuntime.profiles || {}).map(([key, value]) => [key, scrubRemovedSkillProfile(value)])
      ),
    }),
  });
};

const loadQqTargetProfilesFromServerBeforeSkillRemovalFinal = loadQqTargetProfilesFromServer;
loadQqTargetProfilesFromServer = async function loadQqTargetProfilesFromServerWithoutSkills() {
  await loadQqTargetProfilesFromServerBeforeSkillRemovalFinal();
  qqTargetProfileRuntime.profiles = Object.fromEntries(
    Object.entries(qqTargetProfileRuntime.profiles || {}).map(([key, value]) => [key, scrubRemovedSkillProfile(value)])
  );
  qqTargetProfileRuntime.baseConfig = scrubRemovedSkillProfile({
    ...(qqTargetProfileRuntime.baseConfig || {}),
    toolSkillEnabled: false,
  });
  clearRemovedSkillState();
  persistQqTargetProfiles(qqTargetProfileRuntime.profiles);
  renderQqToolPermissionMeta();
};

const saveBeforeSkillRemovalFinal = save;
save = function saveWithoutSkills() {
  clearRemovedSkillState();
  saveBeforeSkillRemovalFinal();
  const current = scrubRemovedSkillSettingsRecord(saved());
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  renderConversationMiniheadMeta();
  renderQqToolPermissionMeta();
};

const loadBeforeSkillRemovalFinal = load;
load = function loadWithoutSkills() {
  loadBeforeSkillRemovalFinal();
  clearRemovedSkillState();
  const current = scrubRemovedSkillSettingsRecord(saved());
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  renderConversationMiniheadMeta();
  renderQqToolPermissionMeta();
};

const loadModelsBeforeSkillRemovalFinal = loadModels;
loadModels = async function loadModelsWithoutSkills() {
  await loadModelsBeforeSkillRemovalFinal();
  renderConversationMiniheadMeta();
};

renderConversationMiniheadMeta();
renderQqToolPermissionMeta();
localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubRemovedSkillSettingsRecord(saved())));

function scrubQqUnifiedModelProfile(profile = {}) {
  if (!profile || typeof profile !== "object") return profile;
  const next = { ...profile };
  delete next.model;
  return next;
}

function scrubQqUnifiedModelSettingsRecord(record = {}) {
  const next = { ...(record || {}) };
  delete next.qqBotModel;
  if (next.qqTargetProfiles && typeof next.qqTargetProfiles === "object") {
    next.qqTargetProfiles = Object.fromEntries(
      Object.entries(next.qqTargetProfiles).map(([key, value]) => [key, scrubQqUnifiedModelProfile(value)])
    );
  }
  return next;
}

const getQqBotSettingsBeforeUnifiedBaseModelFinal = getQqBotSettings;
getQqBotSettings = function getQqBotSettingsUnifiedBaseModelFinal() {
  const config = getQqBotSettingsBeforeUnifiedBaseModelFinal();
  return {
    ...config,
    model: selectedModel(),
    toolSkillEnabled: false,
  };
};

const getSavedQqTargetProfilesBeforeUnifiedBaseModelFinal = getSavedQqTargetProfiles;
getSavedQqTargetProfiles = function getSavedQqTargetProfilesUnifiedBaseModelFinal() {
  const profiles = getSavedQqTargetProfilesBeforeUnifiedBaseModelFinal();
  return Object.fromEntries(
    Object.entries(profiles || {}).map(([key, value]) => [key, scrubQqUnifiedModelProfile(value)])
  );
};

const persistQqTargetProfilesBeforeUnifiedBaseModelFinal = persistQqTargetProfiles;
persistQqTargetProfiles = function persistQqTargetProfilesUnifiedBaseModelFinal(nextProfiles = qqTargetProfileRuntime.profiles) {
  const sanitized = Object.fromEntries(
    Object.entries(nextProfiles || {}).map(([key, value]) => [key, scrubQqUnifiedModelProfile(value)])
  );
  qqTargetProfileRuntime.profiles = sanitized;
  return persistQqTargetProfilesBeforeUnifiedBaseModelFinal(sanitized);
};

const collectCurrentQqTargetProfileBeforeUnifiedBaseModelFinal = collectCurrentQqTargetProfile;
collectCurrentQqTargetProfile = function collectCurrentQqTargetProfileUnifiedBaseModelFinal() {
  const profile = collectCurrentQqTargetProfileBeforeUnifiedBaseModelFinal();
  if (!profile) return null;
  return {
    ...scrubQqUnifiedModelProfile(profile),
    toolSkillEnabled: false,
  };
};

const applyQqTargetProfileBeforeUnifiedBaseModelFinal = applyQqTargetProfile;
applyQqTargetProfile = function applyQqTargetProfileUnifiedBaseModelFinal(profile = null) {
  applyQqTargetProfileBeforeUnifiedBaseModelFinal(profile ? scrubQqUnifiedModelProfile(profile) : null);
  renderQqBotMeta();
  renderQqToolPermissionMeta();
};

const persistQqSettingsIndependentlyBeforeUnifiedBaseModelFinal = persistQqSettingsIndependently;
persistQqSettingsIndependently = function persistQqSettingsIndependentlyUnifiedBaseModelFinal() {
  persistQqSettingsIndependentlyBeforeUnifiedBaseModelFinal();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubQqUnifiedModelSettingsRecord(saved())));
};

const saveBeforeUnifiedBaseModelFinal = save;
save = function saveUnifiedBaseModelFinal() {
  saveBeforeUnifiedBaseModelFinal();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubQqUnifiedModelSettingsRecord(saved())));
};

const loadBeforeUnifiedBaseModelFinal = load;
load = function loadUnifiedBaseModelFinal() {
  loadBeforeUnifiedBaseModelFinal();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubQqUnifiedModelSettingsRecord(saved())));
  renderQqBotMeta();
  renderQqToolPermissionMeta();
};

const loadModelsBeforeUnifiedBaseModelFinal = loadModels;
loadModels = async function loadModelsUnifiedBaseModelFinal() {
  await loadModelsBeforeUnifiedBaseModelFinal();
  renderQqBotMeta();
  renderQqToolPermissionMeta();
};

function replaceQqTargetProfileActionButton(propertyName) {
  const button = els[propertyName];
  if (!button || !button.parentNode) return button;
  const clone = button.cloneNode(true);
  button.parentNode.replaceChild(clone, button);
  els[propertyName] = clone;
  return clone;
}

function resetQqTargetProfileActionButton(button) {
  if (!button) return;
  button.classList.remove("is-busy", "is-success");
}

function reportQqTargetProfileAction(message, tone = "success") {
  setQqTargetProfileFeedback(message, tone === "error" ? "danger" : tone);
  setStatus(message, tone);
}

async function syncQqConfigWithUnifiedBaseModel() {
  await syncQqBotConfig();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubQqUnifiedModelSettingsRecord(saved())));
}

function bindUnifiedQqTargetProfileActionButtons() {
  const saveButton = replaceQqTargetProfileActionButton("saveQqTargetProfile");
  const deleteButton = replaceQqTargetProfileActionButton("deleteQqTargetProfile");

  saveButton?.addEventListener("click", async () => {
    spark(saveButton);
    pulseQqTargetProfileAction(saveButton, "busy");
    const profile = collectCurrentQqTargetProfile();
    if (!profile) {
      resetQqTargetProfileActionButton(saveButton);
      reportQqTargetProfileAction("请先填写 QQ 或群号，再保存对象配置。", "error");
      return;
    }

    const previousProfiles = JSON.parse(JSON.stringify(qqTargetProfileRuntime.profiles || {}));
    persistQqTargetProfileState(profile);
    applyQqTargetProfile(profile);
    renderQqTargetProfilesSelect();

    try {
      await syncQqConfigWithUnifiedBaseModel();
      pulseQqTargetProfileAction(saveButton, "success");
      reportQqTargetProfileAction(`已保存对象配置：${profile.name}`, "success");
    } catch (error) {
      persistQqTargetProfiles(previousProfiles);
      applyCurrentQqTargetProfileIfExists();
      renderQqTargetProfilesSelect();
      resetQqTargetProfileActionButton(saveButton);
      reportQqTargetProfileAction(`保存对象配置失败：${String(error?.message || "未知错误")}`, "error");
    }
  });

  deleteButton?.addEventListener("click", async () => {
    spark(deleteButton);
    pulseQqTargetProfileAction(deleteButton, "busy");
    const key = qqTargetProfileKey();
    if (!key || !qqTargetProfileRuntime.profiles[key]) {
      resetQqTargetProfileActionButton(deleteButton);
      reportQqTargetProfileAction("当前对象还没有独立配置可删除。", "error");
      return;
    }

    const previousProfiles = JSON.parse(JSON.stringify(qqTargetProfileRuntime.profiles || {}));
    const removedName = qqTargetProfileRuntime.profiles[key]?.name || key;
    delete qqTargetProfileRuntime.profiles[key];
    persistQqTargetProfiles(qqTargetProfileRuntime.profiles);
    renderQqTargetProfilesSelect();
    applyQqTargetProfile(null);

    try {
      await syncQqConfigWithUnifiedBaseModel();
      pulseQqTargetProfileAction(deleteButton, "success");
      reportQqTargetProfileAction(`已删除对象配置：${removedName}`, "success");
    } catch (error) {
      persistQqTargetProfiles(previousProfiles);
      applyCurrentQqTargetProfileIfExists();
      renderQqTargetProfilesSelect();
      resetQqTargetProfileActionButton(deleteButton);
      reportQqTargetProfileAction(`删除对象配置失败：${String(error?.message || "未知错误")}`, "error");
    }
  });
}

bindUnifiedQqTargetProfileActionButtons();

els.modelSelect?.addEventListener("change", () => {
  renderQqBotMeta();
  renderQqToolPermissionMeta();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubQqUnifiedModelSettingsRecord(saved())));
});

localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubQqUnifiedModelSettingsRecord(saved())));

function normalizeQqConfigEditorValue(value = "") {
  if (Array.isArray(value)) return value.join("\n");
  return String(value || "");
}

function formatQqConfigEditorTargetLabel(targetType = els.qqTargetType?.value || "private", targetId = els.qqTargetId?.value || "") {
  const normalizedId = String(targetId || "").trim();
  if (!normalizedId) return "";
  return `${targetType === "group" ? "群" : "QQ"} ${normalizedId}`;
}

function getScopedDefaultQqBotSettings() {
  const current = getQqBotSettings();
  if (!qqTargetProfileKey()) return current;
  const baseConfig = qqTargetProfileRuntime.baseConfig || {};
  return {
    ...current,
    triggerPrefix: normalizeQqConfigEditorValue(baseConfig.triggerPrefix),
    allowedUsers: normalizeQqConfigEditorValue(baseConfig.allowedUsers),
    allowedGroups: normalizeQqConfigEditorValue(baseConfig.allowedGroups),
    persona: String(baseConfig.persona || ""),
    personaPreset: String(baseConfig.personaPreset || "none").trim() || "none",
  };
}

const renderQqTargetProfilesSelectBeforeEditorLayoutFinal = renderQqTargetProfilesSelect;
renderQqTargetProfilesSelect = function renderQqTargetProfilesSelectByEditorLayout() {
  renderQqTargetProfilesSelectBeforeEditorLayoutFinal();
  const firstOption = els.qqTargetProfileSelect?.querySelector("option");
  if (!firstOption) return;
  firstOption.textContent = qqTargetProfileKey()
    ? "当前对象未保存为独立配置"
    : "可选：加载已保存对象配置";
};

renderQqTargetProfileMeta = function renderQqTargetProfileMetaByEditorLayout() {
  if (!els.qqTargetProfileMeta) return;
  const key = qqTargetProfileKey();
  const targetType = els.qqTargetType?.value || "private";
  const targetId = els.qqTargetId?.value?.trim() || "";
  const targetLabel = formatQqConfigEditorTargetLabel(targetType, targetId);
  if (!key || !targetLabel) {
    els.qqTargetProfileMeta.textContent = "当前正在编辑默认 QQ 配置。填写对象类型和对象 ID 后，可以把下面“当前对象...”里的设定保存为独立对象配置。";
    return;
  }
  const profile = qqTargetProfileRuntime.profiles[key];
  els.qqTargetProfileMeta.textContent = profile
    ? `当前正在编辑：${targetLabel}。状态：已保存独立配置；点击“保存对象配置”会覆盖该对象现有设置，点击“删除对象配置”会恢复跟随默认 QQ 配置。`
    : `当前正在编辑：${targetLabel}。状态：尚未保存为独立配置；下面“当前对象...”里的设定会在点击“保存对象配置”后固化到这个对象。`;
};

renderQqBotMeta = function renderQqBotMetaByScopedDefaultsFinal() {
  if (!els.qqBotMeta) return;
  const config = getScopedDefaultQqBotSettings();
  if (!config.enabled) {
    els.qqBotMeta.textContent = "当前未启用 QQ 机器人自动回复。";
    renderQqToolPermissionMeta();
    return;
  }
  const prefixText = config.triggerPrefix ? ` · 默认前缀：${config.triggerPrefix}` : "";
  const permissionsText = ` · 默认私聊限制：${String(config.allowedUsers || "").trim() ? "已限制" : "不限制"} · 默认群限制：${String(config.allowedGroups || "").trim() ? "已限制" : "不限制"}`;
  const toolText = ` · 默认工具：${formatQqToolPermissionSummary(config)}`;
  const taskPushText = config.taskPushEnabled ? " · 定时推送：已开启" : "";
  const editingScopeText = qqTargetProfileKey()
    ? ` · 当前正在编辑对象：${formatQqConfigEditorTargetLabel()}`
    : " · 当前正在编辑默认配置";
  els.qqBotMeta.textContent = `QQ 机器人已启用 · 群聊模式：${config.groupMentionOnly ? "仅 @ 时回复" : "允许直接回复"}${prefixText}${permissionsText}${toolText}${taskPushText}${editingScopeText}`;
  renderQqToolPermissionMeta();
};

syncQqBotConfig = async function syncQqBotConfigByEditorLayoutFinal() {
  const push = getQqPushSettings();
  const bot = getQqBotSettings();
  const scopedDefaultBot = getScopedDefaultQqBotSettings();
  qqTargetProfileRuntime.baseConfig = {
    ...(qqTargetProfileRuntime.baseConfig || {}),
    enabled: Boolean(bot.enabled),
    groupMentionOnly: scopedDefaultBot.groupMentionOnly,
    taskPushEnabled: scopedDefaultBot.taskPushEnabled,
    triggerPrefix: scopedDefaultBot.triggerPrefix,
    allowedUsers: scopedDefaultBot.allowedUsers,
    allowedGroups: scopedDefaultBot.allowedGroups,
    persona: scopedDefaultBot.persona,
    personaPreset: scopedDefaultBot.personaPreset || "none",
    bridgeUrl: push.bridgeUrl,
    accessToken: push.accessToken,
    defaultTargetType: push.targetType,
    defaultTargetId: push.targetId,
    fileShareRoots: bot.fileShareRoots || "data/personas",
    toolReadEnabled: bot.toolReadEnabled,
    toolWriteEnabled: bot.toolWriteEnabled,
    toolCommandEnabled: bot.toolCommandEnabled,
    toolFileSendEnabled: bot.toolFileSendEnabled,
    model: bot.model || "",
    systemPrompt: els.systemPrompt?.value.trim() || "",
    assistantName: els.assistantName?.value.trim() || "Assistant",
  };
  await j("/qq-bot/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: bot.enabled,
      groupMentionOnly: scopedDefaultBot.groupMentionOnly,
      taskPushEnabled: scopedDefaultBot.taskPushEnabled,
      triggerPrefix: scopedDefaultBot.triggerPrefix,
      allowedUsers: scopedDefaultBot.allowedUsers,
      allowedGroups: scopedDefaultBot.allowedGroups,
      persona: scopedDefaultBot.persona,
      personaPreset: scopedDefaultBot.personaPreset || "none",
      fileShareRoots: bot.fileShareRoots || "data/personas",
      toolReadEnabled: bot.toolReadEnabled,
      toolWriteEnabled: bot.toolWriteEnabled,
      toolCommandEnabled: bot.toolCommandEnabled,
      toolFileSendEnabled: bot.toolFileSendEnabled,
      bridgeUrl: push.bridgeUrl,
      accessToken: push.accessToken,
      defaultTargetType: push.targetType,
      defaultTargetId: push.targetId,
      model: bot.model || "",
      systemPrompt: els.systemPrompt?.value.trim() || "",
      assistantName: els.assistantName?.value.trim() || "Assistant",
      targetProfiles: Object.fromEntries(
        Object.entries(qqTargetProfileRuntime.profiles || {}).map(([key, value]) => [key, scrubQqUnifiedModelProfile(value)])
      ),
    }),
  });
  renderQqTargetProfileMeta();
  renderQqBotMeta();
  renderQqToolPermissionMeta();
};

applyCurrentQqTargetProfileIfExists = function applyCurrentQqTargetProfileIfExistsByEditorLayout() {
  const key = qqTargetProfileKey();
  if (!key) {
    applyQqTargetProfile(null);
    renderQqTargetProfilesSelect();
    renderQqTargetProfileMeta();
    return;
  }
  applyQqTargetProfile(qqTargetProfileRuntime.profiles[key] || null);
  renderQqTargetProfilesSelect();
  renderQqTargetProfileMeta();
};

[els.qqTargetType, els.qqTargetId].forEach((el) => {
  el?.addEventListener("change", () => {
    applyCurrentQqTargetProfileIfExists();
  }, true);
});

renderQqTargetProfilesSelect();
renderQqTargetProfileMeta();
renderQqBotMeta();

const QQ_LOCKED_PUBLIC_BOT_ENABLED = true;
const QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT = "data/temp";

function normalizeQqTargetTypeValue(value = "") {
  return String(value || "").trim().toLowerCase() === "group" ? "group" : "private";
}

function getHiddenQqPublicBaseConfig() {
  const record = saved();
  const base = qqTargetProfileRuntime.baseConfig || {};
  return {
    enabled: QQ_LOCKED_PUBLIC_BOT_ENABLED,
    groupMentionOnly: base.groupMentionOnly !== false,
    taskPushEnabled: Boolean(base.taskPushEnabled),
    triggerPrefix: normalizeQqConfigEditorValue(base.triggerPrefix ?? record.qqBotTriggerPrefix ?? ""),
    allowedUsers: normalizeQqConfigEditorValue(base.allowedUsers ?? record.qqBotAllowedUsers ?? ""),
    allowedGroups: normalizeQqConfigEditorValue(base.allowedGroups ?? record.qqBotAllowedGroups ?? ""),
    persona: String(base.persona ?? record.qqBotPersona ?? ""),
    personaPreset: String(base.personaPreset || record.qqBotPersonaPreset || "none").trim() || "none",
    bridgeUrl: String(els.qqBridgeUrl?.value?.trim() || base.bridgeUrl || record.qqBridgeUrl || ""),
    accessToken: String(els.qqAccessToken?.value?.trim() || base.accessToken || record.qqAccessToken || ""),
    defaultTargetType: DEFAULT_QQ_PUSH_TARGET_TYPE,
    defaultTargetId: DEFAULT_QQ_PUSH_TARGET_ID,
    model: String(base.model || selectedModel() || ""),
    fileShareRoots: QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT,
    toolReadEnabled: true,
    toolWriteEnabled: false,
    toolCommandEnabled: false,
    toolSkillEnabled: false,
    toolFileSendEnabled: false,
  };
}

function persistLockedQqPublicSettingsRecord() {
  const current = saved();
  const hidden = getHiddenQqPublicBaseConfig();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubQqUnifiedModelSettingsRecord({
    ...current,
    qqPushEnabled: Boolean(els.qqPushEnabled?.checked ?? current.qqPushEnabled),
    qqBridgeUrl: hidden.bridgeUrl,
    qqAccessToken: hidden.accessToken,
    qqDefaultTargetType: hidden.defaultTargetType,
    qqDefaultTargetId: hidden.defaultTargetId,
    qqBotEnabled: hidden.enabled,
    qqBotGroupMentionOnly: hidden.groupMentionOnly,
    qqTaskPushEnabled: hidden.taskPushEnabled,
    qqFileShareRoots: QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT,
    qqToolReadEnabled: true,
    qqToolWriteEnabled: false,
    qqToolCommandEnabled: false,
    qqToolSkillEnabled: false,
    qqToolFileSendEnabled: false,
  })));
}

function renderQqPublicSummaryMetaLocked() {
  const text = document.querySelector("#qq-public-summary-text");
  if (!text) return;
  const hidden = getHiddenQqPublicBaseConfig();
  const pushEnabledText = Boolean(els.qqPushEnabled?.checked ?? saved().qqPushEnabled) ? "已启用" : "已关闭";
  const bridgeText = hidden.bridgeUrl ? "已保留" : "未配置";
  const tokenText = hidden.accessToken ? "已保留" : "未配置";
  const targetText = hidden.defaultTargetId
    ? `${hidden.defaultTargetType === "group" ? "群" : "QQ"} ${hidden.defaultTargetId}`
    : "未设置";
  const botText = hidden.enabled ? "已启用" : "未启用";
  const groupModeText = hidden.groupMentionOnly ? "仅 @ 时触发" : "允许直接触发";
  const privateLimitText = String(hidden.allowedUsers || "").trim() ? "已限制" : "不限制";
  const groupLimitText = String(hidden.allowedGroups || "").trim() ? "已限制" : "不限制";
  const taskPushText = hidden.taskPushEnabled ? "已启用" : "未启用";
  text.textContent = [
    `QQ 推送：${pushEnabledText}`,
    `桥接地址：${bridgeText}`,
    `Access Token：${tokenText}`,
    `默认推送对象：${targetText}`,
    `QQ 机器人：${botText}`,
    `群聊触发：${groupModeText}`,
    `触发限制：私聊${privateLimitText}，群${groupLimitText}`,
    `定时任务推送：${taskPushText}`,
    `工具权限：仅允许读取目录与文件`,
    `共享目录：${QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT}`,
    "模型：跟随基础连接",
  ].join("\n");
}

const getQqPushSettingsBeforeLockedPublicSummaryFinal = getQqPushSettings;
getQqPushSettings = function getQqPushSettingsLockedPublicSummaryFinal() {
  const config = getQqPushSettingsBeforeLockedPublicSummaryFinal();
  const hidden = getHiddenQqPublicBaseConfig();
  return {
    ...config,
    enabled: Boolean(els.qqPushEnabled?.checked ?? saved().qqPushEnabled),
    bridgeUrl: hidden.bridgeUrl,
    accessToken: hidden.accessToken,
    targetType: hidden.defaultTargetType,
    targetId: hidden.defaultTargetId,
  };
};

const getQqBotSettingsBeforeLockedPublicSummaryFinal = getQqBotSettings;
getQqBotSettings = function getQqBotSettingsLockedPublicSummaryFinal() {
  const config = getQqBotSettingsBeforeLockedPublicSummaryFinal();
  const hidden = getHiddenQqPublicBaseConfig();
  return {
    ...config,
    enabled: hidden.enabled,
    groupMentionOnly: hidden.groupMentionOnly,
    taskPushEnabled: hidden.taskPushEnabled,
    triggerPrefix: hidden.triggerPrefix,
    allowedUsers: hidden.allowedUsers,
    allowedGroups: hidden.allowedGroups,
    persona: hidden.persona,
    personaPreset: hidden.personaPreset,
    fileShareRoots: hidden.fileShareRoots,
    toolReadEnabled: true,
    toolWriteEnabled: false,
    toolCommandEnabled: false,
    toolSkillEnabled: false,
    toolFileSendEnabled: false,
    model: selectedModel() || hidden.model || config.model || "",
  };
};

renderQqPushMeta = function renderQqPushMetaLockedPublicSummaryFinal() {
  renderQqPublicSummaryMetaLocked();
};

renderQqBotMeta = function renderQqBotMetaLockedPublicSummaryFinal() {
  renderQqPublicSummaryMetaLocked();
  if (els.qqProfileToolPermissionMeta) {
    renderQqToolPermissionMeta();
  }
};

renderQqToolPermissionMeta = function renderQqToolPermissionMetaLockedPublicSummaryFinal() {
  renderQqPublicSummaryMetaLocked();
  if (els.qqProfileToolPermissionMeta) {
    const profileTools = getQqProfileToolSettings();
    const roots = String(els.qqProfileFileShareRoots?.value || QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    els.qqProfileToolPermissionMeta.textContent = `当前对象工具权限：${formatQqToolPermissionSummary(profileTools)}。共享目录：${roots.length ? roots.join("、") : QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT}。保存对象配置后，才会对该对象单独生效。`;
  }
};

renderQqTargetProfileMeta = function renderQqTargetProfileMetaLockedPublicSummaryFinal() {
  if (!els.qqTargetProfileMeta) return;
  const key = qqTargetProfileKey();
  const targetType = els.qqTargetType?.value || "private";
  const targetId = els.qqTargetId?.value?.trim() || "";
  const targetLabel = formatQqConfigEditorTargetLabel(targetType, targetId);
  if (!key || !targetLabel) {
    els.qqTargetProfileMeta.textContent = "请先选择对象类型和对象 ID。下方内容会作为该对象的独立配置。";
    return;
  }
  const profile = qqTargetProfileRuntime.profiles[key];
  els.qqTargetProfileMeta.textContent = profile
    ? `当前正在编辑：${targetLabel}。状态：已保存独立配置；点击“保存对象配置”会覆盖该对象现有设置，点击“删除对象配置”会恢复继承公共默认配置。`
    : `当前正在编辑：${targetLabel}。状态：尚未保存为独立配置；下方对象设定会在点击“保存对象配置”后固化到这个对象。`;
};

const saveBeforeLockedPublicSummaryFinal = save;
save = function saveLockedPublicSummaryFinal() {
  saveBeforeLockedPublicSummaryFinal();
  persistLockedQqPublicSettingsRecord();
  renderQqPublicSummaryMetaLocked();
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqToolPermissionMeta();
};

const persistQqSettingsIndependentlyBeforeLockedPublicSummaryFinal = persistQqSettingsIndependently;
persistQqSettingsIndependently = function persistQqSettingsIndependentlyLockedPublicSummaryFinal() {
  persistQqSettingsIndependentlyBeforeLockedPublicSummaryFinal();
  persistLockedQqPublicSettingsRecord();
};

const loadBeforeLockedPublicSummaryFinal = load;
load = function loadLockedPublicSummaryFinal() {
  loadBeforeLockedPublicSummaryFinal();
  persistLockedQqPublicSettingsRecord();
  renderQqPublicSummaryMetaLocked();
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqToolPermissionMeta();
  renderQqTargetProfileMeta();
};

const loadQqTargetProfilesFromServerBeforeLockedPublicSummaryFinal = loadQqTargetProfilesFromServer;
loadQqTargetProfilesFromServer = async function loadQqTargetProfilesFromServerLockedPublicSummaryFinal() {
  await loadQqTargetProfilesFromServerBeforeLockedPublicSummaryFinal();
  qqTargetProfileRuntime.baseConfig = {
    ...(qqTargetProfileRuntime.baseConfig || {}),
    defaultTargetType: DEFAULT_QQ_PUSH_TARGET_TYPE,
    defaultTargetId: DEFAULT_QQ_PUSH_TARGET_ID,
    fileShareRoots: QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT,
    toolReadEnabled: true,
    toolWriteEnabled: false,
    toolCommandEnabled: false,
    toolSkillEnabled: false,
    toolFileSendEnabled: false,
  };
  persistLockedQqPublicSettingsRecord();
  renderQqPublicSummaryMetaLocked();
  renderQqPushMeta();
  renderQqBotMeta();
  renderQqToolPermissionMeta();
  renderQqTargetProfileMeta();
};

persistLockedQqPublicSettingsRecord();
renderQqPublicSummaryMetaLocked();
renderQqPushMeta();
renderQqBotMeta();
renderQqToolPermissionMeta();
renderQqTargetProfileMeta();

const getHiddenQqPublicBaseConfigBeforeTaskScopedSchedulerFinal = getHiddenQqPublicBaseConfig;
getHiddenQqPublicBaseConfig = function getHiddenQqPublicBaseConfigTaskScopedSchedulerFinal() {
  return {
    ...getHiddenQqPublicBaseConfigBeforeTaskScopedSchedulerFinal(),
    taskPushEnabled: false,
  };
};

renderQqPublicSummaryMetaLocked = function renderQqPublicSummaryMetaTaskScopedSchedulerFinal() {
  const text = document.querySelector("#qq-public-summary-text");
  if (!text) return;
  const hidden = getHiddenQqPublicBaseConfig();
  const pushEnabledText = Boolean(els.qqPushEnabled?.checked ?? saved().qqPushEnabled) ? "已启用" : "已关闭";
  const bridgeText = hidden.bridgeUrl ? "已保存" : "未配置";
  const tokenText = hidden.accessToken ? "已保存" : "未配置";
  const targetText = hidden.defaultTargetId
    ? `${hidden.defaultTargetType === "group" ? "群" : "QQ"} ${hidden.defaultTargetId}`
    : "未设置";
  const botText = hidden.enabled ? "已启用" : "未启用";
  const groupModeText = hidden.groupMentionOnly ? "仅 @ 触发" : "允许直接触发";
  const privateLimitText = String(hidden.allowedUsers || "").trim() ? "已限制" : "不限";
  const groupLimitText = String(hidden.allowedGroups || "").trim() ? "已限制" : "不限";
  text.textContent = [
    `QQ 推送：${pushEnabledText}`,
    `桥接地址：${bridgeText}`,
    `Access Token：${tokenText}`,
    `默认推送对象：${targetText}`,
    `QQ 机器人：${botText}`,
    `群聊触发：${groupModeText}`,
    `触发限制：私聊 ${privateLimitText}，群 ${groupLimitText}`,
    "定时任务：按任务单独配置 QQ 推送",
    "工具权限：仅允许读取目录与文件",
    `共享目录：${QQ_LOCKED_PUBLIC_FILE_SHARE_ROOT}`,
    "模型：跟随基础连接",
  ].join("\n");
};

function normalizeScheduledTaskQqTargetType(value = "") {
  return String(value || "").trim().toLowerCase() === "group" ? "group" : "private";
}

function formatScheduledTaskQqTargetLabel(targetType = "private", targetId = "") {
  const normalizedId = String(targetId || "").trim();
  if (!normalizedId) {
    return "未配置";
  }
  return `${normalizeScheduledTaskQqTargetType(targetType) === "group" ? "群" : "QQ"} ${normalizedId}`;
}

function buildScheduledTaskQqPushSummary(task = {}) {
  if (!task?.qqPushEnabled) {
    return "QQ 推送：未启用";
  }
  return `QQ 推送：${formatScheduledTaskQqTargetLabel(task.qqTargetType, task.qqTargetId)}`;
}

function hasScheduledTaskQqPushPersistenceMismatch(task = {}, expectedSettings = {}) {
  if (!expectedSettings?.qqPushEnabled) {
    return false;
  }
  return !(
    task &&
    task.qqPushEnabled === true &&
    normalizeScheduledTaskQqTargetType(task.qqTargetType || "private") === normalizeScheduledTaskQqTargetType(expectedSettings.qqTargetType || "private") &&
    String(task.qqTargetId || "").trim() === String(expectedSettings.qqTargetId || "").trim()
  );
}

function applyScheduledTaskQqPushDisabledState(targetTypeInput, targetIdInput, enabled) {
  if (targetTypeInput) {
    targetTypeInput.disabled = !enabled;
  }
  if (targetIdInput) {
    targetIdInput.disabled = !enabled;
  }
}

schedulerElements = function schedulerElementsQqPushFinal() {
  return {
    formSummary: $("#schedule-task-form-summary"),
    name: $("#schedule-task-name"),
    cron: $("#schedule-task-cron"),
    prompt: $("#schedule-task-prompt"),
    qqPushEnabled: $("#schedule-task-qq-push-enabled"),
    qqTargetType: $("#schedule-task-qq-target-type"),
    qqTargetId: $("#schedule-task-qq-target-id"),
    createButton: $("#create-schedule-task"),
    refreshButton: $("#refresh-schedule-tasks"),
    meta: $("#schedule-task-meta"),
    list: $("#schedule-task-list"),
  };
};

function getScheduledTaskQqPushFormSettings() {
  const { qqPushEnabled, qqTargetType, qqTargetId } = schedulerElements();
  return {
    qqPushEnabled: Boolean(qqPushEnabled?.checked),
    qqTargetType: normalizeScheduledTaskQqTargetType(qqTargetType?.value || "private"),
    qqTargetId: String(qqTargetId?.value || "").trim(),
  };
}

function buildScheduledTaskQqPushPayload(settings = getScheduledTaskQqPushFormSettings()) {
  return {
    qqPushEnabled: Boolean(settings.qqPushEnabled),
    qqTargetType: normalizeScheduledTaskQqTargetType(settings.qqTargetType || "private"),
    qqTargetId: String(settings.qqTargetId || "").trim(),
  };
}

function buildScheduledTaskResultText(task = {}) {
  return String(task.lastError || task.lastResult || "最近还没有执行结果。").trim() || "最近还没有执行结果。";
}

function buildScheduledTaskResultPreview(task = {}) {
  return buildScheduledTaskResultText(task).replace(/\s+/g, " ").trim();
}

function buildScheduledTaskResultStatusLabel(task = {}) {
  if (task.running) {
    return "执行中";
  }
  if (task.lastStatus === "error") {
    return "最近执行失败";
  }
  if (task.lastStatus === "success") {
    return "最近执行成功";
  }
  return "最近还没有执行";
}

function renderScheduledTaskComposerSummary() {
  const { formSummary, cron } = schedulerElements();
  if (!formSummary) return;
  const modelText = selectedModel() || "未选择模型";
  const cronText = String(cron?.value || "").trim() || "未填写";
  const pushText = buildScheduledTaskQqPushSummary(getScheduledTaskQqPushFormSettings()).replace(/^QQ 推送：/, "");
  formSummary.textContent = `执行模型：${modelText} · Cron：${cronText} · QQ 推送：${pushText}`;
}

function validateScheduledTaskQqPushSettings(settings = getScheduledTaskQqPushFormSettings()) {
  if (settings.qqPushEnabled && !String(settings.qqTargetId || "").trim()) {
    setStatus("开启 QQ 推送时，请填写推送对象 ID");
    return false;
  }
  return true;
}

function renderScheduledTaskQqPushFormState() {
  const { qqPushEnabled, qqTargetType, qqTargetId } = schedulerElements();
  applyScheduledTaskQqPushDisabledState(qqTargetType, qqTargetId, Boolean(qqPushEnabled?.checked));
  renderScheduledTaskComposerSummary();
}

createScheduledTask = async function createScheduledTaskQqPushFinal() {
  const { name, cron, prompt } = schedulerElements();
  const taskName = name?.value.trim() || "";
  const cronExpression = cron?.value.trim() || "";
  const taskPrompt = prompt?.value.trim() || "";
  const qqPushSettings = getScheduledTaskQqPushFormSettings();

  if (!taskName) {
    setStatus("请输入任务标题");
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
  if (!selectedModel()) {
    setStatus("请先在基础连接中选择模型");
    return;
  }
  if (!validateScheduledTaskQqPushSettings(qqPushSettings)) {
    return;
  }

  const response = await schedulerRequest("/scheduler/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: taskName,
      prompt: taskPrompt,
      model: taskModel,
      scheduleType: "cron",
      cronExpression,
      enabled: true,
      ...buildScheduledTaskQqPushPayload(qqPushSettings),
    }),
  });

  const createdTask = response?.task || response;
  if (hasScheduledTaskQqPushPersistenceMismatch(createdTask, qqPushSettings)) {
    await loadScheduledTasksUI();
    setStatus("定时任务已创建，但 QQ 推送配置没有落盘。请重启 node server.js 后重新保存或重建任务。");
    return;
  }

  if (name) name.value = "";
  if (cron) cron.value = "";
  if (prompt) prompt.value = "";
  renderScheduledTaskComposerSummary();
  await loadScheduledTasksUI();
  setStatus(`已创建定时任务：${taskName}`);
};

startInlineEditScheduledTask = function startInlineEditScheduledTaskQqPushFinal(task) {
  scheduledTaskEditorRuntime.editingId = task.id;
  scheduledTaskEditorRuntime.drafts[task.id] = {
    cronExpression: String(task.cronExpression || "").trim(),
    prompt: String(task.prompt || ""),
    qqPushEnabled: Boolean(task.qqPushEnabled),
    qqTargetType: normalizeScheduledTaskQqTargetType(task.qqTargetType || "private"),
    qqTargetId: String(task.qqTargetId || "").trim(),
  };
  loadScheduledTasksUI().catch(() => {});
};

saveInlineEditScheduledTask = async function saveInlineEditScheduledTaskQqPushFinal(task) {
  const draft = scheduledTaskEditorRuntime.drafts[task.id] || {};
  const cronExpression = String(draft.cronExpression || "").trim();
  const prompt = String(draft.prompt || "").trim();
  const qqPushSettings = {
    qqPushEnabled: Boolean(draft.qqPushEnabled),
    qqTargetType: normalizeScheduledTaskQqTargetType(draft.qqTargetType || "private"),
    qqTargetId: String(draft.qqTargetId || "").trim(),
  };

  if (!cronExpression) {
    setStatus("Cron 表达式不能为空");
    return;
  }
  if (!prompt) {
    setStatus("任务内容不能为空");
    return;
  }
  if (!validateScheduledTaskQqPushSettings(qqPushSettings)) {
    return;
  }

  const response = await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      scheduleType: "cron",
      cronExpression,
      ...buildScheduledTaskQqPushPayload(qqPushSettings),
    }),
  });

  const updatedTask = response?.task || response;
  if (hasScheduledTaskQqPushPersistenceMismatch(updatedTask, qqPushSettings)) {
    await loadScheduledTasksUI();
    setStatus("定时任务已更新，但 QQ 推送配置没有落盘。请重启 node server.js 后重新保存。");
    return;
  }

  scheduledTaskEditorRuntime.editingId = null;
  delete scheduledTaskEditorRuntime.drafts[task.id];
  renderScheduledTaskComposerSummary();
  await loadScheduledTasksUI();
  setStatus(`已更新定时任务：${task.name}`);
};

function createScheduledTaskStatCard(label, value) {
  const card = document.createElement("div");
  card.className = "schedule-task-stat-card";

  const labelEl = document.createElement("div");
  labelEl.className = "schedule-task-stat-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "schedule-task-stat-value";
  valueEl.textContent = value;

  card.append(labelEl, valueEl);
  return card;
}

function createScheduledTaskSection(label, className, text) {
  const section = document.createElement("div");
  section.className = "schedule-task-section";

  const labelEl = document.createElement("div");
  labelEl.className = "schedule-task-section-label";
  labelEl.textContent = label;

  const content = document.createElement("div");
  content.className = className;
  content.textContent = text;

  section.append(labelEl, content);
  return section;
}

renderScheduledTasks = function renderScheduledTasksQqPushFinal(tasks) {
  const { list, meta } = schedulerElements();
  if (!list || !meta) return;

  if (!tasks.length) {
    meta.textContent = "当前还没有定时任务。";
    list.innerHTML = '<div class="file-empty">还没有定时任务。</div>';
    return;
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;
  const qqPushCount = tasks.filter((task) => task.qqPushEnabled).length;
  meta.textContent = `共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用，${qqPushCount} 个开启 QQ 推送。`;

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

    if (task.qqPushEnabled) {
      const pushBadge = document.createElement("span");
      pushBadge.className = "schedule-task-badge";
      pushBadge.textContent = "QQ 推送";
      badges.append(pushBadge);
    }

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
        qqPushEnabled: Boolean(task.qqPushEnabled),
        qqTargetType: normalizeScheduledTaskQqTargetType(task.qqTargetType || "private"),
        qqTargetId: String(task.qqTargetId || "").trim(),
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
      promptText.textContent = "任务提示词";
      const promptInput = document.createElement("textarea");
      promptInput.rows = 4;
      promptInput.value = draft.prompt;
      promptInput.placeholder = "请输入任务执行时发给模型的内容";
      promptInput.addEventListener("input", (event) => {
        draft.prompt = event.target.value;
      });
      promptLabel.append(promptText, promptInput);

      const pushToggle = document.createElement("label");
      pushToggle.className = "toggle-row";
      const pushToggleText = document.createElement("span");
      pushToggleText.textContent = "推送到 QQ";
      const pushToggleInput = document.createElement("input");
      pushToggleInput.type = "checkbox";
      pushToggleInput.checked = Boolean(draft.qqPushEnabled);
      pushToggle.append(pushToggleText, pushToggleInput);

      const pushGrid = document.createElement("div");
      pushGrid.className = "schedule-task-editor-grid";

      const targetTypeLabel = document.createElement("label");
      const targetTypeText = document.createElement("span");
      targetTypeText.textContent = "推送对象类型";
      const targetTypeSelect = document.createElement("select");
      const privateOption = document.createElement("option");
      privateOption.value = "private";
      privateOption.textContent = "私聊";
      const groupOption = document.createElement("option");
      groupOption.value = "group";
      groupOption.textContent = "群聊";
      targetTypeSelect.append(privateOption, groupOption);
      targetTypeSelect.value = normalizeScheduledTaskQqTargetType(draft.qqTargetType || "private");
      targetTypeSelect.addEventListener("change", (event) => {
        draft.qqTargetType = normalizeScheduledTaskQqTargetType(event.target.value);
      });
      targetTypeLabel.append(targetTypeText, targetTypeSelect);

      const targetIdLabel = document.createElement("label");
      const targetIdText = document.createElement("span");
      targetIdText.textContent = "推送对象 ID";
      const targetIdInput = document.createElement("input");
      targetIdInput.type = "text";
      targetIdInput.value = draft.qqTargetId || "";
      targetIdInput.placeholder = "例如 QQ 号或群号";
      targetIdInput.addEventListener("input", (event) => {
        draft.qqTargetId = event.target.value;
      });
      targetIdLabel.append(targetIdText, targetIdInput);

      const syncDraftQqPushState = () => {
        applyScheduledTaskQqPushDisabledState(targetTypeSelect, targetIdInput, Boolean(draft.qqPushEnabled));
      };
      pushToggleInput.addEventListener("change", (event) => {
        draft.qqPushEnabled = Boolean(event.target.checked);
        syncDraftQqPushState();
      });
      syncDraftQqPushState();

      pushGrid.append(targetTypeLabel, targetIdLabel);
      editorHead.append(editorTitle, editorClose);
      editor.append(editorHead, cronLabel, promptLabel, pushToggle, pushGrid);
      bodyBlock = editor;
    } else {
      const bodyWrap = document.createElement("div");

      const promptPreview = document.createElement("div");
      promptPreview.className = "schedule-task-prompt";
      promptPreview.textContent = `任务内容：${task.prompt || "暂无内容"}`;

      const pushLine = document.createElement("div");
      pushLine.className = "schedule-task-push";
      pushLine.textContent = buildScheduledTaskQqPushSummary(task);

      const result = document.createElement("div");
      result.className = "schedule-task-result";
      result.textContent = task.lastError || task.lastResult || "最近还没有执行结果。";

      bodyWrap.append(promptPreview, pushLine, result);
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
          setStatus(`更新定时任务失败：${error.message}`);
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
          setStatus(`已更新定时任务：${task.name}`);
        } catch (error) {
          setStatus(`更新定时任务失败：${error.message}`);
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
          setStatus(`执行定时任务失败：${error.message}`);
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
          setStatus(`删除定时任务失败：${error.message}`);
        }
      });

      actions.append(editButton, toggleButton, runButton, deleteButton);
    }

    item.append(head, metaLine, bodyBlock, actions);
    return item;
  }));
};

pushScheduledTaskResultToChat = function pushScheduledTaskResultToChatDisabledFinal() {};

syncScheduledTaskDeliveries = function syncScheduledTaskDeliveriesDisabledFinal(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return;
  }
  tasks.forEach((task) => markScheduledTaskDelivery(task));
};

schedulerElements().qqPushEnabled?.addEventListener("change", renderScheduledTaskQqPushFormState);
renderScheduledTaskQqPushFormState();
persistLockedQqPublicSettingsRecord();
renderQqPublicSummaryMetaLocked();
renderQqPushMeta();
renderQqBotMeta();
renderQqToolPermissionMeta();
renderQqTargetProfileMeta();
loadScheduledTasksUI().catch(() => {});

renderScheduledTaskComposerSummary = function renderScheduledTaskComposerSummaryNoModelDisplayReallyFinal() {
  const { formSummary, cron } = getScheduledTaskWorkbenchElements();
  if (!formSummary) return;

  const cronText = String(cron?.value || "").trim() || "未填写";
  const pushText = buildScheduledTaskQqPushSummary(getScheduledTaskQqPushFormSettings()).replace(/^QQ 推送：/, "");
  formSummary.textContent = `Cron：${cronText} · QQ 推送：${pushText}`;
};

const renderScheduledTasksBeforeNoModelDisplayReallyFinal = renderScheduledTasks;
renderScheduledTasks = function renderScheduledTasksNoModelDisplayReallyFinal(tasks) {
  renderScheduledTasksBeforeNoModelDisplayReallyFinal(tasks);

  const { list } = getScheduledTaskWorkbenchElements();
  if (!list) return;

  list.querySelectorAll(".schedule-task-summary-grid .schedule-task-stat-card").forEach((card) => {
    const label = String(card.querySelector(".schedule-task-stat-label")?.textContent || "").trim();
    if (/模型|妯/.test(label)) {
      card.remove();
    }
  });
};

renderScheduledTaskComposerSummary();
loadScheduledTasksUI().catch(() => {});

renderScheduledTaskComposerSummary = function renderScheduledTaskComposerSummaryHideModelFinal() {
  const { formSummary, cron } = getScheduledTaskWorkbenchElements();
  if (!formSummary) return;

  const cronText = String(cron?.value || "").trim() || "未填写";
  const pushText = buildScheduledTaskQqPushSummary(getScheduledTaskQqPushFormSettings()).replace(/^QQ 推送：/, "");
  formSummary.textContent = `Cron：${cronText} · QQ 推送：${pushText}`;
};

const renderScheduledTasksBeforeHideModelFinal = renderScheduledTasks;
renderScheduledTasks = function renderScheduledTasksHideModelFinal(tasks) {
  renderScheduledTasksBeforeHideModelFinal(tasks);

  const { list } = getScheduledTaskWorkbenchElements();
  if (!list) return;

  list.querySelectorAll(".schedule-task-summary-grid .schedule-task-stat-card").forEach((card) => {
    const label = String(card.querySelector(".schedule-task-stat-label")?.textContent || "").trim();
    if (/模型|妯/.test(label)) {
      card.remove();
    }
  });
};

renderScheduledTaskComposerSummary();
loadScheduledTasksUI().catch(() => {});

renderScheduledTaskComposerSummary = function renderScheduledTaskComposerSummaryNoModelDisplayFinal() {
  const elements = typeof getScheduledTaskWorkbenchElements === "function"
    ? getScheduledTaskWorkbenchElements()
    : schedulerElements();
  const formSummary = elements?.formSummary || schedulerElements()?.formSummary;
  const cron = elements?.cron || schedulerElements()?.cron;
  if (!formSummary) return;

  const cronText = String(cron?.value || "").trim() || "未填写";
  const pushText = buildScheduledTaskQqPushSummary(getScheduledTaskQqPushFormSettings()).replace(/^QQ 推送：/, "");
  formSummary.textContent = `Cron：${cronText} · QQ 推送：${pushText}`;
};

const renderScheduledTasksBeforeNoModelDisplayFinal = renderScheduledTasks;
renderScheduledTasks = function renderScheduledTasksNoModelDisplayFinal(tasks) {
  renderScheduledTasksBeforeNoModelDisplayFinal(tasks);

  const list = (typeof getScheduledTaskWorkbenchElements === "function"
    ? getScheduledTaskWorkbenchElements()?.list
    : null) || schedulerElements()?.list;
  if (!list) return;

  list.querySelectorAll(".schedule-task-summary-grid .schedule-task-stat-card").forEach((card) => {
    const label = String(card.querySelector(".schedule-task-stat-label")?.textContent || "").trim();
    if (/模型|妯/.test(label)) {
      card.remove();
    }
  });
};

renderScheduledTaskComposerSummary();
loadScheduledTasksUI().catch(() => {});

renderScheduledTaskComposerSummary = function renderScheduledTaskComposerSummarySharedModelOnlyFinal() {
  const { formSummary, cron } = getScheduledTaskWorkbenchElements();
  if (!formSummary) return;
  const modelText = selectedModel() || "未选择";
  const cronText = String(cron?.value || "").trim() || "未填写";
  const pushText = buildScheduledTaskQqPushSummary(getScheduledTaskQqPushFormSettings()).replace(/^QQ 推送：/, "");
  formSummary.textContent = `基础连接模型：${modelText} · Cron：${cronText} · QQ 推送：${pushText}`;
};

const renderScheduledTasksBeforeSharedModelOnlyFinal = renderScheduledTasks;
renderScheduledTasks = function renderScheduledTasksSharedModelOnlyFinal(tasks) {
  renderScheduledTasksBeforeSharedModelOnlyFinal(tasks);

  const { list } = getScheduledTaskWorkbenchElements();
  if (!list) return;

  list.querySelectorAll(".schedule-task-summary-grid .schedule-task-stat-card").forEach((card) => {
    const label = String(card.querySelector(".schedule-task-stat-label")?.textContent || "").trim();
    if (label.includes("模型")) {
      card.remove();
    }
  });
};

renderScheduledTaskComposerSummary();
loadScheduledTasksUI().catch(() => {});

renderScheduledTaskComposerSummary = function renderScheduledTaskComposerSummaryWorkbenchFinal() {
  const { formSummary, cron } = schedulerElements();
  if (!formSummary) return;
  const modelText = selectedModel() || "未选择模型";
  const cronText = String(cron?.value || "").trim() || "未填写";
  const pushText = buildScheduledTaskQqPushSummary(getScheduledTaskQqPushFormSettings()).replace(/^QQ 推送：/, "");
  formSummary.textContent = `执行模型：${modelText} · Cron：${cronText} · QQ 推送：${pushText}`;
};

renderScheduledTasks = function renderScheduledTasksWorkbenchFinal(tasks) {
  const { list, meta } = schedulerElements();
  if (!list || !meta) return;

  if (!tasks.length) {
    meta.textContent = "当前还没有定时任务。";
    list.innerHTML = '<div class="file-empty">还没有定时任务。</div>';
    return;
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;
  const qqPushCount = tasks.filter((task) => task.qqPushEnabled).length;
  meta.textContent = `共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用，${qqPushCount} 个开启 QQ 推送。`;

  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement("div");
    item.className = "schedule-task-item";
    const isEditing = scheduledTaskEditorRuntime.editingId === task.id;
    if (isEditing) {
      item.classList.add("is-editing");
    }

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

    if (task.qqPushEnabled) {
      const pushBadge = document.createElement("span");
      pushBadge.className = "schedule-task-badge";
      pushBadge.textContent = "QQ 推送";
      badges.append(pushBadge);
    }

    head.append(title, badges);

    const metaLine = document.createElement("div");
    metaLine.className = "schedule-task-meta-line";
    metaLine.textContent = `上次执行：${formatScheduleTime(task.lastRunAt)} · 最近状态：${buildScheduledTaskResultStatusLabel(task)}`;

    const summaryGrid = document.createElement("div");
    summaryGrid.className = "schedule-task-summary-grid";
    summaryGrid.append(
      createScheduledTaskStatCard("执行模型", task.model || "未设置"),
      createScheduledTaskStatCard("执行计划", task.cronExpression || "未设置"),
      createScheduledTaskStatCard("下次执行", formatScheduleTime(task.nextRunAt)),
      createScheduledTaskStatCard("QQ 推送", buildScheduledTaskQqPushSummary(task).replace(/^QQ 推送：/, ""))
    );

    let bodyBlock;
    if (isEditing) {
      const draft = scheduledTaskEditorRuntime.drafts[task.id] || {
        cronExpression: String(task.cronExpression || "").trim(),
        prompt: String(task.prompt || ""),
        qqPushEnabled: Boolean(task.qqPushEnabled),
        qqTargetType: normalizeScheduledTaskQqTargetType(task.qqTargetType || "private"),
        qqTargetId: String(task.qqTargetId || "").trim(),
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
      promptText.textContent = "任务提示词";
      const promptInput = document.createElement("textarea");
      promptInput.rows = 6;
      promptInput.value = draft.prompt;
      promptInput.placeholder = "请输入任务执行时发给模型的内容";
      promptInput.addEventListener("input", (event) => {
        draft.prompt = event.target.value;
      });
      promptLabel.append(promptText, promptInput);

      const pushToggle = document.createElement("label");
      pushToggle.className = "toggle-row";
      const pushToggleText = document.createElement("span");
      pushToggleText.textContent = "推送到 QQ";
      const pushToggleInput = document.createElement("input");
      pushToggleInput.type = "checkbox";
      pushToggleInput.checked = Boolean(draft.qqPushEnabled);
      pushToggle.append(pushToggleText, pushToggleInput);

      const pushGrid = document.createElement("div");
      pushGrid.className = "schedule-task-editor-grid";

      const targetTypeLabel = document.createElement("label");
      const targetTypeText = document.createElement("span");
      targetTypeText.textContent = "推送对象类型";
      const targetTypeSelect = document.createElement("select");
      const privateOption = document.createElement("option");
      privateOption.value = "private";
      privateOption.textContent = "私聊";
      const groupOption = document.createElement("option");
      groupOption.value = "group";
      groupOption.textContent = "群聊";
      targetTypeSelect.append(privateOption, groupOption);
      targetTypeSelect.value = normalizeScheduledTaskQqTargetType(draft.qqTargetType || "private");
      targetTypeSelect.addEventListener("change", (event) => {
        draft.qqTargetType = normalizeScheduledTaskQqTargetType(event.target.value);
      });
      targetTypeLabel.append(targetTypeText, targetTypeSelect);

      const targetIdLabel = document.createElement("label");
      const targetIdText = document.createElement("span");
      targetIdText.textContent = "推送对象 ID";
      const targetIdInput = document.createElement("input");
      targetIdInput.type = "text";
      targetIdInput.value = draft.qqTargetId || "";
      targetIdInput.placeholder = "例如 QQ 号或群号";
      targetIdInput.addEventListener("input", (event) => {
        draft.qqTargetId = event.target.value;
      });
      targetIdLabel.append(targetIdText, targetIdInput);

      const syncDraftQqPushState = () => {
        applyScheduledTaskQqPushDisabledState(targetTypeSelect, targetIdInput, Boolean(draft.qqPushEnabled));
      };
      pushToggleInput.addEventListener("change", (event) => {
        draft.qqPushEnabled = Boolean(event.target.checked);
        syncDraftQqPushState();
      });
      syncDraftQqPushState();

      pushGrid.append(targetTypeLabel, targetIdLabel);
      editorHead.append(editorTitle, editorClose);
      editor.append(editorHead, cronLabel, promptLabel, pushToggle, pushGrid);
      bodyBlock = editor;
    } else {
      const bodyWrap = document.createElement("div");
      bodyWrap.className = "schedule-task-content";

      const promptSection = createScheduledTaskSection("任务内容", "schedule-task-prompt", task.prompt || "暂无内容");
      const pushSection = createScheduledTaskSection("推送配置", "schedule-task-push", buildScheduledTaskQqPushSummary(task));

      const resultPanel = document.createElement("details");
      resultPanel.className = "schedule-task-result-panel";
      if (task.lastStatus === "error") {
        resultPanel.open = true;
      }

      const resultSummary = document.createElement("summary");
      const resultSummaryCopy = document.createElement("div");
      resultSummaryCopy.className = "schedule-task-result-summary";

      const resultStatus = document.createElement("div");
      resultStatus.className = "schedule-task-result-status";
      resultStatus.textContent = buildScheduledTaskResultStatusLabel(task);

      const resultPreview = document.createElement("div");
      resultPreview.className = "schedule-task-result-preview";
      resultPreview.textContent = buildScheduledTaskResultPreview(task);

      const resultToggle = document.createElement("span");
      resultToggle.className = "schedule-task-result-toggle";
      resultToggle.textContent = "查看详情";

      const result = document.createElement("div");
      result.className = "schedule-task-result";
      result.textContent = buildScheduledTaskResultText(task);

      resultSummaryCopy.append(resultStatus, resultPreview);
      resultSummary.append(resultSummaryCopy, resultToggle);
      resultPanel.append(resultSummary, result);

      bodyWrap.append(promptSection, pushSection, resultPanel);
      bodyBlock = bodyWrap;
    }

    const actions = document.createElement("div");
    actions.className = "schedule-task-actions";

    if (isEditing) {
      actions.classList.add("is-editing");

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "primary-button";
      saveButton.textContent = "保存修改";
      saveButton.addEventListener("click", async () => {
        try {
          await saveInlineEditScheduledTask(task);
        } catch (error) {
          setStatus(`更新定时任务失败：${error.message}`);
        }
      });

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "ghost-button";
      cancelButton.textContent = "取消编辑";
      cancelButton.addEventListener("click", () => cancelInlineEditScheduledTask(task.id));

      actions.append(saveButton, cancelButton);
    } else {
      const runButton = document.createElement("button");
      runButton.type = "button";
      runButton.className = "primary-button";
      runButton.textContent = "立即执行";
      runButton.addEventListener("click", async () => {
        try {
          await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}/run`, { method: "POST" });
          await loadScheduledTasksUI();
          setStatus(`已执行定时任务：${task.name}`);
        } catch (error) {
          setStatus(`执行定时任务失败：${error.message}`);
        }
      });

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "ghost-button";
      editButton.textContent = "编辑配置";
      editButton.addEventListener("click", () => editScheduledTask(task));

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "ghost-button";
      toggleButton.textContent = task.enabled ? "暂停任务" : "启用任务";
      toggleButton.addEventListener("click", async () => {
        try {
          await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !task.enabled }),
          });
          await loadScheduledTasksUI();
          setStatus(`已更新定时任务：${task.name}`);
        } catch (error) {
          setStatus(`更新定时任务失败：${error.message}`);
        }
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "ghost-button";
      deleteButton.textContent = "删除任务";
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`确定删除定时任务“${task.name}”吗？`)) return;
        try {
          await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
          cancelInlineEditScheduledTask(task.id);
          await loadScheduledTasksUI();
          setStatus(`已删除定时任务：${task.name}`);
        } catch (error) {
          setStatus(`删除定时任务失败：${error.message}`);
        }
      });

      actions.append(runButton, editButton, toggleButton, deleteButton);
    }

    item.append(head, metaLine, summaryGrid, bodyBlock, actions);
    return item;
  }));
};

[schedulerElements().cron, schedulerElements().qqPushEnabled, schedulerElements().qqTargetType].forEach((el) => {
  el?.addEventListener("change", renderScheduledTaskComposerSummary);
});
schedulerElements().name?.addEventListener("input", renderScheduledTaskComposerSummary);
schedulerElements().cron?.addEventListener("input", renderScheduledTaskComposerSummary);
schedulerElements().qqTargetId?.addEventListener("input", renderScheduledTaskComposerSummary);
els.modelSelect?.addEventListener("change", renderScheduledTaskComposerSummary);

renderScheduledTaskComposerSummary();
loadScheduledTasksUI().catch(() => {});

const scheduledTaskWorkbenchRuntime = {
  editingId: null,
  expandedTaskIds: new Set(),
  tasksById: new Map(),
};

function getScheduledTaskWorkbenchElements() {
  const base = schedulerElements();
  return {
    ...base,
    formTitle: $("#schedule-task-form-title"),
    formDescription: $("#schedule-task-form-description"),
    cancelEditButton: $("#schedule-task-edit-cancel"),
    composePanel: document.querySelector(".scheduler-compose-panel"),
  };
}

function syncScheduledTaskWorkbenchComposerUi() {
  const { formTitle, formDescription, createButton, cancelEditButton } = getScheduledTaskWorkbenchElements();
  const editing = Boolean(scheduledTaskWorkbenchRuntime.editingId);
  if (formTitle) {
    formTitle.textContent = editing ? "编辑任务" : "新建任务";
  }
  if (formDescription) {
    formDescription.textContent = editing
      ? "当前正在编辑已有任务，保存后会直接覆盖原任务配置。"
      : "先配置执行内容，再决定是否推送到 QQ。";
  }
  if (createButton) {
    createButton.textContent = editing ? "编辑任务" : "创建任务";
  }
  if (cancelEditButton) {
    cancelEditButton.hidden = !editing;
  }
}

function fillScheduledTaskWorkbenchComposer(task = {}) {
  const { name, cron, prompt, qqPushEnabled, qqTargetType, qqTargetId } = getScheduledTaskWorkbenchElements();
  if (name) name.value = String(task.name || "");
  if (cron) cron.value = String(task.cronExpression || "");
  if (prompt) prompt.value = String(task.prompt || "");
  if (qqPushEnabled) qqPushEnabled.checked = Boolean(task.qqPushEnabled);
  if (qqTargetType) qqTargetType.value = normalizeScheduledTaskQqTargetType(task.qqTargetType || "private");
  if (qqTargetId) qqTargetId.value = String(task.qqTargetId || "");
  renderScheduledTaskQqPushFormState();
  renderScheduledTaskComposerSummary();
}

function resetScheduledTaskWorkbenchComposer() {
  scheduledTaskWorkbenchRuntime.editingId = null;
  const { name, cron, prompt, qqPushEnabled, qqTargetType, qqTargetId } = getScheduledTaskWorkbenchElements();
  if (name) name.value = "";
  if (cron) cron.value = "";
  if (prompt) prompt.value = "";
  if (qqPushEnabled) qqPushEnabled.checked = false;
  if (qqTargetType) qqTargetType.value = DEFAULT_QQ_PUSH_TARGET_TYPE;
  if (qqTargetId) qqTargetId.value = DEFAULT_QQ_PUSH_TARGET_ID;
  syncScheduledTaskWorkbenchComposerUi();
  renderScheduledTaskQqPushFormState();
  renderScheduledTaskComposerSummary();
}

function focusScheduledTaskWorkbenchComposer() {
  const { composePanel, name, prompt } = getScheduledTaskWorkbenchElements();
  composePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => {
    (prompt || name)?.focus?.();
  }, 140);
}

function toggleScheduledTaskWorkbenchDetails(taskId = "") {
  if (!taskId) return;
  if (scheduledTaskWorkbenchRuntime.expandedTaskIds.has(taskId)) {
    scheduledTaskWorkbenchRuntime.expandedTaskIds.delete(taskId);
  } else {
    scheduledTaskWorkbenchRuntime.expandedTaskIds.add(taskId);
  }
  loadScheduledTasksUI().catch(() => {});
}

editScheduledTask = async function editScheduledTaskWorkbenchFinal(task) {
  if (!task?.id) return;
  scheduledTaskWorkbenchRuntime.editingId = task.id;
  fillScheduledTaskWorkbenchComposer(task);
  syncScheduledTaskWorkbenchComposerUi();
  focusScheduledTaskWorkbenchComposer();
  loadScheduledTasksUI().catch(() => {});
};

createScheduledTask = async function createScheduledTaskWorkbenchFinal() {
  const { name, cron, prompt } = getScheduledTaskWorkbenchElements();
  const taskName = name?.value.trim() || "";
  const cronExpression = cron?.value.trim() || "";
  const taskPrompt = prompt?.value.trim() || "";
  const sharedModel = selectedModel();
  const qqPushSettings = getScheduledTaskQqPushFormSettings();

  if (!taskName) {
    setStatus("请输入任务标题");
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
  if (!sharedModel) {
    setStatus("请先在基础连接中选择模型");
    return;
  }
  if (!validateScheduledTaskQqPushSettings(qqPushSettings)) {
    return;
  }

  const payload = {
    name: taskName,
    prompt: taskPrompt,
    scheduleType: "cron",
    cronExpression,
    enabled: true,
    ...buildScheduledTaskQqPushPayload(qqPushSettings),
  };

  if (scheduledTaskWorkbenchRuntime.editingId) {
    const currentTask = scheduledTaskWorkbenchRuntime.tasksById.get(scheduledTaskWorkbenchRuntime.editingId);
    payload.enabled = currentTask ? Boolean(currentTask.enabled) : true;
    const response = await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(scheduledTaskWorkbenchRuntime.editingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const updatedTask = response?.task || response;
    if (hasScheduledTaskQqPushPersistenceMismatch(updatedTask, qqPushSettings)) {
      await loadScheduledTasksUI();
      setStatus("定时任务已更新，但 QQ 推送配置没有落盘。请重启 node server.js 后重新保存。");
      return;
    }
    scheduledTaskWorkbenchRuntime.expandedTaskIds.add(scheduledTaskWorkbenchRuntime.editingId);
    const editedName = taskName;
    resetScheduledTaskWorkbenchComposer();
    await loadScheduledTasksUI();
    setStatus(`已更新定时任务：${editedName}`);
    return;
  }

  const response = await schedulerRequest("/scheduler/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const createdTask = response?.task || response;
  if (hasScheduledTaskQqPushPersistenceMismatch(createdTask, qqPushSettings)) {
    await loadScheduledTasksUI();
    setStatus("定时任务已创建，但 QQ 推送配置没有落盘。请重启 node server.js 后重新保存或重建任务。");
    return;
  }

  if (createdTask?.id) {
    scheduledTaskWorkbenchRuntime.expandedTaskIds.add(createdTask.id);
  }
  resetScheduledTaskWorkbenchComposer();
  await loadScheduledTasksUI();
  setStatus(`已创建定时任务：${taskName}`);
};

renderScheduledTasks = function renderScheduledTasksWorkbenchCompactFinal(tasks) {
  const { list, meta } = getScheduledTaskWorkbenchElements();
  if (!list || !meta) return;

  if (!tasks.length) {
    meta.textContent = "当前还没有定时任务。";
    list.innerHTML = '<div class="file-empty">还没有定时任务。</div>';
    return;
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;
  const qqPushCount = tasks.filter((task) => task.qqPushEnabled).length;
  scheduledTaskWorkbenchRuntime.tasksById = new Map(tasks.map((task) => [task.id, task]));
  meta.textContent = `共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用，${qqPushCount} 个开启 QQ 推送。`;

  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement("div");
    item.className = "schedule-task-item";
    if (scheduledTaskWorkbenchRuntime.editingId === task.id) {
      item.classList.add("is-editing");
    }

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
    if (task.qqPushEnabled) {
      const pushBadge = document.createElement("span");
      pushBadge.className = "schedule-task-badge";
      pushBadge.textContent = "QQ 推送";
      badges.append(pushBadge);
    }
    head.append(title, badges);

    const metaLine = document.createElement("div");
    metaLine.className = "schedule-task-meta-line";
    metaLine.textContent = `下次执行：${formatScheduleTime(task.nextRunAt)} · 上次执行：${formatScheduleTime(task.lastRunAt)}`;

    const summaryGrid = document.createElement("div");
    summaryGrid.className = "schedule-task-summary-grid";
    summaryGrid.append(
      createScheduledTaskStatCard("执行模型", task.model || "未设置"),
      createScheduledTaskStatCard("最近状态", buildScheduledTaskResultStatusLabel(task)),
      createScheduledTaskStatCard("执行计划", task.cronExpression || "未设置"),
      createScheduledTaskStatCard("QQ 推送", buildScheduledTaskQqPushSummary(task).replace(/^QQ 推送：/, ""))
    );

    const expanded = scheduledTaskWorkbenchRuntime.expandedTaskIds.has(task.id);
    let detailsBlock = null;
    if (expanded) {
      const content = document.createElement("div");
      content.className = "schedule-task-content";
      content.append(
        createScheduledTaskSection("任务内容", "schedule-task-prompt", task.prompt || "暂无内容"),
        createScheduledTaskSection("推送配置", "schedule-task-push", buildScheduledTaskQqPushSummary(task))
      );

      const resultPanel = document.createElement("details");
      resultPanel.className = "schedule-task-result-panel";
      if (task.lastStatus === "error") {
        resultPanel.open = true;
      }

      const resultSummary = document.createElement("summary");
      const resultSummaryCopy = document.createElement("div");
      resultSummaryCopy.className = "schedule-task-result-summary";

      const resultStatus = document.createElement("div");
      resultStatus.className = "schedule-task-result-status";
      resultStatus.textContent = buildScheduledTaskResultStatusLabel(task);

      const resultPreview = document.createElement("div");
      resultPreview.className = "schedule-task-result-preview";
      resultPreview.textContent = buildScheduledTaskResultPreview(task);

      const resultToggle = document.createElement("span");
      resultToggle.className = "schedule-task-result-toggle";
      resultToggle.textContent = "查看结果";

      const result = document.createElement("div");
      result.className = "schedule-task-result";
      result.textContent = buildScheduledTaskResultText(task);

      resultSummaryCopy.append(resultStatus, resultPreview);
      resultSummary.append(resultSummaryCopy, resultToggle);
      resultPanel.append(resultSummary, result);
      content.append(resultPanel);
      detailsBlock = content;
    }

    const actions = document.createElement("div");
    actions.className = "schedule-task-actions";

    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "ghost-button schedule-task-action-button";
    detailButton.textContent = expanded ? "收起详情" : "查看详情";
    detailButton.addEventListener("click", () => toggleScheduledTaskWorkbenchDetails(task.id));

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "ghost-button schedule-task-action-button";
    editButton.textContent = "编辑任务";
    editButton.addEventListener("click", () => editScheduledTask(task));

    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "ghost-button schedule-task-action-button schedule-task-action-button-accent";
    runButton.textContent = "立即执行";
    runButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}/run`, { method: "POST" });
        scheduledTaskWorkbenchRuntime.expandedTaskIds.add(task.id);
        await loadScheduledTasksUI();
        setStatus(`已执行定时任务：${task.name}`);
      } catch (error) {
        setStatus(`执行定时任务失败：${error.message}`);
      }
    });

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "ghost-button schedule-task-action-button";
    toggleButton.textContent = task.enabled ? "暂停任务" : "启用任务";
    toggleButton.addEventListener("click", async () => {
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !task.enabled }),
        });
        await loadScheduledTasksUI();
        setStatus(`已更新定时任务：${task.name}`);
      } catch (error) {
        setStatus(`更新定时任务失败：${error.message}`);
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost-button schedule-task-action-button";
    deleteButton.textContent = "删除任务";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`确定删除定时任务“${task.name}”吗？`)) return;
      try {
        await schedulerRequest(`/scheduler/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
        scheduledTaskWorkbenchRuntime.expandedTaskIds.delete(task.id);
        if (scheduledTaskWorkbenchRuntime.editingId === task.id) {
          resetScheduledTaskWorkbenchComposer();
        }
        await loadScheduledTasksUI();
        setStatus(`已删除定时任务：${task.name}`);
      } catch (error) {
        setStatus(`删除定时任务失败：${error.message}`);
      }
    });

    actions.append(editButton, detailButton, runButton, toggleButton, deleteButton);

    item.append(head, metaLine, summaryGrid);
    if (detailsBlock) {
      item.append(detailsBlock);
    }
    item.append(actions);
    return item;
  }));
};

getScheduledTaskWorkbenchElements().cancelEditButton?.addEventListener("click", () => {
  resetScheduledTaskWorkbenchComposer();
  loadScheduledTasksUI().catch(() => {});
});

syncScheduledTaskWorkbenchComposerUi();
renderScheduledTaskComposerSummary();
loadScheduledTasksUI().catch(() => {});

const SHARED_CONNECTION_CONFIG_ENDPOINT = "/connection-config";
const sharedConnectionModelRuntime = {
  applyingRemoteModel: false,
  lastKnownModel: "",
};
let sharedConnectionConfigSaveTimer = null;

function getRemoteApiEnabled() {
  return String(els.remoteApiEnabled?.value || "false") === "true";
}

function renderRemoteConnectionMeta() {
  if (!els.remoteConnectionMeta) return;
  if (!getRemoteApiEnabled()) {
    els.remoteConnectionMeta.textContent = "默认使用本地模型服务；仅在启用远程 API 后切换到远程代理。";
    return;
  }
  const remoteBaseUrl = els.remoteBaseUrl?.value?.trim() || "(未填写)";
  const remoteApiPath = els.remoteApiPath?.value?.trim() || "/v1/chat/completions";
  const remoteModelsPath = els.remoteModelsPath?.value?.trim() || "/v1/models";
  els.remoteConnectionMeta.textContent = `当前已启用远程 API：${remoteBaseUrl} ｜ chat=${remoteApiPath} ｜ models=${remoteModelsPath}`;
}

function buildSharedConnectionConfigPayload({ includeModel = true } = {}) {
  const payload = {
    remoteApiEnabled: getRemoteApiEnabled(),
    remoteBaseUrl: els.remoteBaseUrl?.value?.trim() || "",
    remoteApiPath: els.remoteApiPath?.value?.trim() || "/v1/chat/completions",
    remoteModelsPath: els.remoteModelsPath?.value?.trim() || "/v1/models",
    remoteApiKey: els.remoteApiKey?.value?.trim() || "",
  };
  if (includeModel) {
    payload.model = selectedModel();
  }
  return payload;
}

function ensureSharedConnectionModelOption(modelName = "") {
  const normalized = String(modelName || "").trim();
  if (!normalized || !els.modelSelect) return;
  const hasOption = Array.from(els.modelSelect.options || []).some((option) => option.value === normalized);
  if (hasOption) return;
  const option = document.createElement("option");
  option.value = normalized;
  option.textContent = normalized;
  els.modelSelect.append(option);
}

function applySharedConnectionModelToUi(modelName = "", { persistLocal = true } = {}) {
  const normalized = String(modelName || "").trim();
  if (!normalized || !els.modelSelect) return false;
  if (selectedModel() === normalized) {
    sharedConnectionModelRuntime.lastKnownModel = normalized;
    return true;
  }
  sharedConnectionModelRuntime.applyingRemoteModel = true;
  try {
    ensureSharedConnectionModelOption(normalized);
    els.modelSelect.value = normalized;
    applyContextLimitForModel(normalized);
    if (persistLocal) {
      save();
    } else {
      renderModelMeta();
      refreshMetrics();
    }
    renderQqBotMeta();
    renderQqToolPermissionMeta();
    sharedConnectionModelRuntime.lastKnownModel = normalized;
    return true;
  } finally {
    sharedConnectionModelRuntime.applyingRemoteModel = false;
  }
}

async function persistSharedConnectionModelToServer(modelName = selectedModel(), { quiet = false } = {}) {
  const normalized = String(modelName || "").trim();
  try {
    const response = await j(SHARED_CONNECTION_CONFIG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...buildSharedConnectionConfigPayload({ includeModel: false }),
        model: normalized,
      }),
    });
    const savedModel = String(response?.config?.model || normalized).trim() || normalized;
    sharedConnectionModelRuntime.lastKnownModel = savedModel;
    if (els.remoteApiEnabled) els.remoteApiEnabled.value = response?.config?.remoteApiEnabled ? "true" : "false";
    if (els.remoteBaseUrl) els.remoteBaseUrl.value = String(response?.config?.remoteBaseUrl || "");
    if (els.remoteApiPath) els.remoteApiPath.value = String(response?.config?.remoteApiPath || "/v1/chat/completions");
    if (els.remoteModelsPath) els.remoteModelsPath.value = String(response?.config?.remoteModelsPath || "/v1/models");
    if (els.remoteApiKey) els.remoteApiKey.value = String(response?.config?.remoteApiKey || "");
    renderRemoteConnectionMeta();
    return savedModel;
  } catch (error) {
    if (!quiet) {
      setStatus(`同步基础连接模型失败：${String(error?.message || "未知错误")}`, "error");
    }
    throw error;
  }
}

function queueSharedConnectionConfigSave() {
  if (sharedConnectionConfigSaveTimer) {
    clearTimeout(sharedConnectionConfigSaveTimer);
  }
  sharedConnectionConfigSaveTimer = setTimeout(() => {
    persistSharedConnectionModelToServer(selectedModel(), { quiet: false }).catch(() => {});
  }, 300);
}

async function syncSharedConnectionModelFromServer({ quiet = true } = {}) {
  try {
    const response = await j(SHARED_CONNECTION_CONFIG_ENDPOINT);
    if (els.remoteApiEnabled) els.remoteApiEnabled.value = response?.config?.remoteApiEnabled ? "true" : "false";
    if (els.remoteBaseUrl) els.remoteBaseUrl.value = String(response?.config?.remoteBaseUrl || "");
    if (els.remoteApiPath) els.remoteApiPath.value = String(response?.config?.remoteApiPath || "/v1/chat/completions");
    if (els.remoteModelsPath) els.remoteModelsPath.value = String(response?.config?.remoteModelsPath || "/v1/models");
    if (els.remoteApiKey) els.remoteApiKey.value = String(response?.config?.remoteApiKey || "");
    renderRemoteConnectionMeta();
    const sharedModel = String(response?.config?.model || "").trim();
    if (sharedModel) {
      applySharedConnectionModelToUi(sharedModel, { persistLocal: true });
      return sharedModel;
    }
    const localModel = selectedModel();
    if (localModel) {
      return await persistSharedConnectionModelToServer(localModel, { quiet: true });
    }
    return "";
  } catch (error) {
    if (!quiet) {
      setStatus(`读取基础连接模型失败：${String(error?.message || "未知错误")}`, "error");
    }
    return "";
  }
}

els.modelSelect?.addEventListener("change", () => {
  if (sharedConnectionModelRuntime.applyingRemoteModel) {
    return;
  }
  persistSharedConnectionModelToServer(selectedModel(), { quiet: false }).catch(() => {});
});

[els.remoteApiEnabled, els.remoteBaseUrl, els.remoteApiPath, els.remoteModelsPath, els.remoteApiKey].forEach((el) => {
  el?.addEventListener("change", () => {
    renderRemoteConnectionMeta();
    queueSharedConnectionConfigSave();
  });
  el?.addEventListener("blur", () => {
    renderRemoteConnectionMeta();
    queueSharedConnectionConfigSave();
  });
});

window.addEventListener("focus", () => {
  syncSharedConnectionModelFromServer({ quiet: true }).catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  syncSharedConnectionModelFromServer({ quiet: true }).catch(() => {});
});

syncSharedConnectionModelFromServer({ quiet: true }).catch(() => {});
renderRemoteConnectionMeta();

function seemsNaturalScheduledTaskIntentText(text = "") {
  const source = String(text || "").trim();
  if (!source) return false;
  return /(定时任务|任务列表|cron|schedule|提醒|通知|每天|每日|每周|每星期|工作日)/i.test(source);
}

async function tryHandleScheduledTaskIntentFromNaturalText(text = "") {
  const source = String(text || "").trim();
  if (!source || !seemsNaturalScheduledTaskIntentText(source)) {
    return null;
  }

  try {
    const data = await schedulerRequest("/scheduler/intent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: source,
        model: selectedModel(),
      }),
    });
    return data?.intent ? data : null;
  } catch (error) {
    if (error.status === 400) {
      return null;
    }
    throw error;
  }
}

function clampScheduledTaskChatText(value = "", maxLength = 48) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildScheduledTaskChatStateLabel(task = {}) {
  if (task?.running) return "运行中";
  if (task?.enabled === false) return "已暂停";
  return "已启用";
}

function buildScheduledTaskChatPreviewItems(tasks = [], limit = 4) {
  return (Array.isArray(tasks) ? tasks : []).slice(0, Math.max(Number(limit) || 4, 0)).map((task, index) => {
    const metaParts = [
      buildScheduledTaskChatStateLabel(task),
      task?.cronExpression ? `Cron ${String(task.cronExpression || "").trim()}` : "",
      task?.qqPushEnabled ? buildScheduledTaskQqPushSummary(task).replace(/^QQ 推送：/, "") : "未推送到 QQ",
    ].filter(Boolean);

    return {
      indexLabel: `#${index + 1}`,
      title: clampScheduledTaskChatText(task?.name || "未命名任务", 28),
      meta: metaParts.join(" · "),
    };
  });
}

function buildScheduledTaskIntentChatPayload(directScheduledTaskResult = {}, refreshedTasks = []) {
  const intent = directScheduledTaskResult?.intent || {};
  const result = directScheduledTaskResult?.result || {};
  const action = String(intent?.action || "").trim();
  const sourceTasks = Array.isArray(refreshedTasks) && refreshedTasks.length
    ? refreshedTasks
    : (Array.isArray(result?.tasks) ? result.tasks : []);
  const totalCount = sourceTasks.length;
  const enabledCount = sourceTasks.filter((task) => task?.enabled).length;
  const task = action === "list"
    ? null
    : (result && typeof result === "object" && !Array.isArray(result?.tasks) ? result : (directScheduledTaskResult?.task || intent?.task || {}));
  const taskName = clampScheduledTaskChatText(task?.name || intent?.task?.name || "未命名任务", 36);
  const cronExpression = String(task?.cronExpression || intent?.args?.cronExpression || "").trim();
  const tone = action === "delete" ? "is-neutral" : (task?.lastStatus === "error" ? "is-danger" : "is-success");
  const chips = [];

  if (cronExpression) {
    chips.push({ label: "Cron", value: cronExpression });
  }
  if (action && action !== "list" && action !== "delete" && (typeof task?.enabled === "boolean" || task?.running)) {
    chips.push({ label: "状态", value: buildScheduledTaskChatStateLabel(task) });
  }
  if (task?.qqPushEnabled) {
    chips.push({ label: "QQ 推送", value: formatScheduledTaskQqTargetLabel(task.qqTargetType, task.qqTargetId) });
  }
  if (task?.creatorId) {
    chips.push({ label: "创建者", value: buildScheduledTaskCreatorLabel(task) });
  }
  if (totalCount) {
    chips.push({ label: "当前任务", value: `${totalCount} 个` });
  }

  let title = "定时任务已处理";
  let subtitle = taskName;
  let footer = totalCount
    ? `右侧任务面板已同步刷新。当前共有 ${totalCount} 个任务，其中 ${enabledCount} 个已启用。`
    : "右侧任务面板已同步刷新。";
  let previewItems = [];
  let text = String(directScheduledTaskResult?.message || "").trim();

  switch (action) {
    case "create":
      title = "已创建定时任务";
      text = `已创建定时任务：${taskName}${cronExpression ? `。Cron：${cronExpression}` : ""}。${footer}`;
      break;
    case "update":
      title = "已更新定时任务";
      text = `已更新定时任务：${taskName}${cronExpression ? `。Cron：${cronExpression}` : ""}。${footer}`;
      break;
    case "delete":
      title = "已删除定时任务";
      footer = totalCount
        ? `右侧任务面板已同步刷新。删除后当前还剩 ${totalCount} 个任务。`
        : "右侧任务面板已同步刷新。";
      text = `已删除定时任务：${taskName}。${footer}`;
      break;
    case "enable":
      title = "已启用定时任务";
      text = `已启用定时任务：${taskName}。${footer}`;
      break;
    case "disable":
      title = "已暂停定时任务";
      text = `已暂停定时任务：${taskName}。${footer}`;
      break;
    case "run": {
      const runStatus = task?.lastStatus === "error"
        ? `执行失败：${clampScheduledTaskChatText(task?.lastError || "任务执行失败", 64)}`
        : buildScheduledTaskResultStatusLabel(task);
      title = "已执行定时任务";
      chips.push({ label: "结果", value: runStatus, accent: task?.lastStatus === "error" ? "is-danger" : "is-success" });
      footer = task?.lastStatus === "error"
        ? clampScheduledTaskChatText(task?.lastError || "任务执行失败", 80)
        : `右侧任务面板已同步刷新。${totalCount ? `当前共有 ${totalCount} 个任务。` : ""}`;
      text = `已执行定时任务：${taskName}。${runStatus}。`;
      break;
    }
    case "list":
      title = totalCount ? `当前共有 ${totalCount} 个定时任务` : "当前还没有定时任务";
      subtitle = totalCount ? `其中 ${enabledCount} 个已启用` : "可以在右侧面板新建任务";
      previewItems = buildScheduledTaskChatPreviewItems(sourceTasks, 4);
      footer = totalCount > previewItems.length
        ? `聊天里只展示前 ${previewItems.length} 项，完整列表请看右侧任务面板。`
        : "右侧任务面板已同步刷新。";
      text = totalCount
        ? `已刷新定时任务列表。当前共有 ${totalCount} 个任务，其中 ${enabledCount} 个已启用。`
        : "当前还没有定时任务。";
      break;
    default:
      text = text || "定时任务操作已完成。";
      break;
  }

  return {
    text,
    renderType: "scheduled-task-reply",
    renderMeta: {
      tone,
      title,
      subtitle,
      chips,
      previewItems,
      footer,
    },
  };
}

const askModelBeforeServerScheduledTaskIntent = askModel;
askModel = async function askModelWithServerScheduledTaskIntent(userText) {
  const directScheduledTaskResult = await tryHandleScheduledTaskIntentFromNaturalText(userText);
  if (directScheduledTaskResult?.intent) {
    const refreshedTasks = await loadScheduledTasksUI().catch(() => []);
    const summaryPayload = buildScheduledTaskIntentChatPayload(directScheduledTaskResult, refreshedTasks);
    const summary = String(summaryPayload.text || "").trim() || "定时任务操作已完成。";
    const messageTimestamp = Date.now();
    state.lastRequestedUserText = userText || "";
    state.messages.push(
      { role: "user", content: userText || "请继续处理", timestamp: messageTimestamp },
      {
        role: "assistant",
        content: summary,
        renderType: summaryPayload.renderType,
        renderMeta: summaryPayload.renderMeta,
        timestamp: Date.now(),
      }
    );
    save();
    refreshMetrics();
    autoSaveCurrentChat();
    return summary;
  }

  return askModelBeforeServerScheduledTaskIntent(userText);
};

function parseNaturalSequenceIndex(token = "") {
  const source = String(token || "").trim();
  if (!source) return 0;
  if (/^\d+$/.test(source)) {
    return Number(source);
  }

  const digitMap = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (source === "十") {
    return 10;
  }
  if (source.includes("十")) {
    const [tensToken, unitsToken] = source.split("十");
    const tens = tensToken ? (digitMap[tensToken] || 0) : 1;
    const units = unitsToken ? (digitMap[unitsToken] || 0) : 0;
    return tens * 10 + units;
  }
  return digitMap[source] || 0;
}

function normalizeNaturalLookupValue(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function fetchAvailableModelIdsForChatCommand() {
  const data = await j(modelsEndpoint());
  return (data?.data || []).map((item) => String(item?.id || "").trim()).filter(Boolean);
}

async function ensurePersonaPresetsForChatCommand() {
  if (!workspacePersonaPresets.length) {
    await loadWorkspacePersonaPresets();
  }
  return allPersonaPresets()
    .filter((preset) => preset && preset.id !== "none")
    .map((preset) => ({ ...preset }));
}

function resolveModelCommandIntent(text = "") {
  const source = String(text || "").trim();
  if (!source) return null;

  const switchByIndex = source.match(/(?:切|切换|更换|改用|使用)\s*第\s*([0-9]+|[一二两三四五六七八九十]{1,3})\s*个模型/i);
  if (switchByIndex) {
    return { action: "switch_by_index", index: parseNaturalSequenceIndex(switchByIndex[1]) };
  }

  const switchByValue = source.match(/(?:切换|更换|改用|使用)(?:当前)?模型[:：\s]+(.+)$/i);
  if (switchByValue) {
    const target = String(switchByValue[1] || "").trim();
    if (/^\d+$/.test(target)) {
      return { action: "switch_by_index", index: Number(target) };
    }
    return target ? { action: "switch_by_name", target } : null;
  }

  if (/(?:当前|现在|正在使用).{0,4}模型/i.test(source)) {
    return { action: "current" };
  }

  if (/(?:查看|列出|显示|看看|查询).*(?:模型列表|模型)|模型列表|有哪些模型/i.test(source)) {
    return { action: "list" };
  }

  return null;
}

function resolvePersonaCommandIntent(text = "") {
  const source = String(text || "").trim();
  if (!source) return null;

  if (/(?:恢复默认人设|恢复默认预设|清空人设|清空预设|不用人设|不使用预设)/i.test(source)) {
    return { action: "clear" };
  }

  const switchByIndex = source.match(/(?:切|切换|更换|改用|使用)\s*第\s*([0-9]+|[一二两三四五六七八九十]{1,3})\s*个(?:人设|预设)/i);
  if (switchByIndex) {
    return { action: "switch_by_index", index: parseNaturalSequenceIndex(switchByIndex[1]) };
  }

  const switchByValue = source.match(/(?:切换|更换|改用|使用)(?:当前)?(?:人设|预设)[:：\s]+(.+)$/i);
  if (switchByValue) {
    const target = String(switchByValue[1] || "").trim();
    if (/^\d+$/.test(target)) {
      return { action: "switch_by_index", index: Number(target) };
    }
    return target ? { action: "switch_by_name", target } : null;
  }

  if (/(?:当前|现在|正在使用).{0,4}(?:人设|预设)/i.test(source)) {
    return { action: "current" };
  }

  if (/(?:查看|列出|显示|看看|查询).*(?:人设列表|人设|预设列表|预设)|(?:人设|预设)列表|有哪些人设|有哪些预设/i.test(source)) {
    return { action: "list" };
  }

  return null;
}

function commitDirectChatAdminReply(userText = "", replyText = "") {
  const summary = String(replyText || "").trim();
  if (!summary) {
    return "";
  }

  const messageTimestamp = Date.now();
  state.lastRequestedUserText = userText || "";
  state.messages.push(
    { role: "user", content: userText || "请继续处理", timestamp: messageTimestamp },
    { role: "assistant", content: summary, timestamp: Date.now() }
  );
  save();
  refreshMetrics();
  autoSaveCurrentChat();
  return summary;
}

function buildCurrentPersonaSummary() {
  const presetId = String(els.personaPreset?.value || "none").trim() || "none";
  const selectedPreset = presetId !== "none"
    ? allPersonaPresets().find((preset) => preset.id === presetId)
    : null;
  const personaPrompt = String(els.personaPrompt?.value || "").trim();

  if (selectedPreset) {
    return `当前人设：${selectedPreset.name}`;
  }
  if (personaPrompt) {
    return `当前人设：自定义人设\n内容预览：${personaPrompt.slice(0, 120)}${personaPrompt.length > 120 ? "…" : ""}`;
  }
  return "当前人设：未设置";
}

async function tryHandleModelOrPersonaChatCommand(text = "") {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }

  const modelIntent = resolveModelCommandIntent(source);
  if (modelIntent) {
    if (modelIntent.action === "current") {
      return commitDirectChatAdminReply(source, `当前模型：${selectedModel() || "未选择"}`);
    }

    const models = await fetchAvailableModelIdsForChatCommand();
    if (!models.length) {
      return commitDirectChatAdminReply(source, "当前没有读取到可用模型。");
    }

    if (modelIntent.action === "list") {
      const currentModel = selectedModel();
      const summary = [
        `当前模型：${currentModel || "未选择"}`,
        "可用模型：",
        ...models.map((modelName, index) => `${index + 1}. ${modelName}${modelName === currentModel ? "（当前）" : ""}`),
      ].join("\n");
      return commitDirectChatAdminReply(source, summary);
    }

    let targetModel = "";
    if (modelIntent.action === "switch_by_index") {
      targetModel = models[modelIntent.index - 1] || "";
      if (!targetModel) {
        return commitDirectChatAdminReply(source, `没有找到第 ${modelIntent.index} 个模型。当前一共 ${models.length} 个模型。`);
      }
    } else if (modelIntent.action === "switch_by_name") {
      const normalizedTarget = normalizeNaturalLookupValue(modelIntent.target);
      const exactMatch = models.find((modelName) => normalizeNaturalLookupValue(modelName) === normalizedTarget);
      const fuzzyMatch = exactMatch || models.find((modelName) => normalizeNaturalLookupValue(modelName).includes(normalizedTarget));
      targetModel = fuzzyMatch || "";
      if (!targetModel) {
        return commitDirectChatAdminReply(source, `没有找到模型：${modelIntent.target}`);
      }
    }

    applySharedConnectionModelToUi(targetModel, { persistLocal: true });
    await persistSharedConnectionModelToServer(targetModel, { quiet: false });
    renderQqBotModelOptions?.();
    renderScheduledTaskComposerSummary?.();
    syncQqBotConfig?.().catch(() => {});
    return commitDirectChatAdminReply(source, `已切换模型：${targetModel}`);
  }

  const personaIntent = resolvePersonaCommandIntent(source);
  if (!personaIntent) {
    return null;
  }

  if (personaIntent.action === "current") {
    return commitDirectChatAdminReply(source, buildCurrentPersonaSummary());
  }

  if (personaIntent.action === "clear") {
    if (els.personaPreset) {
      els.personaPreset.value = "none";
      els.personaPreset.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (els.personaPrompt) {
      els.personaPrompt.value = "";
    }
    renderPersonaPresetDescription?.();
    renderConversationMiniheadMeta?.();
    save();
    refreshMetrics();
    return commitDirectChatAdminReply(source, "已恢复默认人设。");
  }

  const presets = await ensurePersonaPresetsForChatCommand();
  if (!presets.length) {
    return commitDirectChatAdminReply(source, "当前没有可切换的人设。");
  }

  if (personaIntent.action === "list") {
    const currentPresetId = String(els.personaPreset?.value || "none").trim() || "none";
    const summary = [
      buildCurrentPersonaSummary(),
      "可用人设：",
      ...presets.map((preset, index) => `${index + 1}. ${preset.name}${preset.id === currentPresetId ? "（当前）" : ""}`),
    ].join("\n");
    return commitDirectChatAdminReply(source, summary);
  }

  let targetPreset = null;
  if (personaIntent.action === "switch_by_index") {
    targetPreset = presets[personaIntent.index - 1] || null;
    if (!targetPreset) {
      return commitDirectChatAdminReply(source, `没有找到第 ${personaIntent.index} 个人设。当前一共 ${presets.length} 个人设。`);
    }
  } else if (personaIntent.action === "switch_by_name") {
    const normalizedTarget = normalizeNaturalLookupValue(personaIntent.target);
    const exactMatch = presets.find((preset) => normalizeNaturalLookupValue(preset.name) === normalizedTarget || normalizeNaturalLookupValue(preset.id) === normalizedTarget);
    targetPreset = exactMatch || presets.find((preset) => {
      const normalizedName = normalizeNaturalLookupValue(preset.name);
      const normalizedId = normalizeNaturalLookupValue(preset.id);
      return normalizedName.includes(normalizedTarget) || normalizedId.includes(normalizedTarget);
    }) || null;
    if (!targetPreset) {
      return commitDirectChatAdminReply(source, `没有找到人设：${personaIntent.target}`);
    }
  }

  if (els.personaPreset) {
    els.personaPreset.value = targetPreset.id;
    els.personaPreset.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (els.personaPrompt && targetPreset.prompt) {
    els.personaPrompt.value = targetPreset.prompt;
  }
  renderPersonaPresetDescription?.();
  renderConversationMiniheadMeta?.();
  save();
  refreshMetrics();
  return commitDirectChatAdminReply(source, `已切换人设：${targetPreset.name}`);
}

const askModelBeforeWebAdminCommandFinal = askModel;
askModel = async function askModelWithWebAdminCommandFinal(userText) {
  const directAdminReply = await tryHandleModelOrPersonaChatCommand(userText);
  if (directAdminReply) {
    return directAdminReply;
  }
  return askModelBeforeWebAdminCommandFinal(userText);
};

renderConversationMiniheadMeta = function renderConversationMiniheadMetaModelPersonaOnlyFinal() {
  if (!els.conversationMiniheadText) return;
  const modelText = selectedModel() || "未选择模型";
  const personaContent = String(els.personaPrompt?.value || "").trim();
  const personaPresetId = els.personaPreset?.value || "none";
  const personaPresetName = personaPresetId !== "none"
    ? String(els.personaPreset?.selectedOptions?.[0]?.textContent || "").trim()
    : "";
  const personaText = personaPresetName || (personaContent ? "自定义人设" : "无人设");
  const personaMarkup = `<span class="minihead-meta-value${personaContent ? " is-hoverable" : ""}"${personaContent ? ` title="${esc(personaContent)}"` : ""}>${esc(personaText)}</span>`;
  els.conversationMiniheadText.innerHTML = [
    `<span class="minihead-meta-item"><span class="minihead-meta-label">模型</span><span class="minihead-meta-value">${esc(modelText)}</span></span>`,
    `<span class="minihead-meta-separator">·</span>`,
    `<span class="minihead-meta-item"><span class="minihead-meta-label">人设</span>${personaMarkup}</span>`,
  ].join("");
};

renderConversationMiniheadMeta();

function buildScheduledTaskTimestampMetaText(task = {}) {
  return `创建：${formatScheduleTime(task.createdAt)} · 最后修改：${formatScheduleTime(task.updatedAt)} · 上次执行：${formatScheduleTime(task.lastRunAt)}`;
}

function buildScheduledTaskTimestampDetailText(task = {}) {
  return [
    `创建：${formatScheduleTime(task.createdAt)}`,
    `最后修改：${formatScheduleTime(task.updatedAt)}`,
    `下次执行：${formatScheduleTime(task.nextRunAt)}`,
    `上次执行：${formatScheduleTime(task.lastRunAt)}`,
  ].join("\n");
}

const renderScheduledTasksBeforeTimestampMetaFinal = renderScheduledTasks;
renderScheduledTasks = function renderScheduledTasksWithTimestampMetaFinal(tasks) {
  renderScheduledTasksBeforeTimestampMetaFinal(tasks);

  const { list } = getScheduledTaskWorkbenchElements();
  if (!list || !Array.isArray(tasks) || !tasks.length) {
    return;
  }

  const items = Array.from(list.querySelectorAll(".schedule-task-item"));
  items.forEach((item, index) => {
    const task = tasks[index];
    if (!task) return;

    const metaLine = item.querySelector(".schedule-task-meta-line");
    if (metaLine) {
      metaLine.textContent = buildScheduledTaskTimestampMetaText(task);
    }

    const summaryGrid = item.querySelector(".schedule-task-summary-grid");
    if (summaryGrid && !summaryGrid.querySelector('[data-schedule-stat="next-run"]')) {
      const nextRunCard = createScheduledTaskStatCard("下次执行", formatScheduleTime(task.nextRunAt));
      nextRunCard.dataset.scheduleStat = "next-run";
      const qqPushCard = summaryGrid.lastElementChild;
      if (qqPushCard) {
        summaryGrid.insertBefore(nextRunCard, qqPushCard);
      } else {
        summaryGrid.append(nextRunCard);
      }
    }

    const content = item.querySelector(".schedule-task-content");
    if (content && !content.querySelector(".schedule-task-time-info-section")) {
      const timeSection = createScheduledTaskSection("时间信息", "schedule-task-push", buildScheduledTaskTimestampDetailText(task));
      timeSection.classList.add("schedule-task-time-info-section");
      const resultPanel = content.querySelector(".schedule-task-result-panel");
      if (resultPanel) {
        content.insertBefore(timeSection, resultPanel);
      } else {
        content.append(timeSection);
      }
    }
  });
};

loadScheduledTasksUI().catch(() => {});

renderScheduledTaskComposerSummary = function renderScheduledTaskComposerSummaryNoModelDisplayTailFinal() {
  const { formSummary, cron } = getScheduledTaskWorkbenchElements();
  if (!formSummary) return;

  const cronText = String(cron?.value || "").trim() || "未填写";
  const pushText = buildScheduledTaskQqPushSummary(getScheduledTaskQqPushFormSettings()).replace(/^QQ 推送：/, "");
  formSummary.textContent = `Cron：${cronText} · QQ 推送：${pushText}`;
};

const renderScheduledTasksBeforeNoModelDisplayTailFinal = renderScheduledTasks;
renderScheduledTasks = function renderScheduledTasksNoModelDisplayTailFinal(tasks) {
  renderScheduledTasksBeforeNoModelDisplayTailFinal(tasks);

  const { list } = getScheduledTaskWorkbenchElements();
  if (!list) return;

  list.querySelectorAll(".schedule-task-summary-grid .schedule-task-stat-card").forEach((card) => {
    const label = String(card.querySelector(".schedule-task-stat-label")?.textContent || "").trim();
    if (/模型|妯/.test(label)) {
      card.remove();
    }
  });
};

renderScheduledTaskComposerSummary();
loadScheduledTasksUI().catch(() => {});

function buildScheduledTaskTimestampMetaText(task = {}) {
  return `\u4e0b\u6b21\u6267\u884c\uff1a${formatScheduleTime(task.nextRunAt)} \u00b7 \u4e0a\u6b21\u6267\u884c\uff1a${formatScheduleTime(task.lastRunAt)}`;
}

function buildScheduledTaskTimestampDetailText(task = {}) {
  return [
    `\u4e0b\u6b21\u6267\u884c\uff1a${formatScheduleTime(task.nextRunAt)}`,
    `\u4e0a\u6b21\u6267\u884c\uff1a${formatScheduleTime(task.lastRunAt)}`,
  ].join("\n");
}

function buildScheduledTaskCreatorLabel(task = {}) {
  const creatorType = String(task?.creatorType || "").trim().toLowerCase() === "group" ? "群" : "QQ";
  const creatorId = String(task?.creatorId || "").trim() || "1036986718";
  return `${creatorType} ${creatorId}`;
}

function getScheduledTaskCreatorFilterScope() {
  const elements = typeof getScheduledTaskWorkbenchElements === "function"
    ? getScheduledTaskWorkbenchElements()
    : schedulerElements();
  const creatorType = normalizeScheduledTaskQqTargetType(elements?.qqTargetType?.value || "private");
  const creatorId = String(elements?.qqTargetId?.value || "").trim();
  const includeAll = !creatorId || creatorId === "1036986718";
  return {
    creatorType,
    creatorId,
    includeAll,
  };
}

const loadScheduledTasksUIBeforeCreatorFilterFinal = loadScheduledTasksUI;
loadScheduledTasksUI = async function loadScheduledTasksUICreatorFilterFinal(options = {}) {
  const { meta, list } = schedulerElements();
  try {
    const scope = getScheduledTaskCreatorFilterScope();
    const query = (!scope.includeAll && scope.creatorId)
      ? `?creatorType=${encodeURIComponent(scope.creatorType)}&creatorId=${encodeURIComponent(scope.creatorId)}`
      : "";
    const data = await schedulerRequest(`/scheduler/tasks${query}`);
    const tasks = data.tasks || [];
    renderScheduledTasks(tasks);
    syncScheduledTaskDeliveries(tasks, options);
    return tasks;
  } catch (error) {
    if (error.status === 404) {
      if (meta) meta.textContent = "当前服务暂未启用定时任务接口，重启 node server.js 后可用。";
      if (list) list.innerHTML = '<div class="file-empty">当前运行中的服务版本还不支持定时任务，请重启服务。</div>';
      return [];
    }
    throw error;
  }
};

const renderScheduledTasksBeforeCreatorFinal = renderScheduledTasks;
renderScheduledTasks = function renderScheduledTasksWithCreatorFinal(tasks) {
  renderScheduledTasksBeforeCreatorFinal(tasks);

  const { list, meta } = typeof getScheduledTaskWorkbenchElements === "function"
    ? getScheduledTaskWorkbenchElements()
    : schedulerElements();
  if (!list || !meta || !Array.isArray(tasks)) return;

  const scope = getScheduledTaskCreatorFilterScope();
  const scopeText = scope.includeAll ? "全部任务" : `${scope.creatorType === "group" ? "群" : "QQ"} ${scope.creatorId}`;
  if (tasks.length) {
    const enabledCount = tasks.filter((task) => task.enabled).length;
    const qqPushCount = tasks.filter((task) => task.qqPushEnabled).length;
    meta.textContent = `当前范围：${scopeText} · 共 ${tasks.length} 个任务，其中 ${enabledCount} 个已启用，${qqPushCount} 个开启 QQ 推送。`;
  } else {
    meta.textContent = `当前范围：${scopeText} · 当前还没有定时任务。`;
  }

  const items = Array.from(list.querySelectorAll(".schedule-task-item"));
  items.forEach((item, index) => {
    const task = tasks[index];
    if (!task) return;

    const summaryGrid = item.querySelector(".schedule-task-summary-grid");
    if (summaryGrid && !summaryGrid.querySelector('[data-schedule-stat="creator"]')) {
      const creatorCard = createScheduledTaskStatCard("创建者", buildScheduledTaskCreatorLabel(task));
      creatorCard.dataset.scheduleStat = "creator";
      summaryGrid.append(creatorCard);
    }

    const metaLine = item.querySelector(".schedule-task-meta-line");
    if (metaLine && !String(metaLine.textContent || "").includes("创建者")) {
      metaLine.textContent = `${String(metaLine.textContent || "").trim()} · 创建者：${buildScheduledTaskCreatorLabel(task)}`;
    }
  });
};

[
  schedulerElements().qqTargetType,
  schedulerElements().qqTargetId,
].forEach((el) => {
  el?.addEventListener("change", () => {
    loadScheduledTasksUI().catch(() => {});
  });
  el?.addEventListener("input", () => {
    loadScheduledTasksUI().catch(() => {});
  });
});

loadScheduledTasksUI().catch(() => {});
