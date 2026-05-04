function createSharedConnectionConfigModule({
  connectionConfigFile,
  readJsonFile,
  writeJsonFileAtomic,
  readRequestBody,
  sendJson,
  mysqlStorage,
} = {}) {
  const DEFAULT_CONNECTION_CONFIG = {
    model: "",
    remoteApiEnabled: false,
    remoteBaseUrl: "",
    remoteApiPath: "/v1/chat/completions",
    remoteModelsPath: "/v1/models",
    remoteApiKey: "",
  };

  const MYSQL_CONFIG_KEY = "connection-config";

  let sharedConnectionConfigState = { ...DEFAULT_CONNECTION_CONFIG };
  let lastMysqlUpdatedAt = 0;

  function hasConfigField(input, field) {
    return Object.prototype.hasOwnProperty.call(input || {}, field);
  }

  function sanitizeSharedConnectionConfig(input = {}, { partial = false } = {}) {
    const result = {};
    if (!partial || hasConfigField(input, "model")) {
      result.model = String(input?.model || "").trim();
    }
    if (!partial || hasConfigField(input, "remoteApiEnabled")) {
      result.remoteApiEnabled = input?.remoteApiEnabled === true;
    }
    if (!partial || hasConfigField(input, "remoteBaseUrl")) {
      result.remoteBaseUrl = String(input?.remoteBaseUrl || "").trim();
    }
    if (!partial || hasConfigField(input, "remoteApiPath")) {
      result.remoteApiPath = String(input?.remoteApiPath || "/v1/chat/completions").trim() || "/v1/chat/completions";
    }
    if (!partial || hasConfigField(input, "remoteModelsPath")) {
      result.remoteModelsPath = String(input?.remoteModelsPath || "/v1/models").trim() || "/v1/models";
    }
    if (!partial || hasConfigField(input, "remoteApiKey")) {
      result.remoteApiKey = String(input?.remoteApiKey || "").trim();
    }
    return result;
  }

  function mysqlAvailable() {
    return !!(mysqlStorage && typeof mysqlStorage.isEnabled === "function" && mysqlStorage.isEnabled());
  }

  function mergeConfig(local, remote) {
    if (!remote) return { ...local };
    return {
      ...local,
      ...sanitizeSharedConnectionConfig(remote, { partial: true }),
    };
  }

  async function loadSharedConnectionConfig() {
    // 1. Load local JSON file
    const loaded = await readJsonFile(connectionConfigFile, {});
    sharedConnectionConfigState = {
      ...DEFAULT_CONNECTION_CONFIG,
      ...sanitizeSharedConnectionConfig(loaded),
    };

    // 2. If MySQL is available, try to load remote config (higher priority)
    if (mysqlAvailable()) {
      try {
        const mysqlRecord = await mysqlStorage.getConfig(MYSQL_CONFIG_KEY);
        if (mysqlRecord && mysqlRecord.value && Object.keys(mysqlRecord.value).length > 0) {
          lastMysqlUpdatedAt = mysqlRecord.updatedAt || 0;
          sharedConnectionConfigState = mergeConfig(sharedConnectionConfigState, mysqlRecord.value);
        }
      } catch (err) {
        // MySQL read failed, keep local config
      }
    }

    return sharedConnectionConfigState;
  }

  async function saveSharedConnectionConfig(nextConfig = {}) {
    sharedConnectionConfigState = {
      ...sharedConnectionConfigState,
      ...sanitizeSharedConnectionConfig(nextConfig, { partial: true }),
    };
    await writeJsonFileAtomic(connectionConfigFile, sharedConnectionConfigState);

    // Also write to MySQL if available
    if (mysqlAvailable()) {
      try {
        const result = await mysqlStorage.saveConfig(MYSQL_CONFIG_KEY, sharedConnectionConfigState);
        lastMysqlUpdatedAt = result.updatedAt || 0;
      } catch (err) {
        // MySQL write failed, local file is already saved
      }
    }

    return sharedConnectionConfigState;
  }

  function getSharedConnectionConfig() {
    return {
      ...sharedConnectionConfigState,
    };
  }

  async function syncConnectionConfigFromMysql() {
    if (!mysqlAvailable()) return false;

    try {
      const mysqlRecord = await mysqlStorage.getConfig(MYSQL_CONFIG_KEY);
      if (!mysqlRecord || !mysqlRecord.value || Object.keys(mysqlRecord.value).length === 0) {
        return false;
      }

      const mysqlUpdatedAt = mysqlRecord.updatedAt || 0;
      if (mysqlUpdatedAt <= lastMysqlUpdatedAt) {
        return false;
      }

      const newConfig = mergeConfig(sharedConnectionConfigState, mysqlRecord.value);
      const changed = JSON.stringify(newConfig) !== JSON.stringify(sharedConnectionConfigState);
      if (!changed) {
        lastMysqlUpdatedAt = mysqlUpdatedAt;
        return false;
      }

      sharedConnectionConfigState = newConfig;
      lastMysqlUpdatedAt = mysqlUpdatedAt;
      await writeJsonFileAtomic(connectionConfigFile, sharedConnectionConfigState);
      return true;
    } catch (err) {
      return false;
    }
  }

  function handleSharedConnectionConfigGet(res) {
    sendJson(res, 200, {
      ok: true,
      config: getSharedConnectionConfig(),
    });
  }

  async function handleSharedConnectionConfigPost(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const config = await saveSharedConnectionConfig(payload);
      sendJson(res, 200, { ok: true, config });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to save shared connection config",
      });
    }
  }

  async function handleSharedConnectionConfigSync(req, res) {
    try {
      const changed = await syncConnectionConfigFromMysql();
      sendJson(res, 200, {
        ok: true,
        config: getSharedConnectionConfig(),
        changed,
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to sync connection config from MySQL",
      });
    }
  }

  return {
    loadSharedConnectionConfig,
    saveSharedConnectionConfig,
    getSharedConnectionConfig,
    syncConnectionConfigFromMysql,
    handleSharedConnectionConfigGet,
    handleSharedConnectionConfigPost,
    handleSharedConnectionConfigSync,
  };
}

module.exports = {
  createSharedConnectionConfigModule,
};
