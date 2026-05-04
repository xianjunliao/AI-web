const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const DEFAULT_OUTBOUND_TIMEOUT_MS = 20_000;
const DEFAULT_OUTBOUND_RETRY_COUNT = 1;
const DEFAULT_OUTBOUND_RETRY_DELAY_MS = 750;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
]);
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const KEEP_ALIVE_HTTP_AGENT = new http.Agent({ keepAlive: true });
const KEEP_ALIVE_HTTPS_AGENT = new https.Agent({ keepAlive: true });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiPath(value = "", fallback = "/") {
  const normalized = String(value || fallback || "").trim() || fallback || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function getTransportForUrl(targetUrl) {
  return targetUrl.protocol === "https:"
    ? { transport: https, agent: KEEP_ALIVE_HTTPS_AGENT }
    : { transport: http, agent: KEEP_ALIVE_HTTP_AGENT };
}

function createRequestTimeoutError(targetUrl, timeoutMs) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.code = "ETIMEDOUT";
  error.targetUrl = String(targetUrl || "");
  return error;
}

function isRetryableNetworkError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (RETRYABLE_NETWORK_CODES.has(code)) {
    return true;
  }
  return /socket hang up/i.test(String(error?.message || ""));
}

function isRetryableStatusCode(statusCode) {
  return RETRYABLE_STATUS_CODES.has(Number(statusCode) || 0);
}

function normalizeRetryCount(value, fallback = DEFAULT_OUTBOUND_RETRY_COUNT) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return Math.max(0, Number(value) || 0);
}

function normalizeRetryDelayMs(value, fallback = DEFAULT_OUTBOUND_RETRY_DELAY_MS) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return Math.max(0, Number(value) || 0);
}

function normalizeTimeoutMs(value, fallback = DEFAULT_OUTBOUND_TIMEOUT_MS) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return Math.max(1000, Number(value) || fallback);
}

function toBodyBuffer(body = "") {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body == null) {
    return Buffer.alloc(0);
  }
  return Buffer.from(String(body), "utf8");
}

function getDefaultUserAgent(headers = {}) {
  return headers["User-Agent"] || headers["user-agent"] ? {} : { "User-Agent": "AI-web/1.0" };
}

function requestBufferOnce(targetUrl, { method = "GET", headers = {}, body = "", timeoutMs = DEFAULT_OUTBOUND_TIMEOUT_MS } = {}) {
  const url = targetUrl instanceof URL ? targetUrl : new URL(targetUrl);
  const { transport, agent } = getTransportForUrl(url);
  const bodyBuffer = toBodyBuffer(body);

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method,
        headers: {
          ...getDefaultUserAgent(headers),
          ...headers,
        },
        agent,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: { ...res.headers },
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(createRequestTimeoutError(url, timeoutMs));
    });

    req.on("error", reject);
    if (bodyBuffer.length) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function requestBufferWithRetry(targetUrl, options = {}) {
  const retryCount = normalizeRetryCount(options.retryCount);
  const retryDelayMs = normalizeRetryDelayMs(options.retryDelayMs);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await requestBufferOnce(targetUrl, {
        ...options,
        timeoutMs,
      });
      if (isRetryableStatusCode(response.statusCode) && attempt < retryCount) {
        await wait(retryDelayMs * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt >= retryCount) {
        throw error;
      }
      await wait(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError || new Error("Request failed");
}

async function requestJsonWithRetry(targetUrl, options = {}) {
  const response = await requestBufferWithRetry(targetUrl, options);
  const raw = response.body.toString("utf8");
  let parsed = {};
  let parsedOk = true;

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsedOk = false;
      parsed = null;
    }
  }

  if ((response.statusCode || 500) >= 400) {
    const detail = formatJsonErrorDetail(parsed, raw, response.statusCode || 500);
    const error = new Error(detail);
    error.statusCode = response.statusCode || 500;
    error.rawBody = raw;
    throw error;
  }

  if (!parsedOk) {
    const error = new Error("Response was not valid JSON");
    error.statusCode = response.statusCode || 500;
    error.rawBody = raw;
    throw error;
  }

  return parsed || {};
}

function formatJsonErrorDetail(parsed, raw, statusCode) {
  const candidates = [
    parsed?.message,
    parsed?.msg,
    parsed?.error?.message,
    parsed?.error?.msg,
    parsed?.error?.detail,
    parsed?.error,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "object") {
      try {
        const text = JSON.stringify(candidate);
        if (text && text !== "{}") return text;
      } catch {
        // Fall through to the raw response.
      }
    }
  }
  return String(raw || "").trim() || `Request failed: ${statusCode || 500}`;
}

function readIncomingRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
    };

    const onData = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onAborted = () => {
      cleanup();
      reject(new Error("Client request aborted"));
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function buildProxyRequestHeaders({
  requestHeaders = {},
  extraHeaders = {},
  method = "GET",
  bodyBuffer = Buffer.alloc(0),
} = {}) {
  const nextHeaders = {};

  for (const [key, value] of Object.entries(requestHeaders || {})) {
    if (value == null) {
      continue;
    }
    const normalizedKey = String(key || "").toLowerCase();
    if (
      !normalizedKey ||
      HOP_BY_HOP_REQUEST_HEADERS.has(normalizedKey) ||
      normalizedKey === "content-length" ||
      normalizedKey === "host" ||
      normalizedKey === "origin" ||
      normalizedKey === "referer" ||
      normalizedKey === "if-none-match" ||
      normalizedKey === "if-modified-since"
    ) {
      continue;
    }
    nextHeaders[key] = value;
  }

  for (const [key, value] of Object.entries(extraHeaders || {})) {
    if (value == null) {
      continue;
    }
    nextHeaders[key] = value;
  }

  if (bodyBuffer.length) {
    nextHeaders["Content-Length"] = String(bodyBuffer.length);
  } else if (["POST", "PUT", "PATCH"].includes(String(method || "GET").toUpperCase())) {
    nextHeaders["Content-Length"] = "0";
  } else {
    delete nextHeaders["Content-Length"];
    delete nextHeaders["content-length"];
  }

  if (!nextHeaders["User-Agent"] && !nextHeaders["user-agent"]) {
    nextHeaders["User-Agent"] = "AI-web/1.0";
  }

  return nextHeaders;
}

function buildProxyResponseHeaders(responseHeaders = {}, bodyBuffer = Buffer.alloc(0)) {
  const headers = {};
  for (const [key, value] of Object.entries(responseHeaders || {})) {
    const normalizedKey = String(key || "").toLowerCase();
    if (
      !normalizedKey ||
      HOP_BY_HOP_RESPONSE_HEADERS.has(normalizedKey) ||
      normalizedKey === "content-length" ||
      normalizedKey === "etag" ||
      normalizedKey === "last-modified" ||
      normalizedKey === "access-control-allow-origin" ||
      normalizedKey === "access-control-allow-credentials"
    ) {
      continue;
    }
    headers[key] = value;
  }
  headers["Content-Length"] = String(bodyBuffer.length);
  headers["Cache-Control"] = "no-store";
  return headers;
}

function resolveProxyTargetPath(pathname = "/", proxyConfig = {}) {
  const relativePath = normalizeApiPath(String(pathname || "/").replace(/^\/api/, "") || "/");
  const chatPath = normalizeApiPath(proxyConfig.chatPath || "/v1/chat/completions", "/v1/chat/completions");
  const modelsPath = normalizeApiPath(proxyConfig.modelsPath || "/v1/models", "/v1/models");

  if (relativePath === "/v1/chat/completions") {
    return chatPath;
  }
  if (relativePath === "/v1/models") {
    return modelsPath;
  }
  return relativePath;
}

function createStaticServer({
  publicDir,
  mimeTypes,
  isPublicStaticPath,
  sendJson,
} = {}) {
  return function serveStatic(req, res, pathname) {
    if (!isPublicStaticPath(pathname)) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const safePath = pathname === "/" ? "/index.html" : pathname;
    const relativePublicPath = safePath.replace(/^\/+/, "");
    const resolvedPath = path.normalize(path.join(publicDir, relativePublicPath));

    if (!resolvedPath.startsWith(publicDir)) {
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
      const contentType = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
      res.end(data);
    });
  };
}

function createApiProxy({
  targetOrigin,
  getProxyConfig,
  sendJson,
  logDebug,
} = {}) {
  return function proxyRequest(req, res, pathname) {
    void (async () => {
      const proxyConfig = typeof getProxyConfig === "function" ? (getProxyConfig() || {}) : {};
      const resolvedOrigin = String(proxyConfig.targetOrigin || targetOrigin || "").trim();
      if (!resolvedOrigin) {
        sendJson(res, 500, { error: "Proxy target is not configured" });
        return;
      }

      const incomingUrl = new URL(req.url || pathname || "/", "http://127.0.0.1");
      const targetPath = resolveProxyTargetPath(pathname || incomingUrl.pathname, proxyConfig);
      const targetUrl = new URL(targetPath, resolvedOrigin);
      targetUrl.search = incomingUrl.search;

      const extraHeaders = proxyConfig.extraHeaders && typeof proxyConfig.extraHeaders === "object"
        ? proxyConfig.extraHeaders
        : {};
      const bodyBuffer = await readIncomingRequestBody(req);
      const response = await requestBufferWithRetry(targetUrl, {
        method: req.method || "GET",
        headers: buildProxyRequestHeaders({
          requestHeaders: req.headers,
          extraHeaders,
          method: req.method || "GET",
          bodyBuffer,
        }),
        body: bodyBuffer,
        timeoutMs: proxyConfig.timeoutMs,
        retryCount: proxyConfig.retryCount,
        retryDelayMs: proxyConfig.retryDelayMs,
      });

      res.writeHead(
        response.statusCode || 500,
        buildProxyResponseHeaders(response.headers, response.body)
      );
      res.end(response.body);
    })().catch((error) => {
      try {
        if (typeof logDebug === "function") {
          logDebug(
            `proxy failed method=${String(req.method || "").toUpperCase()} path=${String(req.url || pathname || "")} `
            + `code=${String(error?.code || "")} status=${String(error?.statusCode || "")} `
            + `message=${String(error?.message || "unknown")}`
          );
        }
      } catch {}

      sendJson(res, error.statusCode || 502, {
        error: "Proxy request failed",
        details: error.message,
        code: error.code || "",
      });
    });
  };
}

module.exports = {
  createStaticServer,
  createApiProxy,
  requestJsonWithRetry,
  requestBufferWithRetry,
  isRetryableNetworkError,
  isRetryableStatusCode,
};
