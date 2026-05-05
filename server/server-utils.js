const fs = require("fs");
const path = require("path");

const DEFAULT_REQUEST_BODY_LIMIT = 1024 * 1024;

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function ensurePathInsideRoot(rootPath, targetPath, errorMessage = "Path escapes workspace") {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createHttpError(errorMessage, 403);
  }
}

function resolveWorkspacePath(rootPath, targetPath = ".") {
  const normalizedInput = String(targetPath || ".").replace(/^[/\\]+/, "");
  const resolvedPath = path.resolve(rootPath, normalizedInput);
  ensurePathInsideRoot(rootPath, resolvedPath);
  return resolvedPath;
}

function stripModelThinkingContent(value = "") {
  let text = String(value || "").replace(/\r\n/g, "\n");
  if (!text) {
    return "";
  }

  text = text
    .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, "")
    .replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think(?:ing)?\b[^>]*>/gi, "");

  const closeTagMatch = text.match(/<\/think(?:ing)?>/i);
  if (closeTagMatch) {
    const prefix = text.slice(0, closeTagMatch.index);
    if (!/<think(?:ing)?\b/i.test(prefix)) {
      text = text.slice(closeTagMatch.index + closeTagMatch[0].length);
    }
  }

  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildAssistantMessageForHistory(message = {}, fallbackContent = "") {
  const assistantMessage = {
    role: "assistant",
    content: Object.prototype.hasOwnProperty.call(message, "content")
      ? message.content
      : fallbackContent,
  };

  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    assistantMessage.tool_calls = message.tool_calls;
  }
  if (Object.prototype.hasOwnProperty.call(message, "reasoning_content")) {
    assistantMessage.reasoning_content = message.reasoning_content;
  }
  if (Object.prototype.hasOwnProperty.call(message, "reasoning")) {
    assistantMessage.reasoning = message.reasoning;
  }

  return assistantMessage;
}

async function readRequestBody(req, options = {}) {
  const limitBytes = Number(options.limitBytes) || DEFAULT_REQUEST_BODY_LIMIT;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > limitBytes) {
        req.pause();
        if (typeof req.resume === "function") {
          req.resume();
        }
        fail(createHttpError("Request body too large", 413));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    const onError = (error) => {
      fail(error);
    };

    const onAborted = () => {
      fail(createHttpError("Request aborted", 400));
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
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

async function readTextFile(filePath, fallbackValue = "") {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallbackValue;
    }
    throw error;
  }
}

function isRetryableAtomicRenameError(error) {
  return ["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJsonFileAtomic(filePath, value) {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

async function writeFileAtomic(filePath, content) {
  const dirPath = path.dirname(filePath);
  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.promises.mkdir(dirPath, { recursive: true });
  try {
    await fs.promises.writeFile(tempPath, String(content ?? ""), "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.promises.rename(tempPath, filePath);
        break;
      } catch (error) {
        if (!isRetryableAtomicRenameError(error) || attempt >= 5) {
          throw error;
        }
        await wait(25 * (attempt + 1));
      }
    }
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function createStaticPathGuard(rootPath, options = {}) {
  const exactPaths = new Set(options.exactPaths || []);
  const publicDir = options.publicDir ? path.resolve(rootPath, options.publicDir) : null;

  return function isPublicStaticPath(pathname = "/") {
    if (exactPaths.has(pathname)) {
      return true;
    }

    if (!publicDir) {
      return false;
    }

    const safePath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (!safePath || safePath.includes("\0")) {
      return false;
    }

    const resolvedPath = path.resolve(publicDir, safePath);
    try {
      ensurePathInsideRoot(publicDir, resolvedPath, "Forbidden");
    } catch {
      return false;
    }
    return true;
  };
}

async function migrateLegacyDataFile({ currentPath, legacyPath, fallbackValue }) {
  if (currentPath === legacyPath) {
    return;
  }

  try {
    await fs.promises.access(currentPath, fs.constants.F_OK);
    return;
  } catch {}

  try {
    await fs.promises.mkdir(path.dirname(currentPath), { recursive: true });
    await fs.promises.rename(legacyPath, currentPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJsonFileAtomic(currentPath, fallbackValue);
      return;
    }
    if (error.code === "EXDEV") {
      const value = await readJsonFile(legacyPath, fallbackValue);
      await writeJsonFileAtomic(currentPath, value);
      return;
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_REQUEST_BODY_LIMIT,
  buildAssistantMessageForHistory,
  createHttpError,
  createStaticPathGuard,
  migrateLegacyDataFile,
  readJsonFile,
  readTextFile,
  readRequestBody,
  resolveWorkspacePath,
  stripModelThinkingContent,
  writeFileAtomic,
  writeJsonFileAtomic,
};
