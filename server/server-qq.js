function createQqModule(deps) {
  const {
    qqBotConfigFile,
    qqBotSessionsFile,
    readJsonFile,
    writeJsonFileAtomic,
    readRequestBody,
    sendJson,
    requestJson,
    targetOrigin,
  } = deps;

  const DEFAULT_QQ_BOT_CONFIG = {
    enabled: false,
    groupMentionOnly: true,
    taskPushEnabled: false,
    triggerPrefix: "",
    allowedUsers: [],
    allowedGroups: [],
    persona: "",
    personaPreset: "none",
    bridgeUrl: "",
    accessToken: "",
    defaultTargetType: "private",
    defaultTargetId: "",
    model: "",
    systemPrompt: "",
    assistantName: "Assistant",
    targetProfiles: {},
  };

  let qqBotConfig = { ...DEFAULT_QQ_BOT_CONFIG };
  let qqBotSessions = {};

  function parseQqIdList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    return String(value || "")
      .split(/[\r\n,，；;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeTargetType(value = "") {
    return String(value || "").trim().toLowerCase() === "group" ? "group" : "private";
  }

  function buildTargetProfileKey(targetType = "private", targetId = "") {
    const normalizedId = String(targetId || "").trim();
    if (!normalizedId) return "";
    return `${normalizeTargetType(targetType)}:${normalizedId}`;
  }

  function sanitizeTargetProfile(profile = {}, fallbackKey = "") {
    const [fallbackType, ...rest] = String(fallbackKey || "").split(":");
    const fallbackId = rest.join(":");
    const targetType = normalizeTargetType(profile.targetType || fallbackType || "private");
    const targetId = String(profile.targetId || fallbackId || "").trim();
    if (!targetId) return null;
    return {
      name: String(profile.name || `${targetType === "group" ? "Group" : "QQ"} ${targetId}`).trim(),
      targetType,
      targetId,
      enabled: Boolean(profile.enabled),
      groupMentionOnly: profile.groupMentionOnly !== false,
      taskPushEnabled: Boolean(profile.taskPushEnabled),
      triggerPrefix: String(profile.triggerPrefix || "").trim(),
      allowedUsers: parseQqIdList(profile.allowedUsers),
      allowedGroups: parseQqIdList(profile.allowedGroups),
      persona: String(profile.persona || "").trim(),
      personaPreset: String(profile.personaPreset || "none").trim() || "none",
      bridgeUrl: String(profile.bridgeUrl || "").trim(),
      accessToken: String(profile.accessToken || "").trim(),
      defaultTargetType: normalizeTargetType(profile.defaultTargetType || targetType),
      defaultTargetId: String(profile.defaultTargetId || targetId).trim(),
      model: String(profile.model || "").trim(),
      systemPrompt: String(profile.systemPrompt || "").trim(),
      assistantName: String(profile.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName).trim() || DEFAULT_QQ_BOT_CONFIG.assistantName,
    };
  }

  function sanitizeTargetProfilesMap(input = {}) {
    const output = {};
    if (!input || typeof input !== "object") return output;
    for (const [key, value] of Object.entries(input)) {
      const profile = sanitizeTargetProfile(value, key);
      if (!profile) continue;
      output[buildTargetProfileKey(profile.targetType, profile.targetId)] = profile;
    }
    return output;
  }

  function sanitizeQqBotConfig(input = {}) {
    return {
      enabled: Boolean(input.enabled),
      groupMentionOnly: input.groupMentionOnly !== false,
      taskPushEnabled: Boolean(input.taskPushEnabled),
      triggerPrefix: String(input.triggerPrefix || "").trim(),
      allowedUsers: parseQqIdList(input.allowedUsers),
      allowedGroups: parseQqIdList(input.allowedGroups),
      persona: String(input.persona || "").trim(),
      personaPreset: String(input.personaPreset || "none").trim() || "none",
      bridgeUrl: String(input.bridgeUrl || "").trim(),
      accessToken: String(input.accessToken || "").trim(),
      defaultTargetType: normalizeTargetType(input.defaultTargetType || "private"),
      defaultTargetId: String(input.defaultTargetId || "").trim(),
      model: String(input.model || "").trim(),
      systemPrompt: String(input.systemPrompt || "").trim(),
      assistantName: String(input.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName).trim() || DEFAULT_QQ_BOT_CONFIG.assistantName,
      targetProfiles: sanitizeTargetProfilesMap(input.targetProfiles),
    };
  }

  async function loadQqBotConfig() {
    const loaded = await readJsonFile(qqBotConfigFile, {});
    qqBotConfig = {
      ...DEFAULT_QQ_BOT_CONFIG,
      ...sanitizeQqBotConfig({
        ...DEFAULT_QQ_BOT_CONFIG,
        ...(loaded && typeof loaded === "object" ? loaded : {}),
      }),
    };
  }

  async function saveQqBotConfig(nextConfig = {}) {
    qqBotConfig = {
      ...qqBotConfig,
      ...sanitizeQqBotConfig({
        ...qqBotConfig,
        ...nextConfig,
      }),
    };
    await writeJsonFileAtomic(qqBotConfigFile, qqBotConfig);
    return qqBotConfig;
  }

  async function loadQqBotSessions() {
    const loaded = await readJsonFile(qqBotSessionsFile, {});
    qqBotSessions = loaded && typeof loaded === "object" ? loaded : {};
  }

  async function saveQqBotSessions() {
    await writeJsonFileAtomic(qqBotSessionsFile, qqBotSessions);
  }

  function getTargetProfile(targetType = "private", targetId = "") {
    const key = buildTargetProfileKey(targetType, targetId);
    if (!key) return null;
    return qqBotConfig.targetProfiles?.[key] || null;
  }

  function getResolvedQqConfig(targetType = "private", targetId = "") {
    const profile = getTargetProfile(targetType, targetId);
    if (!profile) return { ...qqBotConfig };
    return {
      ...qqBotConfig,
      ...profile,
      targetProfiles: qqBotConfig.targetProfiles || {},
    };
  }

  async function sendQqMessageFinal(args = {}) {
    const bridgeUrl = String(args.bridgeUrl || "").trim();
    const targetType = normalizeTargetType(args.targetType || "private");
    const targetId = String(args.targetId || "").trim();
    const message = String(args.message || "").trim();
    const accessToken = String(args.accessToken || "").trim();

    if (!bridgeUrl) {
      const error = new Error("QQ bridge URL is required");
      error.statusCode = 400;
      throw error;
    }
    if (!targetId) {
      const error = new Error("QQ target ID is required");
      error.statusCode = 400;
      throw error;
    }
    if (!message) {
      const error = new Error("QQ message is required");
      error.statusCode = 400;
      throw error;
    }

    const baseUrl = new URL(bridgeUrl.endsWith("/") ? bridgeUrl : `${bridgeUrl}/`);
    const actionUrl = new URL(targetType === "group" ? "send_group_msg" : "send_private_msg", baseUrl);
    const payload = targetType === "group"
      ? { group_id: /^\d+$/.test(targetId) ? Number(targetId) : targetId, message }
      : { user_id: /^\d+$/.test(targetId) ? Number(targetId) : targetId, message };

    const response = await requestJson(actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    }, payload);

    return {
      ok: true,
      targetType,
      targetId,
      message,
      bridgeUrl: baseUrl.toString(),
      response,
    };
  }

  async function sendQqMessage(args = {}) {
    return sendQqMessageFinal(args);
  }

  function normalizeQqIncomingText(event = {}) {
    if (Array.isArray(event.message)) {
      return event.message
        .map((segment) => {
          if (segment?.type === "text") return String(segment.data?.text || "");
          if (segment?.type === "at") return "";
          return "";
        })
        .join("")
        .trim();
    }

    if (typeof event.message === "string") {
      return event.message.trim();
    }

    return "";
  }

  function isGroupMentioned(event = {}) {
    const selfId = String(event.self_id || "");
    if (Array.isArray(event.message)) {
      return event.message.some((segment) => segment?.type === "at" && String(segment.data?.qq || "") === selfId);
    }
    return typeof event.raw_message === "string" && selfId ? event.raw_message.includes(`[CQ:at,qq=${selfId}]`) : false;
  }

  function stripQqTriggerPrefix(text = "", config = qqBotConfig) {
    const raw = String(text || "").trim();
    const prefix = String(config.triggerPrefix || "").trim();
    if (!prefix) return raw;
    return raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : "";
  }

  function isQqEventAllowed(event = {}, config = qqBotConfig) {
    const userId = String(event.user_id || "").trim();
    const groupId = String(event.group_id || "").trim();
    const allowedUsers = parseQqIdList(config.allowedUsers);
    const allowedGroups = parseQqIdList(config.allowedGroups);

    if (allowedUsers.length && !allowedUsers.includes(userId)) {
      return false;
    }
    if (event.message_type === "group" && allowedGroups.length && !allowedGroups.includes(groupId)) {
      return false;
    }
    return true;
  }

  function getQqSessionKey(event = {}) {
    if (event.message_type === "group") {
      return `group:${event.group_id || "unknown"}:user:${event.user_id || "unknown"}`;
    }
    return `private:${event.user_id || "unknown"}`;
  }

  function isQqSessionResetCommand(text = "") {
    const normalized = String(text || "").trim().toLowerCase();
    return normalized === "/new" || normalized === "/reset";
  }

  async function clearQqSession(event = {}) {
    const sessionKey = getQqSessionKey(event);
    if (qqBotSessions[sessionKey]) {
      delete qqBotSessions[sessionKey];
      await saveQqBotSessions();
    }
  }

  function trimSessionMessages(messages = []) {
    return messages.slice(-24);
  }

  async function getFallbackModelId() {
    const modelsUrl = new URL("/v1/models", targetOrigin);
    const data = await requestJson(modelsUrl, { method: "GET" });
    return data?.data?.[0]?.id || "";
  }

  async function generateQqBotReply(event = {}) {
    const targetType = event.message_type === "group" ? "group" : "private";
    const targetId = targetType === "group" ? String(event.group_id || "") : String(event.user_id || "");
    const resolvedConfig = getResolvedQqConfig(targetType, targetId);
    const sessionKey = getQqSessionKey(event);
    const session = Array.isArray(qqBotSessions[sessionKey]?.messages) ? qqBotSessions[sessionKey].messages : [];
    const rawUserText = normalizeQqIncomingText(event);
    const userText = stripQqTriggerPrefix(rawUserText, resolvedConfig);
    if (!userText) {
      return "";
    }

    const model = resolvedConfig.model || await getFallbackModelId();
    if (!model) {
      const error = new Error("No model configured for QQ bot");
      error.statusCode = 500;
      throw error;
    }

    const systemPrompt = [
      resolvedConfig.persona || resolvedConfig.systemPrompt || "",
      `You are replying as QQ assistant "${resolvedConfig.assistantName || DEFAULT_QQ_BOT_CONFIG.assistantName}". Reply directly to the user and do not explain tool calls or internal system details.`,
    ].filter(Boolean).join("\n\n");

    const messages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...session,
      { role: "user", content: userText },
    ];

    const chatUrl = new URL("/v1/chat/completions", targetOrigin);
    const data = await requestJson(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    }, {
      model,
      messages,
      temperature: 0.7,
      stream: false,
    });

    const message = data?.choices?.[0]?.message;
    const reply =
      typeof message?.content === "string"
        ? message.content.trim()
        : Array.isArray(message?.content)
          ? message.content.map((item) => item?.text || "").join("\n").trim()
          : "";

    if (!reply) {
      return "";
    }

    qqBotSessions[sessionKey] = {
      updatedAt: Date.now(),
      messages: trimSessionMessages([
        ...session,
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      ]),
    };
    await saveQqBotSessions();
    return reply;
  }

  async function handleQqWebhook(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const event = rawBody ? JSON.parse(rawBody) : {};

      if (!qqBotConfig.enabled) {
        sendJson(res, 200, { ok: true, ignored: "bot_disabled" });
        return;
      }
      if (event.post_type !== "message") {
        sendJson(res, 200, { ok: true, ignored: "non_message_event" });
        return;
      }
      if (String(event.user_id || "") === String(event.self_id || "")) {
        sendJson(res, 200, { ok: true, ignored: "self_message" });
        return;
      }

      const targetType = event.message_type === "group" ? "group" : "private";
      const targetId = targetType === "group" ? String(event.group_id || "") : String(event.user_id || "");
      const resolvedConfig = getResolvedQqConfig(targetType, targetId);

      if (!isQqEventAllowed(event, resolvedConfig)) {
        sendJson(res, 200, { ok: true, ignored: "not_allowed" });
        return;
      }

      if (event.message_type === "group" && resolvedConfig.groupMentionOnly && !isGroupMentioned(event)) {
        sendJson(res, 200, { ok: true, ignored: "group_no_mention" });
        return;
      }

      const normalizedIncomingText = normalizeQqIncomingText(event);
      if (isQqSessionResetCommand(normalizedIncomingText)) {
        await clearQqSession(event);
        await sendQqMessageFinal({
          bridgeUrl: resolvedConfig.bridgeUrl,
          accessToken: resolvedConfig.accessToken,
          targetType,
          targetId,
          message: "Current QQ conversation has been reset.",
        });
        sendJson(res, 200, { ok: true, reset: true });
        return;
      }

      if (resolvedConfig.triggerPrefix && !stripQqTriggerPrefix(normalizedIncomingText, resolvedConfig)) {
        sendJson(res, 200, { ok: true, ignored: "missing_prefix" });
        return;
      }

      const reply = await generateQqBotReply(event);
      if (!reply) {
        sendJson(res, 200, { ok: true, ignored: "empty_reply" });
        return;
      }

      await sendQqMessageFinal({
        bridgeUrl: resolvedConfig.bridgeUrl,
        accessToken: resolvedConfig.accessToken,
        targetType,
        targetId,
        message: reply,
      });

      sendJson(res, 200, { ok: true, replied: true });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "QQ webhook failed" });
    }
  }

  function handleQqBotConfigGet(res) {
    sendJson(res, 200, { ok: true, config: qqBotConfig });
  }

  async function handleQqBotConfigPost(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const config = await saveQqBotConfig(payload);
      sendJson(res, 200, { ok: true, config });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to save QQ bot config" });
    }
  }

  function wrapToolExecutor(baseExecuteToolCall) {
    return async function executeToolCallWithQqFinal(name, args = {}) {
      if (name === "send_qq_message") {
        return await sendQqMessageFinal(args);
      }
      return baseExecuteToolCall(name, args);
    };
  }

  function wrapScheduledTaskRunner(baseRunScheduledTask) {
    return async function runScheduledTaskWithQqPush(taskId) {
      const task = await baseRunScheduledTask(taskId);
      if (
        task &&
        qqBotConfig.taskPushEnabled &&
        qqBotConfig.defaultTargetId &&
        task.lastStatus === "success" &&
        task.lastResult
      ) {
        try {
          const targetConfig = getResolvedQqConfig(
            qqBotConfig.defaultTargetType || "private",
            qqBotConfig.defaultTargetId
          );
          await sendQqMessageFinal({
            bridgeUrl: targetConfig.bridgeUrl,
            accessToken: targetConfig.accessToken,
            targetType: targetConfig.defaultTargetType || "private",
            targetId: targetConfig.defaultTargetId,
            message: String(task.lastResult || "").trim(),
          });
        } catch (error) {
          console.error("Failed to push scheduled task result to QQ:", error);
        }
      }
      return task;
    };
  }

  return {
    loadQqBotConfig,
    loadQqBotSessions,
    sendQqMessage,
    handleQqBotConfigGet,
    handleQqBotConfigPost,
    handleQqWebhook,
    wrapToolExecutor,
    wrapScheduledTaskRunner,
    getQqBotConfig: () => qqBotConfig,
  };
}

module.exports = {
  createQqModule,
};
