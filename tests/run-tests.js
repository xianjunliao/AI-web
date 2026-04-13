const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  createStaticPathGuard,
  migrateLegacyDataFile,
  readRequestBody,
  resolveWorkspacePath,
  writeJsonFileAtomic,
} = require("../server/server-utils");
const { createScheduler } = require("../server/server-scheduler");
const { createQqModule } = require("../server/server-qq");
const { createTaskModelInvoker } = require("../server/server-task-model");
const {
  inferScheduledTaskIntentFromText,
  formatScheduledTaskActionReply,
} = require("../server/server-schedule-intent");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-web-test-"));
}

function createSchedulerHarness() {
  let tasks = [];
  const scheduler = createScheduler({
    scheduledTasksFile: path.join(createTempDir(), "scheduled-tasks.json"),
    readJsonFile: async () => [],
    writeJsonFileAtomic: async () => {},
    readRequestBody: async () => "",
    sendJson: () => {},
    callLocalModelForTask: async () => "ok",
    schedulerTickMs: 1000,
    getScheduledTasks: () => tasks,
    setScheduledTasks: (nextTasks) => {
      tasks = nextTasks;
    },
    runningScheduledTaskIds: new Set(),
  });
  return {
    scheduler,
    getTasks: () => tasks,
    setTasks: (nextTasks) => {
      tasks = nextTasks;
    },
  };
}

function createQqModuleHarness(config = {}, options = {}) {
  const root = createTempDir();
  const personaPresetsDir = path.join(root, "personas");
  const qqBotConfigFile = path.join(root, "qq-bot-config.json");
  const qqBotSessionsFile = path.join(root, "qq-bot-sessions.json");
  fs.mkdirSync(personaPresetsDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(options.personaFiles || {})) {
    const targetPath = path.join(personaPresetsDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, String(content), "utf8");
  }
  fs.writeFileSync(qqBotConfigFile, JSON.stringify(config, null, 2), "utf8");
  fs.writeFileSync(qqBotSessionsFile, JSON.stringify({}, null, 2), "utf8");

  const sentMessages = [];
  const requestLog = [];
  let sharedConnectionConfig = {
    model: String(config.model || ""),
  };
  const qqModule = createQqModule({
    root,
    personaPresetsDir,
    qqBotConfigFile,
    qqBotSessionsFile,
    readJsonFile: async (filePath, fallbackValue) => {
      try {
        const raw = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(raw);
      } catch {
        return fallbackValue;
      }
    },
    writeJsonFileAtomic,
    readRequestBody,
    sendJson: (res, statusCode, payload) => {
      res.statusCode = statusCode;
      res.payload = payload;
    },
    requestJson: async (targetUrl, options = {}) => {
      requestLog.push({ pathname: targetUrl.pathname, options });
      if (targetUrl.pathname === "/v1/models") {
        return {
          data: [
            { id: "model-alpha" },
            { id: "model-beta" },
          ],
        };
      }
      if (targetUrl.pathname === "/send_private_msg" || targetUrl.pathname === "/send_group_msg" || targetUrl.pathname === "/send_msg") {
        sentMessages.push(JSON.parse(String(options.body || "{}")));
        return { status: "ok", retcode: 0 };
      }
      throw new Error(`Unexpected request path: ${targetUrl.pathname}`);
    },
    targetOrigin: "http://127.0.0.1:1234",
    executeToolCall: options.executeToolCall || (async (name, args = {}) => ({ name, args })),
    callLocalModelWithTools: options.callLocalModelWithTools || (async () => {
      throw new Error("Model should not be called for direct QQ model admin commands");
    }),
    getScheduledTasks: options.getScheduledTasks || (() => []),
    getSharedConnectionConfig: () => ({ ...sharedConnectionConfig }),
    saveSharedConnectionConfig: async (nextConfig = {}) => {
      sharedConnectionConfig = {
        ...sharedConnectionConfig,
        model: String(nextConfig.model || "").trim(),
      };
      return { ...sharedConnectionConfig };
    },
    logDebug: () => {},
  });

  return {
    qqModule,
    qqBotConfigFile,
    sentMessages,
    requestLog,
    getSharedConnectionConfig: () => ({ ...sharedConnectionConfig }),
  };
}

function createWebhookRequest(event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event), "utf8")]);
  req.headers = {};
  req.method = "POST";
  return req;
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

async function main() {
  await runTest("resolveWorkspacePath keeps access inside workspace root", async () => {
    const root = createTempDir();
    const inside = resolveWorkspacePath(root, "notes/file.txt");
    assert.equal(inside, path.join(root, "notes", "file.txt"));
    assert.throws(() => resolveWorkspacePath(root, "../outside.txt"), /Path escapes workspace/);
  });

  await runTest("writeJsonFileAtomic writes complete json content", async () => {
    const root = createTempDir();
    const target = path.join(root, "data", "config.json");
    await writeJsonFileAtomic(target, { enabled: true, count: 2 });
    const raw = await fs.promises.readFile(target, "utf8");
    assert.deepEqual(JSON.parse(raw), { enabled: true, count: 2 });
  });

  await runTest("migrateLegacyDataFile moves legacy json into data directory", async () => {
    const root = createTempDir();
    const legacy = path.join(root, "scheduled-tasks.json");
    const current = path.join(root, "data", "scheduled-tasks.json");
    await fs.promises.writeFile(legacy, JSON.stringify([{ id: "task-1" }], null, 2), "utf8");

    await migrateLegacyDataFile({
      currentPath: current,
      legacyPath: legacy,
      fallbackValue: [],
    });

    const migrated = JSON.parse(await fs.promises.readFile(current, "utf8"));
    assert.deepEqual(migrated, [{ id: "task-1" }]);
    await assert.rejects(fs.promises.access(legacy));
  });

  await runTest("readRequestBody rejects oversized payloads", async () => {
    const req = Readable.from([Buffer.from("12345"), Buffer.from("67890")]);
    req.headers = {};
    req.method = "POST";

    await assert.rejects(readRequestBody(req, { limitBytes: 8 }), /Request body too large/);
  });

  await runTest("createStaticPathGuard only allows explicit public paths", async () => {
    const isPublicStaticPath = createStaticPathGuard("C:\\workspace", {
      exactPaths: ["/", "/index.html", "/app.js"],
    });

    assert.equal(isPublicStaticPath("/"), true);
    assert.equal(isPublicStaticPath("/app.js"), true);
    assert.equal(isPublicStaticPath("/qq-bot-config.json"), false);
    assert.equal(isPublicStaticPath("/data/scheduled-tasks.json"), false);
  });

  /*
  await runTest("scheduled task payload supports task-level QQ push config", async () => {
    const { scheduler } = createSchedulerHarness();
    const payload = scheduler.validateScheduledTaskPayload({
      name: "日报推送",
      prompt: "生成日报",
      cronExpression: "0 9 * * *",
      enabled: true,
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "123456",
    });

    assert.equal(payload.qqPushEnabled, true);
    assert.equal(payload.qqTargetType, "group");
    assert.equal(payload.qqTargetId, "123456");
    assert.throws(() => scheduler.validateScheduledTaskPayload({
      name: "日报推送",
      prompt: "生成日报",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "",
    }), /QQ target ID is required/);
  });

  await runTest("scheduled task sanitization strips legacy model field", async () => {
    const { scheduler } = createSchedulerHarness();
    const task = scheduler.sanitizeScheduledTask({
      name: "鏃ユ姤鎺ㄩ€?,
      prompt: "鐢熸垚鏃ユ姤",
      model: "legacy-model",
      cronExpression: "0 9 * * *",
      enabled: true,
    });

    assert.equal(Object.prototype.hasOwnProperty.call(task, "model"), false);
  });

  await runTest("scheduled task deduplication distinguishes QQ push target", async () => {
    const { scheduler, setTasks } = createSchedulerHarness();
    setTasks([
      scheduler.sanitizeScheduledTask({
        name: "日报推送",
        prompt: "生成日报",
        cronExpression: "0 9 * * *",
        enabled: true,
        qqPushEnabled: true,
        qqTargetType: "group",
        qqTargetId: "123456",
      }),
    ]);

    const sameTask = scheduler.findEquivalentScheduledTask({
      name: "日报推送",
      prompt: "生成日报",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "123456",
    });
    const differentTargetTask = scheduler.findEquivalentScheduledTask({
      name: "日报推送",
      prompt: "生成日报",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "654321",
    });

    assert.ok(sameTask);
    assert.equal(differentTargetTask, null);
  });

  await runTest("scheduled tasks are listed by created time descending", async () => {
    const { scheduler, setTasks } = createSchedulerHarness();
    setTasks([
      scheduler.sanitizeScheduledTask({
        id: "task-old",
        name: "较早任务",
        prompt: "旧任务",
        cronExpression: "0 8 * * *",
        enabled: true,
        createdAt: 1712970000000,
        updatedAt: 1712970000000,
      }),
      scheduler.sanitizeScheduledTask({
        id: "task-new",
        name: "较新任务",
        prompt: "新任务",
        cronExpression: "0 9 * * *",
        enabled: true,
        createdAt: 1712977200000,
        updatedAt: 1712977200000,
      }),
    ]);

    const listed = scheduler.listScheduledTasks();
    assert.equal(listed[0].id, "task-new");
    assert.equal(listed[1].id, "task-old");
  });

  await runTest("scheduled task execution uses shared connection model", async () => {
    let capturedModel = "";
    const callLocalModelForTask = createTaskModelInvoker({
      getTaskModel: () => "shared-model",
      callLocalModelWithTools: async ({ model }) => {
        capturedModel = model;
        return "ok";
      },
    });

    const result = await callLocalModelForTask({
      name: "鏃ユ姤鎺ㄩ€?,
      prompt: "鐢熸垚鏃ユ姤",
    });

    assert.equal(result, "ok");
    assert.equal(capturedModel, "shared-model");
  });

  */

  await runTest("scheduled task payload supports task-level QQ push config", async () => {
    const { scheduler } = createSchedulerHarness();
    const payload = scheduler.validateScheduledTaskPayload({
      name: "daily-report",
      prompt: "generate report",
      cronExpression: "0 9 * * *",
      enabled: true,
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "123456",
    });

    assert.equal(payload.qqPushEnabled, true);
    assert.equal(payload.qqTargetType, "group");
    assert.equal(payload.qqTargetId, "123456");
    assert.throws(() => scheduler.validateScheduledTaskPayload({
      name: "daily-report",
      prompt: "generate report",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "",
    }), /QQ target ID is required/);
  });

  await runTest("scheduled task sanitization strips legacy model field", async () => {
    const { scheduler } = createSchedulerHarness();
    const task = scheduler.sanitizeScheduledTask({
      name: "legacy-task",
      prompt: "legacy prompt",
      model: "legacy-model",
      cronExpression: "0 9 * * *",
      enabled: true,
    });

    assert.equal(Object.prototype.hasOwnProperty.call(task, "model"), false);
  });

  await runTest("scheduled task deduplication distinguishes QQ push target", async () => {
    const { scheduler, setTasks } = createSchedulerHarness();
    setTasks([
      scheduler.sanitizeScheduledTask({
        name: "daily-report",
        prompt: "generate report",
        cronExpression: "0 9 * * *",
        enabled: true,
        qqPushEnabled: true,
        qqTargetType: "group",
        qqTargetId: "123456",
      }),
    ]);

    const sameTask = scheduler.findEquivalentScheduledTask({
      name: "daily-report",
      prompt: "generate report",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "123456",
    });
    const differentTargetTask = scheduler.findEquivalentScheduledTask({
      name: "daily-report",
      prompt: "generate report",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "654321",
    });

    assert.ok(sameTask);
    assert.equal(differentTargetTask, null);
  });

  await runTest("scheduled tasks are listed by created time descending", async () => {
    const { scheduler, setTasks } = createSchedulerHarness();
    setTasks([
      scheduler.sanitizeScheduledTask({
        id: "task-old",
        name: "older-task",
        prompt: "older prompt",
        cronExpression: "0 8 * * *",
        enabled: true,
        createdAt: 1712970000000,
        updatedAt: 1712970000000,
      }),
      scheduler.sanitizeScheduledTask({
        id: "task-new",
        name: "newer-task",
        prompt: "newer prompt",
        cronExpression: "0 9 * * *",
        enabled: true,
        createdAt: 1712977200000,
        updatedAt: 1712977200000,
      }),
    ]);

    const listed = scheduler.listScheduledTasks();
    assert.equal(listed[0].id, "task-new");
    assert.equal(listed[1].id, "task-old");
  });

  await runTest("scheduled task execution uses shared connection model", async () => {
    let capturedModel = "";
    const callLocalModelForTask = createTaskModelInvoker({
      getTaskModel: () => "shared-model",
      callLocalModelWithTools: async ({ model }) => {
        capturedModel = model;
        return "ok";
      },
    });

    const result = await callLocalModelForTask({
      name: "daily-report",
      prompt: "generate report",
    });

    assert.equal(result, "ok");
    assert.equal(capturedModel, "shared-model");
  });

  await runTest("qq super permission target can view model list directly", async () => {
    const { qqModule, sentMessages, requestLog } = createQqModuleHarness({
      enabled: true,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      targetProfiles: {
        "private:1036986718": {
          name: "QQ 1036986718",
          targetType: "private",
          targetId: "1036986718",
          superPermissionEnabled: true,
          toolReadEnabled: true,
          toolWriteEnabled: true,
          toolCommandEnabled: true,
          toolFileSendEnabled: true,
          fileShareRoots: ["data/temp"],
        },
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "模型列表",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /当前可用模型/);
    assert.match(sentMessages[0].message, /model-alpha（当前使用）/);
    assert.match(sentMessages[0].message, /model-beta/);
    assert.equal(requestLog.filter((item) => item.pathname === "/v1/models").length, 1);
  });

  await runTest("qq super permission target can switch model directly", async () => {
    const { qqModule, qqBotConfigFile, sentMessages, requestLog } = createQqModuleHarness({
      enabled: true,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      targetProfiles: {
        "private:1036986718": {
          name: "QQ 1036986718",
          targetType: "private",
          targetId: "1036986718",
          superPermissionEnabled: true,
          toolReadEnabled: true,
          toolWriteEnabled: true,
          toolCommandEnabled: true,
          toolFileSendEnabled: true,
          fileShareRoots: ["data/temp"],
        },
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "切换使用模型 model-beta",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /已切换 QQ 当前使用模型/);
    assert.match(sentMessages[0].message, /当前模型：model-beta/);
    assert.equal(qqModule.getQqBotConfig().model, "model-beta");
    const persistedConfig = JSON.parse(await fs.promises.readFile(qqBotConfigFile, "utf8"));
    assert.equal(persistedConfig.model, "model-beta");
    assert.equal(requestLog.filter((item) => item.pathname === "/v1/models").length, 1);
  });

  await runTest("qq super permission target can switch shared model by index", async () => {
    const { qqModule, sentMessages, getSharedConnectionConfig } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      targetProfiles: {
        "private:1036986718": {
          name: "QQ 1036986718",
          targetType: "private",
          targetId: "1036986718",
          superPermissionEnabled: true,
          toolReadEnabled: true,
          toolWriteEnabled: true,
          toolCommandEnabled: true,
          toolFileSendEnabled: true,
          fileShareRoots: ["data/temp"],
        },
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "切第2个模型",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /model-beta/);
    assert.equal(getSharedConnectionConfig().model, "model-beta");
  });

  await runTest("qq super permission actor can switch shared model inside group", async () => {
    const { qqModule, sentMessages, getSharedConnectionConfig } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      targetProfiles: {
        "private:1036986718": {
          name: "QQ 1036986718",
          targetType: "private",
          targetId: "1036986718",
          superPermissionEnabled: true,
          toolReadEnabled: true,
          toolWriteEnabled: true,
          toolCommandEnabled: true,
          toolFileSendEnabled: true,
          fileShareRoots: ["data/temp"],
        },
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "group",
      group_id: "20001",
      user_id: "1036986718",
      self_id: "999999",
      message: "切第2个模型",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /model-beta/);
    assert.equal(getSharedConnectionConfig().model, "model-beta");
  });

  await runTest("other group users cannot switch shared model", async () => {
    const { qqModule, sentMessages, getSharedConnectionConfig } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      targetProfiles: {
        "private:1036986718": {
          name: "QQ 1036986718",
          targetType: "private",
          targetId: "1036986718",
          superPermissionEnabled: true,
          toolReadEnabled: true,
          toolWriteEnabled: true,
          toolCommandEnabled: true,
          toolFileSendEnabled: true,
          fileShareRoots: ["data/temp"],
        },
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "group",
      group_id: "20001",
      user_id: "55555555",
      self_id: "999999",
      message: "切第2个模型",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    if (sentMessages.length) {
      assert.match(sentMessages[0].message, /未授权|超级管理/);
    }
    assert.equal(getSharedConnectionConfig().model, "model-alpha");
  });

  await runTest("qq super permission actor can switch current group persona", async () => {
    const { qqModule } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      targetProfiles: {
        "private:1036986718": {
          name: "QQ 1036986718",
          targetType: "private",
          targetId: "1036986718",
          superPermissionEnabled: true,
          toolReadEnabled: true,
          toolWriteEnabled: true,
          toolCommandEnabled: true,
          toolFileSendEnabled: true,
          fileShareRoots: ["data/temp"],
        },
      },
    }, {
      personaFiles: {
        "alpha.md": "# Alpha\n\nAlpha persona\nYou are alpha.",
        "beta.md": "# Beta\n\nBeta persona\nYou are beta.",
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "group",
      group_id: "20002",
      user_id: "1036986718",
      self_id: "999999",
      message: "切第2个人设",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    const groupProfile = qqModule.getQqBotConfig().targetProfiles["group:20002"];
    assert.ok(groupProfile);
    assert.equal(groupProfile.personaPreset, "workspace:beta.md");
    assert.match(groupProfile.persona, /You are beta/);
  });

  await runTest("scheduled task intent can target tasks by index", async () => {
    const tasks = [
      { id: "task-a", name: "日报推送", enabled: true, cronExpression: "0 9 * * *" },
      { id: "task-b", name: "周报推送", enabled: false, cronExpression: "0 18 * * 1" },
    ];

    const runIntent = inferScheduledTaskIntentFromText("立即执行第2个定时任务", { tasks });
    assert.equal(runIntent?.action, "run");
    assert.equal(runIntent?.args?.id, "task-b");

    const disableIntent = inferScheduledTaskIntentFromText("暂停第一个任务", { tasks });
    assert.equal(disableIntent?.action, "disable");
    assert.equal(disableIntent?.args?.id, "task-a");

    const deleteIntent = inferScheduledTaskIntentFromText("删掉第一个定时任务", { tasks });
    assert.equal(deleteIntent?.action, "delete");
    assert.equal(deleteIntent?.args?.id, "task-a");

    const updateIntent = inferScheduledTaskIntentFromText("修改第2个任务为每天9点提醒我发周报", { tasks });
    assert.equal(updateIntent?.action, "update");
    assert.equal(updateIntent?.args?.id, "task-b");
    assert.equal(updateIntent?.args?.cronExpression, "0 9 * * *");
    assert.equal(updateIntent?.args?.prompt, "提醒我发周报");
  });

  await runTest("scheduled task action reply appends refreshed list with timestamps", async () => {
    const reply = formatScheduledTaskActionReply(
      { action: "delete", task: { name: "出行提醒" } },
      { deleted: true },
      {
        tasks: [
          {
            id: "task-b",
            name: "天气播报",
            enabled: true,
            cronExpression: "30 8 * * *",
            createdAt: 1712973600000,
            updatedAt: 1712977200000,
          },
        ],
      }
    );

    assert.match(reply, /已经删除定时任务：出行提醒/);
    assert.match(reply, /当前定时任务：/);
    assert.match(reply, /\| 序号 \| 任务 \| 状态 \| Cron \| 创建时间 \| 最后修改 \|/);
    assert.match(reply, /\| 1 \| 天气播报 \| 已启用 \| 30 8 \* \* \* \|/);
  });

  await runTest("qq can handle scheduled task actions directly by task index", async () => {
    const calls = [];
    const tasks = [
      { id: "task-a", name: "日报推送", enabled: true, cronExpression: "0 9 * * *" },
      { id: "task-b", name: "周报推送", enabled: true, cronExpression: "0 18 * * 1" },
    ];
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
    }, {
      getScheduledTasks: () => tasks,
      executeToolCall: async (name, args = {}) => {
        calls.push({ name, args });
        if (name === "run_scheduled_task") {
          return { id: args.id, name: "周报推送" };
        }
        return { name, args };
      },
      callLocalModelWithTools: async () => {
        throw new Error("Model should not be called for direct QQ scheduled task actions");
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "group",
      group_id: "20003",
      user_id: "55555555",
      self_id: "999999",
      message: "立即执行第2个定时任务",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "run_scheduled_task");
    assert.equal(calls[0].args.id, "task-b");
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /周报推送/);
    assert.match(sentMessages[0].message, /当前定时任务/);
    assert.match(sentMessages[0].message, /\| 序号 \| 任务 \| 状态 \| Cron \| 创建时间 \| 最后修改 \|/);
  });

  await runTest("qq can delete scheduled task directly with colloquial wording", async () => {
    const calls = [];
    let tasks = [
      { id: "task-a", name: "出行提醒", enabled: true, cronExpression: "20 8 * * *" },
      { id: "task-b", name: "天气播报", enabled: true, cronExpression: "30 8 * * *" },
    ];
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
    }, {
      getScheduledTasks: () => tasks,
      executeToolCall: async (name, args = {}) => {
        calls.push({ name, args });
        if (name === "delete_scheduled_task") {
          tasks = tasks.filter((task) => task.id !== args.id);
          return { id: args.id, name: "出行提醒" };
        }
        return { name, args };
      },
      callLocalModelWithTools: async () => {
        throw new Error("Model should not be called for direct QQ scheduled task delete");
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "删掉第一个定时任务",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "delete_scheduled_task");
    assert.equal(calls[0].args.id, "task-a");
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /出行提醒/);
    assert.match(sentMessages[0].message, /当前定时任务/);
    assert.match(sentMessages[0].message, /\| 序号 \| 任务 \| 状态 \| Cron \| 创建时间 \| 最后修改 \|/);
    assert.doesNotMatch(sentMessages[0].message, /\| 1 \| 出行提醒 \|/);
  });

  await runTest("qq can update scheduled task directly with natural language", async () => {
    const calls = [];
    let tasks = [
      { id: "task-a", name: "出行提醒", prompt: "提醒我出门", enabled: true, cronExpression: "20 8 * * *" },
      { id: "task-b", name: "天气播报", prompt: "提醒我看天气", enabled: true, cronExpression: "30 8 * * *" },
    ];
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
    }, {
      getScheduledTasks: () => tasks,
      executeToolCall: async (name, args = {}) => {
        calls.push({ name, args });
        if (name === "update_scheduled_task") {
          const updatedTask = {
            id: args.id,
            name: "提醒我发周报",
            prompt: args.prompt,
            cronExpression: args.cronExpression,
          };
          tasks = tasks.map((task) => task.id === args.id ? { ...task, ...updatedTask, updatedAt: 1712977200000 } : task);
          return updatedTask;
        }
        return { name, args };
      },
      callLocalModelWithTools: async () => {
        throw new Error("Model should not be called for direct QQ scheduled task update");
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "group",
      group_id: "20003",
      user_id: "55555555",
      self_id: "999999",
      message: "修改第2个任务为每天9点提醒我发周报",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "update_scheduled_task");
    assert.equal(calls[0].args.id, "task-b");
    assert.equal(calls[0].args.cronExpression, "0 9 * * *");
    assert.equal(calls[0].args.prompt, "提醒我发周报");
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /当前 Cron/);
    assert.match(sentMessages[0].message, /当前定时任务/);
    assert.match(sentMessages[0].message, /\| 序号 \| 任务 \| 状态 \| Cron \| 创建时间 \| 最后修改 \|/);
  });

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
