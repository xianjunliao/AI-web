function createSharedConnectionConfigModule({
  connectionConfigFile,
  readJsonFile,
  writeJsonFileAtomic,
  readRequestBody,
  sendJson,
} = {}) {
  const DEFAULT_CONNECTION_CONFIG = {
    model: "",
  };

  let sharedConnectionConfigState = { ...DEFAULT_CONNECTION_CONFIG };

  function sanitizeSharedConnectionConfig(input = {}) {
    return {
      model: String(input?.model || "").trim(),
    };
  }

  async function loadSharedConnectionConfig() {
    const loaded = await readJsonFile(connectionConfigFile, {});
    sharedConnectionConfigState = {
      ...DEFAULT_CONNECTION_CONFIG,
      ...sanitizeSharedConnectionConfig(loaded),
    };
    return sharedConnectionConfigState;
  }

  async function saveSharedConnectionConfig(nextConfig = {}) {
    sharedConnectionConfigState = {
      ...sharedConnectionConfigState,
      ...sanitizeSharedConnectionConfig(nextConfig),
    };
    await writeJsonFileAtomic(connectionConfigFile, sharedConnectionConfigState);
    return sharedConnectionConfigState;
  }

  function getSharedConnectionConfig() {
    return {
      ...sharedConnectionConfigState,
    };
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

  return {
    loadSharedConnectionConfig,
    saveSharedConnectionConfig,
    getSharedConnectionConfig,
    handleSharedConnectionConfigGet,
    handleSharedConnectionConfigPost,
  };
}

module.exports = {
  createSharedConnectionConfigModule,
};
