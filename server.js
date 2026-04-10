const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = 8000;
const TARGET_ORIGIN = "http://127.0.0.1:1234";
const ROOT = __dirname;
const SCHEDULED_TASKS_FILE = path.join(ROOT, "scheduled-tasks.json");
const PERSONA_PRESETS_DIR = path.join(ROOT, "人设");
const SKILL_SOURCES = {
  workspace: path.join(ROOT, "skills"),
  codex: path.join(os.homedir(), ".codex", "skills"),
};
const SKILL_TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".py",
  ".sh",
  ".ps1",
  ".xml",
  ".csv",
  ".html",
  ".css",
]);
const MAX_SKILL_FILES = 24;
const MAX_SKILL_FILE_SIZE = 64 * 1024;
const SCHEDULER_TICK_MS = 30 * 1000;

let scheduledTasks = [];
const runningScheduledTaskIds = new Set();

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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallbackValue;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function resolveWorkspacePath(targetPath = ".") {
  const normalizedInput = String(targetPath || ".").replace(/^[/\\]+/, "");
  const resolvedPath = path.resolve(ROOT, normalizedInput);
  if (!resolvedPath.startsWith(ROOT)) {
    const error = new Error("Path escapes workspace");
    error.statusCode = 403;
    throw error;
  }
  return resolvedPath;
}

async function callLocalModelForTask(task) {
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

async function executeToolCall(name, args = {}) {
  switch (name) {
    case "list_dir": {
      const targetPath = resolveWorkspacePath(args.path || ".");
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
      const targetPath = resolveWorkspacePath(args.path);
      const content = await fs.promises.readFile(targetPath, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        content,
      };
    }
    case "write_file": {
      const targetPath = resolveWorkspacePath(args.path);
      const content = String(args.content ?? "");
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, content, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    }
    case "delete_file": {
      const targetPath = resolveWorkspacePath(args.path);
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

function getSkillRoot(source) {
  const root = SKILL_SOURCES[source];
  if (!root) {
    const error = new Error("Unknown skill source");
    error.statusCode = 400;
    throw error;
  }
  return root;
}

async function listSkills(filterSource = "") {
  const skills = [];

  for (const [source, root] of Object.entries(SKILL_SOURCES)) {
    if (filterSource && source !== filterSource) {
      continue;
    }
    try {
      await collectSkillsFromRoot(source, root, root, skills);
    } catch (error) {
      // Ignore missing roots
    }
  }

  skills.sort((left, right) => left.name.localeCompare(right.name));
  return skills;
}

async function collectSkillsFromRoot(source, sourceRoot, currentDir, skills) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(sourceRoot, fullPath).replace(/\\/g, "/");
    const skillFile = path.join(fullPath, "SKILL.md");

    try {
      const content = await fs.promises.readFile(skillFile, "utf8");
      const summary = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && line !== "---" && !line.startsWith("#")) || "No summary available.";

      skills.push({
        source,
        name: relativePath,
        summary,
      });
      continue;
    } catch (error) {
      // Not a skill root, continue walking.
    }

    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    await collectSkillsFromRoot(source, sourceRoot, fullPath, skills);
  }
}

async function collectSkillFiles(rootDir, currentDir, files = []) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (files.length >= MAX_SKILL_FILES) {
      break;
    }

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      await collectSkillFiles(rootDir, fullPath, files);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!SKILL_TEXT_EXTENSIONS.has(ext) && entry.name !== "SKILL.md") {
      continue;
    }

    const stat = await fs.promises.stat(fullPath);
    if (stat.size > MAX_SKILL_FILE_SIZE) {
      continue;
    }

    const content = await fs.promises.readFile(fullPath, "utf8");
    files.push({
      path: relativePath,
      content,
    });
  }

  return files;
}

async function readSkill(source, name) {
  const root = getSkillRoot(source);
  const skillDir = path.resolve(root, name);
  if (!skillDir.startsWith(root)) {
    const error = new Error("Skill path escapes source root");
    error.statusCode = 403;
    throw error;
  }

  const files = await collectSkillFiles(skillDir, skillDir);
  const skillFile = files.find((file) => file.path === "SKILL.md");
  return {
    source,
    name,
    content: skillFile?.content || "",
    files,
  };
}

async function handleSkillsListRequest(res, searchParams) {
  try {
    const source = searchParams.get("source") || "";
    const skills = await listSkills(source);
    sendJson(res, 200, { ok: true, skills });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to list skills",
    });
  }
}

async function handleSkillsReadRequest(res, searchParams) {
  try {
    const source = searchParams.get("source") || "workspace";
    const name = searchParams.get("name");
    if (!name) {
      sendJson(res, 400, { error: "Missing skill name" });
      return;
    }

    const skill = await readSkill(source, name);
    sendJson(res, 200, { ok: true, skill });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to read skill",
    });
  }
}

async function copyDirectoryRecursive(sourceDir, targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }

    await fs.promises.copyFile(sourcePath, targetPath);
  }
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

async function handleSkillsInstallRequest(req, res) {
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

async function collectPersonaFiles(currentDir, rootDir, personas) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectPersonaFiles(fullPath, rootDir, personas);
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

async function listPersonaPresets() {
  try {
    const stat = await fs.promises.stat(PERSONA_PRESETS_DIR);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  const personas = [];
  await collectPersonaFiles(PERSONA_PRESETS_DIR, PERSONA_PRESETS_DIR, personas);
  personas.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  return personas;
}

async function handlePersonaPresetsListRequest(res) {
  try {
    const presets = await listPersonaPresets();
    sendJson(res, 200, { ok: true, presets });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Failed to list persona presets",
    });
  }
}

function sanitizeScheduledTask(task = {}) {
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

async function loadScheduledTasks() {
  const records = await readJsonFile(SCHEDULED_TASKS_FILE, []);
  scheduledTasks = Array.isArray(records) ? records.map((task) => sanitizeScheduledTask(task)) : [];
}

async function saveScheduledTasks() {
  await writeJsonFile(SCHEDULED_TASKS_FILE, scheduledTasks);
}

function listScheduledTasks() {
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

function findEquivalentScheduledTask(taskLike = {}) {
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

function ensureScheduledTask(taskId) {
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

function resolveScheduledTask(args = {}) {
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

function validateScheduledTaskPayload(payload = {}, { partial = false } = {}) {
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

async function callLocalModelForTask(task) {
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

async function runScheduledTask(taskId) {
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

async function tickScheduledTasks() {
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

function startScheduledTaskLoop() {
  setInterval(() => {
    tickScheduledTasks().catch(() => {});
  }, SCHEDULER_TICK_MS);
}

async function handleScheduledTasksList(res) {
  sendJson(res, 200, { ok: true, tasks: listScheduledTasks() });
}

async function handleScheduledTasksCreate(req, res) {
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

async function handleScheduledTaskUpdate(req, res, taskId) {
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

async function handleScheduledTaskDelete(res, taskId) {
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

async function handleScheduledTaskRun(res, taskId) {
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
  forecastUrl.searchParams.set("timezone", "auto");

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

function parseCronExpression(cronExpression) {
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

function computeNextRunAt(task, fromTime = Date.now()) {
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

function sanitizeScheduledTask(task = {}) {
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

function validateScheduledTaskPayload(payload = {}, { partial = false } = {}) {
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

async function runScheduledTask(taskId) {
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

async function handleScheduledTasksCreate(req, res) {
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

async function handleScheduledTaskUpdate(req, res, taskId) {
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

async function executeToolCall(name, args = {}) {
  switch (name) {
    case "list_dir": {
      const targetPath = resolveWorkspacePath(args.path || ".");
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
      const targetPath = resolveWorkspacePath(args.path);
      const content = await fs.promises.readFile(targetPath, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        content,
      };
    }
    case "write_file": {
      const targetPath = resolveWorkspacePath(args.path);
      const content = String(args.content ?? "");
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, content, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    }
    case "delete_file": {
      const targetPath = resolveWorkspacePath(args.path);
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
      scheduledTasks.unshift(task);
      await saveScheduledTasks();
      return task;
    }
    case "update_scheduled_task": {
      const task = resolveScheduledTask(args);
      const patch = validateScheduledTaskPayload(args, { partial: true });
      Object.assign(task, patch);
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

async function callLocalModelWithTools({ model, messages, tools }) {
  const targetUrl = new URL("/v1/chat/completions", TARGET_ORIGIN);
  let workingMessages = [...messages];
  let finalText = "";

  for (let i = 0; i < 6; i += 1) {
    const requestBody = JSON.stringify({
      model,
      messages: workingMessages,
      temperature: 0.7,
      tools,
      tool_choice: "auto",
      stream: false,
    });

    const data = await requestJson(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
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

  if (!finalText) {
    throw new Error("Model completed without final text");
  }
  return finalText;
}

async function callLocalModelForTask(task) {
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

async function executeToolCall(name, args = {}) {
  switch (name) {
    case "list_dir": {
      const targetPath = resolveWorkspacePath(args.path || ".");
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
      const targetPath = resolveWorkspacePath(args.path);
      const content = await fs.promises.readFile(targetPath, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        content,
      };
    }
    case "write_file": {
      const targetPath = resolveWorkspacePath(args.path);
      const content = String(args.content ?? "");
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, content, "utf8");
      return {
        path: path.relative(ROOT, targetPath) || path.basename(targetPath),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    }
    case "delete_file": {
      const targetPath = resolveWorkspacePath(args.path);
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
    case "get_weather": {
      return await getWeatherByLocation(args.location);
    }
    case "search_clawhub_skills": {
      const query = String(args.query || "").trim();
      const skills = await searchClawHubSkills(query, Number(args.limit) || 6);
      return {
        query,
        preferredSource: "https://clawhub.ai/skills?sort=downloads&nonSuspicious=true",
        skills,
      };
    }
    case "install_clawhub_skill": {
      return await installClawHubSkill(args);
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
      scheduledTasks.unshift(task);
      await saveScheduledTasks();
      return task;
    }
    case "update_scheduled_task": {
      const task = ensureScheduledTask(args.id);
      const patch = validateScheduledTaskPayload(args, { partial: true });
      Object.assign(task, patch);
      task.updatedAt = Date.now();
      task.nextRunAt = task.enabled ? computeNextRunAt(task, Date.now()) : null;
      await saveScheduledTasks();
      return task;
    }
    case "delete_scheduled_task": {
      ensureScheduledTask(args.id);
      scheduledTasks = scheduledTasks.filter((task) => task.id !== args.id);
      runningScheduledTaskIds.delete(args.id);
      await saveScheduledTasks();
      return { deleted: true, id: args.id };
    }
    case "run_scheduled_task": {
      return await runScheduledTask(args.id);
    }
    default: {
      const error = new Error(`Unsupported tool: ${name}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.normalize(path.join(ROOT, safePath));

  if (!resolvedPath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      sendJson(res, 500, { error: "Failed to read file" });
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function proxyRequest(req, res, pathname) {
  const targetUrl = new URL(pathname.replace(/^\/api/, "") + (req.url.includes("?") ? `?${req.url.split("?")[1]}` : ""), TARGET_ORIGIN);

  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers };
      delete headers["access-control-allow-origin"];
      delete headers["access-control-allow-credentials"];

      res.writeHead(proxyRes.statusCode || 500, headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    sendJson(res, 502, {
      error: "Proxy request failed",
      details: error.message,
    });
  });

  req.pipe(proxyReq);
}

async function callLocalModelForTask(task) {
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

  if (pathname === "/skills/list" && req.method === "GET") {
    handleSkillsListRequest(res, url.searchParams);
    return;
  }

  if (pathname === "/skills/read" && req.method === "GET") {
    handleSkillsReadRequest(res, url.searchParams);
    return;
  }

  if (pathname === "/skills/install" && req.method === "POST") {
    handleSkillsInstallRequest(req, res);
    return;
  }

  if (pathname === "/personas/list" && req.method === "GET") {
    handlePersonaPresetsListRequest(res);
    return;
  }

  if (pathname === "/scheduler/tasks" && req.method === "GET") {
    handleScheduledTasksList(res);
    return;
  }

  if (pathname === "/scheduler/tasks" && req.method === "POST") {
    handleScheduledTasksCreate(req, res);
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

  if (pathname.startsWith("/api/")) {
    proxyRequest(req, res, pathname);
    return;
  }

  serveStatic(req, res, pathname);
});

loadScheduledTasks()
  .then(() => {
    startScheduledTaskLoop();
    server.listen(PORT, HOST, () => {
      console.log(`Local AI workbench running at http://${HOST}:${PORT}`);
      console.log(`Proxy target: ${TARGET_ORIGIN}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize scheduler:", error);
    process.exit(1);
  });
