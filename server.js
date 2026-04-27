const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");
const {
  createStaticPathGuard,
  migrateLegacyDataFile,
  readJsonFile,
  readTextFile,
  readRequestBody,
  resolveWorkspacePath,
  stripModelThinkingContent,
  writeFileAtomic,
  writeJsonFileAtomic,
} = require("./server/server-utils");
const { createExecuteToolCall } = require("./server/server-tool-dispatcher");
const { createQqModule } = require("./server/server-qq");
const { createTaskModelInvoker } = require("./server/server-task-model");
const { createPersonaHandlers } = require("./server/server-personas");
const { createScheduler } = require("./server/server-scheduler");
const { createStartupCleanup } = require("./server/server-cleanup");
const { createDataInitializer, createServerBootstrap } = require("./server/server-bootstrap");
const { createSharedConnectionConfigModule } = require("./server/server-connection-config");
const { createMysqlStorage } = require("./server/server-mysql-storage");
const {
  createStaticServer,
  createApiProxy,
  requestJsonWithRetry,
  requestBufferWithRetry,
} = require("./server/server-http");
const { createNovelModule } = require("./server/server-novel-projects");
const {
  inferScheduledTaskArgsFromText,
  inferScheduledTaskIntentFromText,
  formatScheduledTaskCreationReply,
  formatScheduledTaskActionReply,
} = require("./server/server-schedule-intent");

const HOST = "127.0.0.1";
const PORT = 8000;
const TARGET_ORIGIN = "http://127.0.0.1:1234";
const DEFAULT_CHAT_API_PATH = "/v1/chat/completions";
const DEFAULT_MODELS_API_PATH = "/v1/models";
const NOVEL_MODEL_TIMEOUT_MS = 30 * 60 * 1000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const LOGS_DIR = path.join(ROOT, "logs");
const NOVELS_DIR = path.join(DATA_DIR, "novels");
const LEGACY_PERSONA_PRESETS_DIR = path.join(ROOT, "人设");
const LEGACY_SCHEDULED_TASKS_FILE = path.join(ROOT, "scheduled-tasks.json");
const LEGACY_QQ_BOT_CONFIG_FILE = path.join(ROOT, "qq-bot-config.json");
const LEGACY_QQ_BOT_SESSIONS_FILE = path.join(ROOT, "qq-bot-sessions.json");
const LEGACY_CONNECTION_CONFIG_FILE = path.join(ROOT, "connection-config.json");
const SCHEDULED_TASKS_FILE = path.join(DATA_DIR, "scheduled-tasks.json");
const QQ_BOT_CONFIG_FILE = path.join(DATA_DIR, "qq-bot-config.json");
const QQ_BOT_SESSIONS_FILE = path.join(DATA_DIR, "qq-bot-sessions.json");
const CONNECTION_CONFIG_FILE = path.join(DATA_DIR, "connection-config.json");
const MYSQL_CONFIG_FILE = path.join(DATA_DIR, "mysql-config.json");
const PERSONA_PRESETS_DIR = path.join(DATA_DIR, "personas");
const SCHEDULER_TICK_MS = 30 * 1000;
const PUBLIC_STATIC_PATHS = new Set(["/"]);
const DEFAULT_QQ_PUSH_TARGET_TYPE = "private";
const DEFAULT_QQ_PUSH_TARGET_ID = "1036986718";
const isPublicStaticPath = createStaticPathGuard(ROOT, {
  exactPaths: PUBLIC_STATIC_PATHS,
  publicDir: "public",
});
let loadSharedConnectionConfig;
let saveSharedConnectionConfig;
let getSharedConnectionConfig;
let handleSharedConnectionConfigGet;
let handleSharedConnectionConfigPost;
let serveStatic;
let proxyRequest;
let initMysqlStorage;
let handleMysqlStorageStatus;
let handleChatRecordsList;
let handleChatRecordsSync;
let handleStorageConfigGet;
let handleStorageConfigSave;
let logChatApiRequest;
let saveStorageConfig;
let getMysqlStorageConfig;
let claimPendingChatJob;
let completeChatJob;
let failChatJob;
let claimPendingNovelJob;
let completeNovelJob;
let failNovelJob;

function appendServerDebugLog(message) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOGS_DIR, "server-debug.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {}
}

function appendCommandAuditLog(record = {}) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(LOGS_DIR, "command-audit.log"),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        ...record,
      })}\n`,
      "utf8"
    );
  } catch {}
}

const runStartupCleanup = createStartupCleanup({
  dataDir: DATA_DIR,
  logsDir: LOGS_DIR,
  appendServerDebugLog,
});
const initializeDataFiles = createDataInitializer({
  dataDir: DATA_DIR,
  personaPresetsDir: PERSONA_PRESETS_DIR,
  legacyPersonaPresetsDir: LEGACY_PERSONA_PRESETS_DIR,
  scheduledTasksFile: SCHEDULED_TASKS_FILE,
  legacyScheduledTasksFile: LEGACY_SCHEDULED_TASKS_FILE,
  qqBotConfigFile: QQ_BOT_CONFIG_FILE,
  legacyQqBotConfigFile: LEGACY_QQ_BOT_CONFIG_FILE,
  qqBotSessionsFile: QQ_BOT_SESSIONS_FILE,
  legacyQqBotSessionsFile: LEGACY_QQ_BOT_SESSIONS_FILE,
  connectionConfigFile: CONNECTION_CONFIG_FILE,
  legacyConnectionConfigFile: LEGACY_CONNECTION_CONFIG_FILE,
  migrateLegacyDataFile,
});
({
  loadSharedConnectionConfig,
  saveSharedConnectionConfig,
  getSharedConnectionConfig,
  handleSharedConnectionConfigGet,
  handleSharedConnectionConfigPost,
} = createSharedConnectionConfigModule({
  connectionConfigFile: CONNECTION_CONFIG_FILE,
  readJsonFile,
  writeJsonFileAtomic,
  readRequestBody,
  sendJson,
}));

({
  initMysqlStorage,
  handleMysqlStorageStatus,
  handleChatRecordsList,
  handleChatRecordsSync,
  handleConfigGet: handleStorageConfigGet,
  handleConfigSave: handleStorageConfigSave,
  saveConfig: saveStorageConfig,
  logChatApiRequest,
  getMysqlStorageConfig,
  claimPendingChatJob,
  completeChatJob,
  failChatJob,
  claimPendingNovelJob,
  completeNovelJob,
  failNovelJob,
} = createMysqlStorage({
  mysqlConfigFile: MYSQL_CONFIG_FILE,
  readJsonFile,
  readRequestBody,
  sendJson,
  logDebug: appendServerDebugLog,
}));

let scheduledTasks = [];
const runningScheduledTaskIds = new Set();
let loadScheduledTasks;
let saveScheduledTasks;
let listScheduledTasks;
let findEquivalentScheduledTask;
let ensureScheduledTask;
let resolveScheduledTask;
let validateScheduledTaskPayload;
let computeNextRunAt;
let sanitizeScheduledTask;
let runScheduledTask;
let startScheduledTaskLoop;
let handleScheduledTasksList;
let handleScheduledTasksCreate;
let handleScheduledTaskUpdate;
let handleScheduledTaskDelete;
let handleScheduledTaskRun;
let legacyQqBotConfigState = {
  enabled: false,
  groupMentionOnly: true,
  taskPushEnabled: false,
  triggerPrefix: "",
  allowedUsers: [],
  allowedGroups: [],
  persona: "",
  bridgeUrl: "",
  accessToken: "",
  defaultTargetType: DEFAULT_QQ_PUSH_TARGET_TYPE,
  defaultTargetId: DEFAULT_QQ_PUSH_TARGET_ID,
  model: "",
  systemPrompt: "",
  assistantName: "繁星",
};
let legacyQqBotSessionsState = {};
let loadQqBotConfig;
let loadQqBotSessions;
let sendQqMessage;
let handleQqBotConfigGet;
let handleQqBotConfigPost;
let handleQqWebhook;
let pushScheduledTaskResultToQq;
let getQqBotConfig;
let novelModule;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

serveStatic = createStaticServer({
  publicDir: PUBLIC_DIR,
  mimeTypes: MIME_TYPES,
  isPublicStaticPath,
  sendJson,
});
proxyRequest = createApiProxy({
  targetOrigin: TARGET_ORIGIN,
  getProxyConfig: () => {
    const resolved = getResolvedModelServiceConfig();
    return {
      targetOrigin: resolved.targetOrigin,
      chatPath: resolved.chatPath,
      modelsPath: resolved.modelsPath,
      extraHeaders: resolved.authHeaders,
      timeoutMs: NOVEL_MODEL_TIMEOUT_MS,
      retryCount: 1,
      retryDelayMs: 750,
    };
  },
  sendJson,
  logDebug: appendServerDebugLog,
});

function getResolvedModelServiceConfig() {
  const sharedConfig = typeof getSharedConnectionConfig === "function"
    ? (getSharedConnectionConfig() || {})
    : {};
  const remoteEnabled = sharedConfig?.remoteApiEnabled === true;
  const remoteBaseUrl = String(sharedConfig?.remoteBaseUrl || "").trim();
  const remoteApiKey = String(sharedConfig?.remoteApiKey || "").trim();
  const remoteApiPath = String(sharedConfig?.remoteApiPath || DEFAULT_CHAT_API_PATH).trim() || DEFAULT_CHAT_API_PATH;
  const remoteModelsPath = String(sharedConfig?.remoteModelsPath || DEFAULT_MODELS_API_PATH).trim() || DEFAULT_MODELS_API_PATH;
  const useRemote = remoteEnabled && remoteBaseUrl;
  return {
    mode: useRemote ? "remote" : "local",
    targetOrigin: useRemote ? remoteBaseUrl : TARGET_ORIGIN,
    chatPath: useRemote ? remoteApiPath : DEFAULT_CHAT_API_PATH,
    modelsPath: useRemote ? remoteModelsPath : DEFAULT_MODELS_API_PATH,
    authHeaders: useRemote && remoteApiKey ? { Authorization: `Bearer ${remoteApiKey}` } : {},
  };
}

function buildModelServiceUrl(kind = "chat") {
  const resolved = getResolvedModelServiceConfig();
  const apiPath = kind === "models" ? resolved.modelsPath : resolved.chatPath;
  return new URL(apiPath, resolved.targetOrigin);
}

async function warmupModelServiceConnection({ reason = "startup" } = {}) {
  const resolved = getResolvedModelServiceConfig();
  if (resolved.mode !== "remote") {
    return false;
  }

  const targetUrl = buildModelServiceUrl("models");
  try {
    await requestJson(targetUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...resolved.authHeaders,
      },
      timeoutMs: 10_000,
      retryCount: 2,
      retryDelayMs: 1_500,
    });
    appendServerDebugLog(`model warmup succeeded reason=${reason} url=${targetUrl.toString()}`);
    return true;
  } catch (error) {
    appendServerDebugLog(
      `model warmup failed reason=${reason} code=${String(error?.code || "")} `
      + `status=${String(error?.statusCode || "")} message=${String(error?.message || "unknown")}`
    );
    return false;
  }
}

function clampTextForModel(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

async function legacyLoadQqBotConfigV1() {
  legacyQqBotConfigState = {
    ...legacyQqBotConfigState,
    ...(await readJsonFile(QQ_BOT_CONFIG_FILE, {})),
  };
}

async function legacySaveQqBotConfigV1(nextConfig = {}) {
  legacyQqBotConfigState = {
    ...legacyQqBotConfigState,
    ...nextConfig,
  };
  await writeJsonFileAtomic(QQ_BOT_CONFIG_FILE, legacyQqBotConfigState);
  return legacyQqBotConfigState;
}

async function legacyLoadQqBotSessionsV1() {
  const loaded = await readJsonFile(QQ_BOT_SESSIONS_FILE, {});
  legacyQqBotSessionsState = loaded && typeof loaded === "object" ? loaded : {};
}

async function legacySaveQqBotSessionsV1() {
  await writeJsonFileAtomic(QQ_BOT_SESSIONS_FILE, legacyQqBotSessionsState);
}

function legacyParseQqIdListV1(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\r\n,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function requestJson(targetUrl, options = {}) {
  return requestJsonWithRetry(targetUrl, options);
}

async function requestBuffer(targetUrl, options = {}) {
  const response = await requestBufferWithRetry(targetUrl, options);
  return response.body;
}

function getRequestHeader(req, name) {
  const value = req.headers[String(name || "").toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function createMonitoredRequestId() {
  return `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveMonitoredRequestSource(req) {
  return (
    getRequestHeader(req, "x-ai-web-source") ||
    getRequestHeader(req, "origin") ||
    getRequestHeader(req, "referer") ||
    getRequestHeader(req, "host") ||
    "unknown"
  ).slice(0, 128);
}

function normalizeChatCompletionPayload(payload = {}) {
  const nextPayload = payload && typeof payload === "object" ? { ...payload } : {};
  if (nextPayload.stream === true) {
    nextPayload.stream = false;
  }
  if (!String(nextPayload.model || "").trim()) {
    const fallbackModel = String(getSharedConnectionConfig()?.model || "").trim();
    if (fallbackModel) {
      nextPayload.model = fallbackModel;
    }
  }
  return nextPayload;
}

function formatErrorForStorage(error) {
  if (error == null) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message || String(error);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function callConfiguredChatCompletion(payload = {}) {
  const resolved = getResolvedModelServiceConfig();
  const targetUrl = new URL(resolved.chatPath, resolved.targetOrigin);
  return await requestJson(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...resolved.authHeaders,
    },
    body: JSON.stringify(normalizeChatCompletionPayload(payload)),
    timeoutMs: NOVEL_MODEL_TIMEOUT_MS,
    retryCount: 1,
    retryDelayMs: 750,
  });
}

const BRIDGE_WEB_SEARCH_INTENT_RE = /(?:\bweb_search\b|\u8054\u7f51|\u4e0a\u7f51|\u7f51\u9875|\u7f51\u7edc\u641c\u7d22|\u641c\u7d22|\u6700\u65b0|\u5b9e\u65f6|\u65b0\u95fb|\u8d44\u8baf|\u70ed\u641c|\u4ef7\u683c|\u80a1\u4ef7|\u6c47\u7387|web search|latest|news|search)/i;
const BRIDGE_WEATHER_INTENT_RE = /(?:\u5929\u6c14|\u6e29\u5ea6|\u964d\u96e8|\u4e0b\u96e8|\u6e7f\u5ea6|\u98ce\u901f|weather|temperature|rain)/i;
const BRIDGE_SCHEDULER_INTENT_RE = /(?:\u5b9a\u65f6\u4efb\u52a1|\u5b9a\u65f6|\u8ba1\u5212\u4efb\u52a1|\u63d0\u9192|\u6bcf\u5929|\u6bcf\u65e5|\u6bcf\u5468|\u6bcf\u6708|\u81ea\u52a8\u6267\u884c|\u5468\u671f\u6267\u884c|cron|schedule|scheduled task|every day|every week)/i;

function extractLastUserTextFromPayload(payload = {}) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      const content = message?.content;
      if (typeof content === "string") {
        return content.trim();
      }
      if (Array.isArray(content)) {
        const text = content.map((item) => item?.text || "").join("\n").trim();
        if (text) return text;
      }
    }
  }
  return String(payload?.question || payload?.user_text || "").trim();
}

function createBridgeChatTools({ allowScheduler = false } = {}) {
  const tools = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a city or location when the user asks about weather.",
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
        description: "Search the live web for current information, news, prices, releases, or webpage findings.",
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
  ];

  if (allowScheduler) {
    tools.push(
      {
        type: "function",
        function: {
          name: "create_scheduled_task",
          description: "Create a scheduled task only when the user explicitly asks to schedule an automatic recurring task.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              prompt: { type: "string" },
              scheduleType: { type: "string", enum: ["cron"] },
              cronExpression: { type: "string" },
              enabled: { type: "boolean" },
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
          description: "Update, pause, resume, or change an existing scheduled task only when explicitly requested.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              prompt: { type: "string" },
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
          description: "Delete a scheduled task only when explicitly requested.",
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
          description: "Run a scheduled task immediately when explicitly requested.",
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
  }

  return tools;
}

function createBridgeTextResponse(text = "", model = "") {
  return {
    id: `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: String(model || ""),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: String(text || ""),
        },
        finish_reason: "stop",
      },
    ],
  };
}

async function callBridgeChatCompletion(payload = {}) {
  const requestPayload = normalizeChatCompletionPayload(payload);
  if (requestPayload.toolsEnabled === false) {
    return await callConfiguredChatCompletion(requestPayload);
  }

  const model = String(requestPayload.model || getSharedConnectionConfig()?.model || "").trim();
  if (!model) {
    return await callConfiguredChatCompletion(requestPayload);
  }

  const userText = extractLastUserTextFromPayload(requestPayload);
  const allowScheduler = BRIDGE_SCHEDULER_INTENT_RE.test(userText);
  const hasWeatherIntent = BRIDGE_WEATHER_INTENT_RE.test(userText);
  const hasWebSearchIntent = BRIDGE_WEB_SEARCH_INTENT_RE.test(userText) && !hasWeatherIntent;

  if (allowScheduler) {
    try {
      const handled = await executeScheduledTaskIntent(userText, model);
      return createBridgeTextResponse(handled.message, model);
    } catch (error) {
      appendServerDebugLog(`bridge_scheduler_intent_fallback ${formatErrorForStorage(error)}`);
    }
  }

  const messages = Array.isArray(requestPayload.messages) && requestPayload.messages.length
    ? requestPayload.messages
    : [{ role: "user", content: userText }];
  const bridgeSystemPrompt = [
    "You are handling a website chat request through the AI-web bridge.",
    "Use get_weather for weather questions.",
    "Use web_search for live or current information instead of guessing.",
    allowScheduler
      ? "The user explicitly mentioned scheduled tasks. You may manage scheduled tasks with the scheduler tools."
      : "Do not create, update, delete, or run scheduled tasks unless the user explicitly asks.",
    "After tool use, answer directly and concisely in the user's language.",
  ].join("\n");
  const text = await callLocalModelWithTools({
    model,
    messages: [{ role: "system", content: bridgeSystemPrompt }, ...messages],
    tools: createBridgeChatTools({ allowScheduler }),
    requiredToolName: hasWebSearchIntent ? "web_search" : (hasWeatherIntent ? "get_weather" : ""),
    singleUseToolNames: hasWebSearchIntent ? ["web_search"] : [],
    temperature: requestPayload.temperature,
    timeoutMs: NOVEL_MODEL_TIMEOUT_MS,
  });
  return createBridgeTextResponse(text, model);
}

async function processOneChatJob(workerId = "ai-web-worker") {
  const job = await claimPendingChatJob(workerId);
  if (!job) {
    return false;
  }

  const startedAt = Date.now();
  const requestPayload = normalizeChatCompletionPayload(job.requestPayload || {});
  try {
    const responsePayload = await callBridgeChatCompletion(requestPayload);
    await completeChatJob(job.id, {
      responsePayload,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    });
    await logChatApiRequest({
      requestId: job.requestId,
      source: job.source || "mysql-job",
      requestPayload,
      responsePayload,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    const errorText = formatErrorForStorage(error.message || error);
    await failChatJob(job.id, {
      errorText,
      statusCode: error.statusCode || 500,
      latencyMs: Date.now() - startedAt,
    });
    await logChatApiRequest({
      requestId: job.requestId,
      source: job.source || "mysql-job",
      requestPayload,
      statusCode: error.statusCode || 500,
      errorText,
      latencyMs: Date.now() - startedAt,
    });
  }
  return true;
}

function startMysqlChatJobWorker() {
  const config = typeof getMysqlStorageConfig === "function" ? getMysqlStorageConfig() : {};
  if (config.chatJobWorkerEnabled !== true) {
    return;
  }

  const workerId = `ai-web-${process.pid}`;
  const pollMs = Math.max(1000, Number(config.chatJobPollMs || 3000));
  const batchSize = Math.max(1, Math.min(5, Number(config.chatJobBatchSize || 1)));
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const processed = await processOneChatJob(workerId);
        if (!processed) {
          break;
        }
      }
    } catch (error) {
      appendServerDebugLog(`mysql_chat_job_worker_failed ${String(error?.message || error)}`);
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    tick().catch(() => {});
  }, pollMs);
  tick().catch(() => {});
  appendServerDebugLog(`mysql_chat_job_worker_started pollMs=${pollMs} batchSize=${batchSize}`);
}

async function callLocalNovelEndpoint(job = {}) {
  const method = String(job.method || "GET").toUpperCase();
  const pathValue = String(job.path || "/").trim();
  if (!pathValue.startsWith("/novels/") && pathValue !== "/novels/projects" && pathValue !== "/novels/infer-project") {
    const error = new Error("Unsupported novel bridge path");
    error.statusCode = 400;
    throw error;
  }

  const targetUrl = new URL(pathValue, `http://${HOST}:${PORT}`);
  const bodyPayload = job.requestPayload && typeof job.requestPayload === "object" ? job.requestPayload : {};
  const hasBody = !["GET", "HEAD"].includes(method);
  return await requestJson(targetUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-ai-web-source": job.source || "mysql-novel-job",
      "x-request-id": job.requestId,
    },
    body: hasBody ? JSON.stringify(bodyPayload) : undefined,
    timeoutMs: NOVEL_MODEL_TIMEOUT_MS + 30_000,
    retryCount: 0,
  });
}

async function processOneNovelJob(workerId = "ai-web-novel-worker") {
  const job = await claimPendingNovelJob(workerId);
  if (!job) {
    return false;
  }

  const startedAt = Date.now();
  try {
    const responsePayload = await callLocalNovelEndpoint(job);
    await completeNovelJob(job.id, {
      responsePayload,
      responseText: JSON.stringify(responsePayload || {}),
      contentType: "application/json; charset=utf-8",
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    const errorText = formatErrorForStorage(error.message || error);
    await failNovelJob(job.id, {
      errorText,
      statusCode: error.statusCode || 500,
      latencyMs: Date.now() - startedAt,
    });
  }
  return true;
}

function startMysqlNovelJobWorker() {
  const config = typeof getMysqlStorageConfig === "function" ? getMysqlStorageConfig() : {};
  if (config.novelJobWorkerEnabled === false) {
    return;
  }

  const workerId = `ai-web-novel-${process.pid}`;
  const pollMs = Math.max(1000, Number(config.novelJobPollMs || config.chatJobPollMs || 3000));
  const batchSize = Math.max(1, Math.min(3, Number(config.novelJobBatchSize || 1)));
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const processed = await processOneNovelJob(workerId);
        if (!processed) {
          break;
        }
      }
    } catch (error) {
      appendServerDebugLog(`mysql_novel_job_worker_failed ${String(error?.message || error)}`);
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    tick().catch(() => {});
  }, pollMs);
  tick().catch(() => {});
  appendServerDebugLog(`mysql_novel_job_worker_started pollMs=${pollMs} batchSize=${batchSize}`);
}

async function refreshMysqlAvailableModels() {
  if (typeof saveStorageConfig !== "function") {
    return false;
  }
  const modelsUrl = buildModelServiceUrl("models");
  const { authHeaders } = getResolvedModelServiceConfig();
  const data = await requestJson(modelsUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders,
    },
    timeoutMs: 10_000,
    retryCount: 1,
    retryDelayMs: 750,
  });
  const models = Array.isArray(data?.data)
    ? data.data.map((item) => String(item?.id || item?.name || "").trim()).filter(Boolean)
    : [];
  await saveStorageConfig("available-models", {
    models: Array.from(new Set(models)),
    updatedAt: Date.now(),
  });
  return true;
}

function startMysqlModelListSync() {
  const run = () => {
    refreshMysqlAvailableModels().catch((error) => {
      appendServerDebugLog(`mysql_model_list_sync_failed ${formatErrorForStorage(error)}`);
    });
  };
  setInterval(run, 60 * 1000);
  run();
}

async function handleMonitoredChatCompletion(req, res) {
  const startedAt = Date.now();
  const requestId = getRequestHeader(req, "x-request-id") || createMonitoredRequestId();
  const source = resolveMonitoredRequestSource(req);
  let payload = {};
  let statusCode = 500;
  let responsePayload = null;

  try {
    const rawBody = await readRequestBody(req, { limitBytes: 20 * 1024 * 1024 });
    payload = rawBody ? JSON.parse(rawBody) : {};
    payload = normalizeChatCompletionPayload(payload);
    responsePayload = await callConfiguredChatCompletion(payload);
    statusCode = 200;

    await logChatApiRequest({
      requestId,
      source,
      requestPayload: payload,
      responsePayload,
      statusCode,
      latencyMs: Date.now() - startedAt,
    });
    sendJson(res, statusCode, responsePayload);
  } catch (error) {
    const errorText = formatErrorForStorage(error.message || error);
    statusCode = error.statusCode || 500;
    try {
      await logChatApiRequest({
        requestId,
        source,
        requestPayload: payload,
        responsePayload,
        statusCode,
        errorText,
        latencyMs: Date.now() - startedAt,
      });
    } catch (logError) {
      appendServerDebugLog(`monitored_chat_log_failed ${String(logError?.message || logError)}`);
    }
    sendJson(res, statusCode, {
      error: errorText,
      requestId,
    });
  }
}

async function legacySendQqMessageV1(args = {}) {
  const bridgeUrl = String(args.bridgeUrl || "").trim();
  const targetType = String(args.targetType || "private").trim().toLowerCase();
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

  const action = targetType === "group" ? "send_group_msg" : "send_private_msg";
  const apiUrl = new URL(action, bridgeUrl.endsWith("/") ? bridgeUrl : `${bridgeUrl}/`).toString();
  const payload = targetType === "group"
    ? { group_id: /^\d+$/.test(targetId) ? Number(targetId) : targetId, message }
    : { user_id: /^\d+$/.test(targetId) ? Number(targetId) : targetId, message };

  const data = await requestJson(
    apiUrl,
    {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    payload
  );

  return {
    ok: true,
    targetType,
    targetId,
    message,
    bridgeUrl,
    response: data,
  };
}

async function legacyCallLocalModelForTaskV1(task) {
  const taskTools = [
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
  ];

  return await callLocalModelWithTools({
    model: task.model,
    messages: [
      {
        role: "system",
        content: "你正在执行一个定时任务，生成的内容会直接推送给最终用户。请直接输出要发送给用户的结果或提醒内容，不要把自己当成被提醒的人，也不要回复“好的、收到、明白了”这类自我应答。需要实时天气时，请调用 get_weather 工具，不要凭空猜测天气。",
      },
      {
        role: "user",
        content: task.prompt,
      },
    ],
    tools: taskTools,
  });
}

async function legacyExecuteToolCallV1(name, args = {}) {
  switch (name) {
    case "list_dir": {
      const targetPath = resolveWorkspacePath(ROOT, args.path || ".");
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
      return {
        path: path.relative(ROOT, targetPath) || ".",
        entries: entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        })),
      };
    }
    case "read_file": {
      const targetPath = resolveWorkspacePath(ROOT, args.path);
      const content = await fs.promises.readFile(targetPath, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        content,
      };
    }
    case "write_file": {
      const targetPath = resolveWorkspacePath(ROOT, args.path);
      const content = String(args.content ?? "");
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, content, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    }
    case "delete_file": {
      const targetPath = resolveWorkspacePath(ROOT, args.path);
      const stat = await fs.promises.stat(targetPath);
      if (stat.isDirectory()) {
        const error = new Error("delete_file only supports files");
        error.statusCode = 400;
        throw error;
      }
      await fs.promises.unlink(targetPath);
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        deleted: true,
      };
    }
    case "send_qq_message": {
      return await sendQqMessage(args);
    }
    default: {
      const error = new Error(`Unsupported tool: ${name}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

async function handleToolRequest(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const result = await executeToolCall(payload.name, payload.arguments);
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Tool execution failed",
    });
  }
}

const COMMAND_TOOL_DEFAULT_TIMEOUT_MS = 360000;
const COMMAND_TOOL_MAX_TIMEOUT_MS = 720000;
const COMMAND_TOOL_OUTPUT_LIMIT = 30000;

function clampCommandTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return COMMAND_TOOL_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(numeric), 1000), COMMAND_TOOL_MAX_TIMEOUT_MS);
}

function truncateCommandOutput(text = "") {
  const value = String(text || "");
  if (value.length <= COMMAND_TOOL_OUTPUT_LIMIT) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, COMMAND_TOOL_OUTPUT_LIMIT)}\n...[truncated]`,
    truncated: true,
  };
}

function resolveCommandWorkingDirectory(workingDirectory = ".") {
  return resolveWorkspacePath(ROOT, workingDirectory || ".");
}

async function executeProcessTool(filePath, args = [], options = {}) {
  const cwd = resolveCommandWorkingDirectory(options.workingDirectory);
  const timeoutMs = clampCommandTimeout(options.timeoutMs);
  const auditBase = {
    tool: String(options.toolName || "process"),
    executable: filePath,
    args: Array.isArray(args) ? args : [],
    cwd: path.relative(ROOT, cwd).replace(/\\/g, "/") || ".",
    timeoutMs,
  };

  appendCommandAuditLog({
    event: "start",
    ...auditBase,
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(filePath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {}
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      appendCommandAuditLog({
        event: "error",
        ...auditBase,
        error: String(error?.message || "unknown"),
      });
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutInfo = truncateCommandOutput(stdout);
      const stderrInfo = truncateCommandOutput(stderr);
      if (timedOut) {
        appendCommandAuditLog({
          event: "timeout",
          ...auditBase,
          exitCode: code,
          signal,
          stdoutBytes: Buffer.byteLength(stdout, "utf8"),
          stderrBytes: Buffer.byteLength(stderr, "utf8"),
        });
        const error = new Error(`Command timed out after ${timeoutMs}ms`);
        error.statusCode = 504;
        error.result = {
          cwd: path.relative(ROOT, cwd).replace(/\\/g, "/") || ".",
          exitCode: code,
          signal,
          timedOut: true,
          stdout: stdoutInfo.text,
          stderr: stderrInfo.text,
          stdoutTruncated: stdoutInfo.truncated,
          stderrTruncated: stderrInfo.truncated,
        };
        reject(error);
        return;
      }
      const result = {
        cwd: path.relative(ROOT, cwd).replace(/\\/g, "/") || ".",
        exitCode: code,
        signal,
        timedOut: false,
        stdout: stdoutInfo.text,
        stderr: stderrInfo.text,
        stdoutTruncated: stdoutInfo.truncated,
        stderrTruncated: stderrInfo.truncated,
      };
      appendCommandAuditLog({
        event: "finish",
        ...auditBase,
        exitCode: code,
        signal,
        timedOut: false,
        stdoutBytes: Buffer.byteLength(stdout, "utf8"),
        stderrBytes: Buffer.byteLength(stderr, "utf8"),
      });
      resolve(result);
    });
  });
}

async function runShellCommand(args = {}) {
  const command = String(args.command || "").trim();
  if (!command) {
    const error = new Error("Shell command is required");
    error.statusCode = 400;
    throw error;
  }

  const result = await executeProcessTool("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    toolName: "run_shell_command",
    workingDirectory: args.workingDirectory || ".",
    timeoutMs: args.timeoutMs,
  });

  return {
    command,
    ...result,
  };
}

async function runCliCommand(args = {}) {
  const executable = String(args.executable || "").trim();
  if (!executable) {
    const error = new Error("CLI executable is required");
    error.statusCode = 400;
    throw error;
  }

  const cliArgs = Array.isArray(args.args)
    ? args.args.map((item) => String(item))
    : [];

  const result = await executeProcessTool(executable, cliArgs, {
    toolName: "run_cli_command",
    workingDirectory: args.workingDirectory || ".",
    timeoutMs: args.timeoutMs,
  });

  return {
    executable,
    args: cliArgs,
    ...result,
  };
}

async function legacyCollectPersonaFilesV1(currentDir, rootDir, personas) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await legacyCollectPersonaFilesV1(fullPath, rootDir, personas);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    const content = await fs.promises.readFile(fullPath, "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    const description =
      lines.find((line) => line && !line.startsWith("#")) ||
      `${relativePath} · 工作区人设文件`;
    personas.push({
      id: `workspace:${relativePath}`,
      name: path.basename(entry.name, ".md"),
      path: relativePath,
      description,
      prompt: content,
      source: "workspace",
    });
  }
}

async function legacyListPersonaPresetsV1() {
  try {
    const stat = await fs.promises.stat(PERSONA_PRESETS_DIR);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  const personas = [];
  await legacyCollectPersonaFilesV1(PERSONA_PRESETS_DIR, PERSONA_PRESETS_DIR, personas);
  personas.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  return personas;
}

async function legacyHandlePersonaPresetsListRequestV1(res) {
  try {
    const presets = await legacyListPersonaPresetsV1();
    sendJson(res, 200, { ok: true, presets });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to list persona presets",
    });
  }
}

function legacySanitizeScheduledTaskV1(task = {}) {
  const intervalMinutes = Math.max(1, Number(task.intervalMinutes) || 60);
  return {
    id: String(task.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name: String(task.name || "未命名任务").trim() || "未命名任务",
    prompt: String(task.prompt || "").trim(),
    model: String(task.model || "").trim(),
    intervalMinutes,
    enabled: Boolean(task.enabled),
    createdAt: Number(task.createdAt) || Date.now(),
    updatedAt: Number(task.updatedAt) || Date.now(),
    nextRunAt: Number(task.nextRunAt) || (Boolean(task.enabled) ? Date.now() + intervalMinutes * 60 * 1000 : null),
    lastRunAt: Number(task.lastRunAt) || null,
    lastStatus: String(task.lastStatus || "idle"),
    lastResult: String(task.lastResult || ""),
    lastError: String(task.lastError || ""),
  };
}

async function legacyLoadScheduledTasksV1() {
  const records = await readJsonFile(SCHEDULED_TASKS_FILE, []);
  scheduledTasks = Array.isArray(records) ? records.map((task) => sanitizeScheduledTask(task)) : [];
}

async function legacySaveScheduledTasksV1() {
  await writeJsonFileAtomic(SCHEDULED_TASKS_FILE, scheduledTasks);
}

function legacyListScheduledTasksV1() {
  return scheduledTasks
    .slice()
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      return (left.nextRunAt || Infinity) - (right.nextRunAt || Infinity);
    })
    .map((task) => ({
      ...task,
      running: runningScheduledTaskIds.has(task.id),
    }));
}

function normalizeTaskSignatureValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function legacyFindEquivalentScheduledTaskV1(taskLike = {}) {
  const scheduleType = "cron";
  const normalizedName = normalizeTaskSignatureValue(taskLike.name);
  const normalizedPrompt = normalizeTaskSignatureValue(taskLike.prompt);
  const normalizedModel = normalizeTaskSignatureValue(taskLike.model);
  const normalizedCron = normalizeTaskSignatureValue(taskLike.cronExpression);

  return scheduledTasks.find((task) => {
    if (task.scheduleType !== scheduleType) {
      return false;
    }
    if (normalizeTaskSignatureValue(task.name) !== normalizedName) {
      return false;
    }
    if (normalizeTaskSignatureValue(task.prompt) !== normalizedPrompt) {
      return false;
    }
    if (normalizeTaskSignatureValue(task.model) !== normalizedModel) {
      return false;
    }
    return normalizeTaskSignatureValue(task.cronExpression) === normalizedCron;
  }) || null;
}

function findScheduledTask(taskId) {
  return scheduledTasks.find((task) => task.id === taskId);
}

function legacyEnsureScheduledTaskV1(taskId) {
  const task = findScheduledTask(taskId);
  if (!task) {
    const error = new Error("Scheduled task not found");
    error.statusCode = 404;
    throw error;
  }
  return task;
}

function normalizeScheduledTaskMatchValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function legacyResolveScheduledTaskV1(args = {}) {
  const directId = String(args.id || "").trim();
  if (directId) {
    return ensureScheduledTask(directId);
  }

  const name = normalizeScheduledTaskMatchValue(args.name);
  if (name) {
    const byName = scheduledTasks.find((task) => normalizeScheduledTaskMatchValue(task.name) === name);
    if (byName) {
      return byName;
    }
  }

  const error = new Error("Scheduled task not found");
  error.statusCode = 404;
  throw error;
}

function legacyValidateScheduledTaskPayloadV1(payload = {}, { partial = false } = {}) {
  const next = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
    next.name = String(payload.name || "").trim();
    if (!next.name) {
      const error = new Error("Task name is required");
      error.statusCode = 400;
      throw error;
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "prompt")) {
    next.prompt = String(payload.prompt || "").trim();
    if (!next.prompt) {
      const error = new Error("Task prompt is required");
      error.statusCode = 400;
      throw error;
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "model")) {
    next.model = String(payload.model || "").trim();
    if (!next.model) {
      const error = new Error("Task model is required");
      error.statusCode = 400;
      throw error;
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "intervalMinutes")) {
    next.intervalMinutes = Math.max(1, Number(payload.intervalMinutes) || 0);
    if (!Number.isFinite(next.intervalMinutes) || next.intervalMinutes <= 0) {
      const error = new Error("intervalMinutes must be a positive number");
      error.statusCode = 400;
      throw error;
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "enabled")) {
    next.enabled = Boolean(payload.enabled);
  }

  return next;
}

async function legacyCallLocalModelForTaskV2(task) {
  const targetUrl = new URL("/v1/chat/completions", TARGET_ORIGIN);
  const requestBody = JSON.stringify({
    model: task.model,
    messages: [
      {
        role: "user",
        content: task.prompt,
      },
    ],
    temperature: 0.7,
    stream: false,
  });

  return await new Promise((resolve, reject) => {
    const proxyReq = http.request(
      targetUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestBody),
        },
      },
      (proxyRes) => {
        const chunks = [];
        proxyRes.on("data", (chunk) => chunks.push(chunk));
        proxyRes.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            const data = body ? JSON.parse(body) : {};
            if ((proxyRes.statusCode || 500) >= 400) {
              const error = new Error(data.error || `Model request failed: ${proxyRes.statusCode}`);
              reject(error);
              return;
            }

            const text =
              data?.choices?.[0]?.message?.content ||
              data?.choices?.[0]?.text ||
              "";
            resolve(stripModelThinkingContent(String(text)));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    proxyReq.on("error", reject);
    proxyReq.write(requestBody);
    proxyReq.end();
  });
}

async function legacyRunScheduledTaskV1(taskId) {
  const task = ensureScheduledTask(taskId);
  if (runningScheduledTaskIds.has(task.id)) {
    return task;
  }

  runningScheduledTaskIds.add(task.id);
  task.lastStatus = "running";
  task.lastError = "";
  task.updatedAt = Date.now();
  await saveScheduledTasks();

  try {
    const result = await callLocalModelForTask(task);
    task.lastStatus = "success";
    task.lastResult = result.slice(0, 4000);
    task.lastRunAt = Date.now();
    task.updatedAt = task.lastRunAt;
    task.lastError = "";
  } catch (error) {
    task.lastStatus = "error";
    task.lastError = error.message || "Task execution failed";
    task.lastRunAt = Date.now();
    task.updatedAt = task.lastRunAt;
  } finally {
    runningScheduledTaskIds.delete(task.id);
    task.nextRunAt = task.enabled ? Date.now() + task.intervalMinutes * 60 * 1000 : null;
    await saveScheduledTasks();
  }

  return task;
}

async function legacyTickScheduledTasksV1() {
  const now = Date.now();
  const dueTasks = scheduledTasks.filter(
    (task) => task.enabled && !runningScheduledTaskIds.has(task.id) && task.nextRunAt && task.nextRunAt <= now
  );

  for (const task of dueTasks) {
    try {
      await runScheduledTask(task.id);
    } catch (error) {
      // Ignore per-task failures to keep scheduler alive.
    }
  }
}

function legacyStartScheduledTaskLoopV1() {
  setInterval(() => {
    tickScheduledTasks().catch(() => {});
  }, SCHEDULER_TICK_MS);
}

async function legacyHandleScheduledTasksListV1(res) {
  sendJson(res, 200, { ok: true, tasks: listScheduledTasks() });
}

async function legacyHandleScheduledTasksCreateV1(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const input = validateScheduledTaskPayload(payload);
    const task = sanitizeScheduledTask({
      ...input,
      enabled: payload.enabled !== false,
      nextRunAt: (payload.enabled !== false) ? Date.now() + input.intervalMinutes * 60 * 1000 : null,
    });
    scheduledTasks.unshift(task);
    await saveScheduledTasks();
    sendJson(res, 200, { ok: true, task });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Failed to create scheduled task" });
  }
}

async function legacyHandleScheduledTaskUpdateV1(req, res, taskId) {
  try {
    const task = ensureScheduledTask(taskId);
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const patch = validateScheduledTaskPayload(payload, { partial: true });
    Object.assign(task, patch);
    task.updatedAt = Date.now();
    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
      task.nextRunAt = patch.enabled ? Date.now() + task.intervalMinutes * 60 * 1000 : null;
    } else if (Object.prototype.hasOwnProperty.call(patch, "intervalMinutes") && task.enabled) {
      task.nextRunAt = Date.now() + task.intervalMinutes * 60 * 1000;
    }
    await saveScheduledTasks();
    sendJson(res, 200, { ok: true, task });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Failed to update scheduled task" });
  }
}

async function legacyHandleScheduledTaskDeleteV1(res, taskId) {
  try {
    ensureScheduledTask(taskId);
    scheduledTasks = scheduledTasks.filter((task) => task.id !== taskId);
    runningScheduledTaskIds.delete(taskId);
    await saveScheduledTasks();
    sendJson(res, 200, { ok: true, deleted: true });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Failed to delete scheduled task" });
  }
}

async function legacyHandleScheduledTaskRunV1(res, taskId) {
  try {
    const task = await runScheduledTask(taskId);
    sendJson(res, 200, { ok: true, task });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Failed to run scheduled task" });
  }
}

async function getWeatherByLocation(location) {
  const query = String(location || "").trim();
  if (!query) {
    const error = new Error("Weather location is required");
    error.statusCode = 400;
    throw error;
  }

  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", query);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("language", "zh");
  geoUrl.searchParams.set("format", "json");

  const geoData = await requestJson(geoUrl);
  const place = Array.isArray(geoData.results) ? geoData.results[0] : null;
  if (!place) {
    const error = new Error(`Location not found: ${query}`);
    error.statusCode = 404;
    throw error;
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(place.latitude));
  forecastUrl.searchParams.set("longitude", String(place.longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m");
  forecastUrl.searchParams.set("timezone", "Asia/Shanghai");

  const forecast = await requestJson(forecastUrl);
  return {
    location: {
      query,
      name: place.name,
      country: place.country,
      admin1: place.admin1 || "",
      latitude: place.latitude,
      longitude: place.longitude,
    },
    current: forecast.current || {},
  };
}

async function searchWeb(query, limit = 3) {
  const normalizedQuery = clampTextForModel(query, 120);
  if (!normalizedQuery) {
    const error = new Error("Search query is required");
    error.statusCode = 400;
    throw error;
  }

  const apiKey = String(process.env.TAVILY_API_KEY || process.env.WEB_SEARCH_API_KEY || "").trim();
  if (!apiKey) {
    const error = new Error("Web search is not configured. Set TAVILY_API_KEY before starting the server.");
    error.statusCode = 500;
    throw error;
  }

  const normalizedLimit = Math.min(Math.max(Number(limit) || 3, 1), 5);
  const apiUrl = new URL(process.env.TAVILY_SEARCH_API_URL || "https://api.tavily.com/search");
  const body = JSON.stringify({
    api_key: apiKey,
    query: normalizedQuery,
    max_results: normalizedLimit,
    topic: "general",
    search_depth: "basic",
    include_answer: false,
    include_images: false,
    include_raw_content: false,
  });

  const data = await requestJson(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body, "utf8"),
    },
    body,
  });

  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    query: normalizedQuery,
    results: results.slice(0, normalizedLimit).map((item = {}) => ({
      title: clampTextForModel(item.title, 120),
      url: clampTextForModel(item.url, 300),
      snippet: clampTextForModel(item.content || item.snippet, 220),
      source: clampTextForModel(item.source || item.url, 120),
    })),
  };
}

function expandCronSegment(segment, min, max) {
  const values = new Set();
  const trimmed = String(segment || "").trim();
  if (!trimmed) {
    return values;
  }

  const parts = trimmed.split(",");
  for (const part of parts) {
    const [base, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${part}`);
    }

    let rangeStart = min;
    let rangeEnd = max;
    if (base && base !== "*") {
      if (base.includes("-")) {
        const [startText, endText] = base.split("-");
        rangeStart = Number(startText);
        rangeEnd = Number(endText);
      } else {
        rangeStart = Number(base);
        rangeEnd = Number(base);
      }
    }

    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
      throw new Error(`Invalid cron range: ${part}`);
    }

    for (let value = rangeStart; value <= rangeEnd; value += step) {
      values.add(value);
    }
  }

  return values;
}

function legacyParseCronExpressionV2(cronExpression) {
  const fields = String(cronExpression || "").trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("cronExpression must have 5 fields: minute hour day month weekday");
  }

  return {
    minute: expandCronSegment(fields[0], 0, 59),
    hour: expandCronSegment(fields[1], 0, 23),
    dayOfMonth: expandCronSegment(fields[2], 1, 31),
    month: expandCronSegment(fields[3], 1, 12),
    dayOfWeek: expandCronSegment(fields[4], 0, 6),
  };
}

function matchesCronDate(parsed, date) {
  return (
    parsed.minute.has(date.getMinutes()) &&
    parsed.hour.has(date.getHours()) &&
    parsed.dayOfMonth.has(date.getDate()) &&
    parsed.month.has(date.getMonth() + 1) &&
    parsed.dayOfWeek.has(date.getDay())
  );
}

function legacyComputeNextRunAtV2(task, fromTime = Date.now()) {
  if (!task.enabled) {
    return null;
  }

  if (task.scheduleType === "cron" && task.cronExpression) {
    const parsed = parseCronExpression(task.cronExpression);
    const cursor = new Date(fromTime);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    for (let i = 0; i < 60 * 24 * 366; i += 1) {
      if (matchesCronDate(parsed, cursor)) {
        return cursor.getTime();
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
    }

    throw new Error("Unable to compute next run time from cron expression");
  }

  const error = new Error("Only cron-based scheduled tasks are supported");
  error.statusCode = 400;
  throw error;
}

function legacySanitizeScheduledTaskV2(task = {}) {
  const scheduleType = "cron";
  const enabled = Boolean(task.enabled);
  const sanitized = {
    id: String(task.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name: String(task.name || "未命名任务").trim() || "未命名任务",
    prompt: String(task.prompt || "").trim(),
    model: String(task.model || "").trim(),
    scheduleType,
    intervalMinutes: 0,
    cronExpression: String(task.cronExpression || "").trim(),
    enabled,
    createdAt: Number(task.createdAt) || Date.now(),
    updatedAt: Number(task.updatedAt) || Date.now(),
    nextRunAt: Number(task.nextRunAt) || null,
    lastRunAt: Number(task.lastRunAt) || null,
    lastStatus: String(task.lastStatus || "idle"),
    lastResult: String(task.lastResult || ""),
    lastError: String(task.lastError || ""),
  };

  if (!sanitized.cronExpression) {
    sanitized.enabled = false;
    sanitized.nextRunAt = null;
  }

  if (!sanitized.nextRunAt && sanitized.enabled) {
    sanitized.nextRunAt = computeNextRunAt(sanitized, Date.now());
  }

  return sanitized;
}

function legacyValidateScheduledTaskPayloadV2(payload = {}, { partial = false } = {}) {
  const next = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
    next.name = String(payload.name || "").trim();
    if (!next.name) {
      const error = new Error("Task name is required");
      error.statusCode = 400;
      throw error;
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "prompt")) {
    next.prompt = String(payload.prompt || "").trim();
    if (!next.prompt) {
      const error = new Error("Task prompt is required");
      error.statusCode = 400;
      throw error;
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "model")) {
    next.model = String(payload.model || "").trim();
    if (!next.model) {
      const error = new Error("Task model is required");
      error.statusCode = 400;
      throw error;
    }
  }

  next.scheduleType = "cron";
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "cronExpression") || Object.prototype.hasOwnProperty.call(payload, "scheduleType")) {
    next.cronExpression = String(payload.cronExpression || "").trim();
    if (!next.cronExpression) {
      const error = new Error("cronExpression is required");
      error.statusCode = 400;
      throw error;
    }
    parseCronExpression(next.cronExpression);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "enabled")) {
    next.enabled = Boolean(payload.enabled);
  }

  return next;
}

async function legacyRunScheduledTaskV2(taskId) {
  const task = ensureScheduledTask(taskId);
  if (runningScheduledTaskIds.has(task.id)) {
    return task;
  }

  runningScheduledTaskIds.add(task.id);
  task.lastStatus = "running";
  task.lastError = "";
  task.updatedAt = Date.now();
  await saveScheduledTasks();

  try {
    const result = await callLocalModelForTask(task);
    task.lastStatus = "success";
    task.lastResult = result.slice(0, 4000);
    task.lastRunAt = Date.now();
    task.updatedAt = task.lastRunAt;
    task.lastError = "";
  } catch (error) {
    task.lastStatus = "error";
    task.lastError = error.message || "Task execution failed";
    task.lastRunAt = Date.now();
    task.updatedAt = task.lastRunAt;
  } finally {
    runningScheduledTaskIds.delete(task.id);
    task.nextRunAt = task.enabled ? computeNextRunAt(task, Date.now()) : null;
    await saveScheduledTasks();
  }

  return task;
}

async function legacyHandleScheduledTasksCreateV2(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const input = validateScheduledTaskPayload(payload);
    const existingTask = findEquivalentScheduledTask({
      ...input,
      enabled: payload.enabled !== false,
    });
    if (existingTask) {
      sendJson(res, 200, { ok: true, task: existingTask, deduplicated: true });
      return;
    }
    const task = sanitizeScheduledTask({
      ...input,
      enabled: payload.enabled !== false,
    });
    scheduledTasks.unshift(task);
    await saveScheduledTasks();
    sendJson(res, 200, { ok: true, task });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Failed to create scheduled task" });
  }
}

async function legacyHandleScheduledTaskUpdateV2(req, res, taskId) {
  try {
    const task = ensureScheduledTask(taskId);
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const patch = validateScheduledTaskPayload(payload, { partial: true });
    Object.assign(task, patch);
    task.updatedAt = Date.now();
    if (task.enabled) {
      task.nextRunAt = computeNextRunAt(task, Date.now());
    } else {
      task.nextRunAt = null;
    }
    await saveScheduledTasks();
    sendJson(res, 200, { ok: true, task });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Failed to update scheduled task" });
  }
}

async function legacyExecuteToolCallV2(name, args = {}) {
  switch (name) {
    case "list_dir": {
      const targetPath = resolveWorkspacePath(ROOT, args.path || ".");
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
      return {
        path: path.relative(ROOT, targetPath) || ".",
        entries: entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        })),
      };
    }
    case "read_file": {
      const targetPath = resolveWorkspacePath(ROOT, args.path);
      const content = await fs.promises.readFile(targetPath, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        content,
      };
    }
    case "write_file": {
      const targetPath = resolveWorkspacePath(ROOT, args.path);
      const content = String(args.content ?? "");
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, content, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    }
    case "delete_file": {
      const targetPath = resolveWorkspacePath(ROOT, args.path);
      const stat = await fs.promises.stat(targetPath);
      if (stat.isDirectory()) {
        const error = new Error("delete_file only supports files");
        error.statusCode = 400;
        throw error;
      }
      await fs.promises.unlink(targetPath);
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        deleted: true,
      };
    }
    case "list_scheduled_tasks": {
      return { tasks: listScheduledTasks() };
    }
    case "create_scheduled_task": {
      const input = validateScheduledTaskPayload(args);
      const existingTask = findEquivalentScheduledTask({
        ...input,
        enabled: args.enabled !== false,
      });
      if (existingTask) {
        return {
          ...existingTask,
          deduplicated: true,
        };
      }
      const task = sanitizeScheduledTask({
        ...input,
        enabled: args.enabled !== false,
      });
      if (task.qqPushEnabled && !String(task.qqTargetId || "").trim()) {
        const error = new Error("QQ target ID is required when QQ push is enabled");
        error.statusCode = 400;
        throw error;
      }
      scheduledTasks.unshift(task);
      await saveScheduledTasks();
      return task;
    }
    case "update_scheduled_task": {
      const task = resolveScheduledTask(args);
      const patch = validateScheduledTaskPayload(args, { partial: true });
      const nextTask = sanitizeScheduledTask({
        ...task,
        ...patch,
        updatedAt: Date.now(),
      });
      if (nextTask.qqPushEnabled && !String(nextTask.qqTargetId || "").trim()) {
        const error = new Error("QQ target ID is required when QQ push is enabled");
        error.statusCode = 400;
        throw error;
      }
      Object.assign(task, nextTask);
      task.updatedAt = Date.now();
      task.nextRunAt = task.enabled ? computeNextRunAt(task, Date.now()) : null;
      await saveScheduledTasks();
      return task;
    }
    case "delete_scheduled_task": {
      const task = resolveScheduledTask(args);
      scheduledTasks = scheduledTasks.filter((item) => item.id !== task.id);
      runningScheduledTaskIds.delete(task.id);
      await saveScheduledTasks();
      return { deleted: true, id: task.id, name: task.name };
    }
    case "run_scheduled_task": {
      const task = resolveScheduledTask(args);
      return await runScheduledTask(task.id);
    }
    default: {
      const error = new Error(`Unsupported tool: ${name}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const { handlePersonaPresetsListRequest, handlePersonaPresetSaveRequest, handlePersonaPresetDeleteRequest } = createPersonaHandlers({
  personaPresetsDir: PERSONA_PRESETS_DIR,
  sendJson,
  readRequestBody,
});

function serializeToolResultForModel(toolName, result) {
  if (toolName === "web_search") {
    const query = clampTextForModel(result?.query, 120);
    const results = Array.isArray(result?.results) ? result.results.slice(0, 3) : [];
    const lines = [];
    if (query) {
      lines.push(`Search query: ${query}`);
    }
    if (!results.length) {
      lines.push("No search results returned.");
      return lines.join("\n");
    }
    results.forEach((item, index) => {
      lines.push(`Result ${index + 1}`);
      lines.push(`Title: ${clampTextForModel(item?.title, 120) || "(untitled)"}`);
      if (item?.url) {
        lines.push(`URL: ${clampTextForModel(item.url, 300)}`);
      }
      if (item?.snippet) {
        lines.push(`Snippet: ${clampTextForModel(item.snippet, 220)}`);
      }
    });
    return lines.join("\n");
  }

  if (toolName === "get_weather") {
    const location = result?.location || {};
    const current = result?.current || {};
    return [
      `Location: ${clampTextForModel(
        [location.country, location.admin1, location.name].filter(Boolean).join(" "),
        120
      ) || clampTextForModel(location.query, 120) || "unknown"}`,
      `Temperature: ${current.temperature_2m ?? "unknown"}`,
      `Humidity: ${current.relative_humidity_2m ?? "unknown"}`,
      `Precipitation: ${current.precipitation ?? "unknown"}`,
      `Wind: ${current.wind_speed_10m ?? "unknown"}`,
      `Weather code: ${current.weather_code ?? "unknown"}`,
    ].join("\n");
  }

  return clampTextForModel(JSON.stringify(result, null, 2), 2400);
}

async function callLocalModelWithTools({
  model,
  messages,
  tools,
  requiredToolName = "",
  singleUseToolNames = [],
  temperature = 0.7,
  maxRounds = 6,
  timeoutMs,
}) {
  const targetUrl = buildModelServiceUrl("chat");
  const { authHeaders } = getResolvedModelServiceConfig();
  let workingMessages = [...messages];
  let finalText = "";
  const normalizedRequiredToolName = String(requiredToolName || "").trim();
  const normalizedSingleUseToolNames = new Set(
    Array.isArray(singleUseToolNames)
      ? singleUseToolNames.map((name) => String(name || "").trim()).filter(Boolean)
      : []
  );
  const availableTools = Array.isArray(tools) ? tools : [];
  const hasRequiredTool = normalizedRequiredToolName
    && availableTools.some((tool) => tool?.function?.name === normalizedRequiredToolName);
  let requiredToolUsed = false;
  let requiredToolReminderSent = false;
  const usedSingleUseToolNames = new Set();

  const normalizedMaxRounds = Math.min(Math.max(Number(maxRounds) || 6, 1), 6);
  const normalizedTemperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7;

  for (let i = 0; i < normalizedMaxRounds; i += 1) {
    const requestTools = (hasRequiredTool && !requiredToolUsed
      ? availableTools.filter((tool) => tool?.function?.name === normalizedRequiredToolName)
      : availableTools
    ).filter((tool) => {
      const toolName = String(tool?.function?.name || "").trim();
      return toolName && !usedSingleUseToolNames.has(toolName);
    });
    const toolChoice = Array.isArray(requestTools) && requestTools.length
      ? (hasRequiredTool && !requiredToolUsed ? "required" : "auto")
      : "none";
    const requestBody = JSON.stringify({
      model,
      messages: workingMessages,
      temperature: normalizedTemperature,
      tools: requestTools,
      tool_choice: toolChoice,
      stream: false,
    });

    const data = await requestJson(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        ...authHeaders,
      },
      body: requestBody,
      timeoutMs,
    });

    const message = data?.choices?.[0]?.message;
    if (!message) {
      throw new Error("Model response missing assistant message");
    }

    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((item) => item?.text || "").join("\n")
          : "";

    if (text) {
      finalText = stripModelThinkingContent(text);
    }

    workingMessages.push({
      role: "assistant",
      content: message.content || text,
      tool_calls: message.tool_calls,
    });

    if (!Array.isArray(message.tool_calls) || !message.tool_calls.length) {
      if (hasRequiredTool && !requiredToolUsed && !requiredToolReminderSent) {
        requiredToolReminderSent = true;
        workingMessages.push({
          role: "system",
          content: `You must call ${normalizedRequiredToolName} before giving the final answer for this task.`,
        });
        finalText = "";
        continue;
      }
      break;
    }

    for (const toolCall of message.tool_calls) {
      const toolName = toolCall?.function?.name || "";
      if (hasRequiredTool && toolName === normalizedRequiredToolName) {
        requiredToolUsed = true;
      }
      const args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
      const result = await executeToolCall(toolName, args);
      if (normalizedSingleUseToolNames.has(toolName)) {
        usedSingleUseToolNames.add(toolName);
      }
      workingMessages.push({
        role: "tool",
        tool_call_id: toolCall.id || `${toolName}-${Date.now()}`,
        content: serializeToolResultForModel(toolName, result),
      });
    }
  }

  if (hasRequiredTool && !requiredToolUsed) {
    throw new Error(`Model did not call required tool: ${normalizedRequiredToolName}`);
  }
  if (!finalText) {
    throw new Error("Model completed without final text");
  }
  return stripModelThinkingContent(finalText);
}

async function generateNovelText({
  systemPrompt,
  userPrompt,
  model: preferredModel,
  temperature = 0.7,
  timeoutMs = NOVEL_MODEL_TIMEOUT_MS,
} = {}) {
  const model = String(preferredModel || "").trim();
  if (!model) {
    const error = new Error("Novel project model is not configured");
    error.statusCode = 400;
    throw error;
  }
  return await callLocalModelWithTools({
    model,
    messages: [
      {
        role: "system",
        content: String(systemPrompt || "").trim() || "你是中文小说创作助手。",
      },
      {
        role: "user",
        content: String(userPrompt || "").trim(),
      },
    ],
    tools: [],
    temperature,
    maxRounds: 1,
    timeoutMs,
  });
}

async function legacyCallLocalModelForTaskV3(task) {
  const taskTools = [
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
  ];

  return await callLocalModelWithTools({
    model: task.model,
    messages: [
      {
        role: "system",
        content: "你正在执行一个定时任务。需要实时天气时，请调用 get_weather 工具，不要凭空猜测天气。",
      },
      {
        role: "user",
        content: task.prompt,
      },
    ],
    tools: taskTools,
  });
}

// Canonical tool dispatcher used by the HTTP route and model tool-calling flow.
let executeToolCall = createExecuteToolCall({
  root: ROOT,
  resolveWorkspacePath,
  getWeatherByLocation,
  searchWeb,
  runShellCommand,
  runCliCommand,
  listScheduledTasks: (...args) => listScheduledTasks(...args),
  validateScheduledTaskPayload: (...args) => validateScheduledTaskPayload(...args),
  findEquivalentScheduledTask: (...args) => findEquivalentScheduledTask(...args),
  sanitizeScheduledTask: (...args) => sanitizeScheduledTask(...args),
  saveScheduledTasks: (...args) => saveScheduledTasks(...args),
  ensureScheduledTask: (...args) => ensureScheduledTask(...args),
  computeNextRunAt: (...args) => computeNextRunAt(...args),
  runScheduledTask: (...args) => runScheduledTask(...args),
  sendQqMessage: (...args) => sendQqMessage(...args),
  getScheduledTasks: () => scheduledTasks,
  setScheduledTasks: (nextTasks) => {
    scheduledTasks = nextTasks;
  },
  runningScheduledTaskIds,
});

async function handleScheduledTaskIntentCreate(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const text = String(payload.text || "").trim();
    const inferredArgs = inferScheduledTaskArgsFromText(text);
    if (!inferredArgs) {
      const error = new Error("Unable to infer a scheduled task from the provided text");
      error.statusCode = 400;
      throw error;
    }

    const task = await executeToolCall("create_scheduled_task", inferredArgs);
    sendJson(res, 200, {
      ok: true,
      inferred: true,
      args: inferredArgs,
      task,
      message: formatScheduledTaskCreationReply(task),
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to infer scheduled task",
    });
  }
}

async function executeScheduledTaskIntent(text = "", model = "") {
  const intent = inferScheduledTaskIntentFromText(text, {
    tasks: listScheduledTasks(),
  });
  if (!intent) {
    const error = new Error("Unable to infer a scheduled task action from the provided text");
    error.statusCode = 400;
    throw error;
  }

  let result = null;
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
    default: {
      const error = new Error(`Unsupported scheduled task intent: ${intent.action}`);
      error.statusCode = 400;
      throw error;
    }
  }

  return {
    intent,
    result,
    message: formatScheduledTaskActionReply(intent, result, { tasks: listScheduledTasks() }),
  };
}

async function handleScheduledTaskIntentHandle(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const text = String(payload.text || "").trim();
    const model = String(payload.model || "").trim();
    const handled = await executeScheduledTaskIntent(text, model);
    sendJson(res, 200, {
      ok: true,
      inferred: true,
      intent: handled.intent,
      result: handled.result,
      message: handled.message,
      task: handled.intent.action === "create" ? handled.result : undefined,
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to handle scheduled task intent",
    });
  }
}

const qqModule = createQqModule({
  root: ROOT,
  personaPresetsDir: PERSONA_PRESETS_DIR,
  qqBotConfigFile: QQ_BOT_CONFIG_FILE,
  qqBotSessionsFile: QQ_BOT_SESSIONS_FILE,
  readJsonFile,
  writeJsonFileAtomic,
  readRequestBody,
  sendJson,
  requestJson,
  targetOrigin: TARGET_ORIGIN,
  getModelServiceConfig: () => getResolvedModelServiceConfig(),
  executeToolCall: (...args) => executeToolCall(...args),
  callLocalModelWithTools: (...args) => callLocalModelWithTools(...args),
  getScheduledTasks: () => listScheduledTasks(),
  getSharedConnectionConfig,
  saveSharedConnectionConfig,
  logDebug: appendServerDebugLog,
  handleExternalCommand: (...args) => (novelModule ? novelModule.handleQqCommand(...args) : null),
});

({
  loadQqBotConfig,
  loadQqBotSessions,
  sendQqMessage,
  handleQqBotConfigGet,
  handleQqBotConfigPost,
  handleQqWebhook,
  pushScheduledTaskResultToQq,
  getQqBotConfig,
} = qqModule);

novelModule = createNovelModule({
  novelsDir: NOVELS_DIR,
  readJsonFile,
  readTextFile,
  writeJsonFileAtomic,
  writeFileAtomic,
  readRequestBody,
  sendJson,
  generateText: (...args) => generateNovelText(...args),
  sendQqMessage: (...args) => sendQqMessage(...args),
  getQqBotConfig: () => (typeof getQqBotConfig === "function" ? getQqBotConfig() : {}),
  logDebug: appendServerDebugLog,
});

// Canonical scheduled-task model invocation flow.
const callLocalModelForTask = createTaskModelInvoker({
  callLocalModelWithTools,
  getTaskModel: () => String(getSharedConnectionConfig()?.model || "").trim(),
  searchWeb,
});

({
  loadScheduledTasks,
  saveScheduledTasks,
  listScheduledTasks,
  findEquivalentScheduledTask,
  ensureScheduledTask,
  resolveScheduledTask,
  validateScheduledTaskPayload,
  computeNextRunAt,
  sanitizeScheduledTask,
  runScheduledTask,
  startScheduledTaskLoop,
  handleScheduledTasksList,
  handleScheduledTasksCreate,
  handleScheduledTaskUpdate,
  handleScheduledTaskDelete,
  handleScheduledTaskRun,
} = createScheduler({
  scheduledTasksFile: SCHEDULED_TASKS_FILE,
  readJsonFile,
  writeJsonFileAtomic,
  readRequestBody,
  sendJson,
  callLocalModelForTask,
  afterRunScheduledTask: (...args) => pushScheduledTaskResultToQq(...args),
  schedulerTickMs: SCHEDULER_TICK_MS,
  getScheduledTasks: () => scheduledTasks,
  setScheduledTasks: (nextTasks) => {
    scheduledTasks = nextTasks;
  },
  runningScheduledTaskIds,
}));

async function legacyInlineCallLocalModelForTask(task) {
  const taskTools = [
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
  ];

  return await callLocalModelWithTools({
    model: task.model,
    messages: [
      {
        role: "system",
        content: "你正在执行一个定时任务，生成的内容会直接推送给最终用户。请直接输出要发送给用户的结果或提醒内容，不要把自己当成被提醒的人，也不要回复“好的、收到、明白了”这类自我应答。需要实时天气时，请调用 get_weather 工具，不要凭空猜测天气。",
      },
      {
        role: "user",
        content: task.prompt,
      },
    ],
    tools: taskTools,
  });
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Missing request URL" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === "/tools/execute" && req.method === "POST") {
    handleToolRequest(req, res);
    return;
  }

  if ((pathname === "/personas/list" || pathname === "/personas/list/") && req.method === "GET") {
      handlePersonaPresetsListRequest(res);
      return;
  }

  if ((pathname === "/personas/save" || pathname === "/personas/save/") && req.method === "POST") {
    handlePersonaPresetSaveRequest(req, res);
    return;
  }

  if ((pathname === "/personas/delete" || pathname === "/personas/delete/") && (req.method === "POST" || req.method === "DELETE")) {
    handlePersonaPresetDeleteRequest(req, res);
    return;
  }

  if (pathname === "/qq-bot/config" && req.method === "GET") {
    handleQqBotConfigGet(res);
    return;
  }

  if (pathname === "/qq-bot/config" && req.method === "POST") {
    handleQqBotConfigPost(req, res);
    return;
  }

  if (pathname === "/connection-config" && req.method === "GET") {
    handleSharedConnectionConfigGet(res);
    return;
  }

  if (pathname === "/connection-config" && req.method === "POST") {
    handleSharedConnectionConfigPost(req, res);
    return;
  }

  if (pathname === "/storage/status" && req.method === "GET") {
    handleMysqlStorageStatus(res);
    return;
  }

  if (pathname === "/storage/chat-records" && req.method === "GET") {
    handleChatRecordsList(res);
    return;
  }

  if (pathname === "/storage/chat-records/sync" && req.method === "POST") {
    handleChatRecordsSync(req, res);
    return;
  }

  if (
    (pathname === "/monitored/v1/chat/completions" || pathname === "/api/monitored/v1/chat/completions")
    && req.method === "POST"
  ) {
    handleMonitoredChatCompletion(req, res);
    return;
  }

  const storageConfigMatch = pathname.match(/^\/storage\/config\/([^/]+)$/);
  if (storageConfigMatch && req.method === "GET") {
    handleStorageConfigGet(res, decodeURIComponent(storageConfigMatch[1]));
    return;
  }

  if (storageConfigMatch && req.method === "POST") {
    handleStorageConfigSave(req, res, decodeURIComponent(storageConfigMatch[1]));
    return;
  }

  if (pathname === "/qq/webhook" && req.method === "POST") {
    handleQqWebhook(req, res);
    return;
  }

  if (pathname === "/scheduler/tasks" && req.method === "GET") {
    handleScheduledTasksList(res, {
      creatorType: url.searchParams.get("creatorType") || "",
      creatorId: url.searchParams.get("creatorId") || "",
    });
    return;
  }

  if (pathname === "/scheduler/tasks" && req.method === "POST") {
    handleScheduledTasksCreate(req, res);
    return;
  }

  if (pathname === "/scheduler/intent/create" && req.method === "POST") {
    handleScheduledTaskIntentCreate(req, res);
    return;
  }

  if (pathname === "/scheduler/intent/handle" && req.method === "POST") {
    handleScheduledTaskIntentHandle(req, res);
    return;
  }

  const schedulerMatch = pathname.match(/^\/scheduler\/tasks\/([^/]+)(?:\/(run))?$/);
  if (schedulerMatch) {
    const taskId = decodeURIComponent(schedulerMatch[1]);
    const action = schedulerMatch[2] || "";

    if (!action && req.method === "PUT") {
      handleScheduledTaskUpdate(req, res, taskId);
      return;
    }

    if (!action && req.method === "DELETE") {
      handleScheduledTaskDelete(res, taskId);
      return;
    }

    if (action === "run" && req.method === "POST") {
      handleScheduledTaskRun(res, taskId);
      return;
    }
  }

  if (pathname.startsWith("/novels/")) {
    Promise.resolve(novelModule.handleRequest(req, res, pathname))
      .then((handled) => {
        if (!handled) {
          sendJson(res, 404, { error: "Not found" });
        }
      })
      .catch((error) => {
        sendJson(res, error.statusCode || 500, {
          error: error.message || "Novel request failed",
        });
      });
    return;
  }

  if (pathname.startsWith("/api/")) {
    proxyRequest(req, res, pathname);
    return;
  }

  serveStatic(req, res, pathname);
});

async function legacySendQqMessageFinalV1(args = {}) {
  const bridgeUrl = String(args.bridgeUrl || "").trim();
  const targetType = String(args.targetType || "private").trim().toLowerCase();
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
  const actionUrl = new URL(targetType === "group" ? "send_group_msg" : "send_private_msg", baseUrl);
  const payload = targetType === "group"
    ? { group_id: /^\d+$/.test(targetId) ? Number(targetId) : targetId, message }
    : { user_id: /^\d+$/.test(targetId) ? Number(targetId) : targetId, message };

  const response = await requestJson(actionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  return {
    ok: true,
    bridgeUrl: baseUrl.toString(),
    targetType,
    targetId,
    message,
    response,
  };
}

function legacyNormalizeQqIncomingTextV1(event = {}) {
  if (typeof event.raw_message === "string" && event.raw_message.trim()) {
    return event.raw_message.trim();
  }

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

function legacyIsGroupMentionedV1(event = {}) {
  const selfId = String(event.self_id || "");
  if (Array.isArray(event.message)) {
    return event.message.some((segment) => segment?.type === "at" && String(segment.data?.qq || "") === selfId);
  }
  return typeof event.raw_message === "string" && selfId ? event.raw_message.includes(`[CQ:at,qq=${selfId}]`) : false;
}

function legacyStripQqTriggerPrefixV1(text = "") {
  const raw = String(text || "").trim();
  const prefix = String(qqBotConfig.triggerPrefix || "").trim();
  if (!prefix) return raw;
  return raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : "";
}

function legacyIsQqEventAllowedV1(event = {}) {
  const userId = String(event.user_id || "").trim();
  const groupId = String(event.group_id || "").trim();
  const allowedUsers = parseQqIdList(qqBotConfig.allowedUsers);
  const allowedGroups = parseQqIdList(qqBotConfig.allowedGroups);

  if (allowedUsers.length && !allowedUsers.includes(userId)) {
    return false;
  }
  if (event.message_type === "group" && allowedGroups.length && !allowedGroups.includes(groupId)) {
    return false;
  }
  return true;
}

function legacyGetQqSessionKeyV1(event = {}) {
  if (event.message_type === "group") {
    return `group:${event.group_id || "unknown"}:user:${event.user_id || "unknown"}`;
  }
  return `private:${event.user_id || "unknown"}`;
}

function legacyIsQqSessionResetCommandV1(text = "") {
  const normalized = String(text || "").trim().toLowerCase();
  return normalized === "/new" || normalized === "/reset";
}

async function legacyClearQqSessionV1(event = {}) {
  const sessionKey = getQqSessionKey(event);
  if (qqBotSessions[sessionKey]) {
    delete qqBotSessions[sessionKey];
    await saveQqBotSessions();
  }
}

function legacyTrimSessionMessagesV1(messages = []) {
  return messages.slice(-24);
}

async function legacyGetFallbackModelIdV1() {
  const modelsUrl = new URL("/v1/models", TARGET_ORIGIN);
  const data = await requestJson(modelsUrl, { method: "GET" });
  return data?.data?.[0]?.id || "";
}

async function legacyGenerateQqBotReplyV1(event = {}) {
  const sessionKey = getQqSessionKey(event);
  const session = Array.isArray(qqBotSessions[sessionKey]?.messages) ? qqBotSessions[sessionKey].messages : [];
  const rawUserText = normalizeQqIncomingText(event);
  const userText = stripQqTriggerPrefix(rawUserText);
  if (!userText) {
    return "";
  }

  const model = qqBotConfig.model || await getFallbackModelId();
  if (!model) {
    const error = new Error("No model configured for QQ bot");
    error.statusCode = 500;
    throw error;
  }

  const systemPrompt = [
    qqBotConfig.persona || qqBotConfig.systemPrompt || "",
    `你当前正在作为 QQ 机器人“${qqBotConfig.assistantName || "繁星"}”回复消息。请直接回复用户，不要解释工具过程，不要输出多余系统说明。`,
  ].filter(Boolean).join("\n\n");

  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    ...session,
    { role: "user", content: userText },
  ];

  const chatUrl = new URL("/v1/chat/completions", TARGET_ORIGIN);
  const data = await requestJson(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      stream: false,
    }),
  });

  const message = data?.choices?.[0]?.message;
  const reply = stripModelThinkingContent(
    typeof message?.content === "string"
      ? message.content.trim()
      : Array.isArray(message?.content)
        ? message.content.map((item) => item?.text || "").join("\n").trim()
        : ""
  );

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

async function legacyHandleQqWebhookV1(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const event = rawBody ? JSON.parse(rawBody) : {};

    if (!qqBotConfig.enabled) {
      sendJson(res, 200, { ok: true, ignored: "bot_disabled" });
      return;
    }
    if (event.post_type !== "message") {
      sendJson(res, 200, { ok: true, ignored: "non_message_event" });
      return;
    }
    if (String(event.user_id || "") === String(event.self_id || "")) {
      sendJson(res, 200, { ok: true, ignored: "self_message" });
      return;
    }
    if (!isQqEventAllowed(event)) {
      sendJson(res, 200, { ok: true, ignored: "not_allowed" });
      return;
    }

    if (event.message_type === "group" && qqBotConfig.groupMentionOnly && !isGroupMentioned(event)) {
      sendJson(res, 200, { ok: true, ignored: "group_no_mention" });
      return;
    }
    const normalizedIncomingText = normalizeQqIncomingText(event);
    if (isQqSessionResetCommand(normalizedIncomingText)) {
      await clearQqSession(event);
      await sendQqMessageFinal({
        bridgeUrl: qqBotConfig.bridgeUrl,
        accessToken: qqBotConfig.accessToken,
        targetType: event.message_type === "group" ? "group" : "private",
        targetId: event.message_type === "group" ? String(event.group_id || "") : String(event.user_id || ""),
        message: "当前 QQ 会话已重置，我们可以从新话题继续。",
      });
      sendJson(res, 200, { ok: true, reset: true });
      return;
    }
    if (qqBotConfig.triggerPrefix && !stripQqTriggerPrefix(normalizedIncomingText)) {
      sendJson(res, 200, { ok: true, ignored: "missing_prefix" });
      return;
    }

    const reply = await generateQqBotReply(event);
    if (!reply) {
      sendJson(res, 200, { ok: true, ignored: "empty_reply" });
      return;
    }

    await sendQqMessageFinal({
      bridgeUrl: qqBotConfig.bridgeUrl,
      accessToken: qqBotConfig.accessToken,
      targetType: event.message_type === "group" ? "group" : "private",
      targetId: event.message_type === "group" ? String(event.group_id || "") : String(event.user_id || ""),
      message: reply,
    });

    sendJson(res, 200, { ok: true, replied: true });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "QQ webhook failed" });
  }
}

function legacyHandleQqBotConfigGetV1(res) {
  sendJson(res, 200, { ok: true, config: qqBotConfig });
}

async function legacyHandleQqBotConfigPostV1(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const config = await saveQqBotConfig({
      enabled: Boolean(payload.enabled),
      groupMentionOnly: payload.groupMentionOnly !== false,
      taskPushEnabled: Boolean(payload.taskPushEnabled),
      triggerPrefix: String(payload.triggerPrefix || "").trim(),
      allowedUsers: parseQqIdList(payload.allowedUsers),
      allowedGroups: parseQqIdList(payload.allowedGroups),
      persona: String(payload.persona || "").trim(),
      bridgeUrl: String(payload.bridgeUrl || "").trim(),
      accessToken: String(payload.accessToken || "").trim(),
      defaultTargetType: String(payload.defaultTargetType || DEFAULT_QQ_PUSH_TARGET_TYPE).trim().toLowerCase() === "group" ? "group" : "private",
      defaultTargetId: String(payload.defaultTargetId || DEFAULT_QQ_PUSH_TARGET_ID).trim(),
      model: String(payload.model || "").trim(),
      systemPrompt: String(payload.systemPrompt || "").trim(),
      assistantName: String(payload.assistantName || "繁星").trim() || "繁星",
    });
    sendJson(res, 200, { ok: true, config });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Failed to save QQ bot config" });
  }
}

executeToolCall = qqModule.wrapToolExecutor(executeToolCall);

const bootstrapServer = createServerBootstrap({
  initializeDataFiles: async () => {
    await initializeDataFiles();
    await novelModule.ensureNovelsDir();
    await initMysqlStorage();
  },
  runStartupCleanup,
  loadScheduledTasks,
  loadSharedConnectionConfig,
  loadQqBotConfig,
  loadQqBotSessions,
  startScheduledTaskLoop,
  server,
  port: PORT,
  host: HOST,
  targetOrigin: TARGET_ORIGIN,
});

bootstrapServer()
  .then(() => {
    startMysqlChatJobWorker();
    startMysqlNovelJobWorker();
    startMysqlModelListSync();
    warmupModelServiceConnection({ reason: "startup" }).catch(() => {});
  })
  .catch((error) => {
    console.error("Failed to initialize scheduler:", error);
    process.exit(1);
  });
