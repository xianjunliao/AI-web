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

async function writeJsonFileAtomic(filePath, value) {
  const dirPath = path.dirname(filePath);
  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.promises.mkdir(dirPath, { recursive: true });
  await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fs.promises.rename(tempPath, filePath);
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
  createHttpError,
  createStaticPathGuard,
  migrateLegacyDataFile,
  readJsonFile,
  readRequestBody,
  resolveWorkspacePath,
  writeJsonFileAtomic,
};
