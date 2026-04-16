const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  createStaticPathGuard,
  migrateLegacyDataFile,
  readJsonFile,
  readTextFile,
  readRequestBody,
  resolveWorkspacePath,
  writeFileAtomic,
  writeJsonFileAtomic,
} = require("../server/server-utils");
const { createExecuteToolCall } = require("../server/server-tool-dispatcher");
const { createScheduler } = require("../server/server-scheduler");
const { createQqModule } = require("../server/server-qq");
const { createServerBootstrap } = require("../server/server-bootstrap");
const { createTaskModelInvoker } = require("../server/server-task-model");
const { maybeRunDirectWebSearch } = require("../server/server-live-web-search");
const { createNovelModule } = require("../server/server-novel-projects");
const {
  inferScheduledTaskIntentFromText,
  formatScheduledTaskActionReply,
} = require("../server/server-schedule-intent");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-web-test-"));
}

function createSchedulerHarness(overrides = {}) {
  let tasks = [];
  const scheduler = createScheduler({
    scheduledTasksFile: path.join(createTempDir(), "scheduled-tasks.json"),
    readJsonFile: overrides.readJsonFile || (async () => []),
    writeJsonFileAtomic: overrides.writeJsonFileAtomic || (async () => {}),
    readRequestBody: overrides.readRequestBody || (async () => ""),
    sendJson: overrides.sendJson || (() => {}),
    callLocalModelForTask: overrides.callLocalModelForTask || (async () => "ok"),
    schedulerTickMs: overrides.schedulerTickMs || 1000,
    getScheduledTasks: () => tasks,
    setScheduledTasks: (nextTasks) => {
      tasks = nextTasks;
    },
    runningScheduledTaskIds: overrides.runningScheduledTaskIds || new Set(),
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

function createNovelModuleHarness(overrides = {}) {
  const root = createTempDir();
  const novelsDir = path.join(root, "novels");
  const sentMessages = [];
  const novelModule = createNovelModule({
    novelsDir,
    readJsonFile,
    readTextFile,
    writeJsonFileAtomic,
    writeFileAtomic,
    readRequestBody,
    sendJson: (res, statusCode, payload) => {
      res.statusCode = statusCode;
      res.payload = payload;
    },
    generateText: overrides.generateText || (async ({ purpose }) => `# ${purpose}\n\nmock content`),
    sendQqMessage: async (args = {}) => {
      sentMessages.push(args);
      return { ok: true };
    },
    getQqBotConfig: () => ({
      defaultTargetType: "private",
      defaultTargetId: "123456",
    }),
    logDebug: () => {},
  });
  return { novelModule, novelsDir, sentMessages };
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

  await runTest("writeJsonFileAtomic retries transient rename failures", async () => {
    const root = createTempDir();
    const target = path.join(root, "data", "config.json");
    const originalRename = fs.promises.rename;
    let renameAttempts = 0;
    fs.promises.rename = async (...args) => {
      renameAttempts += 1;
      if (renameAttempts === 1) {
        const error = new Error("File is temporarily locked");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(...args);
    };

    try {
      await writeJsonFileAtomic(target, { enabled: true, count: 3 });
    } finally {
      fs.promises.rename = originalRename;
    }

    const raw = await fs.promises.readFile(target, "utf8");
    assert.deepEqual(JSON.parse(raw), { enabled: true, count: 3 });
    assert.equal(renameAttempts, 2);
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

  await runTest("bootstrap loads shared connection config before QQ config", async () => {
    let sharedLoaded = false;
    let qqConfigSawSharedLoaded = false;
    let qqSessionsSawSharedLoaded = false;
    let startedLoop = false;
    let serverListened = false;
    const bootstrapServer = createServerBootstrap({
      initializeDataFiles: async () => {},
      runStartupCleanup: async () => {},
      loadScheduledTasks: async () => {},
      loadSharedConnectionConfig: async () => {
        sharedLoaded = true;
      },
      loadQqBotConfig: async () => {
        qqConfigSawSharedLoaded = sharedLoaded;
      },
      loadQqBotSessions: async () => {
        qqSessionsSawSharedLoaded = sharedLoaded;
      },
      startScheduledTaskLoop: () => {
        startedLoop = true;
      },
      server: {
        listen(_port, _host, callback) {
          serverListened = true;
          callback();
        },
      },
      port: 8000,
      host: "127.0.0.1",
      targetOrigin: "http://127.0.0.1:1234",
    });

    await bootstrapServer();

    assert.equal(qqConfigSawSharedLoaded, true);
    assert.equal(qqSessionsSawSharedLoaded, true);
    assert.equal(startedLoop, true);
    assert.equal(serverListened, true);
  });

  await runTest("qq config keeps bot enabled when loading persisted config", async () => {
    const { qqModule, qqBotConfigFile } = createQqModuleHarness({
      enabled: false,
      targetProfiles: {
        "private:1036986718": {
          name: "QQ 1036986718",
          targetType: "private",
          targetId: "1036986718",
          enabled: false,
        },
      },
    });

    await qqModule.loadQqBotConfig();

    const config = qqModule.getQqBotConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.targetProfiles["private:1036986718"]?.enabled, true);

    const persistedConfig = JSON.parse(await fs.promises.readFile(qqBotConfigFile, "utf8"));
    assert.equal(persistedConfig.enabled, true);
    assert.equal(persistedConfig.targetProfiles["private:1036986718"]?.enabled, true);
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

  await runTest("scheduled task sanitization persists creator info", async () => {
    const { scheduler } = createSchedulerHarness();
    const task = scheduler.sanitizeScheduledTask({
      name: "group-task",
      prompt: "send report",
      cronExpression: "0 9 * * *",
      enabled: true,
      creatorType: "group",
      creatorId: "20003",
    });

    assert.equal(task.creatorType, "group");
    assert.equal(task.creatorId, "20003");
  });

  await runTest("scheduled task list can filter by creator scope", async () => {
    const { scheduler, setTasks } = createSchedulerHarness();
    setTasks([
      scheduler.sanitizeScheduledTask({
        id: "task-admin",
        name: "admin-task",
        prompt: "admin prompt",
        cronExpression: "0 8 * * *",
        enabled: true,
        creatorType: "private",
        creatorId: "1036986718",
      }),
      scheduler.sanitizeScheduledTask({
        id: "task-group",
        name: "group-task",
        prompt: "group prompt",
        cronExpression: "0 9 * * *",
        enabled: true,
        creatorType: "group",
        creatorId: "20003",
      }),
    ]);

    const groupTasks = scheduler.listScheduledTasks({
      creatorType: "group",
      creatorId: "20003",
    });
    const adminTasks = scheduler.listScheduledTasks({
      creatorType: "private",
      creatorId: "1036986718",
    });

    assert.equal(groupTasks.length, 1);
    assert.equal(groupTasks[0].id, "task-group");
    assert.equal(groupTasks[0].creatorLabel, "群 20003");
    assert.equal(adminTasks.length, 2);
  });

  await runTest("scheduled task actor admin still respects explicit group scope", async () => {
    const { scheduler, setTasks } = createSchedulerHarness();
    setTasks([
      scheduler.sanitizeScheduledTask({
        id: "task-admin",
        name: "admin-task",
        prompt: "admin prompt",
        cronExpression: "0 8 * * *",
        enabled: true,
        creatorType: "private",
        creatorId: "1036986718",
      }),
      scheduler.sanitizeScheduledTask({
        id: "task-group",
        name: "group-task",
        prompt: "group prompt",
        cronExpression: "0 9 * * *",
        enabled: true,
        creatorType: "group",
        creatorId: "20003",
      }),
    ]);

    const scopedTasks = scheduler.listScheduledTasks({
      actorUserId: "1036986718",
      creatorType: "group",
      creatorId: "20003",
      scopeTargetType: "group",
      scopeTargetId: "20003",
    });

    assert.equal(scopedTasks.length, 1);
    assert.equal(scopedTasks[0].id, "task-group");
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

  await runTest("scheduled task sanitization persists creator info", async () => {
    const { scheduler } = createSchedulerHarness();
    const task = scheduler.sanitizeScheduledTask({
      name: "group-task",
      prompt: "send report",
      cronExpression: "0 9 * * *",
      enabled: true,
      creatorType: "group",
      creatorId: "20003",
    });

    assert.equal(task.creatorType, "group");
    assert.equal(task.creatorId, "20003");
  });

  await runTest("scheduled task list can filter by creator scope", async () => {
    const { scheduler, setTasks } = createSchedulerHarness();
    setTasks([
      scheduler.sanitizeScheduledTask({
        id: "task-admin",
        name: "admin-task",
        prompt: "admin prompt",
        cronExpression: "0 8 * * *",
        enabled: true,
        creatorType: "private",
        creatorId: "1036986718",
      }),
      scheduler.sanitizeScheduledTask({
        id: "task-group",
        name: "group-task",
        prompt: "group prompt",
        cronExpression: "0 9 * * *",
        enabled: true,
        creatorType: "group",
        creatorId: "20003",
      }),
    ]);

    const groupTasks = scheduler.listScheduledTasks({
      creatorType: "group",
      creatorId: "20003",
    });
    const adminTasks = scheduler.listScheduledTasks({
      creatorType: "private",
      creatorId: "1036986718",
    });

    assert.equal(groupTasks.length, 1);
    assert.equal(groupTasks[0].id, "task-group");
    assert.equal(groupTasks[0].creatorLabel, "群 20003");
    assert.equal(adminTasks.length, 2);
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

  await runTest("scheduled task failure clears stale last result", async () => {
    const { scheduler, setTasks, getTasks } = createSchedulerHarness({
      callLocalModelForTask: async () => {
        throw new Error("Model unavailable");
      },
    });

    setTasks([
      scheduler.sanitizeScheduledTask({
        id: "task-hot-search",
        name: "hot-search",
        prompt: "用联网搜索工具查询国内实时热搜",
        cronExpression: "30 12 * * *",
        enabled: true,
        lastStatus: "success",
        lastResult: "old success result",
      }),
    ]);

    const task = await scheduler.runScheduledTask("task-hot-search");
    const storedTask = getTasks()[0];

    assert.equal(task.lastStatus, "error");
    assert.equal(task.lastError, "Model unavailable");
    assert.equal(task.lastResult, "");
    assert.equal(storedTask.lastResult, "");
  });

  await runTest("scheduled task model exposes web search tool", async () => {
    let capturedTools = [];
    let capturedRequiredToolName = "";
    let capturedSingleUseToolNames = [];
    const callLocalModelForTask = createTaskModelInvoker({
      getTaskModel: () => "shared-model",
      callLocalModelWithTools: async ({ tools, requiredToolName, singleUseToolNames }) => {
        capturedTools = Array.isArray(tools) ? tools : [];
        capturedRequiredToolName = String(requiredToolName || "");
        capturedSingleUseToolNames = Array.isArray(singleUseToolNames) ? singleUseToolNames : [];
        return "ok";
      },
    });

    const result = await callLocalModelForTask({
      name: "daily-report",
      prompt: "用联网搜索工具查询国内实时热搜",
    });

    assert.equal(result, "ok");
    assert.deepEqual(
      capturedTools.map((tool) => tool?.function?.name),
      ["get_weather", "web_search"]
    );
    assert.equal(capturedRequiredToolName, "web_search");
    assert.deepEqual(capturedSingleUseToolNames, ["web_search"]);
  });

  await runTest("scheduled task simple live query bypasses model with direct web search", async () => {
    let modelCalled = false;
    const searchCalls = [];
    const callLocalModelForTask = createTaskModelInvoker({
      getTaskModel: () => "shared-model",
      searchWeb: async (query, limit) => {
        searchCalls.push({ query, limit });
        return {
          query,
          results: [
            {
              title: "国内热搜榜",
              url: "https://example.com/hot-search",
              snippet: "这是最新的热搜摘要",
            },
          ],
        };
      },
      callLocalModelWithTools: async () => {
        modelCalled = true;
        return "should-not-run";
      },
    });

    const result = await callLocalModelForTask({
      name: "hot-search",
      prompt: "用联网搜索工具查询国内实时热搜",
    });

    assert.equal(modelCalled, false);
    assert.deepEqual(searchCalls, [{ query: "国内实时热搜", limit: 3 }]);
    assert.match(result, /国内实时热搜/);
    assert.match(result, /国内热搜榜/);
  });

  await runTest("direct web search supports concise news briefing requests", async () => {
    const searchCalls = [];
    const result = await maybeRunDirectWebSearch({
      text: "帮我整理今天关于比亚迪的新闻",
      searchWeb: async (query, limit) => {
        searchCalls.push({ query, limit });
        return {
          query,
          results: [
            {
              title: "比亚迪发布新车型",
              url: "https://example.com/byd-1",
              snippet: "新车型发布并公布配置与售价信息",
            },
            {
              title: "比亚迪一季度销量增长",
              url: "https://example.com/byd-2",
              snippet: "销量数据继续走高，市场关注度上升",
            },
          ],
        };
      },
    });

    assert.deepEqual(searchCalls, [{ query: "今天关于比亚迪的新闻", limit: 4 }]);
    assert.equal(result?.mode, "brief");
    assert.match(result?.reply || "", /今天关于比亚迪的新闻/);
    assert.match(result?.reply || "", /比亚迪发布新车型/);
    assert.match(result?.reply || "", /要点：/);
  });

  await runTest("scheduled task news briefing bypasses model with direct web search", async () => {
    let modelCalled = false;
    const searchCalls = [];
    const callLocalModelForTask = createTaskModelInvoker({
      getTaskModel: () => "shared-model",
      searchWeb: async (query, limit) => {
        searchCalls.push({ query, limit });
        return {
          query,
          results: [
            {
              title: "比亚迪发布新车型",
              url: "https://example.com/byd-1",
              snippet: "新车型发布并公布配置与售价信息",
            },
          ],
        };
      },
      callLocalModelWithTools: async () => {
        modelCalled = true;
        return "should-not-run";
      },
    });

    const result = await callLocalModelForTask({
      name: "byd-news",
      prompt: "整理今天关于比亚迪的新闻",
    });

    assert.equal(modelCalled, false);
    assert.deepEqual(searchCalls, [{ query: "今天关于比亚迪的新闻", limit: 4 }]);
    assert.match(result, /今天关于比亚迪的新闻/);
    assert.match(result, /比亚迪发布新车型/);
  });

  await runTest("scheduled task model keeps optional tools for ordinary prompts", async () => {
    let capturedRequiredToolName = "";
    let capturedSingleUseToolNames = [];
    const callLocalModelForTask = createTaskModelInvoker({
      getTaskModel: () => "shared-model",
      callLocalModelWithTools: async ({ requiredToolName, singleUseToolNames }) => {
        capturedRequiredToolName = String(requiredToolName || "");
        capturedSingleUseToolNames = Array.isArray(singleUseToolNames) ? singleUseToolNames : [];
        return "ok";
      },
    });

    const result = await callLocalModelForTask({
      name: "daily-reminder",
      prompt: "提醒我开始工作",
    });

    assert.equal(result, "ok");
    assert.equal(capturedRequiredToolName, "");
    assert.deepEqual(capturedSingleUseToolNames, []);
  });

  await runTest("tool dispatcher supports web search", async () => {
    const searchCalls = [];
    const executeToolCall = createExecuteToolCall({
      root: createTempDir(),
      resolveWorkspacePath,
      getWeatherByLocation: async () => {
        throw new Error("get_weather should not be called in this test");
      },
      searchWeb: async (query, limit) => {
        searchCalls.push({ query, limit });
        return {
          query,
          results: [
            {
              title: "OpenAI News",
              url: "https://example.com/openai-news",
              snippet: "Latest update",
              source: "example.com",
            },
          ],
        };
      },
      runShellCommand: async () => ({}),
      runCliCommand: async () => ({}),
      listScheduledTasks: () => [],
      validateScheduledTaskPayload: () => ({}),
      findEquivalentScheduledTask: () => null,
      sanitizeScheduledTask: (task) => task,
      saveScheduledTasks: async () => {},
      ensureScheduledTask: () => {
        throw new Error("ensureScheduledTask should not be called in this test");
      },
      computeNextRunAt: () => null,
      runScheduledTask: async () => ({}),
      sendQqMessage: async () => ({}),
      getScheduledTasks: () => [],
      setScheduledTasks: () => {},
      runningScheduledTaskIds: new Set(),
    });

    const result = await executeToolCall("web_search", {
      query: "OpenAI news",
      limit: 3,
    });

    assert.deepEqual(searchCalls, [{ query: "OpenAI news", limit: 3 }]);
    assert.equal(result.query, "OpenAI news");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].title, "OpenAI News");
  });

  await runTest("qq read tools include web search", async () => {
    let capturedTools = [];
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      toolReadEnabled: true,
    }, {
      callLocalModelWithTools: async ({ tools }) => {
        capturedTools = Array.isArray(tools) ? tools : [];
        return "search-ready";
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "55555555",
      self_id: "999999",
      message: "介绍一下你现在能做什么",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(capturedTools.some((tool) => tool?.function?.name === "web_search"), true);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message, "search-ready");
  });

  await runTest("qq live web query uses lean web search mode", async () => {
    let captured = null;
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      toolReadEnabled: true,
    }, {
      callLocalModelWithTools: async (options = {}) => {
        captured = options;
        return "hot-search-ready";
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "55555555",
      self_id: "999999",
      message: "帮我总结一下国内实时热搜并简要分析",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.ok(captured);
    assert.deepEqual(
      (captured.tools || []).map((tool) => tool?.function?.name),
      ["web_search"]
    );
    assert.equal(captured.requiredToolName, "web_search");
    assert.deepEqual(captured.singleUseToolNames, ["web_search"]);
    assert.equal(captured.temperature, 0.2);
    assert.equal(captured.maxRounds, 2);
    assert.equal(Array.isArray(captured.messages), true);
    assert.equal(captured.messages.length, 2);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message, "hot-search-ready");
  });

  await runTest("qq simple live web query bypasses model directly", async () => {
    let modelCalled = false;
    const toolCalls = [];
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      toolReadEnabled: true,
    }, {
      executeToolCall: async (name, args = {}) => {
        toolCalls.push({ name, args });
        if (name === "web_search") {
          return {
            query: args.query,
            results: [
              {
                title: "国内热搜榜",
                url: "https://example.com/hot-search",
                snippet: "这是最新的热搜摘要",
              },
            ],
          };
        }
        return { name, args };
      },
      callLocalModelWithTools: async () => {
        modelCalled = true;
        return "should-not-run";
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "55555555",
      self_id: "999999",
      message: "帮我查下国内实时热搜",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(modelCalled, false);
    assert.deepEqual(toolCalls, [
      { name: "web_search", args: { query: "国内实时热搜", limit: 3 } },
    ]);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /国内实时热搜/);
    assert.match(sentMessages[0].message, /国内热搜榜/);
  });

  await runTest("qq news briefing query bypasses model directly", async () => {
    let modelCalled = false;
    const toolCalls = [];
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      groupMentionOnly: false,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      toolReadEnabled: true,
    }, {
      executeToolCall: async (name, args = {}) => {
        toolCalls.push({ name, args });
        if (name === "web_search") {
          return {
            query: args.query,
            results: [
              {
                title: "比亚迪发布新车型",
                url: "https://example.com/byd-1",
                snippet: "新车型发布并公布配置与售价信息",
              },
            ],
          };
        }
        return { name, args };
      },
      callLocalModelWithTools: async () => {
        modelCalled = true;
        return "should-not-run";
      },
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "55555555",
      self_id: "999999",
      message: "帮我整理今天关于比亚迪的新闻",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(modelCalled, false);
    assert.deepEqual(toolCalls, [
      { name: "web_search", args: { query: "今天关于比亚迪的新闻", limit: 4 } },
    ]);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /今天关于比亚迪的新闻/);
    assert.match(sentMessages[0].message, /比亚迪发布新车型/);
    assert.match(sentMessages[0].message, /要点：/);
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

  await runTest("builtin admin qq target can view current model without explicit super permission", async () => {
    const { qqModule, sentMessages, requestLog } = createQqModuleHarness({
      enabled: true,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
    });
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "当前模型",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /当前模型/);
    assert.match(sentMessages[0].message, /model-alpha/);
    assert.equal(requestLog.filter((item) => item.pathname === "/v1/models").length, 0);
  });

  await runTest("builtin admin qq target can view current persona without explicit super permission", async () => {
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      personaPreset: "workspace:alpha.md",
      persona: "# Alpha\n\nAlpha persona\nYou are alpha.",
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
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "当前人设",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /当前人设/);
    assert.match(sentMessages[0].message, /alpha/i);
  });

  await runTest("builtin admin qq target can switch private persona without explicit super permission", async () => {
    const { qqModule, sentMessages } = createQqModuleHarness({
      enabled: true,
      bridgeUrl: "http://127.0.0.1:3000/",
      accessToken: "token",
      defaultTargetType: "private",
      defaultTargetId: "1036986718",
      model: "model-alpha",
      personaPreset: "workspace:alpha.md",
      persona: "# Alpha\n\nAlpha persona\nYou are alpha.",
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
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "切第2个人设",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /beta/i);
    const privateProfile = qqModule.getQqBotConfig().targetProfiles["private:1036986718"];
    assert.ok(privateProfile);
    assert.equal(privateProfile.personaPreset, "workspace:beta.md");
    assert.match(privateProfile.persona, /You are beta/);
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

    const createIntent = inferScheduledTaskIntentFromText("创建一个每天早上8点30查询新闻要点的定时任务", { tasks });
    assert.equal(createIntent?.action, "create");
    assert.equal(createIntent?.args?.cronExpression, "30 8 * * *");
    assert.equal(createIntent?.args?.prompt, "查询新闻要点");

    const listIntent = inferScheduledTaskIntentFromText("当前有哪些定时任务", { tasks });
    assert.equal(listIntent?.action, "list");

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

  await runTest("scheduled task action reply appends refreshed list with creator column", async () => {
    const reply = formatScheduledTaskActionReply(
      { action: "delete", task: { name: "travel-task" } },
      { deleted: true },
      {
        tasks: [
          {
            id: "task-b",
            name: "weather-task",
            creatorType: "group",
            creatorId: "20003",
            enabled: true,
            cronExpression: "30 8 * * *",
            createdAt: 1712973600000,
            updatedAt: 1712977200000,
          },
        ],
      }
    );

    assert.equal(reply.includes("当前定时任务："), true);
    assert.equal(reply.includes("| 序号 | 任务 | 创建者 | 状态 | Cron |"), true);
    assert.equal(reply.includes("创建时间"), false);
    assert.equal(reply.includes("最后修改"), false);
    assert.equal(reply.includes("| 1 | weather-task | 群 20003 | 已启用 | 30 8 * * * |"), true);
  });

  await runTest("scheduled task run reply no longer appends task list", async () => {
    const reply = formatScheduledTaskActionReply(
      { action: "run", task: { name: "weather-task" } },
      { id: "task-b", name: "weather-task" },
      {
        tasks: [
          {
            id: "task-b",
            name: "weather-task",
            creatorType: "group",
            creatorId: "20003",
            enabled: true,
            cronExpression: "30 8 * * *",
          },
        ],
      }
    );

    assert.equal(reply, "已经立即执行定时任务：weather-task");
  });

  await runTest("qq can handle scheduled task actions directly by task index", async () => {
    const calls = [];
    const tasks = [
      { id: "task-a", name: "daily-report", creatorType: "group", creatorId: "20003", enabled: true, cronExpression: "0 9 * * *" },
      { id: "task-b", name: "weekly-report", creatorType: "group", creatorId: "20003", enabled: true, cronExpression: "0 18 * * 1" },
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
          return { id: args.id, name: "weekly-report" };
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
    assert.equal(sentMessages[0].message, "已经立即执行定时任务：weekly-report");
  });

  await runTest("qq group scheduled task list stays scoped to current group for admin actor", async () => {
    const calls = [];
    const tasks = [
      { id: "task-admin", name: "admin-private-task", creatorType: "private", creatorId: "1036986718", enabled: true, cronExpression: "0 8 * * *" },
      { id: "task-group-a", name: "group-20003-task", creatorType: "group", creatorId: "20003", enabled: true, cronExpression: "30 8 * * *" },
      { id: "task-group-b", name: "group-20004-task", creatorType: "group", creatorId: "20004", enabled: true, cronExpression: "45 8 * * *" },
    ];
    let currentExecuteToolCall = async (name, args = {}) => {
      calls.push({ name, args });
      if (name === "list_scheduled_tasks") {
        return {
          tasks: tasks.filter((task) => {
            const creatorType = String(args.creatorType || "").trim() || "private";
            const creatorId = String(args.creatorId || "").trim();
            if (!creatorId) {
              return true;
            }
            return task.creatorType === creatorType && task.creatorId === creatorId;
          }),
        };
      }
      return { name, args };
    };
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
      executeToolCall: (...args) => currentExecuteToolCall(...args),
      callLocalModelWithTools: async () => {
        throw new Error("Model should not be called for direct QQ scheduled task list");
      },
    });
    currentExecuteToolCall = qqModule.wrapToolExecutor(currentExecuteToolCall);
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "group",
      group_id: "20003",
      user_id: "1036986718",
      self_id: "999999",
      message: "当前有哪些定时任务",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "list_scheduled_tasks");
    assert.equal(calls[0].args.creatorType, "group");
    assert.equal(calls[0].args.creatorId, "20003");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message.includes("group-20003-task"), true);
    assert.equal(sentMessages[0].message.includes("admin-private-task"), false);
    assert.equal(sentMessages[0].message.includes("group-20004-task"), false);
  });

  await runTest("qq private admin scheduled task list shows all tasks and marks current qq creator", async () => {
    const calls = [];
    const tasks = [
      { id: "task-admin", name: "admin-private-task", creatorType: "private", creatorId: "1036986718", enabled: true, cronExpression: "0 8 * * *" },
      { id: "task-private-other", name: "other-private-task", creatorType: "private", creatorId: "55667788", enabled: true, cronExpression: "15 8 * * *" },
      { id: "task-group-a", name: "group-20003-task", creatorType: "group", creatorId: "20003", enabled: true, cronExpression: "30 8 * * *" },
    ];
    let currentExecuteToolCall = async (name, args = {}) => {
      calls.push({ name, args });
      if (name === "list_scheduled_tasks") {
        return { tasks };
      }
      return { name, args };
    };
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
      executeToolCall: (...args) => currentExecuteToolCall(...args),
      callLocalModelWithTools: async () => {
        throw new Error("Model should not be called for direct QQ scheduled task list");
      },
    });
    currentExecuteToolCall = qqModule.wrapToolExecutor(currentExecuteToolCall);
    await qqModule.loadQqBotConfig();
    await qqModule.loadQqBotSessions();

    const res = {};
    await qqModule.handleQqWebhook(createWebhookRequest({
      post_type: "message",
      message_type: "private",
      user_id: "1036986718",
      self_id: "999999",
      message: "当前有哪些定时任务",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "list_scheduled_tasks");
    assert.equal(calls[0].args.actorUserId, "1036986718");
    assert.equal(calls[0].args.creatorType, undefined);
    assert.equal(calls[0].args.creatorId, undefined);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message.includes("admin-private-task"), true);
    assert.equal(sentMessages[0].message.includes("other-private-task"), true);
    assert.equal(sentMessages[0].message.includes("group-20003-task"), true);
    assert.equal(sentMessages[0].message.includes("已用 [当前QQ] 标注当前 QQ 创建的任务。"), true);
    assert.equal(sentMessages[0].message.includes("QQ 1036986718 [当前QQ]"), true);
    assert.equal(sentMessages[0].message.includes("QQ 55667788 [当前QQ]"), false);
  });

  await runTest("qq can delete scheduled task directly with colloquial wording", async () => {
    const calls = [];
    let tasks = [
      { id: "task-a", name: "travel-task", creatorType: "private", creatorId: "1036986718", enabled: true, cronExpression: "20 8 * * *" },
      { id: "task-b", name: "weather-task", creatorType: "private", creatorId: "1036986718", enabled: true, cronExpression: "30 8 * * *" },
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
          return { id: args.id, name: "travel-task" };
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
    assert.equal(sentMessages[0].message.includes("创建者"), true);
    assert.equal(sentMessages[0].message.includes("创建时间"), false);
    assert.equal(sentMessages[0].message.includes("最后修改"), false);
    assert.equal(sentMessages[0].message.includes("| 1 | travel-task |"), false);
  });

  await runTest("qq can update scheduled task directly with natural language", async () => {
    const calls = [];
    let tasks = [
      { id: "task-a", name: "travel-task", prompt: "remind travel", creatorType: "group", creatorId: "20003", enabled: true, cronExpression: "20 8 * * *" },
      { id: "task-b", name: "weather-task", prompt: "remind weather", creatorType: "group", creatorId: "20003", enabled: true, cronExpression: "30 8 * * *" },
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
            name: "weekly-report-task",
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
    assert.equal(sentMessages[0].message.includes("当前 Cron"), true);
    assert.equal(sentMessages[0].message.includes("创建者"), true);
    assert.equal(sentMessages[0].message.includes("创建时间"), false);
    assert.equal(sentMessages[0].message.includes("最后修改"), false);
  });

  await runTest("novel module creates project structure and generated settings", async () => {
    const calls = [];
    const { novelModule, novelsDir } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        calls.push(purpose);
        return `# ${purpose}\n\n内容`;
      },
    });

    const detail = await novelModule.createProject({
      name: "星海余烬",
      genre: "玄幻",
      theme: "成长",
      autoGenerateSettings: true,
    });

    assert.equal(detail.project.name, "星海余烬");
    assert.equal(calls.includes("novel_setting_world"), true);
    const baseInfo = await readTextFile(path.join(novelsDir, detail.project.id, "settings", "base-info.md"), "");
    assert.equal(baseInfo.includes("星海余烬"), true);
  });

  await runTest("novel module generates draft chapter and supports approval", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        if (purpose === "novel_chapter") {
          return "# 第1章 星火初燃\n\n这是正文。";
        }
        if (purpose === "novel_summary") {
          return "# 摘要\n\n主角踏上旅程。";
        }
        if (purpose === "novel_snapshot") {
          return "# 状态快照\n\n主角：出发。";
        }
        return `# ${purpose}\n\n内容`;
      },
    });

    const detail = await novelModule.createProject({
      name: "长夜航灯",
      genre: "科幻",
      autoGenerateSettings: false,
    });

    await novelModule.generateChapter(detail.project.id);
    const projectAfterDraft = await novelModule.getProjectDetail(detail.project.id);
    assert.equal(projectAfterDraft.state.pendingDraftChapter, 1);

    await novelModule.approveChapter(detail.project.id, 1);
    const chapter = await novelModule.getChapterContent(detail.project.id, 1);
    const projectAfterApprove = await novelModule.getProjectDetail(detail.project.id);
    assert.equal(chapter.status, "approved");
    assert.equal(projectAfterApprove.state.lastApprovedChapter, 1);
  });

  await runTest("novel module supports batch generation with auto approval", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose, userPrompt }) => {
        if (purpose === "novel_chapter") {
          const match = String(userPrompt || "").match(/第\s+(\d+)\s+章/);
          const chapterNo = match?.[1] || "1";
          return `# 第${chapterNo}章 批量生成\n\n正文 ${chapterNo}`;
        }
        if (purpose === "novel_summary") {
          return "# 摘要\n\n摘要";
        }
        if (purpose === "novel_snapshot") {
          return "# 快照\n\n快照";
        }
        return `# ${purpose}\n\n内容`;
      },
    });

    const detail = await novelModule.createProject({
      name: "群星回响",
      genre: "奇幻",
      autoGenerateSettings: false,
    });

    const result = await novelModule.batchGenerateChapters(detail.project.id, {
      count: 2,
      autoApprove: true,
      stopOnReview: false,
    });
    const finalDetail = await novelModule.getProjectDetail(detail.project.id);

    assert.equal(result.generated.length, 2);
    assert.equal(finalDetail.state.lastApprovedChapter, 2);
    assert.equal(finalDetail.state.pendingDraftChapter, null);
  });

  await runTest("qq external handler can process novel review commands", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        if (purpose === "novel_chapter") {
          return "# 第1章 初章\n\n正文";
        }
        if (purpose === "novel_summary") {
          return "# 摘要\n\n摘要";
        }
        if (purpose === "novel_snapshot") {
          return "# 快照\n\n快照";
        }
        return `# ${purpose}\n\n内容`;
      },
    });

    const detail = await novelModule.createProject({
      name: "霜河纪",
      autoGenerateSettings: false,
    });
    await novelModule.generateChapter(detail.project.id);

    const reply = await novelModule.handleQqCommand({
      text: "通过 霜河纪 第1章",
    });

    assert.equal(reply.includes("已通过"), true);
  });

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
