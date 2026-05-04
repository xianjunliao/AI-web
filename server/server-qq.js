const fs = require("fs");
const path = require("path");
const { stripModelThinkingContent } = require("./server-utils");
const {
  inferScheduledTaskArgsFromText,
  inferScheduledTaskIntentFromText,
  formatScheduledTaskCreationReply,
  formatScheduledTaskActionReply,
} = require("./server-schedule-intent");
const { maybeRunDirectWebSearch } = require("./server-live-web-search");

function createQqModule(deps) {
  const {
    root,
    personaPresetsDir,
    qqBotConfigFile,
    qqBotSessionsFile,
    readJsonFile,
    writeJsonFileAtomic,
    readRequestBody,
    sendJson,
    requestJson,
    targetOrigin,
    getModelServiceConfig,
    executeToolCall,
    callLocalModelWithTools,
    getScheduledTasks,
    getSharedConnectionConfig,
    saveSharedConnectionConfig,
    logDebug,
    handleExternalCommand,
  } = deps;
  const DEFAULT_QQ_PUSH_TARGET_TYPE = "private";
  const DEFAULT_QQ_PUSH_TARGET_ID = "1036986718";
  // The public QQ settings UI no longer exposes an enable toggle, so keep the
  // webhook listener enabled by default and normalize persisted records to on.
  const QQ_BOT_PUBLIC_ENABLE_LOCKED = true;

  const DEFAULT_QQ_BOT_CONFIG = {
    enabled: QQ_BOT_PUBLIC_ENABLE_LOCKED,
    groupMentionOnly: true,
    taskPushEnabled: false,
    triggerPrefix: "",
    allowedUsers: [],
    allowedGroups: [],
    persona: "",
    personaPreset: "none",
    bridgeUrl: "",
    accessToken: "",
    defaultTargetType: DEFAULT_QQ_PUSH_TARGET_TYPE,
    defaultTargetId: DEFAULT_QQ_PUSH_TARGET_ID,
    model: "",
    superPermissionEnabled: false,
    systemPrompt: "",
    assistantName: "Assistant",
    toolReadEnabled: true,
    toolWriteEnabled: false,
    toolCommandEnabled: false,
    toolFileSendEnabled: false,
    fileShareRoots: ["data/temp"],
    targetProfiles: {},
  };

  let qqBotConfig = { ...DEFAULT_QQ_BOT_CONFIG };
  let qqBotSessions = {};
  const BEIJING_TIME_ZONE = "Asia/Shanghai";
  const SCHEDULED_TASK_ADMIN_ID = "1036986718";
  let currentQqToolContext = null;

  function isScheduledTaskAdminActor(actorUserId = "") {
    return String(actorUserId || "").trim() === SCHEDULED_TASK_ADMIN_ID;
  }

  function canUseGlobalScheduledTaskScope({
    targetType = "private",
    targetId = "",
    actorUserId = "",
  } = {}) {
    if (!isScheduledTaskAdminActor(actorUserId)) {
      return false;
    }
    const normalizedTargetType = normalizeTargetType(targetType || "private");
    const normalizedTargetId = String(targetId || "").trim();
    if (normalizedTargetType === "group" && normalizedTargetId) {
      return false;
    }
    return true;
  }

  function getCurrentQqScheduledTaskScope() {
    const targetId = String(currentQqToolContext?.targetId || "").trim();
    const targetType = normalizeTargetType(currentQqToolContext?.targetType || "private");
    const actorUserId = String(currentQqToolContext?.actorUserId || "").trim();
    if (canUseGlobalScheduledTaskScope({ targetType, targetId, actorUserId })) {
      return { actorUserId };
    }
    if (!targetId) {
      return { actorUserId };
    }
    return {
      actorUserId,
      creatorType: targetType,
      creatorId: targetId,
      scopeTargetType: targetType,
      scopeTargetId: targetId,
    };
  }

  function listVisibleScheduledTasksForQq({
    targetType = "private",
    targetId = "",
    actorUserId = "",
  } = {}) {
    const tasks = typeof getScheduledTasks === "function" ? getScheduledTasks() : [];
    if (!Array.isArray(tasks) || !tasks.length) {
      return [];
    }
    const normalizedTargetId = String(targetId || "").trim();
    const normalizedTargetType = normalizeTargetType(targetType || "private");
    if (canUseGlobalScheduledTaskScope({
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      actorUserId,
    })) {
      return tasks;
    }
    if (!normalizedTargetId) {
      return tasks;
    }
    return tasks.filter((task) => {
      const creatorType = normalizeTargetType(task?.creatorType || task?.qqTargetType || "private");
      const creatorId = String(task?.creatorId || task?.qqTargetId || "").trim();
      return creatorType === normalizedTargetType && creatorId === normalizedTargetId;
    });
  }

  function getQqScheduledTaskReplyOptions({
    targetType = "private",
    targetId = "",
    actorUserId = "",
  } = {}) {
    if (!canUseGlobalScheduledTaskScope({ targetType, targetId, actorUserId })) {
      return {};
    }
    return {
      highlightCreatorType: "private",
      highlightCreatorId: String(actorUserId || "").trim(),
    };
  }

  function debug(message) {
    try {
      if (typeof logDebug === "function") {
        logDebug(`qq ${message}`);
      }
    } catch {}
  }

  async function postJson(targetUrl, headers = {}, payload = null) {
    const body = payload == null ? "" : JSON.stringify(payload);
    return await requestJson(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(body ? { "Content-Length": Buffer.byteLength(body, "utf8") } : {}),
        ...headers,
      },
      body,
    });
  }

  const QQ_TOOL_DEFINITIONS = [
    {
      type: "function",
      function: {
        name: "list_dir",
        description: "List files and folders in the workspace.",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a text file in the workspace.",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    },
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
        name: "write_file",
        description: "Write content to a file in the workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file in the workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_shell_command",
        description: "Run a PowerShell command inside the current workspace.",
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
        description: "Run a CLI executable with arguments inside the current workspace.",
        parameters: {
          type: "object",
          properties: {
            executable: { type: "string" },
            args: { type: "array", items: { type: "string" } },
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
        name: "send_qq_file",
        description: "Send a file from the allowed persona/settings directory to the current QQ chat.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path under data/temp, for example '大佬.md'." },
            name: { type: "string", description: "Optional filename shown in QQ." },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_scheduled_task",
        description: "Create a scheduled task when the user explicitly asks to create a recurring task.",
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
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_scheduled_task",
        description: "Update an existing scheduled task when the user explicitly asks to modify it.",
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
        description: "Delete a scheduled task when the user explicitly asks to remove it.",
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
    },
    {
      type: "function",
      function: {
        name: "list_available_models",
        description: "List available local models and show the current shared base model with numbered indexes. Only available for QQ targets with super permission.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "switch_active_model",
        description: "Switch the current shared base model to another available local model. Supports specifying a model ID or a numbered index from the model list. Only available for QQ targets with super permission.",
        parameters: {
          type: "object",
          properties: {
            model: { type: "string" },
            index: { type: "number" },
          },
        },
      },
    },
  ];

  function parseQqIdList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    return String(value || "")
      .split(/[\r\n,，；;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeReadToolEnabled(value, fallback = true) {
    return value === undefined ? fallback : value !== false;
  }

  function normalizeOptionalBoolean(value, fallback = false) {
    return value === undefined ? fallback : Boolean(value);
  }

  function normalizeRelativeSharePath(input = "") {
    const raw = String(input || "").trim().replace(/\\/g, "/");
    if (!raw) return "";
    return raw.replace(/^data\/personas\//i, "").replace(/^\/+/, "");
  }

  function sanitizeFileShareRoots(input) {
    const values = Array.isArray(input)
      ? input
      : String(input || "").split(/\r?\n/);
    const unique = [];
    for (const value of values) {
      const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
      if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) continue;
      const absolutePath = path.resolve(root, normalized);
      if (absolutePath !== root && !absolutePath.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
      if (!unique.includes(normalized)) unique.push(normalized);
    }
    return unique.length ? unique : [...DEFAULT_QQ_BOT_CONFIG.fileShareRoots];
  }

  function resolveQqShareableFile(inputPath = "", config = {}) {
    const relativePath = normalizeRelativeSharePath(inputPath);
    if (!relativePath) {
      const error = new Error("QQ file path is required");
      error.statusCode = 400;
      throw error;
    }
    if (path.isAbsolute(relativePath) || relativePath.includes("..")) {
      const error = new Error("QQ file path must stay within configured QQ file share roots");
      error.statusCode = 400;
      throw error;
    }
    const configuredRoots = sanitizeFileShareRoots(config.fileShareRoots || DEFAULT_QQ_BOT_CONFIG.fileShareRoots);
    for (const rootEntry of configuredRoots) {
      const allowedRoot = path.resolve(root, rootEntry);
      const targetPath = path.resolve(allowedRoot, relativePath);
      if (targetPath !== allowedRoot && !targetPath.startsWith(`${allowedRoot}${path.sep}`)) {
        continue;
      }
      return {
        relativePath,
        targetPath,
        root: rootEntry,
      };
    }
    const error = new Error(`QQ file path is not inside configured share roots: ${configuredRoots.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  function normalizeTargetType(value = "") {
    return String(value || "").trim().toLowerCase() === "group" ? "group" : "private";
  }

  function buildTargetProfileKey(targetType = "private", targetId = "") {
    const normalizedId = String(targetId || "").trim();
    if (!normalizedId) return "";
    return `${normalizeTargetType(targetType)}:${normalizedId}`;
  }

  function sanitizeTargetProfile(profile = {}, fallbackKey = "") {
    const [fallbackType, ...rest] = String(fallbackKey || "").split(":");
    const fallbackId = rest.join(":");
    const targetType = normalizeTargetType(profile.targetType || fallbackType || "private");
    const targetId = String(profile.targetId || fallbackId || "").trim();
    if (!targetId) return null;
    return {
      name: String(profile.name || `${targetType === "group" ? "Group" : "QQ"} ${targetId}`).trim(),
      targetType,
      targetId,
      enabled: QQ_BOT_PUBLIC_ENABLE_LOCKED,
      groupMentionOnly: profile.groupMentionOnly !== false,
      taskPushEnabled: Boolean(profile.taskPushEnabled),
      triggerPrefix: String(profile.triggerPrefix || "").trim(),
      allowedUsers: parseQqIdList(profile.allowedUsers),
      allowedGroups: parseQqIdList(profile.allowedGroups),
      persona: String(profile.persona || "").trim(),
      personaPreset: String(profile.personaPreset || "none").trim() || "none",
      bridgeUrl: String(profile.bridgeUrl || "").trim(),
      accessToken: String(profile.accessToken || "").trim(),
      defaultTargetType: normalizeTargetType(profile.defaultTargetType || targetType),
      defaultTargetId: String(profile.defaultTargetId || targetId).trim(),
      systemPrompt: String(profile.systemPrompt || "").trim(),
      superPermissionEnabled: Boolean(profile.superPermissionEnabled),
      assistantName: String(profile.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName).trim() || DEFAULT_QQ_BOT_CONFIG.assistantName,
      toolReadEnabled: normalizeReadToolEnabled(profile.toolReadEnabled, DEFAULT_QQ_BOT_CONFIG.toolReadEnabled),
      toolWriteEnabled: normalizeOptionalBoolean(profile.toolWriteEnabled, DEFAULT_QQ_BOT_CONFIG.toolWriteEnabled),
      toolCommandEnabled: normalizeOptionalBoolean(profile.toolCommandEnabled, DEFAULT_QQ_BOT_CONFIG.toolCommandEnabled),
      toolFileSendEnabled: normalizeOptionalBoolean(profile.toolFileSendEnabled, DEFAULT_QQ_BOT_CONFIG.toolFileSendEnabled),
      fileShareRoots: sanitizeFileShareRoots(profile.fileShareRoots),
    };
  }

  function getResolvedModelServiceConfig() {
    const sharedConfig = typeof getModelServiceConfig === "function" ? (getModelServiceConfig() || {}) : {};
    return {
      targetOrigin: String(sharedConfig?.targetOrigin || targetOrigin || "").trim(),
      chatPath: String(sharedConfig?.chatPath || "/v1/chat/completions").trim() || "/v1/chat/completions",
      modelsPath: String(sharedConfig?.modelsPath || "/v1/models").trim() || "/v1/models",
      authHeaders: sharedConfig?.authHeaders && typeof sharedConfig.authHeaders === "object"
        ? sharedConfig.authHeaders
        : {},
    };
  }

  function sanitizeTargetProfilesMap(input = {}) {
    const output = {};
    if (!input || typeof input !== "object") return output;
    for (const [key, value] of Object.entries(input)) {
      const profile = sanitizeTargetProfile(value, key);
      if (!profile) continue;
      output[buildTargetProfileKey(profile.targetType, profile.targetId)] = profile;
    }
    return output;
  }

  function sanitizeQqBotConfig(input = {}) {
    return {
      enabled: QQ_BOT_PUBLIC_ENABLE_LOCKED,
      groupMentionOnly: input.groupMentionOnly !== false,
      taskPushEnabled: Boolean(input.taskPushEnabled),
      triggerPrefix: String(input.triggerPrefix || "").trim(),
      allowedUsers: parseQqIdList(input.allowedUsers),
      allowedGroups: parseQqIdList(input.allowedGroups),
      persona: String(input.persona || "").trim(),
      personaPreset: String(input.personaPreset || "none").trim() || "none",
      bridgeUrl: String(input.bridgeUrl || "").trim(),
      accessToken: String(input.accessToken || "").trim(),
      defaultTargetType: normalizeTargetType(input.defaultTargetType || DEFAULT_QQ_PUSH_TARGET_TYPE),
      defaultTargetId: String(input.defaultTargetId || DEFAULT_QQ_PUSH_TARGET_ID).trim(),
      model: String(input.model || "").trim(),
      superPermissionEnabled: Boolean(input.superPermissionEnabled),
      systemPrompt: String(input.systemPrompt || "").trim(),
      assistantName: String(input.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName).trim() || DEFAULT_QQ_BOT_CONFIG.assistantName,
      toolReadEnabled: true,
      toolWriteEnabled: false,
      toolCommandEnabled: false,
      toolFileSendEnabled: false,
      fileShareRoots: [...DEFAULT_QQ_BOT_CONFIG.fileShareRoots],
      targetProfiles: sanitizeTargetProfilesMap(input.targetProfiles),
    };
  }

  function buildPersistedQqBotConfig(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    return {
      ...DEFAULT_QQ_BOT_CONFIG,
      ...sanitizeQqBotConfig({
        ...DEFAULT_QQ_BOT_CONFIG,
        ...source,
      }),
    };
  }

  function isSameSerializedQqBotConfig(left, right) {
    try {
      return JSON.stringify(left || {}) === JSON.stringify(right || {});
    } catch {
      return false;
    }
  }

  async function loadQqBotConfig() {
    const loaded = await readJsonFile(qqBotConfigFile, {});
    const loadedRecord = loaded && typeof loaded === "object" ? loaded : {};
    qqBotConfig = buildPersistedQqBotConfig(loadedRecord);
    if (!getStoredSharedConnectionModel() && String(qqBotConfig.model || "").trim() && typeof saveSharedConnectionConfig === "function") {
      await saveSharedConnectionConfig({ model: String(qqBotConfig.model || "").trim() });
    }
    if (!isSameSerializedQqBotConfig(loadedRecord, qqBotConfig)) {
      await writeJsonFileAtomic(qqBotConfigFile, qqBotConfig);
    }
  }

  async function saveQqBotConfig(nextConfig = {}) {
    qqBotConfig = buildPersistedQqBotConfig({
      ...qqBotConfig,
      ...nextConfig,
    });
    await writeJsonFileAtomic(qqBotConfigFile, qqBotConfig);
    return qqBotConfig;
  }

  async function loadQqBotSessions() {
    const loaded = await readJsonFile(qqBotSessionsFile, {});
    qqBotSessions = loaded && typeof loaded === "object" ? loaded : {};
  }

  async function saveQqBotSessions() {
    await writeJsonFileAtomic(qqBotSessionsFile, qqBotSessions);
  }

  function getTargetProfile(targetType = "private", targetId = "") {
    const key = buildTargetProfileKey(targetType, targetId);
    if (!key) return null;
    return qqBotConfig.targetProfiles?.[key] || null;
  }

  function getResolvedQqConfig(targetType = "private", targetId = "") {
    const profile = getTargetProfile(targetType, targetId);
    if (!profile) {
      const sharedModel = getSharedConnectionModel();
      return {
        ...qqBotConfig,
        ...(sharedModel ? { model: sharedModel } : {}),
      };
    }
    const merged = {
      ...qqBotConfig,
      ...profile,
      targetProfiles: qqBotConfig.targetProfiles || {},
    };
    // Object profiles should not blank out shared bridge credentials.
    if (!String(profile.bridgeUrl || "").trim()) {
      merged.bridgeUrl = qqBotConfig.bridgeUrl || "";
    }
    if (!String(profile.accessToken || "").trim()) {
      merged.accessToken = qqBotConfig.accessToken || "";
    }
    if (!Array.isArray(profile.fileShareRoots) || !profile.fileShareRoots.length) {
      merged.fileShareRoots = qqBotConfig.fileShareRoots || [...DEFAULT_QQ_BOT_CONFIG.fileShareRoots];
    }
    const sharedModel = getSharedConnectionModel();
    if (sharedModel) {
      merged.model = sharedModel;
    }
    return {
      ...merged,
    };
  }

  function buildQqAllowedTools(config = {}) {
    const allowedNames = new Set();
    allowedNames.add("create_scheduled_task");
    allowedNames.add("list_scheduled_tasks");
    allowedNames.add("update_scheduled_task");
    allowedNames.add("delete_scheduled_task");
    allowedNames.add("run_scheduled_task");
    if (config.toolReadEnabled !== false) {
      allowedNames.add("list_dir");
      allowedNames.add("read_file");
      allowedNames.add("get_weather");
      allowedNames.add("web_search");
    }
    if (config.toolWriteEnabled) {
      allowedNames.add("write_file");
      allowedNames.add("delete_file");
    }
    if (config.toolCommandEnabled) {
      allowedNames.add("run_shell_command");
      allowedNames.add("run_cli_command");
    }
    if (config.toolFileSendEnabled) {
      allowedNames.add("send_qq_file");
    }
    if (config.superPermissionEnabled) {
      allowedNames.add("list_available_models");
      allowedNames.add("switch_active_model");
    }
    return QQ_TOOL_DEFINITIONS.filter((tool) => allowedNames.has(tool?.function?.name));
  }

  function assertQqSuperPermission(targetType = "private", targetId = "") {
    const normalizedTargetId = String(targetId || "").trim();
    const resolvedConfig = normalizedTargetId
      ? getResolvedQqConfig(targetType, normalizedTargetId)
      : qqBotConfig;
    if (resolvedConfig.superPermissionEnabled) {
      return resolvedConfig;
    }
    const error = new Error("当前 QQ 未授权查看或切换模型。");
    error.statusCode = 403;
    throw error;
  }

  function hasBuiltinQqSuperPermission({ targetType = "private", targetId = "", actorUserId = "" } = {}) {
    const normalizedTargetType = normalizeTargetType(targetType || "private");
    const normalizedTargetId = String(targetId || "").trim();
    const normalizedActorUserId = String(actorUserId || "").trim();
    if (normalizedActorUserId && normalizedActorUserId === SCHEDULED_TASK_ADMIN_ID) {
      return true;
    }
    return normalizedTargetType === "private" && normalizedTargetId === SCHEDULED_TASK_ADMIN_ID;
  }

  function hasQqSuperPermission({ targetType = "private", targetId = "", actorUserId = "" } = {}) {
    const normalizedTargetId = String(targetId || "").trim();
    const normalizedActorUserId = String(actorUserId || "").trim();
    const resolvedConfig = normalizedTargetId
      ? getResolvedQqConfig(targetType, normalizedTargetId)
      : qqBotConfig;
    if (resolvedConfig.superPermissionEnabled) {
      return true;
    }
    if (hasBuiltinQqSuperPermission({ targetType, targetId, actorUserId })) {
      return true;
    }
    if (!normalizedActorUserId) {
      return false;
    }
    const actorProfile = getTargetProfile("private", normalizedActorUserId);
    return Boolean(actorProfile?.superPermissionEnabled);
  }

  assertQqSuperPermission = function assertQqSuperPermissionByActor(targetType = "private", targetId = "", actorUserId = "") {
    if (hasQqSuperPermission({ targetType, targetId, actorUserId })) {
      return getResolvedQqConfig(targetType, targetId);
    }
    const error = new Error("当前 QQ 未授权执行超级管理操作。");
    error.statusCode = 403;
    throw error;
  };

  function getStoredSharedConnectionModel() {
    if (typeof getSharedConnectionConfig !== "function") {
      return "";
    }
    return String(getSharedConnectionConfig()?.model || "").trim();
  }

  function getSharedConnectionModel() {
    return getStoredSharedConnectionModel() || String(qqBotConfig.model || "").trim();
  }

  async function saveSharedConnectionModel(nextModel = "") {
    const normalizedModel = String(nextModel || "").trim();
    if (typeof saveSharedConnectionConfig === "function") {
      await saveSharedConnectionConfig({ model: normalizedModel });
    }
    if (String(qqBotConfig.model || "").trim() !== normalizedModel) {
      await saveQqBotConfig({ model: normalizedModel });
    }
    return normalizedModel;
  }

  async function fetchAvailableModelIds() {
    const modelService = getResolvedModelServiceConfig();
    const modelsUrl = new URL(modelService.modelsPath, modelService.targetOrigin);
    const data = await requestJson(modelsUrl, {
      method: "GET",
      headers: {
        ...modelService.authHeaders,
      },
    });
    return Array.from(new Set(
      (Array.isArray(data?.data) ? data.data : [])
        .map((item) => String(item?.id || "").trim())
        .filter(Boolean)
    ));
  }

  function resolveRequestedModelId(requestedModel = "", availableModels = []) {
    const normalizedRequested = String(requestedModel || "").trim();
    if (!normalizedRequested) {
      const error = new Error("切换模型时必须提供模型 ID。");
      error.statusCode = 400;
      throw error;
    }

    const exactMatch = availableModels.find((modelId) => modelId === normalizedRequested);
    if (exactMatch) {
      return exactMatch;
    }

    const requestedLower = normalizedRequested.toLowerCase();
    const caseInsensitiveMatch = availableModels.find((modelId) => modelId.toLowerCase() === requestedLower);
    if (caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }

    const fuzzyMatches = availableModels.filter((modelId) => modelId.toLowerCase().includes(requestedLower));
    if (fuzzyMatches.length === 1) {
      return fuzzyMatches[0];
    }
    if (fuzzyMatches.length > 1) {
      const error = new Error(`匹配到多个模型，请使用更完整的模型 ID：${fuzzyMatches.slice(0, 8).join("、")}`);
      error.statusCode = 400;
      throw error;
    }

    const error = new Error(`未找到模型：${normalizedRequested}`);
    error.statusCode = 404;
    throw error;
  }

  async function listAvailableModelsForQq() {
    const models = await fetchAvailableModelIds();
    return {
      ok: true,
      currentModel: String(qqBotConfig.model || "").trim(),
      models,
    };
  }

  async function switchActiveModelForQq(args = {}) {
    const availableModels = await fetchAvailableModelIds();
    const nextModel = resolveRequestedModelId(args.model, availableModels);
    const previousModel = String(qqBotConfig.model || "").trim();

    if (previousModel === nextModel) {
      return {
        ok: true,
        unchanged: true,
        previousModel,
        model: nextModel,
      };
    }

    const config = await saveQqBotConfig({ model: nextModel });
    return {
      ok: true,
      unchanged: false,
      previousModel,
      model: String(config.model || "").trim(),
    };
  }

  function parseQqModelAdminCommand(text = "") {
    const normalized = String(text || "").trim();
    if (!normalized) return null;

    if (
      /^(?:查看|列出|显示)?(?:可用)?模型(?:列表)?$/u.test(normalized)
      || /^(?:有哪些|有什么)模型$/u.test(normalized)
    ) {
      return { type: "list" };
    }

    const switchMatch = normalized.match(/^(?:切换(?:使用)?模型(?:到|为)?|使用模型|切换到模型)\s*[:：]?\s*(.+)$/u);
    if (switchMatch) {
      return {
        type: "switch",
        model: String(switchMatch[1] || "").trim(),
      };
    }

    return null;
  }

  function formatQqModelListReply(result = {}) {
    const models = Array.isArray(result.models) ? result.models : [];
    const currentModel = String(result.currentModel || "").trim();
    if (!models.length) {
      return "当前未读取到可用模型。";
    }
    return [
      "当前可用模型：",
      ...models.map((modelId) => modelId === currentModel ? `- ${modelId}（当前使用）` : `- ${modelId}`),
      "",
      "切换方式：发送“切换使用模型 模型ID”",
    ].join("\n");
  }

  function formatQqModelSwitchReply(result = {}) {
    const nextModel = String(result.model || "").trim();
    const previousModel = String(result.previousModel || "").trim();
    if (!nextModel) {
      return "模型切换失败：未获取到新的模型配置。";
    }
    if (result.unchanged) {
      return `当前已经在使用模型：${nextModel}`;
    }
    return [
      "已切换 QQ 当前使用模型。",
      `当前模型：${nextModel}`,
      previousModel ? `上一个模型：${previousModel}` : "",
    ].filter(Boolean).join("\n");
  }

  resolveRequestedModelId = function resolveRequestedModelIdBySharedIndex(args = {}, availableModels = []) {
    const requestedIndex = args?.index === null || args?.index === undefined || args?.index === ""
      ? Number.NaN
      : Number(args.index);
    if (Number.isInteger(requestedIndex)) {
      if (requestedIndex < 1 || requestedIndex > availableModels.length) {
        const error = new Error(`模型序号超出范围，请输入 1 到 ${availableModels.length || 1}。`);
        error.statusCode = 400;
        throw error;
      }
      return availableModels[requestedIndex - 1];
    }

    const normalizedRequested = String(args?.model || "").trim();
    if (!normalizedRequested) {
      const error = new Error("切换模型时必须提供模型 ID 或模型序号。");
      error.statusCode = 400;
      throw error;
    }

    const exactMatch = availableModels.find((modelId) => modelId === normalizedRequested);
    if (exactMatch) {
      return exactMatch;
    }

    const requestedLower = normalizedRequested.toLowerCase();
    const caseInsensitiveMatch = availableModels.find((modelId) => modelId.toLowerCase() === requestedLower);
    if (caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }

    const fuzzyMatches = availableModels.filter((modelId) => modelId.toLowerCase().includes(requestedLower));
    if (fuzzyMatches.length === 1) {
      return fuzzyMatches[0];
    }
    if (fuzzyMatches.length > 1) {
      const error = new Error(`匹配到多个模型，请使用更完整的模型 ID：${fuzzyMatches.slice(0, 8).join("、")}`);
      error.statusCode = 400;
      throw error;
    }

    const error = new Error(`未找到模型：${normalizedRequested}`);
    error.statusCode = 404;
    throw error;
  };

  listAvailableModelsForQq = async function listAvailableModelsForQqSharedModelFinal() {
    const models = await fetchAvailableModelIds();
    return {
      ok: true,
      currentModel: getSharedConnectionModel(),
      models,
    };
  };

  switchActiveModelForQq = async function switchActiveModelForQqSharedModelFinal(args = {}) {
    const availableModels = await fetchAvailableModelIds();
    const nextModel = resolveRequestedModelId(args, availableModels);
    const previousModel = getSharedConnectionModel();

    if (previousModel === nextModel) {
      return {
        ok: true,
        unchanged: true,
        previousModel,
        model: nextModel,
      };
    }

    const model = await saveSharedConnectionModel(nextModel);
    return {
      ok: true,
      unchanged: false,
      previousModel,
      model,
    };
  };

  parseQqModelAdminCommand = function parseQqModelAdminCommandByIndex(text = "") {
    const normalized = String(text || "").trim();
    if (!normalized) return null;
    if (/(?:当前|现在|正在使用).{0,4}模型/u.test(normalized)) {
      return { type: "current" };
    }

    if (
      /^(?:查看|列出|显示)?(?:可用)?模型(?:列表)?$/u.test(normalized)
      || /^(?:有哪些|有什么)模型$/u.test(normalized)
    ) {
      return { type: "list" };
    }

    const switchMatch = normalized.match(/^(?:切换(?:使用)?模型(?:到|为)?|使用模型|切换到模型)\s*[:：]?\s*(.+)$/u);
    if (switchMatch) {
      const rawValue = String(switchMatch[1] || "").trim();
      const indexMatch = rawValue.match(/^第?\s*(\d+)\s*(?:个|号)?$/u);
      return {
        type: "switch",
        model: rawValue,
        index: indexMatch ? Number(indexMatch[1]) : null,
      };
    }

    const ordinalSwitchMatch = normalized.match(/^(?:切(?:换)?(?:到)?|改(?:成|为)?|用)?第\s*(\d+)\s*(?:个|号)?模型$/u)
      || normalized.match(/^(?:切换|改用|使用)\s*(\d+)\s*(?:号|个)?模型$/u);
    if (ordinalSwitchMatch) {
      return {
        type: "switch",
        model: "",
        index: Number(ordinalSwitchMatch[1]),
      };
    }

    return null;
  };

  function formatQqModelCurrentReply(result = {}) {
    const currentModel = String(result.currentModel || "").trim();
    return `当前模型：${currentModel || "未选择"}`;
  }

  formatQqModelListReply = function formatQqModelListReplyWithIndexes(result = {}) {
    const models = Array.isArray(result.models) ? result.models : [];
    const currentModel = String(result.currentModel || "").trim();
    if (!models.length) {
      return "当前未读取到可用模型。";
    }
    return [
      "当前可用模型：",
      ...models.map((modelId, index) => modelId === currentModel
        ? `${index + 1}. ${modelId}（当前使用）`
        : `${index + 1}. ${modelId}`),
      "",
      "切换方式：发送“切第 5 个模型”或“切换使用模型 模型ID”",
    ].join("\n");
  };

  formatQqModelSwitchReply = function formatQqModelSwitchReplySharedModelFinal(result = {}) {
    const nextModel = String(result.model || "").trim();
    const previousModel = String(result.previousModel || "").trim();
    if (!nextModel) {
      return "模型切换失败：未获取到新的模型配置。";
    }
    if (result.unchanged) {
      return `当前已经在使用模型：${nextModel}`;
    }
    return [
      "已切换 QQ 当前使用模型，并已同步基础连接。",
      `当前模型：${nextModel}`,
      previousModel ? `上一个模型：${previousModel}` : "",
    ].filter(Boolean).join("\n");
  };

  function formatQqAdminTargetLabel(targetType = "private", targetId = "") {
    const normalizedTargetId = String(targetId || "").trim();
    if (!normalizedTargetId) return targetType === "group" ? "当前群" : "当前 QQ";
    return `${targetType === "group" ? "群" : "QQ"} ${normalizedTargetId}`;
  }

  async function listQqPersonaPresets() {
    const presets = [];
    const rootDir = path.resolve(personaPresetsDir);

    async function collect(currentDir) {
      let entries = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await collect(fullPath);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
          continue;
        }
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
        const prompt = await fs.promises.readFile(fullPath, "utf8");
        const lines = String(prompt || "").split(/\r?\n/).map((line) => line.trim());
        const description = lines.find((line) => line && !line.startsWith("#")) || relativePath;
        presets.push({
          id: `workspace:${relativePath}`,
          name: path.basename(entry.name, ".md"),
          path: relativePath,
          description,
          prompt,
        });
      }
    }

    await collect(rootDir);
    presets.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    return presets;
  }

  function buildEditableQqTargetProfile(targetType = "private", targetId = "") {
    const normalizedTargetType = normalizeTargetType(targetType);
    const normalizedTargetId = String(targetId || "").trim();
    const existingProfile = getTargetProfile(normalizedTargetType, normalizedTargetId);
    const resolvedConfig = getResolvedQqConfig(normalizedTargetType, normalizedTargetId);
    return sanitizeTargetProfile({
      ...(resolvedConfig || {}),
      ...(existingProfile || {}),
      name: String(existingProfile?.name || `${normalizedTargetType === "group" ? "Group" : "QQ"} ${normalizedTargetId}`).trim(),
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      bridgeUrl: String(existingProfile?.bridgeUrl || "").trim(),
      accessToken: String(existingProfile?.accessToken || "").trim(),
      defaultTargetType: normalizeTargetType(existingProfile?.defaultTargetType || normalizedTargetType),
      defaultTargetId: String(existingProfile?.defaultTargetId || normalizedTargetId).trim(),
      superPermissionEnabled: Boolean(existingProfile?.superPermissionEnabled),
    }, buildTargetProfileKey(normalizedTargetType, normalizedTargetId));
  }

  async function saveQqTargetProfile(profile = {}) {
    const sanitizedProfile = sanitizeTargetProfile(profile, buildTargetProfileKey(profile.targetType, profile.targetId));
    if (!sanitizedProfile) {
      const error = new Error("Missing QQ target profile");
      error.statusCode = 400;
      throw error;
    }
    const key = buildTargetProfileKey(sanitizedProfile.targetType, sanitizedProfile.targetId);
    const nextProfiles = {
      ...(qqBotConfig.targetProfiles || {}),
      [key]: sanitizedProfile,
    };
    await saveQqBotConfig({ targetProfiles: nextProfiles });
    return qqBotConfig.targetProfiles?.[key] || sanitizedProfile;
  }

  function resolveRequestedPersonaPreset(args = {}, presets = []) {
    const requestedIndex = args?.index === null || args?.index === undefined || args?.index === ""
      ? Number.NaN
      : Number(args.index);
    if (Number.isInteger(requestedIndex)) {
      if (requestedIndex < 1 || requestedIndex > presets.length) {
        const error = new Error(`人设序号超出范围，请输入 1 到 ${presets.length || 1}。`);
        error.statusCode = 400;
        throw error;
      }
      return presets[requestedIndex - 1];
    }

    const normalizedRequested = String(args?.persona || "").trim();
    if (!normalizedRequested) {
      const error = new Error("切换人设时必须提供人设名称或序号。");
      error.statusCode = 400;
      throw error;
    }

    const exactMatch = presets.find((preset) =>
      preset.id === normalizedRequested
      || preset.name === normalizedRequested
      || preset.path === normalizedRequested
    );
    if (exactMatch) {
      return exactMatch;
    }

    const requestedLower = normalizedRequested.toLowerCase();
    const fuzzyMatches = presets.filter((preset) =>
      String(preset.id || "").toLowerCase().includes(requestedLower)
      || String(preset.name || "").toLowerCase().includes(requestedLower)
      || String(preset.path || "").toLowerCase().includes(requestedLower)
    );
    if (fuzzyMatches.length === 1) {
      return fuzzyMatches[0];
    }
    if (fuzzyMatches.length > 1) {
      const error = new Error(`匹配到多个人设，请使用更完整的人设名称：${fuzzyMatches.slice(0, 8).map((preset) => preset.name).join("、")}`);
      error.statusCode = 400;
      throw error;
    }

    const error = new Error(`未找到人设：${normalizedRequested}`);
    error.statusCode = 404;
    throw error;
  }

  async function listQqPersonaPresetsForTarget(targetType = "private", targetId = "") {
    const presets = await listQqPersonaPresets();
    const resolvedConfig = getResolvedQqConfig(targetType, targetId);
    return {
      ok: true,
      targetType: normalizeTargetType(targetType),
      targetId: String(targetId || "").trim(),
      currentPersonaPreset: String(resolvedConfig.personaPreset || "none").trim() || "none",
      currentPersona: String(resolvedConfig.persona || "").trim(),
      presets,
    };
  }

  async function switchQqPersonaForTarget(args = {}) {
    const targetType = normalizeTargetType(args.targetType || "private");
    const targetId = String(args.targetId || "").trim();
    if (!targetId) {
      const error = new Error("切换人设时缺少当前 QQ 对象。");
      error.statusCode = 400;
      throw error;
    }

    const baseProfile = buildEditableQqTargetProfile(targetType, targetId);
    if (args.clear) {
      const savedProfile = await saveQqTargetProfile({
        ...baseProfile,
        personaPreset: String(qqBotConfig.personaPreset || "none").trim() || "none",
        persona: String(qqBotConfig.persona || "").trim(),
      });
      return {
        ok: true,
        cleared: true,
        targetType,
        targetId,
        personaPreset: String(savedProfile.personaPreset || "none").trim() || "none",
        personaName: "默认人设",
      };
    }

    const presets = await listQqPersonaPresets();
    const preset = resolveRequestedPersonaPreset(args, presets);
    const savedProfile = await saveQqTargetProfile({
      ...baseProfile,
      personaPreset: preset.id,
      persona: String(preset.prompt || "").trim(),
    });
    return {
      ok: true,
      cleared: false,
      targetType,
      targetId,
      personaPreset: String(savedProfile.personaPreset || preset.id).trim(),
      personaName: String(preset.name || "").trim() || preset.id,
    };
  }

  function parseQqPersonaAdminCommand(text = "") {
    const normalized = String(text || "").trim();
    if (!normalized) return null;
    if (/(?:当前|现在|正在使用).{0,4}(?:人设|预设)/u.test(normalized)) {
      return { type: "current" };
    }

    if (
      /^(?:查看|列出|显示)?人设(?:列表)?$/u.test(normalized)
      || /^(?:有哪些|有什么)人设$/u.test(normalized)
    ) {
      return { type: "list" };
    }

    if (/^(?:恢复默认人设|重置人设|清除人设|取消人设)$/u.test(normalized)) {
      return { type: "clear" };
    }

    const switchMatch = normalized.match(/^(?:切换(?:到)?|更换|改(?:成|为)?|使用)(?:当前)?人设\s*[:：]?\s*(.+)$/u);
    if (switchMatch) {
      const rawValue = String(switchMatch[1] || "").trim();
      const indexMatch = rawValue.match(/^第?\s*(\d+)\s*(?:个|号)?$/u);
      return {
        type: "switch",
        persona: rawValue,
        index: indexMatch ? Number(indexMatch[1]) : null,
      };
    }

    const ordinalSwitchMatch = normalized.match(/^(?:切(?:换)?(?:到)?|改(?:成|为)?|用)?第\s*(\d+)\s*(?:个|号)?人设$/u)
      || normalized.match(/^(?:切换|改用|使用)\s*(\d+)\s*(?:号|个)?人设$/u);
    if (ordinalSwitchMatch) {
      return {
        type: "switch",
        persona: "",
        index: Number(ordinalSwitchMatch[1]),
      };
    }

    return null;
  }

  async function buildCurrentQqPersonaSummary(targetType = "private", targetId = "") {
    const resolvedConfig = getResolvedQqConfig(targetType, targetId);
    const currentPersonaPreset = String(resolvedConfig.personaPreset || "none").trim() || "none";
    const currentPersona = String(resolvedConfig.persona || "").trim();

    if (currentPersonaPreset !== "none") {
      const presets = await listQqPersonaPresets();
      const preset = presets.find((item) => String(item?.id || "").trim() === currentPersonaPreset);
      if (preset?.name) {
        return `当前人设：${preset.name}`;
      }
      return `当前人设：${currentPersonaPreset}`;
    }

    if (currentPersona) {
      const preview = currentPersona.length > 120
        ? `${currentPersona.slice(0, 120)}…`
        : currentPersona;
      return `当前人设：自定义人设\n内容预览：${preview}`;
    }

    return "当前人设：未设置";
  }

  function formatQqPersonaListReply(result = {}) {
    const presets = Array.isArray(result.presets) ? result.presets : [];
    const currentPersonaPreset = String(result.currentPersonaPreset || "none").trim() || "none";
    const targetLabel = formatQqAdminTargetLabel(result.targetType, result.targetId);
    if (!presets.length) {
      return `${targetLabel} 当前没有可用人设文件。`;
    }
    return [
      `${targetLabel} 当前可用人设：`,
      ...presets.map((preset, index) => preset.id === currentPersonaPreset
        ? `${index + 1}. ${preset.name}（当前使用）`
        : `${index + 1}. ${preset.name}`),
      "",
      "切换方式：发送“切第 2 个人设”或“切换人设 人设名”",
    ].join("\n");
  }

  function formatQqPersonaSwitchReply(result = {}) {
    const targetLabel = formatQqAdminTargetLabel(result.targetType, result.targetId);
    if (result.cleared) {
      return `已恢复${targetLabel}的默认人设。`;
    }
    return [
      `已切换${targetLabel}的人设。`,
      `当前人设：${String(result.personaName || result.personaPreset || "").trim() || "未命名人设"}`,
    ].join("\n");
  }

  async function tryHandleDirectQqPersonaAdminCommand({
    targetType = "private",
    targetId = "",
    actorUserId = "",
    sessionKey = "",
    session = [],
    userText = "",
  } = {}) {
    const command = parseQqPersonaAdminCommand(userText);
    if (!command) {
      return null;
    }

    let reply = "";
    try {
      assertQqSuperPermission(targetType, targetId, actorUserId);
      if (command.type === "current") {
        reply = await buildCurrentQqPersonaSummary(targetType, targetId);
      } else if (command.type === "list") {
        reply = formatQqPersonaListReply(await listQqPersonaPresetsForTarget(targetType, targetId));
      } else if (command.type === "switch") {
        reply = formatQqPersonaSwitchReply(await switchQqPersonaForTarget({
          targetType,
          targetId,
          persona: command.persona,
          index: command.index,
        }));
      } else if (command.type === "clear") {
        reply = formatQqPersonaSwitchReply(await switchQqPersonaForTarget({
          targetType,
          targetId,
          clear: true,
        }));
      } else {
        return null;
      }
    } catch (error) {
      reply = (command.type === "list" || command.type === "current")
        ? `查看人设列表失败：${error.message || "未知错误"}`
        : `切换人设失败：${error.message || "未知错误"}`;
    }

    await saveQqSessionReply(sessionKey, session, userText, reply);
    debug(`direct persona admin actor=${actorUserId || "unknown"} target=${targetType}:${targetId} action=${command.type}${command.persona ? ` persona=${command.persona}` : ""}${command.index ? ` index=${command.index}` : ""}`);
    return reply;
  }

  async function saveQqSessionReply(sessionKey, session = [], userText = "", reply = "") {
    qqBotSessions[sessionKey] = {
      updatedAt: Date.now(),
      messages: trimSessionMessages([
        ...session,
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      ]),
    };
    await saveQqBotSessions();
  }

  async function tryHandleDirectScheduledTaskIntent({
    targetType = "private",
    targetId = "",
    actorUserId = "",
    bridgeUrl = "",
    accessToken = "",
    fileShareRoots = [],
    sessionKey = "",
    session = [],
    userText = "",
    model = "",
  } = {}) {
    const intent = inferScheduledTaskIntentFromText(userText, {
      tasks: listVisibleScheduledTasksForQq({
        targetType,
        targetId,
        actorUserId,
      }),
    });
    if (!intent) {
      return null;
    }

    let result = null;
    let reply = "";
    try {
      currentQqToolContext = {
        bridgeUrl,
        accessToken,
        targetType,
        targetId,
        actorUserId,
        fileShareRoots,
      };
      switch (intent.action) {
        case "create":
          result = await executeToolCall("create_scheduled_task", intent.args);
          break;
        case "list":
          result = await executeToolCall("list_scheduled_tasks", {});
          break;
        case "update":
          result = await executeToolCall("update_scheduled_task", intent.args);
          break;
        case "run":
          result = await executeToolCall("run_scheduled_task", intent.args);
          break;
        case "delete":
          result = await executeToolCall("delete_scheduled_task", intent.args);
          break;
        case "disable":
        case "enable":
          result = await executeToolCall("update_scheduled_task", intent.args);
          break;
        default:
          return null;
      }
      reply = formatScheduledTaskActionReply(intent, result, {
        tasks: listVisibleScheduledTasksForQq({
          targetType,
          targetId,
          actorUserId,
        }),
        ...getQqScheduledTaskReplyOptions({
          targetType,
          targetId,
          actorUserId,
        }),
      });
    } catch (error) {
      reply = `定时任务操作失败：${error.message || "未知错误"}`;
    } finally {
      currentQqToolContext = null;
    }

    await saveQqSessionReply(sessionKey, session, userText, reply);
    debug(`direct scheduler intent actor=${actorUserId || "unknown"} target=${targetType}:${targetId} action=${intent.action}`);
    return reply;
  }

  async function tryHandleDirectQqModelAdminCommand({
    targetType = "private",
    targetId = "",
    actorUserId = "",
    sessionKey = "",
    session = [],
    userText = "",
  } = {}) {
    const command = parseQqModelAdminCommand(userText);
    if (!command) {
      return null;
    }

    let reply = "";
    try {
      assertQqSuperPermission(targetType, targetId, actorUserId);
      if (command.type === "current") {
        reply = formatQqModelCurrentReply({
          currentModel: getSharedConnectionModel(),
        });
      } else if (command.type === "list") {
        reply = formatQqModelListReply(await listAvailableModelsForQq());
      } else if (command.type === "switch") {
        reply = formatQqModelSwitchReply(await switchActiveModelForQq({ model: command.model, index: command.index }));
      } else {
        return null;
      }
    } catch (error) {
      reply = command.type === "switch"
        ? `模型切换失败：${error.message || "未知错误"}`
        : `查看模型列表失败：${error.message || "未知错误"}`;
    }

    await saveQqSessionReply(sessionKey, session, userText, reply);
    debug(`direct model admin actor=${actorUserId || "unknown"} target=${targetType}:${targetId} action=${command.type}${command.model ? ` model=${command.model}` : ""}${command.index ? ` index=${command.index}` : ""}`);
    return reply;
  }

  function buildQqToolSystemPrompt(config = {}) {
    const enabledToolNames = buildQqAllowedTools(config).map((tool) => tool.function.name);
    if (!enabledToolNames.length) {
      return "No QQ tools are enabled for this target. Reply with text only.";
    }
    return `Enabled QQ tools for this target: ${enabledToolNames.join(", ")}. Only call tools from this list. If a risky tool is not enabled, explain that the current QQ target is not authorized for it.`;
    const allowedNames = buildQqAllowedTools(config).map((tool) => tool.function.name);
    if (!allowedNames.length) {
      return "当前 QQ 对象未开放任何文件、命令或技能执行工具。只能直接文本回复，不能声称自己已经写文件、执行命令或运行技能。";
    }
    return `当前 QQ 对象已开放的真实工具有：${allowedNames.join("、")}。只能调用这些真实工具；如果某个危险工具未开放，就明确说明当前 QQ 对象未授权该操作。`;
  }

  async function sendQqMessageFinal(args = {}) {
    const bridgeUrl = String(args.bridgeUrl || "").trim();
    const targetType = normalizeTargetType(args.targetType || "private");
    const targetId = String(args.targetId || "").trim();
    const message = stripModelThinkingContent(String(args.message || "").trim());
    const accessToken = String(args.accessToken || "").trim();

    if (!bridgeUrl) {
      const error = new Error("QQ bridge URL is required");
      error.statusCode = 400;
      throw error;
    }
    if (!targetId) {
      const error = new Error("QQ target ID is required");
      error.statusCode = 400;
      throw error;
    }
    if (!message) {
      const error = new Error("QQ message is required");
      error.statusCode = 400;
      throw error;
    }

    const baseUrl = new URL(bridgeUrl.endsWith("/") ? bridgeUrl : `${bridgeUrl}/`);
    const normalizedMessage = String(message || "").replace(/\r\n/g, "\n");
    const numericTargetId = /^\d+$/.test(targetId) ? Number(targetId) : targetId;
    const requestHeaders = {
      "Content-Type": "application/json; charset=utf-8",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    };

    const attemptSend = async (actionName, payload) => {
      const actionUrl = new URL(actionName, baseUrl);
      return await postJson(actionUrl, requestHeaders, payload);
    };

    let response;
    let lastError = null;
    const attempts = [
      {
        action: targetType === "group" ? "send_group_msg" : "send_private_msg",
        payload: targetType === "group"
          ? { group_id: numericTargetId, message: normalizedMessage, auto_escape: true }
          : { user_id: numericTargetId, message: normalizedMessage, auto_escape: true },
      },
      {
        action: "send_msg",
        payload: targetType === "group"
          ? { message_type: "group", group_id: numericTargetId, message: normalizedMessage, auto_escape: true }
          : { message_type: "private", user_id: numericTargetId, message: normalizedMessage, auto_escape: true },
      },
      {
        action: targetType === "group" ? "send_group_msg" : "send_private_msg",
        payload: targetType === "group"
          ? { group_id: numericTargetId, message: [{ type: "text", data: { text: normalizedMessage } }] }
          : { user_id: numericTargetId, message: [{ type: "text", data: { text: normalizedMessage } }] },
      },
    ];

    for (const attempt of attempts) {
      try {
        response = await attemptSend(attempt.action, attempt.payload);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    if (response && typeof response === "object") {
      const retcode = Number(response.retcode);
      const status = String(response.status || "").toLowerCase();
      if ((Number.isFinite(retcode) && retcode !== 0) || (status && status !== "ok")) {
        const error = new Error(`QQ bridge send failed: ${response.wording || response.message || response.msg || `retcode=${response.retcode}`}`);
        error.statusCode = 502;
        error.bridgeResponse = response;
        throw error;
      }
    }

    return {
      ok: true,
      targetType,
      targetId,
      message,
      bridgeUrl: baseUrl.toString(),
      response,
    };
  }

  async function sendQqMessage(args = {}) {
    return sendQqMessageFinal(args);
  }

  function buildQqToolSystemPrompt(config = {}) {
    const enabledToolNames = buildQqAllowedTools(config).map((tool) => tool.function.name);
    if (!enabledToolNames.length) {
      return "No QQ tools are enabled for this target. Reply with text only.";
    }
    const fileHintText = enabledToolNames.includes("send_qq_file")
      ? ` send_qq_file is limited to these workspace directories: ${sanitizeFileShareRoots(config.fileShareRoots).join(", ")}.`
      : "";
    const webSearchHintText = enabledToolNames.includes("web_search")
      ? " If the user needs current internet information such as news, prices, releases, or webpage findings, use web_search instead of guessing."
      : "";
    return `Enabled QQ tools for this target: ${enabledToolNames.join(", ")}. Only call tools from this list. If a risky tool is not enabled, explain that the current QQ target is not authorized for it.${fileHintText}${webSearchHintText}`;
    const allowedNames = buildQqAllowedTools(config).map((tool) => tool.function.name);
    if (!allowedNames.length) {
      return "当前 QQ 对象未开放任何文件、命令或技能执行工具。只能直接文本回复，不能声称自己已经写文件、执行命令、运行技能或发送文件。";
    }
    const fileHint = allowedNames.includes("send_qq_file")
      ? ` send_qq_file 只能发送这些目录中的文件：${sanitizeFileShareRoots(config.fileShareRoots).join("、")}。`
      : "";
    return `当前 QQ 对象已开放的真实工具有：${allowedNames.join("、")}。只能调用这些真实工具；如果某个危险工具未开放，就明确说明当前 QQ 对象未授权该操作。${fileHint}`;
  }

  async function sendQqFileFinal(args = {}) {
    const context = currentQqToolContext || {};
    const bridgeUrl = String(args.bridgeUrl || context.bridgeUrl || "").trim();
    const accessToken = String(args.accessToken || context.accessToken || "").trim();
    const targetType = normalizeTargetType(args.targetType || context.targetType || "private");
    const targetId = String(args.targetId || context.targetId || "").trim();
    const { relativePath, targetPath, root: shareRoot } = resolveQqShareableFile(args.path, context);
    const fileName = String(args.name || path.basename(targetPath)).trim() || path.basename(targetPath);

    if (!bridgeUrl) {
      const error = new Error("QQ bridge URL is required");
      error.statusCode = 400;
      throw error;
    }
    if (!targetId) {
      const error = new Error("QQ target ID is required");
      error.statusCode = 400;
      throw error;
    }

    const stat = await fs.promises.stat(targetPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      const error = new Error(`QQ shareable file not found: ${relativePath}`);
      error.statusCode = 404;
      throw error;
    }

    const baseUrl = new URL(bridgeUrl.endsWith("/") ? bridgeUrl : `${bridgeUrl}/`);
    const actionUrl = new URL(targetType === "group" ? "upload_group_file" : "upload_private_file", baseUrl);
    const requestHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    const numericTargetId = /^\d+$/.test(targetId) ? Number(targetId) : targetId;
    const payload = targetType === "group"
      ? { group_id: numericTargetId, file: targetPath, name: fileName }
      : { user_id: numericTargetId, file: targetPath, name: fileName };
    const response = await postJson(actionUrl, requestHeaders, payload);

    if (response && typeof response === "object") {
      const retcode = Number(response.retcode);
      const status = String(response.status || "").toLowerCase();
      if ((Number.isFinite(retcode) && retcode !== 0) || (status && status !== "ok")) {
        const error = new Error(`QQ bridge file upload failed: ${response.wording || response.message || response.msg || `retcode=${response.retcode}`}`);
        error.statusCode = 502;
        error.bridgeResponse = response;
        throw error;
      }
    }

    return {
      ok: true,
      targetType,
      targetId,
      path: path.relative(root, targetPath).replace(/\\/g, "/"),
      shareRoot,
      fileName,
      response,
    };
  }

  function normalizeQqIncomingText(event = {}) {
    if (Array.isArray(event.message)) {
      return event.message
        .map((segment) => {
          if (segment?.type === "text") return String(segment.data?.text || "");
          if (segment?.type === "at") return "";
          return "";
        })
        .join("")
        .trim();
    }

    if (typeof event.message === "string") {
      return event.message.trim();
    }

    return "";
  }

  function isGroupMentioned(event = {}) {
    const selfId = String(event.self_id || "");
    if (Array.isArray(event.message)) {
      return event.message.some((segment) => segment?.type === "at" && String(segment.data?.qq || "") === selfId);
    }
    return typeof event.raw_message === "string" && selfId ? event.raw_message.includes(`[CQ:at,qq=${selfId}]`) : false;
  }

  function stripQqTriggerPrefix(text = "", config = qqBotConfig) {
    const raw = String(text || "").trim();
    const prefix = String(config.triggerPrefix || "").trim();
    if (!prefix) return raw;
    return raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : "";
  }

  function isQqEventAllowed(event = {}, config = qqBotConfig) {
    const userId = String(event.user_id || "").trim();
    const groupId = String(event.group_id || "").trim();
    const allowedUsers = parseQqIdList(config.allowedUsers);
    const allowedGroups = parseQqIdList(config.allowedGroups);

    if (allowedUsers.length && !allowedUsers.includes(userId)) {
      return false;
    }
    if (event.message_type === "group" && allowedGroups.length && !allowedGroups.includes(groupId)) {
      return false;
    }
    return true;
  }

  function getQqSessionKey(event = {}) {
    if (event.message_type === "group") {
      return `group:${event.group_id || "unknown"}:user:${event.user_id || "unknown"}`;
    }
    return `private:${event.user_id || "unknown"}`;
  }

  function isQqSessionResetCommand(text = "") {
    const normalized = String(text || "").trim().toLowerCase();
    return normalized === "/new" || normalized === "/reset";
  }

  async function clearQqSession(event = {}) {
    const sessionKey = getQqSessionKey(event);
    if (qqBotSessions[sessionKey]) {
      delete qqBotSessions[sessionKey];
      await saveQqBotSessions();
    }
  }

  function trimSessionMessages(messages = []) {
    return messages.slice(-24);
  }

  const LIVE_WEB_QUERY_HINT_RE = /(?:\bweb_search\b|联网|上网|网页|网络搜索|联网搜索|搜索工具|联网工具|最新|实时|热搜|新闻|资讯|热点|榜单|要点)/i;
  const LIVE_WEB_QUERY_ACTION_RE = /(?:查|查询|搜索|搜|获取|整理|汇总|总结|播报|看下|看看)/i;

  function shouldUseLeanQqWebSearchMode(userText = "", tools = []) {
    const text = String(userText || "").trim();
    if (!text) {
      return false;
    }
    if (/(?:定时任务|计划任务|cron|发送文件|发文件)/i.test(text) || parseQqModelAdminCommand(text) || parseQqPersonaAdminCommand(text)) {
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

  function trimQqSessionForLeanWebSearch(messages = []) {
    return Array.isArray(messages) ? messages.slice(-4) : [];
  }

  function collectStructuredContentText(content, bucket = []) {
    if (typeof content === "string") {
      const trimmed = content.trim();
      if (trimmed) bucket.push(trimmed);
      return bucket;
    }
    if (Array.isArray(content)) {
      content.forEach((item) => collectStructuredContentText(item, bucket));
      return bucket;
    }
    if (!content || typeof content !== "object") {
      return bucket;
    }

    if (typeof content.text === "string") {
      const trimmed = content.text.trim();
      if (trimmed) bucket.push(trimmed);
    } else if (content.text && typeof content.text === "object" && typeof content.text.value === "string") {
      const trimmed = content.text.value.trim();
      if (trimmed) bucket.push(trimmed);
    }

    if (typeof content.content === "string" || Array.isArray(content.content) || (content.content && typeof content.content === "object")) {
      collectStructuredContentText(content.content, bucket);
    }

    return bucket;
  }

  function normalizeModelReplyContent(content) {
    return stripModelThinkingContent(collectStructuredContentText(content, [])
      .join("\n")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim());
  }

  function buildQqSkillSystemPrompt(config = {}) {
    void config;
    return "";
  }

  buildQqSkillSystemPrompt = function buildQqSkillSystemPromptWithWorkspaceSkills(config = {}) {
    void config;
    return "";
  };

  function getCurrentTimeCalibrationText() {
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
    return `当前系统时间（以北京时间为准）是：${currentTime}。涉及今天、昨天、明天、当前日期、当前时间、本周、本月等相对时间时，必须以这个时间为准，不要自行假设或沿用过期时间。`;
  }

  function clampLeanQqSystemText(value = "", maxLength = 520) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) {
      return "";
    }
    if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  function buildLeanQqWebSearchSystemPrompt(resolvedConfig = {}) {
    const parts = [];
    const personaText = clampLeanQqSystemText(
      resolvedConfig.persona || resolvedConfig.systemPrompt || "",
      520
    );
    if (personaText) {
      parts.push(personaText);
    }
    parts.push(`You are replying as QQ assistant "${resolvedConfig.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName}". Reply directly to the user and do not explain tool calls or internal system details.`);
    parts.push(getCurrentTimeCalibrationText());
    parts.push("This is a live web search request. Focus on current facts, use web_search when needed, and answer concisely in Chinese.");
    return parts.filter(Boolean).join("\n\n");
  }

  async function generateQqBotReply(event = {}) {
    const targetType = event.message_type === "group" ? "group" : "private";
    const targetId = targetType === "group" ? String(event.group_id || "") : String(event.user_id || "");
    const resolvedConfig = getResolvedQqConfig(targetType, targetId);
    const sessionKey = getQqSessionKey(event);
    const session = Array.isArray(qqBotSessions[sessionKey]?.messages) ? qqBotSessions[sessionKey].messages : [];
    const rawUserText = normalizeQqIncomingText(event);
    const userText = stripQqTriggerPrefix(rawUserText, resolvedConfig);
    if (!userText) {
      return "";
    }

    const directModelAdminReply = await tryHandleDirectQqModelAdminCommand({
      targetType,
      targetId,
      sessionKey,
      session,
      userText,
    });
    if (directModelAdminReply) {
      return directModelAdminReply;
    }

    const directWebSearchTools = buildQqAllowedTools(toolScopedConfig);
    const directWebSearch = await maybeRunDirectWebSearch({
      text: userText,
      enabled: directWebSearchTools.some((tool) => tool?.function?.name === "web_search"),
      searchWeb: async (query, limit) => await executeToolCall("web_search", { query, limit }),
      intro: "联网搜索结果",
    });
    if (directWebSearch?.reply) {
      await saveQqSessionReply(sessionKey, session, userText, directWebSearch.reply);
      debug(`chat direct_web_search target=${targetType}:${targetId} query=${directWebSearch.query}`);
      return directWebSearch.reply;
    }
    const model = String(resolvedConfig.model || "").trim();
    if (!model) {
      const error = new Error("QQ 机器人未配置模型。请先在页面的基础连接中选择模型，并同步 QQ 配置。");
      error.statusCode = 400;
      throw error;
    }

    const directScheduledTaskArgs = inferScheduledTaskArgsFromText(userText);
    if (directScheduledTaskArgs) {
      const task = await executeToolCall("create_scheduled_task", directScheduledTaskArgs);
      const reply = formatScheduledTaskCreationReply(task);
      qqBotSessions[sessionKey] = {
        updatedAt: Date.now(),
        messages: trimSessionMessages([
          ...session,
          { role: "user", content: userText },
          { role: "assistant", content: reply },
        ]),
      };
      await saveQqBotSessions();
      debug(`direct scheduled task created target=${targetType}:${targetId} cron=${task?.cronExpression || ""}`);
      return reply;
    }

    const tools = buildQqAllowedTools(resolvedConfig);
    const systemPrompt = [
      resolvedConfig.persona || resolvedConfig.systemPrompt || "",
      `You are replying as QQ assistant "${resolvedConfig.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName}". Reply directly to the user and do not explain tool calls or internal system details.`,
      getCurrentTimeCalibrationText(),
      buildQqToolSystemPrompt(resolvedConfig),
      buildQqSkillSystemPrompt(resolvedConfig),
    ].filter(Boolean).join("\n\n");

    const messages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...session,
      { role: "user", content: userText },
    ];

    const modelService = getResolvedModelServiceConfig();
    const chatUrl = new URL(modelService.chatPath, modelService.targetOrigin);
    let data;
    try {
      data = await postJson(chatUrl, modelService.authHeaders, {
        model,
        messages,
        temperature: 0.7,
        stream: false,
      });
    } catch (error) {
      const rawMessage = String(error?.message || "");
      if (/No models loaded/i.test(rawMessage)) {
        const nextError = new Error(`QQ 机器人请求失败：本地模型服务当前没有加载模型。请先在模型服务里加载模型，或在网页中为 QQ 机器人明确选择一个可用模型。`);
        nextError.statusCode = 503;
        throw nextError;
      }
      throw error;
    }

    const message = data?.choices?.[0]?.message;
    const reply = normalizeModelReplyContent(message?.content);

    if (!reply) {
      return "";
    }

    qqBotSessions[sessionKey] = {
      updatedAt: Date.now(),
      messages: trimSessionMessages([
        ...session,
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      ]),
    };
    await saveQqBotSessions();
    return reply;
  }

  generateQqBotReply = async function generateQqBotReplyWithTools(event = {}) {
    const targetType = event.message_type === "group" ? "group" : "private";
    const targetId = targetType === "group" ? String(event.group_id || "") : String(event.user_id || "");
    const actorUserId = String(event.user_id || "").trim();
    const resolvedConfig = getResolvedQqConfig(targetType, targetId);
    const toolScopedConfig = hasQqSuperPermission({ targetType, targetId, actorUserId })
      ? { ...resolvedConfig, superPermissionEnabled: true }
      : resolvedConfig;
    const sessionKey = getQqSessionKey(event);
    const session = Array.isArray(qqBotSessions[sessionKey]?.messages) ? qqBotSessions[sessionKey].messages : [];
    const rawUserText = normalizeQqIncomingText(event);
    const userText = stripQqTriggerPrefix(rawUserText, resolvedConfig);
    if (!userText) {
      return "";
    }

    const directModelAdminReply = await tryHandleDirectQqModelAdminCommand({
      targetType,
      targetId,
      actorUserId,
      sessionKey,
      session,
      userText,
    });
    if (directModelAdminReply) {
      return directModelAdminReply;
    }

    const directPersonaAdminReply = await tryHandleDirectQqPersonaAdminCommand({
      targetType,
      targetId,
      actorUserId,
      sessionKey,
      session,
      userText,
    });
    if (directPersonaAdminReply) {
      return directPersonaAdminReply;
    }

    const directScheduledTaskReply = await tryHandleDirectScheduledTaskIntent({
      targetType,
      targetId,
      actorUserId,
      bridgeUrl: resolvedConfig.bridgeUrl,
      accessToken: resolvedConfig.accessToken,
      fileShareRoots: resolvedConfig.fileShareRoots,
      sessionKey,
      session,
      userText,
      model: String(resolvedConfig.model || "").trim(),
    });
    if (directScheduledTaskReply) {
      return directScheduledTaskReply;
    }

    const directWebSearchTools = buildQqAllowedTools(toolScopedConfig);
    const directWebSearchResult = await maybeRunDirectWebSearch({
      text: userText,
      enabled: directWebSearchTools.some((tool) => tool?.function?.name === "web_search"),
      searchWeb: async (query, limit) => await executeToolCall("web_search", { query, limit }),
      intro: "联网搜索结果",
    });
    if (directWebSearchResult?.reply) {
      await saveQqSessionReply(sessionKey, session, userText, directWebSearchResult.reply);
      debug(`chat direct_web_search target=${targetType}:${targetId} query=${directWebSearchResult.query}`);
      return directWebSearchResult.reply;
    }

    const model = String(resolvedConfig.model || "").trim();
    if (!model) {
      const error = new Error("QQ 机器人未配置模型。请先在页面的基础连接中选择模型，并同步 QQ 配置。");
      error.statusCode = 400;
      throw error;
    }

    const tools = buildQqAllowedTools(toolScopedConfig);
    const leanWebSearchMode = shouldUseLeanQqWebSearchMode(userText, tools);
    const requestTools = leanWebSearchMode
      ? tools.filter((tool) => tool?.function?.name === "web_search")
      : tools;
    const requestSession = leanWebSearchMode ? trimQqSessionForLeanWebSearch(session) : session;
    const systemPrompt = leanWebSearchMode
      ? buildLeanQqWebSearchSystemPrompt(resolvedConfig)
      : [
        resolvedConfig.persona || resolvedConfig.systemPrompt || "",
        `You are replying as QQ assistant "${resolvedConfig.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName}". Reply directly to the user and do not explain tool calls or internal system details.`,
        getCurrentTimeCalibrationText(),
        buildQqToolSystemPrompt(toolScopedConfig),
        buildQqSkillSystemPrompt(resolvedConfig),
      ].filter(Boolean).join("\n\n");

    let workingMessages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...requestSession,
      { role: "user", content: userText },
    ];

    debug(`chat request target=${targetType}:${targetId} model=${model} messages=${workingMessages.length} tools=${requestTools.map((tool) => tool?.function?.name).filter(Boolean).join(",") || "none"} lean_web_search=${leanWebSearchMode ? 1 : 0}`);
    try {
      currentQqToolContext = {
        bridgeUrl: resolvedConfig.bridgeUrl,
        accessToken: resolvedConfig.accessToken,
        targetType,
        targetId,
        actorUserId,
        fileShareRoots: resolvedConfig.fileShareRoots,
      };
      const helperReply = await callLocalModelWithTools({
        model,
        messages: workingMessages,
        tools: requestTools,
        requiredToolName: leanWebSearchMode ? "web_search" : "",
        singleUseToolNames: leanWebSearchMode ? ["web_search"] : [],
        temperature: leanWebSearchMode ? 0.2 : 0.7,
        maxRounds: leanWebSearchMode ? 2 : 6,
      });
      debug(`chat response target=${targetType}:${targetId} content_length=${String(helperReply || "").length}`);
      if (!helperReply) {
        return "";
      }

      qqBotSessions[sessionKey] = {
        updatedAt: Date.now(),
        messages: trimSessionMessages([
          ...session,
          { role: "user", content: userText },
          { role: "assistant", content: helperReply },
        ]),
      };
      await saveQqBotSessions();
      return helperReply;
    } catch (error) {
      const rawMessage = String(error?.message || "");
      if (/No models loaded/i.test(rawMessage)) {
        const nextError = new Error("QQ 机器人请求失败：本地模型服务当前没有加载模型。请先在模型服务里加载模型，或在网页里为 QQ 机器人明确选择一个可用模型。");
        nextError.statusCode = 503;
        throw nextError;
      }
      throw error;
    } finally {
      currentQqToolContext = null;
    }

    const modelService = getResolvedModelServiceConfig();
    const chatUrl = new URL(modelService.chatPath, modelService.targetOrigin);
    let reply = "";

    for (let i = 0; i < 6; i += 1) {
      let data;
      try {
        debug(`chat request target=${targetType}:${targetId} round=${i + 1} model=${model} messages=${workingMessages.length} tools=${tools.map((tool) => tool?.function?.name).filter(Boolean).join(",") || "none"}`);
        data = await postJson(chatUrl, modelService.authHeaders, {
          model,
          messages: workingMessages,
          temperature: 0.7,
          tools,
          tool_choice: tools.length ? "auto" : "none",
          stream: false,
        });
      } catch (error) {
        const rawMessage = String(error?.message || "");
        if (/No models loaded/i.test(rawMessage)) {
          const nextError = new Error("QQ 机器人请求失败：本地模型服务当前没有加载模型。请先在模型服务里加载模型，或在网页里为 QQ 机器人明确选择一个可用模型。");
          nextError.statusCode = 503;
          throw nextError;
        }
        throw error;
      }

      const message = data?.choices?.[0]?.message;
      if (!message) {
        throw new Error("QQ model reply missing assistant message");
      }
      debug(`chat response target=${targetType}:${targetId} round=${i + 1} tool_calls=${Array.isArray(message.tool_calls) ? message.tool_calls.length : 0} content_length=${String(normalizeModelReplyContent(message?.content)).length}`);

      const currentReply = normalizeModelReplyContent(message?.content);
      if (currentReply) {
        reply = currentReply;
      }

      workingMessages.push({
        role: "assistant",
        content: message.content || currentReply,
        tool_calls: message.tool_calls,
      });

      if (!Array.isArray(message.tool_calls) || !message.tool_calls.length) {
        break;
      }

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall?.function?.name || "";
        const args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
        const result = await executeToolCall(toolName, args);
        workingMessages.push({
          role: "tool",
          tool_call_id: toolCall.id || `${toolName}-${Date.now()}`,
          content: JSON.stringify(result, null, 2),
        });
      }
    }

    if (!reply) {
      return "";
    }

    qqBotSessions[sessionKey] = {
      updatedAt: Date.now(),
      messages: trimSessionMessages([
        ...session,
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      ]),
    };
    await saveQqBotSessions();
    return reply;
  };

  async function handleQqWebhook(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const event = rawBody ? JSON.parse(rawBody) : {};
      debug(`webhook received post_type=${event.post_type || ""} message_type=${event.message_type || ""} user=${event.user_id || ""} group=${event.group_id || ""}`);

      if (!qqBotConfig.enabled) {
        debug("webhook ignored reason=bot_disabled");
        sendJson(res, 200, { ok: true, ignored: "bot_disabled" });
        return;
      }
      if (event.post_type !== "message") {
        debug("webhook ignored reason=non_message_event");
        sendJson(res, 200, { ok: true, ignored: "non_message_event" });
        return;
      }
      if (String(event.user_id || "") === String(event.self_id || "")) {
        debug("webhook ignored reason=self_message");
        sendJson(res, 200, { ok: true, ignored: "self_message" });
        return;
      }

      const targetType = event.message_type === "group" ? "group" : "private";
      const targetId = targetType === "group" ? String(event.group_id || "") : String(event.user_id || "");
      const resolvedConfig = getResolvedQqConfig(targetType, targetId);

      if (!isQqEventAllowed(event, resolvedConfig)) {
        debug(`webhook ignored reason=not_allowed target=${targetType}:${targetId}`);
        sendJson(res, 200, { ok: true, ignored: "not_allowed" });
        return;
      }

      if (event.message_type === "group" && resolvedConfig.groupMentionOnly && !isGroupMentioned(event)) {
        debug(`webhook ignored reason=group_no_mention target=${targetType}:${targetId}`);
        sendJson(res, 200, { ok: true, ignored: "group_no_mention" });
        return;
      }

      const normalizedIncomingText = normalizeQqIncomingText(event);
      if (isQqSessionResetCommand(normalizedIncomingText)) {
        await clearQqSession(event);
        await sendQqMessageFinal({
          bridgeUrl: resolvedConfig.bridgeUrl,
          accessToken: resolvedConfig.accessToken,
          targetType,
          targetId,
          message: "Current QQ conversation has been reset.",
        });
        sendJson(res, 200, { ok: true, reset: true });
        return;
      }

      if (resolvedConfig.triggerPrefix && !stripQqTriggerPrefix(normalizedIncomingText, resolvedConfig)) {
        debug(`webhook ignored reason=missing_prefix target=${targetType}:${targetId}`);
        sendJson(res, 200, { ok: true, ignored: "missing_prefix" });
        return;
      }

      if (typeof handleExternalCommand === "function") {
        const externalReply = await handleExternalCommand({
          text: normalizedIncomingText,
          event,
          targetType,
          targetId,
          resolvedConfig,
          actorUserId: String(event.user_id || "").trim(),
        });
        if (externalReply) {
          await sendQqMessageFinal({
            bridgeUrl: resolvedConfig.bridgeUrl,
            accessToken: resolvedConfig.accessToken,
            targetType,
            targetId,
            message: String(externalReply || ""),
          });
          sendJson(res, 200, { ok: true, replied: true, external: true });
          return;
        }
      }

      const reply = await generateQqBotReply(event);
      if (!reply) {
        debug(`webhook ignored reason=empty_reply target=${targetType}:${targetId}`);
        sendJson(res, 200, { ok: true, ignored: "empty_reply" });
        return;
      }

      await sendQqMessageFinal({
        bridgeUrl: resolvedConfig.bridgeUrl,
        accessToken: resolvedConfig.accessToken,
        targetType,
        targetId,
        message: reply,
      });

      debug(`webhook replied target=${targetType}:${targetId} length=${reply.length}`);
      sendJson(res, 200, { ok: true, replied: true });
    } catch (error) {
      console.error("QQ webhook failed:", error);
      debug(`webhook failed error=${error.message || "unknown"}`);
      sendJson(res, 200, {
        ok: false,
        ignored: "handler_error",
        error: error.message || "QQ webhook failed",
      });
    }
  }

  function handleQqBotConfigGet(res) {
    sendJson(res, 200, { ok: true, config: { ...qqBotConfig, model: getSharedConnectionModel() } });
  }

  async function handleQqBotConfigPost(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const config = await saveQqBotConfig(payload);
      sendJson(res, 200, { ok: true, config });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to save QQ bot config" });
    }
  }

  function withCurrentQqTaskPush(args = {}, { forUpdate = false } = {}) {
    const nextArgs = args && typeof args === "object" ? { ...args } : {};
    const currentTargetId = String(currentQqToolContext?.targetId || "").trim();
    if (!currentTargetId) {
      return nextArgs;
    }

    const hasQqPushEnabled = Object.prototype.hasOwnProperty.call(nextArgs, "qqPushEnabled");
    const shouldEnableQqPush = forUpdate ? nextArgs.qqPushEnabled === true : nextArgs.qqPushEnabled !== false;
    if (!shouldEnableQqPush) {
      return nextArgs;
    }

    if (!forUpdate && !hasQqPushEnabled) {
      nextArgs.qqPushEnabled = true;
    }
    if (!String(nextArgs.qqTargetId || "").trim()) {
      nextArgs.qqTargetId = currentTargetId;
    }
    if (!String(nextArgs.qqTargetType || "").trim()) {
      nextArgs.qqTargetType = normalizeTargetType(currentQqToolContext?.targetType || "private");
    }
    return nextArgs;
  }

  function withCurrentQqTaskCreator(args = {}) {
    const nextArgs = args && typeof args === "object" ? { ...args } : {};
    const currentTargetId = String(currentQqToolContext?.targetId || "").trim();
    if (!currentTargetId) {
      return nextArgs;
    }
    if (!String(nextArgs.creatorId || "").trim()) {
      nextArgs.creatorId = currentTargetId;
    }
    if (!String(nextArgs.creatorType || "").trim()) {
      nextArgs.creatorType = normalizeTargetType(currentQqToolContext?.targetType || "private");
    }
    return nextArgs;
  }

  function formatScheduledTaskQqPushMessage(task = {}) {
    const taskName = String(task.name || "Scheduled task").trim() || "Scheduled task";
    const runAt = Number(task.lastRunAt) || Date.now();
    const runText = new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(runAt)).replace(/\//g, "-");
    const detail = String(task.lastStatus === "error" ? task.lastError : task.lastResult || "").trim();

    if (task.lastStatus === "error") {
      return [
        `定时任务：${taskName}`,
        `执行时间：${runText}`,
        detail ? `执行失败：${detail}` : "执行失败",
      ].join("\n");
    }

    return [
      `定时任务：${taskName}`,
      `执行时间：${runText}`,
      detail || "任务已执行完成。",
    ].join("\n");
  }

  function wrapToolExecutor(baseExecuteToolCall) {
    return async function executeToolCallWithQqFinal(name, args = {}) {
      if (name === "send_qq_message") {
        return await sendQqMessageFinal(args);
      }
      if (name === "send_qq_file") {
        return await sendQqFileFinal(args);
      }
      if (name === "list_available_models") {
        assertQqSuperPermission(
          currentQqToolContext?.targetType || "private",
          currentQqToolContext?.targetId || "",
          currentQqToolContext?.actorUserId || ""
        );
        return await listAvailableModelsForQq();
      }
      if (name === "switch_active_model") {
        assertQqSuperPermission(
          currentQqToolContext?.targetType || "private",
          currentQqToolContext?.targetId || "",
          currentQqToolContext?.actorUserId || ""
        );
        return await switchActiveModelForQq(args);
      }
      if (name === "list_scheduled_tasks") {
        return await baseExecuteToolCall(name, {
          ...args,
          ...getCurrentQqScheduledTaskScope(),
        });
      }
      if (name === "create_scheduled_task") {
        return await baseExecuteToolCall(name, withCurrentQqTaskCreator(withCurrentQqTaskPush(args)));
      }
      if (name === "update_scheduled_task") {
        return await baseExecuteToolCall(name, {
          ...getCurrentQqScheduledTaskScope(),
          ...withCurrentQqTaskCreator(withCurrentQqTaskPush(args, { forUpdate: true })),
        });
      }
      if (name === "delete_scheduled_task" || name === "run_scheduled_task") {
        return await baseExecuteToolCall(name, {
          ...args,
          ...getCurrentQqScheduledTaskScope(),
        });
      }
      return baseExecuteToolCall(name, args);
    };
  }

  function formatScheduledTaskQqPushMessageSafe(task = {}) {
    const taskName = String(task.name || "Scheduled task").trim() || "Scheduled task";
    const runAt = Number(task.lastRunAt) || Date.now();
    const runText = new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(runAt)).replace(/\//g, "-");
    const detail = String(task.lastStatus === "error" ? task.lastError : task.lastResult || "").trim();
    if (task.lastStatus === "error") {
      return [`Scheduled task: ${taskName}`, `Run time: ${runText}`, detail ? `Failed: ${detail}` : "Failed"].join("\n");
    }
    return [`Scheduled task: ${taskName}`, `Run time: ${runText}`, detail || "Task completed."].join("\n");
  }

  async function pushScheduledTaskResultToQq(task) {
    if (
      !task ||
      !task.qqPushEnabled ||
      !String(task.qqTargetId || "").trim() ||
      (task.lastStatus !== "success" && task.lastStatus !== "error")
    ) {
      return task;
    }

    const targetConfig = getResolvedQqConfig(
      task.qqTargetType || "private",
      task.qqTargetId
    );
    await sendQqMessageFinal({
      bridgeUrl: targetConfig.bridgeUrl,
      accessToken: targetConfig.accessToken,
      targetType: normalizeTargetType(task.qqTargetType || "private"),
      targetId: String(task.qqTargetId || "").trim(),
      message: formatScheduledTaskQqPushMessageSafe(task),
    });
    return task;
  }

  function wrapScheduledTaskRunner(baseRunScheduledTask) {
    return async function runScheduledTaskWithQqPush(taskId) {
      const task = await baseRunScheduledTask(taskId);
      try {
        await pushScheduledTaskResultToQq(task);
      } catch (error) {
        console.error("Failed to push scheduled task result to QQ:", error);
      }
      return task;
    };
  }

  return {
    loadQqBotConfig,
    loadQqBotSessions,
    sendQqMessage,
    handleQqBotConfigGet,
    handleQqBotConfigPost,
    handleQqWebhook,
    wrapToolExecutor,
    wrapScheduledTaskRunner,
    pushScheduledTaskResultToQq,
    getQqBotConfig: () => qqBotConfig,
  };
}

module.exports = {
  createQqModule,
};
