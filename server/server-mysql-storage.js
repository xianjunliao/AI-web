const mysql = require("mysql2/promise");

function parseJsonValue(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : Date.now();
}

function sanitizeChatRecord(record = {}) {
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const now = Date.now();
  return {
    id: String(record.id || `chat-${now}`).trim(),
    title: String(record.title || "Untitled chat").trim() || "Untitled chat",
    model: String(record.model || "").trim(),
    assistantName: String(record.assistantName || record.assistant_name || "").trim(),
    userName: String(record.userName || record.user_name || "").trim(),
    createdAt: normalizeTimestamp(record.createdAt || record.created_at || now),
    updatedAt: normalizeTimestamp(record.updatedAt || record.updated_at || now),
    messages,
  };
}

function rowToChatRecord(row = {}) {
  return {
    id: String(row.id || ""),
    title: String(row.title || ""),
    model: String(row.model || ""),
    assistantName: String(row.assistant_name || ""),
    userName: String(row.user_name || ""),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    messages: parseJsonValue(row.messages_json, []),
    metadata: parseJsonValue(row.metadata_json, {}),
  };
}

function rowToChatJob(row = {}) {
  return {
    id: Number(row.id || 0),
    requestId: String(row.request_id || ""),
    source: String(row.source || ""),
    model: String(row.model || ""),
    requestPayload: parseJsonValue(row.request_json, {}),
    attempts: Number(row.attempts || 0),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function rowToNovelJob(row = {}) {
  return {
    id: Number(row.id || 0),
    requestId: String(row.request_id || ""),
    source: String(row.source || ""),
    method: String(row.method || "GET").toUpperCase(),
    path: String(row.path || "/"),
    requestPayload: parseJsonValue(row.request_json, {}),
    attempts: Number(row.attempts || 0),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function extractMessageText(content) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string" || typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }
  if (Array.isArray(content)) {
    return content.map((item) => extractMessageText(item)).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    return [
      content.text,
      content.content,
      content.output_text,
      content.input_text,
      content.value,
    ].map((item) => extractMessageText(item)).filter(Boolean).join("\n");
  }
  return "";
}

function extractLastMessageText(messages = [], role = "") {
  if (!Array.isArray(messages)) {
    return "";
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!role || message?.role === role) {
      const text = extractMessageText(message?.content).trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function extractAssistantTextFromResponse(response = {}) {
  const choices = Array.isArray(response?.choices) ? response.choices : [];
  for (const choice of choices) {
    const text = extractMessageText(choice?.message?.content || choice?.text).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function createMysqlStorage({
  mysqlConfigFile,
  readJsonFile,
  readRequestBody,
  sendJson,
  logDebug,
} = {}) {
  let pool = null;
  let enabled = false;
  let lastError = "";
  let activeConfig = {};

  async function loadConfig() {
    const config = await readJsonFile(mysqlConfigFile, {});
    activeConfig = config && typeof config === "object" ? config : {};
    enabled = config.enabled === true;
    return config;
  }

  async function initMysqlStorage() {
    const config = await loadConfig();
    if (!enabled) {
      return false;
    }
    pool = mysql.createPool({
      host: config.host,
      port: Number(config.port || 3306),
      database: config.database,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: Number(config.connectionLimit || 5),
      connectTimeout: Number(config.connectTimeout || 10000),
      charset: "utf8mb4",
    });
    const connection = await pool.getConnection();
    try {
      await connection.query("SELECT 1");
      lastError = "";
      return true;
    } finally {
      connection.release();
    }
  }

  function getPool() {
    if (!pool) {
      const error = new Error(lastError || "MySQL storage is not initialized");
      error.statusCode = 503;
      throw error;
    }
    return pool;
  }

  async function ensureMysqlStorage() {
    if (pool) {
      return true;
    }
    try {
      return await initMysqlStorage();
    } catch (error) {
      lastError = error.message || "Failed to initialize MySQL storage";
      if (typeof logDebug === "function") {
        logDebug(`mysql_storage_init_failed ${lastError}`);
      }
      throw error;
    }
  }

  function isRecoverableMysqlConnectionError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    return [
      "ECONNRESET",
      "PROTOCOL_CONNECTION_LOST",
      "ETIMEDOUT",
      "EPIPE",
      "ECONNREFUSED",
    ].includes(code) || /ECONNRESET|connection lost|closed|timeout/i.test(message);
  }

  async function resetMysqlPool() {
    const currentPool = pool;
    pool = null;
    if (!currentPool || typeof currentPool.end !== "function") return;
    try {
      await currentPool.end();
    } catch {}
  }

  async function queryMysqlWithReconnect(sql, params = []) {
    await ensureMysqlStorage();
    try {
      return await getPool().query(sql, params);
    } catch (error) {
      if (!isRecoverableMysqlConnectionError(error)) {
        throw error;
      }
      if (typeof logDebug === "function") {
        logDebug(`mysql_storage_reconnect_after ${error.code || error.message || "connection_error"}`);
      }
      await resetMysqlPool();
      await ensureMysqlStorage();
      return await getPool().query(sql, params);
    }
  }

  async function listChatRecords() {
    await ensureMysqlStorage();
    const [rows] = await getPool().query(
      "SELECT id,title,model,assistant_name,user_name,messages_json,metadata_json,created_at,updated_at FROM ai_web_chat_records WHERE deleted_at IS NULL ORDER BY updated_at DESC"
    );
    return rows.map(rowToChatRecord);
  }

  async function syncChatRecords(records = []) {
    await ensureMysqlStorage();
    const normalizedRecords = Array.isArray(records)
      ? records.map(sanitizeChatRecord).filter((record) => record.id)
      : [];
    const now = Date.now();
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      if (normalizedRecords.length) {
        for (const record of normalizedRecords) {
          await connection.query(
            `INSERT INTO ai_web_chat_records
              (id,title,model,assistant_name,user_name,messages_json,metadata_json,created_at,updated_at,deleted_at)
             VALUES (?,?,?,?,?,?,?,?,?,NULL)
             ON DUPLICATE KEY UPDATE
              title=VALUES(title),
              model=VALUES(model),
              assistant_name=VALUES(assistant_name),
              user_name=VALUES(user_name),
              messages_json=VALUES(messages_json),
              metadata_json=VALUES(metadata_json),
              created_at=LEAST(created_at, VALUES(created_at)),
              updated_at=VALUES(updated_at),
              deleted_at=NULL`,
            [
              record.id,
              record.title,
              record.model,
              record.assistantName,
              record.userName,
              JSON.stringify(record.messages),
              JSON.stringify(record.metadata || {}),
              record.createdAt,
              record.updatedAt,
            ]
          );
        }
      }
      const ids = normalizedRecords.map((record) => record.id);
      if (ids.length) {
        await connection.query(
          "UPDATE ai_web_chat_records SET deleted_at=? WHERE deleted_at IS NULL AND id NOT IN (?)",
          [now, ids]
        );
      } else {
        await connection.query(
          "UPDATE ai_web_chat_records SET deleted_at=? WHERE deleted_at IS NULL",
          [now]
        );
      }
      await connection.query(
        "INSERT INTO ai_web_storage_events (event_type,event_json,created_at) VALUES (?,?,?)",
        ["chat_records_sync", JSON.stringify({ count: normalizedRecords.length }), now]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return normalizedRecords;
  }

  async function getConfig(configKey) {
    const [rows] = await queryMysqlWithReconnect(
      "SELECT config_json,updated_at FROM ai_web_configs WHERE config_key=?",
      [configKey]
    );
    if (!rows.length) {
      return null;
    }
    return {
      key: configKey,
      value: parseJsonValue(rows[0].config_json, {}),
      updatedAt: normalizeTimestamp(rows[0].updated_at),
    };
  }

  async function saveConfig(configKey, value) {
    const now = Date.now();
    await queryMysqlWithReconnect(
      `INSERT INTO ai_web_configs (config_key,config_json,updated_at)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE config_json=VALUES(config_json), updated_at=VALUES(updated_at)`,
      [configKey, JSON.stringify(value || {}), now]
    );
    return { key: configKey, value: value || {}, updatedAt: now };
  }

  async function logChatApiRequest(record = {}) {
    await ensureMysqlStorage();
    const requestPayload = record.requestPayload && typeof record.requestPayload === "object"
      ? record.requestPayload
      : {};
    const responsePayload = record.responsePayload && typeof record.responsePayload === "object"
      ? record.responsePayload
      : null;
    const now = normalizeTimestamp(record.createdAt || Date.now());
    const requestId = String(record.requestId || `chatreq-${now}-${Math.random().toString(36).slice(2, 8)}`);
    const model = String(record.model || requestPayload.model || responsePayload?.model || "").trim();
    const source = String(record.source || "").trim().slice(0, 128);
    const userText = String(record.userText || extractLastMessageText(requestPayload.messages, "user")).slice(0, 65535);
    const assistantText = String(
      record.assistantText || extractAssistantTextFromResponse(responsePayload)
    ).slice(0, 16 * 1024 * 1024);

    await getPool().query(
      `INSERT INTO ai_web_chat_request_logs
        (request_id,source,model,user_text,assistant_text,request_json,response_json,status_code,error_text,latency_ms,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        source=VALUES(source),
        model=VALUES(model),
        user_text=VALUES(user_text),
        assistant_text=VALUES(assistant_text),
        request_json=VALUES(request_json),
        response_json=VALUES(response_json),
        status_code=VALUES(status_code),
        error_text=VALUES(error_text),
        latency_ms=VALUES(latency_ms)`,
      [
        requestId,
        source,
        model,
        userText,
        assistantText,
        JSON.stringify(requestPayload),
        responsePayload ? JSON.stringify(responsePayload) : null,
        Number(record.statusCode || 0),
        record.errorText ? String(record.errorText).slice(0, 65535) : null,
        Math.max(0, Number(record.latencyMs || 0)),
        now,
      ]
    );
    return requestId;
  }

  function getMysqlStorageConfig() {
    return { ...activeConfig };
  }

  async function claimPendingChatJob(workerId = "ai-web-worker") {
    await ensureMysqlStorage();
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const now = Date.now();
      const staleBefore = now - Math.max(30_000, Number(activeConfig.chatJobStaleMs || 120_000));
      const [rows] = await connection.query(
        `SELECT id,request_id,source,model,request_json,attempts,created_at,updated_at
         FROM ai_web_chat_jobs
         WHERE status='pending'
            OR (status='processing' AND (locked_at IS NULL OR locked_at < ?))
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`,
        [staleBefore]
      );
      if (!rows.length) {
        await connection.commit();
        return null;
      }
      const row = rows[0];
      await connection.query(
        `UPDATE ai_web_chat_jobs
         SET status='processing', attempts=attempts+1, locked_by=?, locked_at=?, updated_at=?
         WHERE id=?`,
        [workerId, now, now, row.id]
      );
      await connection.commit();
      return rowToChatJob({ ...row, attempts: Number(row.attempts || 0) + 1, updated_at: now });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function completeChatJob(jobId, {
    responsePayload = {},
    statusCode = 200,
    latencyMs = 0,
  } = {}) {
    await ensureMysqlStorage();
    const now = Date.now();
    await getPool().query(
      `UPDATE ai_web_chat_jobs
       SET status='done',
        response_json=?,
        assistant_text=?,
        status_code=?,
        error_text=NULL,
        latency_ms=?,
        locked_by=NULL,
        locked_at=NULL,
        updated_at=?,
        completed_at=?
       WHERE id=?`,
      [
        JSON.stringify(responsePayload || {}),
        extractAssistantTextFromResponse(responsePayload).slice(0, 16 * 1024 * 1024),
        Number(statusCode || 200),
        Math.max(0, Number(latencyMs || 0)),
        now,
        now,
        jobId,
      ]
    );
  }

  async function failChatJob(jobId, {
    errorText = "",
    responsePayload = null,
    statusCode = 500,
    latencyMs = 0,
  } = {}) {
    await ensureMysqlStorage();
    const now = Date.now();
    await getPool().query(
      `UPDATE ai_web_chat_jobs
       SET status='error',
        response_json=?,
        error_text=?,
        status_code=?,
        latency_ms=?,
        locked_by=NULL,
        locked_at=NULL,
        updated_at=?,
        completed_at=?
       WHERE id=?`,
      [
        responsePayload ? JSON.stringify(responsePayload) : null,
        String(errorText || "Chat job failed").slice(0, 65535),
        Number(statusCode || 500),
        Math.max(0, Number(latencyMs || 0)),
        now,
        now,
        jobId,
      ]
    );
  }

  async function claimPendingNovelJob(workerId = "ai-web-novel-worker") {
    await ensureMysqlStorage();
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT id,request_id,source,method,path,request_json,attempts,created_at,updated_at
         FROM ai_web_novel_jobs
         WHERE status='pending'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`
      );
      if (!rows.length) {
        await connection.commit();
        return null;
      }
      const row = rows[0];
      const now = Date.now();
      await connection.query(
        `UPDATE ai_web_novel_jobs
         SET status='processing', attempts=attempts+1, locked_by=?, locked_at=?, updated_at=?
         WHERE id=?`,
        [workerId, now, now, row.id]
      );
      await connection.commit();
      return rowToNovelJob({ ...row, attempts: Number(row.attempts || 0) + 1, updated_at: now });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function completeNovelJob(jobId, {
    responsePayload = {},
    responseText = "",
    contentType = "application/json; charset=utf-8",
    statusCode = 200,
    latencyMs = 0,
  } = {}) {
    await ensureMysqlStorage();
    const now = Date.now();
    await getPool().query(
      `UPDATE ai_web_novel_jobs
       SET status='done',
        response_json=?,
        response_text=?,
        content_type=?,
        status_code=?,
        error_text=NULL,
        latency_ms=?,
        locked_by=NULL,
        locked_at=NULL,
        updated_at=?,
        completed_at=?
       WHERE id=?`,
      [
        responsePayload ? JSON.stringify(responsePayload) : null,
        String(responseText || "").slice(0, 16 * 1024 * 1024),
        String(contentType || "application/json; charset=utf-8").slice(0, 255),
        Number(statusCode || 200),
        Math.max(0, Number(latencyMs || 0)),
        now,
        now,
        jobId,
      ]
    );
  }

  async function failNovelJob(jobId, {
    errorText = "",
    responsePayload = null,
    statusCode = 500,
    latencyMs = 0,
  } = {}) {
    await ensureMysqlStorage();
    const now = Date.now();
    await getPool().query(
      `UPDATE ai_web_novel_jobs
       SET status='error',
        response_json=?,
        error_text=?,
        status_code=?,
        latency_ms=?,
        locked_by=NULL,
        locked_at=NULL,
        updated_at=?,
        completed_at=?
       WHERE id=?`,
      [
        responsePayload ? JSON.stringify(responsePayload) : null,
        String(errorText || "Novel job failed").slice(0, 65535),
        Number(statusCode || 500),
        Math.max(0, Number(latencyMs || 0)),
        now,
        now,
        jobId,
      ]
    );
  }

  function handleError(res, error, fallbackMessage) {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || fallbackMessage,
    });
  }

  async function handleMysqlStorageStatus(res) {
    try {
      await ensureMysqlStorage();
      sendJson(res, 200, { ok: true, enabled: true });
    } catch (error) {
      sendJson(res, 503, {
        ok: false,
        enabled,
        error: error.message || "MySQL storage unavailable",
      });
    }
  }

  async function handleChatRecordsList(res) {
    try {
      const records = await listChatRecords();
      sendJson(res, 200, { ok: true, records });
    } catch (error) {
      handleError(res, error, "Failed to load chat records");
    }
  }

  async function handleChatRecordsSync(req, res) {
    try {
      const rawBody = await readRequestBody(req, { limitBytes: 20 * 1024 * 1024 });
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const records = await syncChatRecords(payload.records || []);
      sendJson(res, 200, { ok: true, count: records.length });
    } catch (error) {
      handleError(res, error, "Failed to sync chat records");
    }
  }

  async function handleConfigGet(res, configKey) {
    try {
      const record = await getConfig(configKey);
      sendJson(res, 200, { ok: true, config: record });
    } catch (error) {
      handleError(res, error, "Failed to load config");
    }
  }

  async function handleConfigSave(req, res, configKey) {
    try {
      const rawBody = await readRequestBody(req, { limitBytes: 20 * 1024 * 1024 });
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const record = await saveConfig(configKey, payload.value || {});
      sendJson(res, 200, { ok: true, config: record });
    } catch (error) {
      handleError(res, error, "Failed to save config");
    }
  }

  return {
    initMysqlStorage,
    handleMysqlStorageStatus,
    handleChatRecordsList,
    handleChatRecordsSync,
    handleConfigGet,
    handleConfigSave,
    getConfig,
    saveConfig,
    logChatApiRequest,
    getMysqlStorageConfig,
    claimPendingChatJob,
    completeChatJob,
    failChatJob,
    claimPendingNovelJob,
    completeNovelJob,
    failNovelJob,
  };
}

module.exports = {
  createMysqlStorage,
};
