const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = 8000;
const TARGET_ORIGIN = "http://127.0.0.1:1234";
const ROOT = __dirname;
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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
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

  if (pathname.startsWith("/api/")) {
    proxyRequest(req, res, pathname);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Local AI workbench running at http://${HOST}:${PORT}`);
  console.log(`Proxy target: ${TARGET_ORIGIN}`);
});
