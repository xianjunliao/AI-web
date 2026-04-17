const http = require("http");
const https = require("https");
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
const { createStaticServer, createApiProxy } = require("./server/server-http");
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

function createRemovedSkillsFeatureError() {
  const error = new Error("Skills have been removed from this app.");
  error.statusCode = 410;
  return error;
}

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
      extraHeaders: resolved.authHeaders,
    };
  },
  sendJson,
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

function requestJson(targetUrl, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const transport = url.protocol === "https:" ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method || "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(payload ? { "Content-Length": payload.length } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          if (res.statusCode >= 400) {
            const error = new Error(
              parsed?.message || parsed?.msg || parsed?.error || `QQ bridge request failed: ${res.statusCode}`
            );
            error.statusCode = res.statusCode;
            reject(error);
            return;
          }
          resolve(parsed);
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function legacySendQqMessageV1(args = {}) {
  const bridgeUrl = String(args.bridgeUrl || "").trim();
  const targetType = String(args.targetType || "private").trim().toLowerCase();
  const targetId = String(args.targetId || "").trim();
  const message = String(args.message || "").trim();
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

const COMMAND_TOOL_DEFAULT_TIMEOUT_MS = 120000;
const COMMAND_TOOL_MAX_TIMEOUT_MS = 300000;
const COMMAND_TOOL_OUTPUT_LIMIT = 20000;

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

async function extractZipArchive(zipPath, destinationDir) {
  await fs.promises.mkdir(destinationDir, { recursive: true });
  const command = `Expand-Archive -LiteralPath '${escapePowerShellLiteral(zipPath)}' -DestinationPath '${escapePowerShellLiteral(destinationDir)}' -Force`;
  await runPowerShellCommand(command);
}

async function collectSkillRootCandidates(rootDir, currentDir = rootDir, candidates = []) {
  const skillFilePath = path.join(currentDir, "SKILL.md");
  try {
    const stat = await fs.promises.stat(skillFilePath);
    if (stat.isFile()) {
      candidates.push(path.relative(rootDir, currentDir).replace(/\\/g, "/") || ".");
      return candidates;
    }
  } catch {}

  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "__MACOSX") {
      continue;
    }
    await collectSkillRootCandidates(rootDir, path.join(currentDir, entry.name), candidates);
  }

  return candidates;
}

async function resolveExtractedSkillDirectory(extractRoot) {
  const candidates = await collectSkillRootCandidates(extractRoot);
  if (!candidates.length) {
    const error = new Error("压缩包中未找到 SKILL.md，无法识别为技能");
    error.statusCode = 400;
    throw error;
  }
  if (candidates.length > 1) {
    const error = new Error("压缩包中包含多个技能目录，请保持一个 ZIP 只包含一个技能");
    error.statusCode = 400;
    throw error;
  }
  const relativeDir = candidates[0];
  return {
    relativeDir,
    absoluteDir: relativeDir === "." ? extractRoot : path.join(extractRoot, relativeDir),
  };
}

async function ensureSkillDestinationDirectory(destinationDir) {
  try {
    await fs.promises.access(destinationDir, fs.constants.F_OK);
    const error = new Error("同名技能已存在，请先删除旧技能或更换目录名");
    error.statusCode = 409;
    throw error;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function detectSkillNameFromSkillMarkdown(skillDir) {
  try {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    const content = await fs.promises.readFile(skillMdPath, "utf8");
    const firstTitle = content.split(/\r?\n/).find((line) => line.trim().startsWith("#"));
    if (!firstTitle) return "";
    return firstTitle.replace(/^#+\s*/, "").split("-")[0].trim();
  } catch {
    return "";
  }
}

function createSkillRunnerJob(args = {}) {
  void args;
  throw createRemovedSkillsFeatureError();
}

function getNextPendingSkillRunnerJob() {
  return null;
}

function completeSkillRunnerJob(jobId, payload = {}) {
  void jobId;
  void payload;
  throw createRemovedSkillsFeatureError();
}

async function waitForSkillRunnerJob(jobId, timeoutMs = 0) {
  void jobId;
  void timeoutMs;
  throw createRemovedSkillsFeatureError();
}

async function handleSkillRunnerNextJobRequest(req, res) {
  void req;
  sendJson(res, 410, { error: "Skills have been removed from this app." });
}

async function handleSkillRunnerJobResultRequest(req, res, jobId) {
  void req;
  void jobId;
  sendJson(res, 410, { error: "Skills have been removed from this app." });
}

async function installSkillArchiveToWorkspace({ buffer, archiveName = "", targetName = "", source = "upload", sourceUrl = "" }) {
  if (!isZipArchiveBuffer(buffer)) {
    const error = new Error("技能安装仅支持 ZIP 格式");
    error.statusCode = 400;
    throw error;
  }

  const workspaceRoot = getSkillRoot("workspace");
  await fs.promises.mkdir(workspaceRoot, { recursive: true });

  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ai-web-skill-"));
  const archivePath = path.join(tempRoot, sanitizeSkillDirectoryName(archiveName || "skill") + ".zip");
  const extractDir = path.join(tempRoot, "extracted");

  try {
    await fs.promises.writeFile(archivePath, buffer);
    await extractZipArchive(archivePath, extractDir);

    const extracted = await resolveExtractedSkillDirectory(extractDir);
    const extractedDirName = extracted.relativeDir === "." ? "" : path.basename(extracted.relativeDir);
    const skillMarkdownName = await detectSkillNameFromSkillMarkdown(extracted.absoluteDir);
    const fallbackArchiveName = path.basename(archiveName || "skill");
    const derivedName = sanitizeSkillDirectoryName(
      targetName
      || extractedDirName
      || skillMarkdownName
      || fallbackArchiveName
    );
    const destinationDir = path.resolve(workspaceRoot, derivedName);
    if (!destinationDir.startsWith(workspaceRoot)) {
      const error = new Error("Skill path escapes workspace root");
      error.statusCode = 403;
      throw error;
    }

    await ensureSkillDestinationDirectory(destinationDir);
    await copyDirectoryRecursive(extracted.absoluteDir, destinationDir);

    return {
      name: derivedName,
      source,
      sourceUrl,
      installedTo: path.relative(ROOT, destinationDir).replace(/\\/g, "/"),
    };
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function requestBinary(targetUrl, { redirectCount = 0 } = {}) {
  if (redirectCount > 5) {
    const error = new Error("下载重定向次数过多");
    error.statusCode = 400;
    throw error;
  }

  const transport = targetUrl.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = transport.request(
      targetUrl,
      { method: "GET", headers: { "User-Agent": "AI-web/1.0" } },
      (res) => {
        const statusCode = res.statusCode || 500;

        if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
          const nextUrl = new URL(res.headers.location, targetUrl);
          res.resume();
          requestBinary(nextUrl, { redirectCount: redirectCount + 1 }).then(resolve).catch(reject);
          return;
        }

        if (statusCode >= 400) {
          res.resume();
          const error = new Error(`下载失败：${statusCode}`);
          error.statusCode = statusCode;
          reject(error);
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_SKILL_ARCHIVE_BYTES) {
            res.destroy(new Error("技能压缩包过大"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: String(res.headers["content-type"] || ""),
            finalUrl: targetUrl.toString(),
          });
        });
      }
    );
    req.on("error", (error) => {
      if (error.message === "技能压缩包过大") {
        error.statusCode = 413;
      }
      reject(error);
    });
    req.end();
  });
}

async function installSkillToWorkspace(source, name) {
  if (source === "workspace") {
    const error = new Error("Skill is already in workspace");
    error.statusCode = 400;
    throw error;
  }

  const sourceRoot = getSkillRoot(source);
  const sourceDir = path.resolve(sourceRoot, name);
  if (!sourceDir.startsWith(sourceRoot)) {
    const error = new Error("Skill path escapes source root");
    error.statusCode = 403;
    throw error;
  }

  const destinationRoot = getSkillRoot("workspace");
  const destinationDir = path.resolve(destinationRoot, name);
  if (!destinationDir.startsWith(destinationRoot)) {
    const error = new Error("Skill path escapes workspace root");
    error.statusCode = 403;
    throw error;
  }

  await fs.promises.mkdir(destinationRoot, { recursive: true });
  await copyDirectoryRecursive(sourceDir, destinationDir);

  return {
    source,
    name,
    installedTo: path.relative(ROOT, destinationDir).replace(/\\/g, "/"),
  };
}

async function runWorkspaceSkill(args = {}) {
  void args;
  throw createRemovedSkillsFeatureError();
  if (isRestrictedDesktopAutomationIdentity()) {
    const error = new Error(buildRestrictedDesktopAutomationMessage(String(args.skillName || "当前技能")));
    error.statusCode = 503;
    throw error;
  }
  const job = createSkillRunnerJob(args);
  try {
    const result = await waitForSkillRunnerJob(job.id, SKILL_RUN_TIMEOUT_MS);
    return {
      skillName: job.payload.skillName,
      queued: true,
      runnerJobId: job.id,
      ...result,
    };
  } catch (error) {
    const message = String(error?.message || "");
    if (/spawn\s+(EPERM|EINVAL)/i.test(message) || /拒绝访问|access is denied/i.test(message)) {
      const wrapped = new Error(buildRestrictedDesktopAutomationMessage(String(args.skillName || job.payload.skillName || "当前技能")));
      wrapped.statusCode = 503;
      throw wrapped;
    }
    throw error;
  }
}

async function handleSkillsInstallRequest(req, res) {
  void req;
  sendJson(res, 410, { error: "Skills have been removed from this app." });
  return;
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    if (!payload.name) {
      sendJson(res, 400, { error: "Missing skill name" });
      return;
    }

    const result = await installSkillToWorkspace(payload.source || "codex", payload.name);
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to install skill",
    });
  }
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
            resolve(String(text));
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

function requestJson(targetUrl, { method = "GET", headers = {}, body = "" } = {}) {
  const transport = targetUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      targetUrl,
      {
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const data = raw ? JSON.parse(raw) : {};
            if ((res.statusCode || 500) >= 400) {
              const error = new Error(data.error || `Request failed: ${res.statusCode}`);
              error.statusCode = res.statusCode || 500;
              reject(error);
              return;
            }
            resolve(data);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function requestBuffer(targetUrl, { method = "GET", headers = {}, body = "" } = {}) {
  const transport = targetUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      targetUrl,
      {
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if ((res.statusCode || 500) >= 400) {
            const error = new Error(`Request failed: ${res.statusCode}`);
            error.statusCode = res.statusCode || 500;
            reject(error);
            return;
          }
          resolve(buffer);
        });
      }
    );

    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function requestText(targetUrl, options = {}) {
  const buffer = await requestBuffer(targetUrl, options);
  return buffer.toString("utf8");
}

function normalizeClawHubSkillItem(item = {}) {
  const downloads = Number(
    item.download_count ??
    item.downloads ??
    item.install_count ??
    item.installs ??
    0
  ) || 0;
  const slug = item.slug || item.skill_slug || "";
  const owner = item.owner || item.author || item.publisher || "";
  const clawhubUrl =
    item.clawhub_url ||
    item.url ||
    item.link ||
    (slug && owner ? `https://clawhub.ai/${owner}/${slug}` : "") ||
    (slug ? `https://clawhub.ai/skills/${slug}` : "");
  const nonSuspicious =
    item.nonSuspicious ??
    item.non_suspicious ??
    item.safe ??
    (item.safety_status ? String(item.safety_status).toLowerCase() !== "suspicious" : true);

  return {
    id: String(item.id || slug || clawhubUrl || item.name || ""),
    name: String(item.name || item.skill_name || item.title || slug || "Unknown Skill"),
    summary: String(item.description || item.summary || item.tagline || ""),
    downloads,
    owner: String(owner || ""),
    slug: String(slug || ""),
    clawhubUrl: String(clawhubUrl || ""),
    nonSuspicious: Boolean(nonSuspicious),
  };
}

function unwrapSkillArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.skills)) return data.skills;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function fetchTopClawHubSkills(limit = 8) {
  const apiUrl = new URL("https://topclawhubskills.com/api/top-downloads");
  apiUrl.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || 8, 1), 20)));
  const data = await requestJson(apiUrl);
  return unwrapSkillArray(data)
    .map((item) => normalizeClawHubSkillItem(item))
    .filter((item) => item.nonSuspicious)
    .sort((left, right) => right.downloads - left.downloads);
}

async function searchClawHubSkills(query = "", limit = 8) {
  void query;
  void limit;
  throw createRemovedSkillsFeatureError();
  const text = String(query || "").trim();
  let items = [];

  if (text) {
    try {
      const apiUrl = new URL("https://topclawhubskills.com/api/search");
      apiUrl.searchParams.set("query", text);
      apiUrl.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || 8, 1), 20)));
      const data = await requestJson(apiUrl);
      items = unwrapSkillArray(data).map((item) => normalizeClawHubSkillItem(item));
    } catch {
      items = [];
    }
  }

  if (!items.length) {
    items = await fetchTopClawHubSkills(Math.max(limit, 12));
  }

  const normalizedQuery = text.toLowerCase();
  const filtered = normalizedQuery
    ? items.filter((item) => {
        const haystack = [item.name, item.summary, item.slug, item.owner].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : items;

  return filtered
    .filter((item) => item.nonSuspicious)
    .sort((left, right) => right.downloads - left.downloads)
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 20));
}

function sanitizeSkillDirectoryName(name = "") {
  return String(name || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || `clawhub-skill-${Date.now()}`;
}

async function runPowerShellExpandArchive(zipPath, destinationDir) {
  await fs.promises.mkdir(destinationDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$zip = $args[0]; $dest = $args[1]; Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force",
        zipPath,
        destinationDir,
      ],
      { stdio: "ignore" }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Expand-Archive failed with exit code ${code}`));
    });
  });
}

async function findDirectoryContainingFile(startDir, fileName) {
  try {
    const entries = await fs.promises.readdir(startDir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === fileName)) {
      return startDir;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = await findDirectoryContainingFile(path.join(startDir, entry.name), fileName);
      if (found) return found;
    }
  } catch {
    return null;
  }
  return null;
}

function extractDownloadZipUrl(html, pageUrl) {
  const patterns = [
    /<a[^>]+href="([^"]+)"[^>]*>\s*Download zip\s*<\/a>/i,
    /<a[^>]+href="([^"]+)"[^>]*>\s*Download ZIP\s*<\/a>/i,
    /href="([^"]+\.zip[^"]*)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return new URL(match[1], pageUrl).toString();
    }
  }
  return "";
}

async function installClawHubSkill(args = {}) {
  void args;
  throw createRemovedSkillsFeatureError();
  const query = String(args.query || args.name || "").trim();
  let skillPageUrl = String(args.url || args.clawhubUrl || "").trim();
  let targetName = String(args.targetName || "").trim();

  if (!skillPageUrl) {
    const matches = await searchClawHubSkills(query, 5);
    if (!matches.length) {
      const error = new Error(`No ClawHub skill found for: ${query}`);
      error.statusCode = 404;
      throw error;
    }
    skillPageUrl = matches[0].clawhubUrl;
    targetName = targetName || matches[0].slug || matches[0].name;
  }

  if (!skillPageUrl) {
    const error = new Error("Missing ClawHub skill URL");
    error.statusCode = 400;
    throw error;
  }

  const pageUrl = new URL(skillPageUrl);
  const html = await requestText(pageUrl);
  const downloadZipUrl = extractDownloadZipUrl(html, pageUrl);
  if (!downloadZipUrl) {
    const error = new Error("Could not find Download zip link on ClawHub skill page");
    error.statusCode = 502;
    throw error;
  }

  const skillDirName = sanitizeSkillDirectoryName(targetName || path.basename(pageUrl.pathname) || "clawhub-skill");
  const workspaceSkillsRoot = getSkillRoot("workspace");
  const destinationDir = path.join(workspaceSkillsRoot, skillDirName);
  try {
    await fs.promises.access(destinationDir);
    const error = new Error(`Skill already exists in workspace: skills/${skillDirName}`);
    error.statusCode = 409;
    throw error;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const tempRoot = path.join(ROOT, "temp-files", "clawhub-downloads");
  const installWorkDir = path.join(tempRoot, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const zipPath = path.join(installWorkDir, `${skillDirName}.zip`);
  const extractedDir = path.join(installWorkDir, "unzipped");

  await fs.promises.mkdir(installWorkDir, { recursive: true });
  const zipBuffer = await requestBuffer(new URL(downloadZipUrl));
  await fs.promises.writeFile(zipPath, zipBuffer);
  await runPowerShellExpandArchive(zipPath, extractedDir);

  const skillRoot = await findDirectoryContainingFile(extractedDir, "SKILL.md");
  if (!skillRoot) {
    const error = new Error("Downloaded archive does not contain SKILL.md");
    error.statusCode = 422;
    throw error;
  }

  await fs.promises.mkdir(workspaceSkillsRoot, { recursive: true });
  await copyDirectoryRecursive(skillRoot, destinationDir);

  return {
    name: skillDirName,
    installedTo: path.relative(ROOT, destinationDir).replace(/\\/g, "/"),
    source: "clawhub",
    clawhubUrl: pageUrl.toString(),
    downloadZipUrl,
  };
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
      finalText = text;
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
  return finalText;
}

async function generateNovelText({
  systemPrompt,
  userPrompt,
  temperature = 0.7,
} = {}) {
  const model = String(getSharedConnectionConfig()?.model || "").trim();
  if (!model) {
    const error = new Error("Base connection model is not configured");
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
  const message = String(args.message || "").trim();
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
  const reply =
    typeof message?.content === "string"
      ? message.content.trim()
      : Array.isArray(message?.content)
        ? message.content.map((item) => item?.text || "").join("\n").trim()
        : "";

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

async function handleSkillsUploadRequest(req, res) {
  void req;
  sendJson(res, 410, { error: "Skills have been removed from this app." });
  return;
  try {
    const rawBody = await readRequestBody(req, { limitBytes: SKILL_ARCHIVE_REQUEST_LIMIT });
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const fileName = String(payload.fileName || "").trim();
    const contentBase64 = String(payload.contentBase64 || "").trim();

    if (!fileName || !contentBase64) {
      sendJson(res, 400, { error: "Missing skill ZIP payload" });
      return;
    }
    if (path.extname(fileName).toLowerCase() !== ".zip") {
      sendJson(res, 400, { error: "技能上传仅支持 ZIP 格式" });
      return;
    }

    const buffer = Buffer.from(contentBase64, "base64");
    const result = await installSkillArchiveToWorkspace({
      buffer,
      archiveName: fileName,
      targetName: String(payload.targetName || "").trim(),
      source: "upload",
    });
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to upload skill ZIP",
    });
  }
}

async function handleSkillsDownloadRequest(req, res) {
  void req;
  sendJson(res, 410, { error: "Skills have been removed from this app." });
  return;
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const urlValue = String(payload.url || "").trim();
    if (!urlValue) {
      sendJson(res, 400, { error: "Missing skill download URL" });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(urlValue);
    } catch {
      sendJson(res, 400, { error: "Invalid skill download URL" });
      return;
    }

    if (!["http:", "https:"].includes(targetUrl.protocol)) {
      sendJson(res, 400, { error: "Only HTTP(S) skill download URLs are supported" });
      return;
    }

    const explicitExt = path.extname(decodeURIComponent(targetUrl.pathname || "")).toLowerCase();
    if (explicitExt && explicitExt !== ".zip") {
      sendJson(res, 400, { error: "技能下载仅支持 ZIP 格式链接" });
      return;
    }

    const download = await requestBinary(targetUrl);
    const archiveName = path.basename(decodeURIComponent(new URL(download.finalUrl).pathname || "")) || "skill.zip";
    const result = await installSkillArchiveToWorkspace({
      buffer: download.buffer,
      archiveName,
      targetName: String(payload.targetName || "").trim(),
      source: "download",
      sourceUrl: download.finalUrl,
    });
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to download skill ZIP",
    });
  }
}

executeToolCall = qqModule.wrapToolExecutor(executeToolCall);

const bootstrapServer = createServerBootstrap({
  initializeDataFiles: async () => {
    await initializeDataFiles();
    await novelModule.ensureNovelsDir();
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
  .catch((error) => {
    console.error("Failed to initialize scheduler:", error);
    process.exit(1);
  });
