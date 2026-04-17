const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

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
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  };
}

function createApiProxy({
  targetOrigin,
  getProxyConfig,
  sendJson,
} = {}) {
  return function proxyRequest(req, res, pathname) {
    const proxyConfig = typeof getProxyConfig === "function" ? (getProxyConfig() || {}) : {};
    const resolvedOrigin = String(proxyConfig.targetOrigin || targetOrigin || "").trim();
    if (!resolvedOrigin) {
      sendJson(res, 500, { error: "Proxy target is not configured" });
      return;
    }
    const targetUrl = new URL(
      pathname.replace(/^\/api/, "") + (req.url.includes("?") ? `?${req.url.split("?")[1]}` : ""),
      resolvedOrigin
    );
    const transport = targetUrl.protocol === "https:" ? https : http;
    const extraHeaders = proxyConfig.extraHeaders && typeof proxyConfig.extraHeaders === "object"
      ? proxyConfig.extraHeaders
      : {};

    const proxyReq = transport.request(
      targetUrl,
      {
        method: req.method,
        headers: {
          ...req.headers,
          ...extraHeaders,
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
  };
}

module.exports = {
  createStaticServer,
  createApiProxy,
};
