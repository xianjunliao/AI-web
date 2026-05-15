const fs = require("fs");
const path = require("path");

const DEFAULT_BODY_LIMIT = 128 * 1024 * 1024;
const DEFAULT_CHUNK_CHARS = 12000;
const MAX_ANALYZE_CHUNKS_PER_CALL = 10;
const SETTING_TARGETS = [
  { key: "world", title: "世界观" },
  { key: "characters", title: "人物设定" },
  { key: "factions", title: "势力设定" },
  { key: "power-system", title: "能力/力量体系" },
  { key: "outline", title: "总纲" },
  { key: "volume-plan", title: "分卷规划" },
  { key: "chapter-plan", title: "章节细纲" },
  { key: "style-guide", title: "文风要求" },
];

function createId(prefix = "item") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : Date.now();
}

function sanitizeFileName(value = "") {
  return String(value || "untitled")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "untitled";
}

  function countChineseCharacters(value = "") {
    const matches = String(value || "").match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g);
    return matches ? matches.length : 0;
  }

  function estimateTokenCount(value = "") {
    const text = String(value || "").trim();
    if (!text) return 0;
    const chinese = countChineseCharacters(text);
    const asciiWords = (text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, " ").match(/[A-Za-z0-9_]+/g) || []).length;
    return Math.max(1, Math.round(chinese * 1.15 + asciiWords * 1.35));
  }

function splitTextIntoChunks(text = "", chunkSize = DEFAULT_CHUNK_CHARS) {
  const source = String(text || "").replace(/\r\n/g, "\n").trim();
  const size = Math.max(4000, Math.min(30000, Number(chunkSize) || DEFAULT_CHUNK_CHARS));
  const chunks = [];
  let offset = 0;
  while (offset < source.length) {
    let end = Math.min(source.length, offset + size);
    if (end < source.length) {
      const window = source.slice(offset, end);
      const candidates = [
        window.lastIndexOf("\n#"),
        window.lastIndexOf("\n第"),
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("。"),
      ].filter((index) => index > Math.floor(size * 0.55));
      if (candidates.length) {
        end = offset + Math.max(...candidates) + 1;
      }
    }
    const chunk = source.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}

function parseJsonBodyFactory(readRequestBody) {
  return async function parseJsonBody(req, options = {}) {
    const raw = await readRequestBody(req, { limitBytes: options.limitBytes || DEFAULT_BODY_LIMIT });
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      const error = new Error("Invalid JSON body");
      error.statusCode = 400;
      throw error;
    }
  };
}

function stripMarkdownTitle(value = "") {
  return String(value || "").replace(/^\s*#\s+.*$/m, "").trim();
}

function createWritingTrainingModule(deps = {}) {
  const {
    writingDir,
    readJsonFile,
    readTextFile,
    writeJsonFileAtomic,
    writeFileAtomic,
    readRequestBody,
    sendJson,
    generateText,
    streamGenerateText,
    createStreamEventWriter,
    getSharedConnectionConfig,
    getMysqlStorageConfig,
    queryMysqlWithReconnect,
    logDebug,
  } = deps;

  const parseJsonBody = parseJsonBodyFactory(readRequestBody);

  function paths() {
    return {
      root: writingDir,
      plansDir: path.join(writingDir, "plans"),
      checkinsDir: path.join(writingDir, "checkins"),
      booksDir: path.join(writingDir, "books"),
    };
  }

  async function ensureWritingDir() {
    const p = paths();
    await Promise.all([
      fs.promises.mkdir(p.plansDir, { recursive: true }),
      fs.promises.mkdir(p.checkinsDir, { recursive: true }),
      fs.promises.mkdir(p.booksDir, { recursive: true }),
    ]);
  }

  function debug(message) {
    try {
      if (typeof logDebug === "function") logDebug(`writing ${message}`);
    } catch {}
  }

  function resolveModelOptions(payload = {}, fallback = {}) {
    const connectionConfig = payload.connectionConfig && typeof payload.connectionConfig === "object"
      ? payload.connectionConfig
      : (fallback.connectionConfig && typeof fallback.connectionConfig === "object" ? fallback.connectionConfig : null);
    const globalModel = String((getSharedConnectionConfig && getSharedConnectionConfig()?.model) || "").trim();
    const payloadHasRoute = Object.prototype.hasOwnProperty.call(payload, "modelRoute")
      || Object.prototype.hasOwnProperty.call(payload, "modelProvider")
      || Object.prototype.hasOwnProperty.call(payload, "localOnly");
    const payloadRoute = String(payload.modelRoute || payload.modelProvider || "").trim().toLowerCase();
    return {
      model: String(payload.model || (payloadHasRoute ? "" : fallback.model) || globalModel || "").trim(),
      connectionConfig,
      localOnly: payloadHasRoute
        ? (payload.localOnly === true || payloadRoute === "local")
        : (fallback.localOnly === true),
    };
  }

  function modelRouteFromPayload(payload = {}, modelOptions = {}) {
    const route = String(payload.modelRoute || payload.modelProvider || "").trim().toLowerCase();
    if (route === "local" || modelOptions.localOnly === true) return "local";
    return "remote";
  }

  function compactModelInfo(info = {}) {
    return {
      model: String(info.model || "").trim(),
      route: String(info.route || "").trim(),
      localOnly: info.localOnly === true,
      purpose: String(info.purpose || "").trim(),
      latencyMs: Math.max(0, Number(info.latencyMs || 0) || 0),
      promptTokens: Math.max(0, Number(info.promptTokens || 0) || 0),
      completionTokens: Math.max(0, Number(info.completionTokens || 0) || 0),
      totalTokens: Math.max(0, Number(info.totalTokens || 0) || 0),
      outputTokensPerSecond: Math.max(0, Number(info.outputTokensPerSecond || 0) || 0),
      tokenSource: String(info.tokenSource || "estimated"),
      createdAt: normalizeTimestamp(info.createdAt || Date.now()),
    };
  }

  function mergeModelInfo(existing = {}, key, info = {}) {
    const next = existing && typeof existing === "object" ? { ...existing } : {};
    const compact = compactModelInfo(info);
    next[key] = compact;
    next.last = compact;
    return next;
  }

  function normalizeOwnerKey(value = "") {
    return String(value || "").trim();
  }

  function ownerFromPayload(payload = {}) {
    return {
      ownerKey: normalizeOwnerKey(payload.ownerKey || payload.lifeOwnerKey || payload.ownerId || payload.lifeOwnerId),
      ownerLevel: String(payload.ownerLevel || payload.lifeOwnerLevel || "").trim(),
      ownerName: String(payload.ownerName || payload.lifeOwnerName || "").trim(),
    };
  }

  function ownerFromRequest(req) {
    const query = requestQuery(req);
    return {
      ownerKey: normalizeOwnerKey(query.get("ownerKey") || query.get("lifeOwnerKey") || query.get("ownerId") || query.get("lifeOwnerId")),
      ownerLevel: String(query.get("ownerLevel") || query.get("lifeOwnerLevel") || "").trim(),
      ownerName: String(query.get("ownerName") || query.get("lifeOwnerName") || "").trim(),
    };
  }

  function withRequestOwner(payload = {}, owner = {}) {
    return {
      ...payload,
      lifeOwnerKey: payload.lifeOwnerKey || payload.ownerKey || owner.ownerKey,
      ownerKey: payload.ownerKey || payload.lifeOwnerKey || owner.ownerKey,
      lifeOwnerLevel: payload.lifeOwnerLevel || payload.ownerLevel || owner.ownerLevel,
      ownerLevel: payload.ownerLevel || payload.lifeOwnerLevel || owner.ownerLevel,
      lifeOwnerName: payload.lifeOwnerName || payload.ownerName || owner.ownerName,
      ownerName: payload.ownerName || payload.lifeOwnerName || owner.ownerName,
    };
  }

  function requireOwner(owner = {}) {
    if (!owner.ownerKey) {
      const error = new Error("Writing owner is required");
      error.statusCode = 403;
      throw error;
    }
    return owner.ownerKey;
  }

  function ownerMatches(item = {}, owner = {}) {
    const ownerKey = requireOwner(owner);
    return String(item.ownerKey || "").trim() === ownerKey;
  }

  function mysqlEnabled() {
    try {
      return typeof queryMysqlWithReconnect === "function"
        && getMysqlStorageConfig
        && getMysqlStorageConfig()?.enabled === true;
    } catch {
      return false;
    }
  }

  let writingTablesReady = false;
  let localTrainingMigrationDone = false;

  async function ensureWritingTables() {
    if (!mysqlEnabled()) return false;
    if (writingTablesReady) return true;
    await queryMysqlWithReconnect(`CREATE TABLE IF NOT EXISTS ai_web_writing_plans (
      id varchar(96) NOT NULL,
      owner_key varchar(128) NOT NULL,
      owner_level varchar(32) NOT NULL DEFAULT '',
      owner_name varchar(128) NOT NULL DEFAULT '',
      title varchar(255) NOT NULL DEFAULT '',
      goal text NULL,
      schedule varchar(64) NOT NULL DEFAULT 'daily',
      target_words int NOT NULL DEFAULT 0,
      practice_types_json text NULL,
      start_date varchar(32) NOT NULL DEFAULT '',
      end_date varchar(32) NOT NULL DEFAULT '',
      reminder_json text NULL,
      model varchar(255) NOT NULL DEFAULT '',
      local_only tinyint(1) NOT NULL DEFAULT 0,
      notes text NULL,
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL,
      deleted_at bigint NULL,
      PRIMARY KEY (id),
      KEY idx_ai_web_writing_plans_owner_updated (owner_key, updated_at),
      KEY idx_ai_web_writing_plans_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryMysqlWithReconnect(`CREATE TABLE IF NOT EXISTS ai_web_writing_checkins (
      id varchar(96) NOT NULL,
      plan_id varchar(96) NOT NULL,
      owner_key varchar(128) NOT NULL,
      owner_level varchar(32) NOT NULL DEFAULT '',
      owner_name varchar(128) NOT NULL DEFAULT '',
      title varchar(255) NOT NULL DEFAULT '',
      exercise_type varchar(128) NOT NULL DEFAULT '',
      prompt text NULL,
      content longtext NOT NULL,
      word_count int NOT NULL DEFAULT 0,
      status varchar(32) NOT NULL DEFAULT 'submitted',
      review longtext NULL,
      polish longtext NULL,
      compare_text longtext NULL,
      model_info_json text NULL,
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL,
      deleted_at bigint NULL,
      PRIMARY KEY (id),
      KEY idx_ai_web_writing_checkins_plan_created (plan_id, created_at),
      KEY idx_ai_web_writing_checkins_owner_created (owner_key, created_at),
      KEY idx_ai_web_writing_checkins_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await ensureMysqlColumn("ai_web_writing_checkins", "model_info_json", "ALTER TABLE ai_web_writing_checkins ADD COLUMN model_info_json text NULL AFTER compare_text");
    writingTablesReady = true;
    await migrateLocalTrainingFilesToMysql();
    return true;
  }

  async function ensureMysqlColumn(tableName, columnName, alterSql) {
    const [rows] = await queryMysqlWithReconnect(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    if (!rows.length) {
      await queryMysqlWithReconnect(alterSql);
    }
  }

  async function migrateLocalTrainingFilesToMysql() {
    if (localTrainingMigrationDone) return;
    localTrainingMigrationDone = true;
    try {
      const [plans, checkins] = await Promise.all([
        listJsonFiles(paths().plansDir),
        listJsonFiles(paths().checkinsDir),
      ]);
      for (const plan of plans) {
        if (plan?.id && plan?.ownerKey) await savePlanRecord(plan);
      }
      for (const checkin of checkins) {
        if (checkin?.id && checkin?.planId && checkin?.ownerKey) await saveCheckinRecord(checkin);
      }
      if (plans.length || checkins.length) {
        debug(`migrated_training_files plans=${plans.length} checkins=${checkins.length}`);
      }
    } catch (error) {
      debug(`migrate_training_files_failed ${error.message || error}`);
    }
  }

  function parseJsonValue(value, fallback) {
    try {
      return JSON.parse(String(value || ""));
    } catch {
      return fallback;
    }
  }

  function rowToPlan(row = {}) {
    return {
      id: String(row.id || ""),
      ownerKey: String(row.owner_key || ""),
      ownerLevel: String(row.owner_level || ""),
      ownerName: String(row.owner_name || ""),
      title: String(row.title || ""),
      goal: String(row.goal || ""),
      schedule: String(row.schedule || "daily"),
      targetWords: Number(row.target_words || 0),
      practiceTypes: parseJsonValue(row.practice_types_json, []),
      startDate: String(row.start_date || ""),
      endDate: String(row.end_date || ""),
      reminder: parseJsonValue(row.reminder_json, {}),
      model: String(row.model || ""),
      localOnly: Number(row.local_only || 0) === 1,
      notes: String(row.notes || ""),
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      deletedAt: Number(row.deleted_at || 0) || null,
    };
  }

  function rowToCheckin(row = {}) {
    return {
      id: String(row.id || ""),
      planId: String(row.plan_id || ""),
      ownerKey: String(row.owner_key || ""),
      ownerLevel: String(row.owner_level || ""),
      ownerName: String(row.owner_name || ""),
      title: String(row.title || ""),
      exerciseType: String(row.exercise_type || ""),
      prompt: String(row.prompt || ""),
      content: String(row.content || ""),
      wordCount: Number(row.word_count || 0),
      status: String(row.status || "submitted"),
      review: row.review == null ? null : String(row.review),
      polish: row.polish == null ? null : String(row.polish),
      compare: row.compare_text == null ? null : String(row.compare_text),
      modelInfo: parseJsonValue(row.model_info_json, {}),
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      deletedAt: Number(row.deleted_at || 0) || null,
    };
  }

  async function savePlanRecord(plan) {
    if (!await ensureWritingTables()) {
      await writeJsonFileAtomic(planFile(plan.id), plan);
      return plan;
    }
    await queryMysqlWithReconnect(
      `INSERT INTO ai_web_writing_plans
        (id,owner_key,owner_level,owner_name,title,goal,schedule,target_words,practice_types_json,start_date,end_date,reminder_json,model,local_only,notes,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        owner_key=VALUES(owner_key), owner_level=VALUES(owner_level), owner_name=VALUES(owner_name),
        title=VALUES(title), goal=VALUES(goal), schedule=VALUES(schedule), target_words=VALUES(target_words),
        practice_types_json=VALUES(practice_types_json), start_date=VALUES(start_date), end_date=VALUES(end_date),
        reminder_json=VALUES(reminder_json), model=VALUES(model), local_only=VALUES(local_only), notes=VALUES(notes),
        updated_at=VALUES(updated_at), deleted_at=VALUES(deleted_at)`,
      [
        plan.id, plan.ownerKey, plan.ownerLevel, plan.ownerName, plan.title, plan.goal, plan.schedule,
        Number(plan.targetWords || 0), JSON.stringify(plan.practiceTypes || []), plan.startDate, plan.endDate,
        JSON.stringify(plan.reminder || {}), plan.model, plan.localOnly ? 1 : 0, plan.notes,
        plan.createdAt, plan.updatedAt, plan.deletedAt || null,
      ]
    );
    return plan;
  }

  async function saveCheckinRecord(checkin) {
    if (!await ensureWritingTables()) {
      await writeJsonFileAtomic(checkinFile(checkin.id), checkin);
      return checkin;
    }
    await queryMysqlWithReconnect(
      `INSERT INTO ai_web_writing_checkins
        (id,plan_id,owner_key,owner_level,owner_name,title,exercise_type,prompt,content,word_count,status,review,polish,compare_text,model_info_json,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        plan_id=VALUES(plan_id), owner_key=VALUES(owner_key), owner_level=VALUES(owner_level), owner_name=VALUES(owner_name),
        title=VALUES(title), exercise_type=VALUES(exercise_type), prompt=VALUES(prompt), content=VALUES(content),
        word_count=VALUES(word_count), status=VALUES(status), review=VALUES(review), polish=VALUES(polish),
        compare_text=VALUES(compare_text), model_info_json=VALUES(model_info_json), updated_at=VALUES(updated_at), deleted_at=VALUES(deleted_at)`,
      [
        checkin.id, checkin.planId, checkin.ownerKey, checkin.ownerLevel, checkin.ownerName, checkin.title,
        checkin.exerciseType, checkin.prompt, checkin.content, Number(checkin.wordCount || 0), checkin.status,
        checkin.review || null, checkin.polish || null, checkin.compare || null, JSON.stringify(checkin.modelInfo || {}), checkin.createdAt,
        checkin.updatedAt, checkin.deletedAt || null,
      ]
    );
    return checkin;
  }

  function requestHeader(req, name) {
    const headers = req?.headers || {};
    const value = headers[String(name || "").toLowerCase()] || headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  function createRequestStreamWriter(req) {
    const requestId = String(requestHeader(req, "x-request-id") || "").trim();
    if (!requestId || typeof createStreamEventWriter !== "function") return null;
    try {
      return createStreamEventWriter(requestId);
    } catch {
      return null;
    }
  }

  async function callWritingModelDetailed({ purpose, systemPrompt, userPrompt, payload = {}, fallback = {}, temperature = 0.55, timeoutMs, streamWriter = null } = {}) {
    const modelOptions = resolveModelOptions(payload, fallback);
    const startedAt = Date.now();
    let content = "";
    let streamed = null;
    if (streamWriter && typeof streamGenerateText === "function") {
      await streamWriter({
        eventType: "status",
        eventPayload: { status: "streaming", purpose },
      });
      streamed = await streamGenerateText({
        purpose,
        ...modelOptions,
        systemPrompt,
        userPrompt,
        temperature,
        timeoutMs,
        onDelta: async (deltaText) => {
          await streamWriter({ eventType: "delta", deltaText });
        },
      });
      content = streamed?.content || "";
    } else {
      content = await generateText({
        purpose,
        ...modelOptions,
        systemPrompt,
        userPrompt,
        temperature,
        timeoutMs,
      });
    }
    const completedAt = Date.now();
    const promptTokens = estimateTokenCount(`${systemPrompt || ""}\n${userPrompt || ""}`);
    const metrics = streamed?.metrics && typeof streamed.metrics === "object" ? streamed.metrics : {};
    const usage = streamed?.usage && typeof streamed.usage === "object" ? streamed.usage : null;
    const completionTokens = Number(metrics.outputTokens || usage?.completion_tokens || usage?.completionTokens) || estimateTokenCount(content);
    const resolvedPromptTokens = Number(metrics.inputTokens || usage?.prompt_tokens || usage?.promptTokens) || promptTokens;
    const outputTokensPerSecond = Number(metrics.outputTokensPerSecond) || completionTokens / Math.max(0.1, (completedAt - startedAt) / 1000);
    const modelInfo = compactModelInfo({
      model: streamed?.model || modelOptions.model || payload.model || fallback.model || "",
      route: modelRouteFromPayload(payload, modelOptions),
      localOnly: modelOptions.localOnly,
      purpose,
      latencyMs: Number(metrics.totalMs) || completedAt - startedAt,
      promptTokens: resolvedPromptTokens,
      completionTokens,
      totalTokens: Number(metrics.totalTokens) || resolvedPromptTokens + completionTokens,
      outputTokensPerSecond,
      tokenSource: usage ? "api" : "estimated",
      createdAt: completedAt,
    });
    if (streamWriter && streamed) {
      await streamWriter({
        eventType: "done",
        eventPayload: { purpose, modelInfo, metrics: streamed.metrics || null, usage: streamed.usage || null },
      });
    }
    return {
      content: String(content || ""),
      modelInfo,
    };
  }

  async function callWritingModel(options = {}) {
    return (await callWritingModelDetailed(options)).content;
  }

  function planFile(planId) {
    return path.join(paths().plansDir, `${sanitizeFileName(planId)}.json`);
  }

  function checkinFile(checkinId) {
    return path.join(paths().checkinsDir, `${sanitizeFileName(checkinId)}.json`);
  }

  function bookDir(bookId) {
    return path.join(paths().booksDir, sanitizeFileName(bookId));
  }

  function bookMetaFile(bookId) {
    return path.join(bookDir(bookId), "book.json");
  }

  async function listJsonFiles(dirPath) {
    await ensureWritingDir();
    let entries = [];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const value = await readJsonFile(path.join(dirPath, entry.name), null);
      if (value) items.push(value);
    }
    return items.sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0));
  }

  function normalizePlan(payload = {}, existing = {}) {
    const now = Date.now();
    const id = String(existing.id || payload.id || createId("plan")).trim();
    const owner = ownerFromPayload(payload);
    return {
      id,
      ownerKey: existing.ownerKey || owner.ownerKey,
      ownerLevel: owner.ownerLevel || existing.ownerLevel || "",
      ownerName: owner.ownerName || existing.ownerName || "",
      title: String(payload.title || existing.title || "写作练习计划").trim(),
      goal: String(payload.goal || existing.goal || "").trim(),
      schedule: String(payload.schedule || existing.schedule || "daily").trim(),
      targetWords: Math.max(0, Number(payload.targetWords ?? existing.targetWords ?? 0) || 0),
      practiceTypes: Array.isArray(payload.practiceTypes)
        ? payload.practiceTypes.map((item) => String(item || "").trim()).filter(Boolean)
        : (Array.isArray(existing.practiceTypes) ? existing.practiceTypes : []),
      startDate: String(payload.startDate || existing.startDate || "").trim(),
      endDate: String(payload.endDate || existing.endDate || "").trim(),
      reminder: payload.reminder && typeof payload.reminder === "object" ? payload.reminder : (existing.reminder || {}),
      model: String(payload.model || existing.model || "").trim(),
      localOnly: payload.localOnly === true || existing.localOnly === true,
      notes: String(payload.notes || existing.notes || "").trim(),
      createdAt: normalizeTimestamp(existing.createdAt || payload.createdAt || now),
      updatedAt: now,
      deletedAt: Number(payload.deletedAt || existing.deletedAt || 0) || null,
    };
  }

  async function createPlan(payload = {}) {
    await ensureWritingDir();
    requireOwner(ownerFromPayload(payload));
    const plan = normalizePlan(payload);
    return await savePlanRecord(plan);
  }

  async function updatePlan(planId, payload = {}) {
    const owner = ownerFromPayload(payload);
    const existing = await readPlanRecord(planId);
    if (!existing || existing.deletedAt || !ownerMatches(existing, owner)) {
      const error = new Error("Writing plan not found");
      error.statusCode = 404;
      throw error;
    }
    const plan = normalizePlan(payload, existing);
    return await savePlanRecord(plan);
  }

  async function getPlan(planId, owner = {}) {
    const plan = await readPlanRecord(planId);
    if (!plan || plan.deletedAt || !ownerMatches(plan, owner)) {
      const error = new Error("Writing plan not found");
      error.statusCode = 404;
      throw error;
    }
    return plan;
  }

  async function listPlans(owner = {}) {
    requireOwner(owner);
    if (await ensureWritingTables()) {
      const [rows] = await queryMysqlWithReconnect(
        `SELECT id,owner_key,owner_level,owner_name,title,goal,schedule,target_words,practice_types_json,start_date,end_date,reminder_json,model,local_only,notes,created_at,updated_at,deleted_at
         FROM ai_web_writing_plans
         WHERE owner_key=? AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
        [owner.ownerKey]
      );
      return rows.map(rowToPlan);
    }
    const plans = await listJsonFiles(paths().plansDir);
    return plans.filter((plan) => !plan.deletedAt && ownerMatches(plan, owner));
  }

  async function deletePlan(planId, owner = {}) {
    const plan = await getPlan(planId, owner);
    const next = { ...plan, deletedAt: Date.now(), updatedAt: Date.now() };
    await savePlanRecord(next);
    return { ok: true, id: planId };
  }

  async function readPlanRecord(planId) {
    if (await ensureWritingTables()) {
      const [rows] = await queryMysqlWithReconnect(
        `SELECT id,owner_key,owner_level,owner_name,title,goal,schedule,target_words,practice_types_json,start_date,end_date,reminder_json,model,local_only,notes,created_at,updated_at,deleted_at
         FROM ai_web_writing_plans
         WHERE id=?
         LIMIT 1`,
        [planId]
      );
      return rows.length ? rowToPlan(rows[0]) : null;
    }
    return await readJsonFile(planFile(planId), null);
  }

  function requestQuery(req) {
    try {
      return new URL(req.url || "", "http://localhost").searchParams;
    } catch {
      return new URLSearchParams();
    }
  }

  function queryTruthy(value) {
    return value === "1" || value === "true" || value === "yes";
  }

  async function listPlanCheckins(planId, options = {}) {
    await getPlan(planId, options.owner || {});
    if (await ensureWritingTables()) {
      const params = [planId, requireOwner(options.owner || {})];
      const deletedClause = options.includeDeleted ? "" : "AND deleted_at IS NULL";
      const [rows] = await queryMysqlWithReconnect(
        `SELECT id,plan_id,owner_key,owner_level,owner_name,title,exercise_type,prompt,content,word_count,status,review,polish,compare_text,model_info_json,created_at,updated_at,deleted_at
         FROM ai_web_writing_checkins
         WHERE plan_id=? AND owner_key=? ${deletedClause}
         ORDER BY created_at DESC`,
        params
      );
      return rows.map(rowToCheckin);
    }
    const checkins = await listJsonFiles(paths().checkinsDir);
    return checkins
      .filter((item) => item.planId === planId && ownerMatches(item, options.owner || {}) && (options.includeDeleted || !item.deletedAt))
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  }

  function normalizeCheckin(plan, payload = {}, existing = {}) {
    const now = Date.now();
    const content = String(payload.content ?? existing.content ?? "").trim();
    return {
      id: String(existing.id || payload.id || createId("checkin")).trim(),
      planId: plan.id,
      ownerKey: plan.ownerKey || existing.ownerKey || ownerFromPayload(payload).ownerKey,
      ownerLevel: plan.ownerLevel || existing.ownerLevel || ownerFromPayload(payload).ownerLevel,
      ownerName: plan.ownerName || existing.ownerName || ownerFromPayload(payload).ownerName,
      title: String(payload.title || existing.title || "").trim(),
      exerciseType: String(payload.exerciseType || payload.type || existing.exerciseType || "").trim(),
      prompt: String(payload.prompt || existing.prompt || "").trim(),
      content,
      wordCount: countChineseCharacters(content),
      status: String(payload.status || existing.status || "submitted").trim(),
      review: existing.review || null,
      polish: existing.polish || null,
      compare: existing.compare || null,
      modelInfo: existing.modelInfo || (payload.model || payload.modelRoute || payload.modelProvider
        ? { initial: compactModelInfo({
          model: payload.model || "",
          route: modelRouteFromPayload(payload, { localOnly: payload.localOnly === true }),
          localOnly: payload.localOnly === true,
          purpose: "writing_checkin_submit",
          createdAt: now,
        }) }
        : {}),
      createdAt: normalizeTimestamp(existing.createdAt || payload.createdAt || now),
      updatedAt: now,
      deletedAt: Number(payload.deletedAt || existing.deletedAt || 0) || null,
    };
  }

  function createReviewPrompt(plan, checkin, mode = "review") {
    return [
      `请作为中文写作教练，评价用户在“${plan.title}”计划中的练笔。`,
      "",
      "### 训练目标",
      plan.goal || "未填写",
      "",
      "### 练习类型",
      checkin.exerciseType || "未填写",
      "",
      "### 写作题目/要求",
      checkin.prompt || "未填写",
      "",
      "### 用户原文",
      checkin.content,
      "",
      "### 输出要求",
      "输出 Markdown，语气直接但鼓励，不要代替用户整篇重写作为唯一答案。",
      "1. 先给 3 条最有效优点。",
      "2. 再给 3-6 条最值得训练的问题，必须引用或概括具体句子。",
      "3. 判断是否有 AI 味、空泛解释、机械微动作、人物动机不足、节奏拖沓等问题。",
      "4. 给出一份局部润色示范，只改最需要示范的 2-4 段。",
      "5. 给下一次练习布置一个具体小任务。",
      mode === "polish"
        ? "6. 最后附一份《完整润色版》，保留原意但更成熟；必须覆盖用户原文的全部内容，不要只给片段。"
        : "6. 最后附一份《完整润色版》，保留原意、不改变核心情节，但要完整重写用户原文的全部内容，方便用户回来看、对比和朗读参考。",
    ].filter(Boolean).join("\n");
  }

  async function reviewCheckin(plan, checkin, payload = {}, options = {}) {
    const result = await callWritingModelDetailed({
      purpose: "writing_checkin_review",
      payload,
      fallback: plan,
      systemPrompt: "你是严谨的中文写作教练。重点是帮助用户提升写作能力，输出纯 Markdown，不要使用代码块。",
      userPrompt: createReviewPrompt(plan, checkin, "review"),
      temperature: 0.45,
      streamWriter: options.streamWriter || null,
    });
    const next = {
      ...checkin,
      review: String(result.content || "").trim(),
      modelInfo: mergeModelInfo(checkin.modelInfo, "review", result.modelInfo),
      status: "reviewed",
      updatedAt: Date.now(),
    };
    return await saveCheckinRecord(next);
  }

  async function createCheckin(planId, payload = {}, options = {}) {
    const plan = await getPlan(planId, ownerFromPayload(payload));
    const checkin = normalizeCheckin(plan, payload);
    if (!checkin.content) {
      const error = new Error("Check-in content is required");
      error.statusCode = 400;
      throw error;
    }
    await saveCheckinRecord(checkin);
    return payload.review === false ? checkin : await reviewCheckin(plan, checkin, payload, options);
  }

  async function getCheckin(checkinId, owner = {}) {
    const checkin = await readCheckinRecord(checkinId);
    if (!checkin || checkin.deletedAt || !ownerMatches(checkin, owner)) {
      const error = new Error("Writing check-in not found");
      error.statusCode = 404;
      throw error;
    }
    return checkin;
  }

  async function deleteCheckin(checkinId, owner = {}) {
    const checkin = await getCheckin(checkinId, owner);
    const next = { ...checkin, deletedAt: Date.now(), status: "deleted", updatedAt: Date.now() };
    await saveCheckinRecord(next);
    return next;
  }

  async function readCheckinRecord(checkinId) {
    if (await ensureWritingTables()) {
      const [rows] = await queryMysqlWithReconnect(
        `SELECT id,plan_id,owner_key,owner_level,owner_name,title,exercise_type,prompt,content,word_count,status,review,polish,compare_text,model_info_json,created_at,updated_at,deleted_at
         FROM ai_web_writing_checkins
         WHERE id=?
         LIMIT 1`,
        [checkinId]
      );
      return rows.length ? rowToCheckin(rows[0]) : null;
    }
    return await readJsonFile(checkinFile(checkinId), null);
  }

  async function polishCheckin(checkinId, payload = {}) {
    const owner = ownerFromPayload(payload);
    const checkin = await getCheckin(checkinId, owner);
    const plan = await getPlan(checkin.planId, owner);
    const polishResult = await callWritingModelDetailed({
      purpose: "writing_checkin_polish",
      payload,
      fallback: plan,
      systemPrompt: "你是中文写作润色教练。输出纯 Markdown，不要使用代码块。",
      userPrompt: createReviewPrompt(plan, checkin, "polish"),
      temperature: 0.55,
    });
    const polish = polishResult.content;
    const compareResult = await callWritingModelDetailed({
      purpose: "writing_checkin_compare",
      payload,
      fallback: plan,
      systemPrompt: "你是中文写作对比分析教练。输出纯 Markdown，不要使用代码块。",
      userPrompt: [
        "请对比用户原文和润色建议，解释每类改动为什么有效。",
        "",
        "### 原文",
        checkin.content,
        "",
        "### 润色/评价",
        polish,
        "",
        "### 输出要求",
        "按“节奏、人物、句子、信息顺序、画面感、删改理由”分条说明。",
      ].join("\n"),
      temperature: 0.4,
    });
    const next = {
      ...checkin,
      polish: String(polish || "").trim(),
      compare: String(compareResult.content || "").trim(),
      modelInfo: mergeModelInfo(
        mergeModelInfo(checkin.modelInfo, "polish", polishResult.modelInfo),
        "compare",
        compareResult.modelInfo
      ),
      updatedAt: Date.now(),
    };
    return await saveCheckinRecord(next);
  }

  async function weeklyReview(planId, payload = {}) {
    const owner = ownerFromPayload(payload);
    const plan = await getPlan(planId, owner);
    const limit = Math.max(1, Math.min(30, Number(payload.limit || 7)));
    const checkins = (await listPlanCheckins(planId, { owner })).slice(0, limit).reverse();
    const body = checkins.map((item, index) => [
      `## 第 ${index + 1} 次：${item.title || item.exerciseType || item.id}`,
      `字数：${item.wordCount || 0}`,
      item.content,
      item.review ? `### 当次评价\n${stripMarkdownTitle(item.review).slice(0, 1800)}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");
    const review = await callWritingModel({
      purpose: "writing_weekly_review",
      payload,
      fallback: plan,
      systemPrompt: "你是长期写作训练教练。输出纯 Markdown，不要使用代码块。",
      userPrompt: [
        `请为写作计划“${plan.title}”做阶段复盘。`,
        "",
        "### 计划目标",
        plan.goal || "未填写",
        "",
        "### 最近练习",
        body || "暂无",
        "",
        "### 输出要求",
        "1. 总结最近阶段最明显的进步。",
        "2. 归纳 3-5 个反复出现的问题。",
        "3. 给出用户的个人写作画像。",
        "4. 制定下一周训练安排，每天一个具体练习。",
        "5. 给出坚持打卡建议。",
      ].join("\n"),
      temperature: 0.45,
    });
    return { ok: true, planId, checkinCount: checkins.length, review: String(review || "").trim() };
  }

  function parsePromptSuggestions(text = "") {
    const raw = String(text || "").trim();
    const jsonText = raw.match(/```json\s*([\s\S]*?)```/i)?.[1]
      || raw.match(/\{[\s\S]*\}/)?.[0]
      || raw;
    try {
      const parsed = JSON.parse(jsonText);
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.suggestions) ? parsed.suggestions : []);
      return items.map((item, index) => ({
        title: String(item.title || item.topic || `训练主题 ${index + 1}`).trim().slice(0, 40),
        type: String(item.type || item.exerciseType || "片段").trim().slice(0, 20),
        prompt: String(item.prompt || item.requirement || item.brief || "").trim().slice(0, 500),
        guide: String(item.guide || item.method || item.howToWrite || item.detail || "").trim().slice(0, 900),
      })).filter((item) => item.title && (item.prompt || item.guide)).slice(0, 5);
    } catch {
      return [];
    }
  }

  function fallbackPromptSuggestions(plan = {}) {
    const type = Array.isArray(plan.practiceTypes) && plan.practiceTypes[0] ? plan.practiceTypes[0] : "片段";
    return [
      {
        title: "一次没有说出口的解释",
        type,
        prompt: "写一个角色本来可以解释清楚，却选择沉默的场景。",
        guide: "先写对方误会的具体行为，再写主角想解释但忍住的原因。重点不要直接说明“他很克制”，而是让读者从停顿、转移话题、离场后的反应里看出来。",
      },
      {
        title: "关系破裂前的日常小事",
        type,
        prompt: "写一件看似很小、但能暴露两个人关系裂缝的事。",
        guide: "不要写大吵。选一个生活动作，比如等消息、吃饭、借东西、错过约定。让人物的期待和失望藏在选择里。",
      },
      {
        title: "一个人撒谎后的补救",
        type,
        prompt: "写角色撒了一个小谎后试图补救，却越补越糟的片段。",
        guide: "先明确谎言保护了什么，再让补救动作带出更深的动机。结尾保留一点后果，不急着解释道德判断。",
      },
    ];
  }

  async function suggestPracticePrompts(planId, payload = {}) {
    const owner = ownerFromPayload(payload);
    const plan = await getPlan(planId, owner);
    const checkins = (await listPlanCheckins(planId, { owner })).slice(0, 5);
    const recent = checkins.map((item, index) => [
      `# ${index + 1}. ${item.title || item.exerciseType || "练习"}`,
      `类型：${item.exerciseType || "未填写"}，字数：${item.wordCount || 0}`,
      String(item.content || "").slice(0, 700),
      item.review ? `反馈摘要：${stripMarkdownTitle(item.review).slice(0, 500)}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");
    let suggestions = [];
    try {
      const content = await callWritingModel({
        purpose: "writing_prompt_suggestions",
        payload,
        fallback: plan,
        systemPrompt: "你是中文写作训练教练。只输出 JSON，不要 Markdown，不要解释。",
        userPrompt: [
          "请根据用户的练笔计划和近期训练，随机生成 4 个适合今天写的训练主题。",
          "",
          "要求：",
          "1. 主题要具体，能立刻开写，不要空泛。",
          "2. 要贴合计划目标，并尽量补足近期练习里的短板。",
          "3. 每个主题都给出具体写法，说明从哪里开场、人物动机怎么藏、结尾怎么收。",
          "4. 输出严格 JSON：{\"suggestions\":[{\"title\":\"\",\"type\":\"\",\"prompt\":\"\",\"guide\":\"\"}]}",
          "",
          "### 当前计划",
          `名称：${plan.title || ""}`,
          `目标：${plan.goal || ""}`,
          `类型：${Array.isArray(plan.practiceTypes) ? plan.practiceTypes.join("、") : ""}`,
          `目标字数：${plan.targetWords || ""}`,
          "",
          "### 近期练习",
          recent || "暂无",
        ].join("\n"),
        temperature: 0.85,
      });
      suggestions = parsePromptSuggestions(content);
    } catch (error) {
      debug(`prompt_suggestions_failed planId=${planId} error=${error.message || error}`);
    }
    if (!suggestions.length) suggestions = fallbackPromptSuggestions(plan);
    return { ok: true, planId, suggestions };
  }

  async function listBooks(owner = {}) {
    requireOwner(owner);
    await ensureWritingDir();
    let entries = [];
    try {
      entries = await fs.promises.readdir(paths().booksDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const books = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readJsonFile(path.join(paths().booksDir, entry.name, "book.json"), null);
      if (meta && !meta.deletedAt && ownerMatches(meta, owner)) books.push(meta);
    }
    return books.sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0));
  }

  async function ingestBook(payload = {}) {
    await ensureWritingDir();
    const owner = ownerFromPayload(payload);
    requireOwner(owner);
    const content = String(payload.content || payload.text || payload.fileText || "").trim();
    if (!content) {
      const error = new Error("Book text content is required");
      error.statusCode = 400;
      throw error;
    }
    const now = Date.now();
    const bookId = String(payload.id || createId("book")).trim();
    const dir = bookDir(bookId);
    const chunksDir = path.join(dir, "chunks");
    await fs.promises.mkdir(chunksDir, { recursive: true });
    const chunks = splitTextIntoChunks(content, payload.chunkSize);
    await Promise.all(chunks.map((chunk, index) =>
      writeFileAtomic(path.join(chunksDir, `${String(index + 1).padStart(6, "0")}.txt`), chunk + "\n")
    ));
    const meta = {
      id: bookId,
      ownerKey: owner.ownerKey,
      ownerLevel: owner.ownerLevel,
      ownerName: owner.ownerName,
      title: String(payload.title || payload.sourceName || "拆书项目").trim(),
      sourceName: String(payload.sourceName || "").trim(),
      totalCharacters: content.length,
      chineseCharacters: countChineseCharacters(content),
      chunkSize: Math.max(4000, Math.min(30000, Number(payload.chunkSize) || DEFAULT_CHUNK_CHARS)),
      chunkCount: chunks.length,
      analyzedChunks: 0,
      status: "ingested",
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonFileAtomic(bookMetaFile(bookId), meta);
    return meta;
  }

  async function getBook(bookId, owner = {}) {
    const meta = await readJsonFile(bookMetaFile(bookId), null);
    if (!meta || meta.deletedAt || !ownerMatches(meta, owner)) {
      const error = new Error("Writing book not found");
      error.statusCode = 404;
      throw error;
    }
    return meta;
  }

  async function readBookChunk(bookId, chunkNo) {
    const safeNo = Math.max(1, Number(chunkNo || 1));
    return await readTextFile(path.join(bookDir(bookId), "chunks", `${String(safeNo).padStart(6, "0")}.txt`), "");
  }

  async function analyzeBook(bookId, payload = {}) {
    const meta = await getBook(bookId, ownerFromPayload(payload));
    const extractsDir = path.join(bookDir(bookId), "extracts");
    await fs.promises.mkdir(extractsDir, { recursive: true });
    const start = Math.max(1, Number(payload.startChunk || meta.analyzedChunks + 1) || 1);
    const maxChunks = Math.max(1, Math.min(MAX_ANALYZE_CHUNKS_PER_CALL, Number(payload.maxChunks || 1)));
    const results = [];
    for (let chunkNo = start; chunkNo <= meta.chunkCount && results.length < maxChunks; chunkNo += 1) {
      const chunkText = await readBookChunk(bookId, chunkNo);
      if (!chunkText.trim()) continue;
      debug(`book_analyze book=${bookId} chunk=${chunkNo}/${meta.chunkCount}`);
      const extract = await callWritingModel({
        purpose: "writing_book_chunk_extract",
        payload,
        systemPrompt: "你是中文小说拆书分析助手。输出纯 Markdown，不要使用代码块。",
        userPrompt: [
          `请拆解小说《${meta.title}》第 ${chunkNo}/${meta.chunkCount} 个文本块。`,
          "",
          "### 文本块",
          chunkText.slice(0, 30000),
          "",
          "### 输出要求",
          "- 本块剧情事件",
          "- 新出现/推进的人物与动机",
          "- 世界观/势力/制度/地理信息",
          "- 能力体系/技术体系/规则",
          "- 伏笔、冲突、钩子",
          "- 文风与叙事手法",
          "- 可合并进总设定的条目",
        ].join("\n"),
        temperature: 0.35,
      });
      const fileName = `${String(chunkNo).padStart(6, "0")}.md`;
      await writeFileAtomic(path.join(extractsDir, fileName), String(extract || "").trim() + "\n");
      results.push({ chunkNo, extract: String(extract || "").trim() });
    }
    const analyzedChunks = Math.max(Number(meta.analyzedChunks || 0), results.at(-1)?.chunkNo || 0);
    const nextMeta = {
      ...meta,
      analyzedChunks,
      status: analyzedChunks >= meta.chunkCount ? "analyzed" : "analyzing",
      updatedAt: Date.now(),
    };
    await writeJsonFileAtomic(bookMetaFile(bookId), nextMeta);
    return { ok: true, book: nextMeta, processed: results.length, results };
  }

  async function synthesizeBook(bookId, payload = {}) {
    const meta = await getBook(bookId, ownerFromPayload(payload));
    const extractsDir = path.join(bookDir(bookId), "extracts");
    const synthesisDir = path.join(bookDir(bookId), "synthesis");
    await fs.promises.mkdir(synthesisDir, { recursive: true });
    let entries = [];
    try {
      entries = await fs.promises.readdir(extractsDir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const extracts = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name))) {
      extracts.push(await readTextFile(path.join(extractsDir, entry.name), ""));
    }
    if (!extracts.length) {
      const error = new Error("No analyzed chunks found");
      error.statusCode = 400;
      throw error;
    }
    const targets = Array.isArray(payload.targets) && payload.targets.length
      ? payload.targets.map((item) => String(item || "").trim()).filter(Boolean)
      : SETTING_TARGETS.map((item) => item.key);
    const context = extracts.join("\n\n").slice(0, 90000);
    const generated = {};
    for (const target of targets) {
      const definition = SETTING_TARGETS.find((item) => item.key === target) || { key: target, title: target };
      const content = await callWritingModel({
        purpose: `writing_book_synthesis_${definition.key}`,
        payload,
        systemPrompt: "你是中文小说拆书设定整理助手。输出纯 Markdown，不要使用代码块。",
        userPrompt: [
          `请基于《${meta.title}》的分块拆书结果，整理“${definition.title}”。`,
          "",
          "### 分块拆书结果",
          context,
          "",
          "### 输出要求",
          `1. 文件标题使用“# ${definition.title}”。`,
          "2. 只基于文本证据归纳，不要编造原文不存在的重要设定。",
          "3. 适合直接迁移到 AI-web 小说项目设定中。",
          "4. 对不确定内容标注“疑似/待后文确认”。",
        ].join("\n"),
        temperature: 0.35,
      });
      const normalized = String(content || "").trim();
      generated[definition.key] = normalized;
      await writeFileAtomic(path.join(synthesisDir, `${definition.key}.md`), normalized + "\n");
    }
    const nextMeta = { ...meta, status: "synthesized", synthesizedAt: Date.now(), updatedAt: Date.now() };
    await writeJsonFileAtomic(bookMetaFile(bookId), nextMeta);
    return { ok: true, book: nextMeta, generated };
  }

  async function handleRequest(req, res, pathname) {
    await ensureWritingDir();
    const requestOwner = ownerFromRequest(req);
    const requestStreamWriter = createRequestStreamWriter(req);

    if (pathname === "/writing/plans" && req.method === "GET") {
      sendJson(res, 200, { ok: true, plans: await listPlans(requestOwner) });
      return true;
    }
    if (pathname === "/writing/plans" && req.method === "POST") {
      sendJson(res, 200, { ok: true, plan: await createPlan(withRequestOwner(await parseJsonBody(req), requestOwner)) });
      return true;
    }

    const planMatch = pathname.match(/^\/writing\/plans\/([^/]+)$/);
    if (planMatch) {
      const planId = decodeURIComponent(planMatch[1]);
      if (req.method === "GET") {
        const includeDeleted = queryTruthy(requestQuery(req).get("includeDeleted"));
        sendJson(res, 200, { ok: true, plan: await getPlan(planId, requestOwner), checkins: await listPlanCheckins(planId, { includeDeleted, owner: requestOwner }) });
        return true;
      }
      if (req.method === "PUT") {
        sendJson(res, 200, { ok: true, plan: await updatePlan(planId, withRequestOwner(await parseJsonBody(req), requestOwner)) });
        return true;
      }
      if (req.method === "DELETE") {
        sendJson(res, 200, await deletePlan(planId, requestOwner));
        return true;
      }
    }

    const checkinsMatch = pathname.match(/^\/writing\/plans\/([^/]+)\/checkins$/);
    if (checkinsMatch) {
      const planId = decodeURIComponent(checkinsMatch[1]);
      if (req.method === "GET") {
        const includeDeleted = queryTruthy(requestQuery(req).get("includeDeleted"));
        sendJson(res, 200, { ok: true, checkins: await listPlanCheckins(planId, { includeDeleted, owner: requestOwner }) });
        return true;
      }
      if (req.method === "POST") {
        sendJson(res, 200, { ok: true, checkin: await createCheckin(planId, withRequestOwner(await parseJsonBody(req), requestOwner), { streamWriter: requestStreamWriter }) });
        return true;
      }
    }

    const weeklyMatch = pathname.match(/^\/writing\/plans\/([^/]+)\/weekly-review$/);
    if (weeklyMatch && req.method === "POST") {
      sendJson(res, 200, await weeklyReview(decodeURIComponent(weeklyMatch[1]), withRequestOwner(await parseJsonBody(req), requestOwner)));
      return true;
    }

    const promptMatch = pathname.match(/^\/writing\/plans\/([^/]+)\/prompts$/);
    if (promptMatch && req.method === "POST") {
      sendJson(res, 200, await suggestPracticePrompts(decodeURIComponent(promptMatch[1]), withRequestOwner(await parseJsonBody(req), requestOwner)));
      return true;
    }

    const checkinMatch = pathname.match(/^\/writing\/checkins\/([^/]+)(?:\/(review|polish))?$/);
    if (checkinMatch) {
      const checkinId = decodeURIComponent(checkinMatch[1]);
      const action = checkinMatch[2] || "";
      if (!action && req.method === "GET") {
        sendJson(res, 200, { ok: true, checkin: await getCheckin(checkinId, requestOwner) });
        return true;
      }
      if (!action && req.method === "DELETE") {
        sendJson(res, 200, { ok: true, checkin: await deleteCheckin(checkinId, requestOwner) });
        return true;
      }
      if (action === "review" && req.method === "POST") {
        const payload = withRequestOwner(await parseJsonBody(req), requestOwner);
        const owner = ownerFromPayload(payload);
        const checkin = await getCheckin(checkinId, owner);
        sendJson(res, 200, { ok: true, checkin: await reviewCheckin(await getPlan(checkin.planId, owner), checkin, payload, { streamWriter: requestStreamWriter }) });
        return true;
      }
      if (action === "polish" && req.method === "POST") {
        sendJson(res, 200, { ok: true, checkin: await polishCheckin(checkinId, withRequestOwner(await parseJsonBody(req), requestOwner)) });
        return true;
      }
    }

    if (pathname === "/writing/books" && req.method === "GET") {
      sendJson(res, 200, { ok: true, books: await listBooks(requestOwner) });
      return true;
    }
    if (pathname === "/writing/books" && req.method === "POST") {
      sendJson(res, 200, { ok: true, book: await ingestBook(withRequestOwner(await parseJsonBody(req, { limitBytes: DEFAULT_BODY_LIMIT }), requestOwner)) });
      return true;
    }

    const bookMatch = pathname.match(/^\/writing\/books\/([^/]+)$/);
    if (bookMatch && req.method === "GET") {
      sendJson(res, 200, { ok: true, book: await getBook(decodeURIComponent(bookMatch[1]), requestOwner) });
      return true;
    }

    const chunkMatch = pathname.match(/^\/writing\/books\/([^/]+)\/chunks\/(\d+)$/);
    if (chunkMatch && req.method === "GET") {
      await getBook(decodeURIComponent(chunkMatch[1]), requestOwner);
      const content = await readBookChunk(decodeURIComponent(chunkMatch[1]), Number(chunkMatch[2]));
      sendJson(res, 200, { ok: true, chunkNo: Number(chunkMatch[2]), content });
      return true;
    }

    const analyzeMatch = pathname.match(/^\/writing\/books\/([^/]+)\/analyze$/);
    if (analyzeMatch && req.method === "POST") {
      sendJson(res, 200, await analyzeBook(decodeURIComponent(analyzeMatch[1]), withRequestOwner(await parseJsonBody(req), requestOwner)));
      return true;
    }

    const synthesizeMatch = pathname.match(/^\/writing\/books\/([^/]+)\/synthesize$/);
    if (synthesizeMatch && req.method === "POST") {
      sendJson(res, 200, await synthesizeBook(decodeURIComponent(synthesizeMatch[1]), withRequestOwner(await parseJsonBody(req), requestOwner)));
      return true;
    }

    return false;
  }

  return {
    ensureWritingDir,
    handleRequest,
    createPlan,
    createCheckin,
    deleteCheckin,
    reviewCheckin,
    polishCheckin,
    ingestBook,
    analyzeBook,
    synthesizeBook,
  };
}

module.exports = {
  createWritingTrainingModule,
};
