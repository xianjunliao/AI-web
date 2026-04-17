const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const vm = require("node:vm");

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

function createMockJsonResponse(payload, statusCode = 200) {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    json: async () => payload,
  };
}

function createDomElement(tagName = "div") {
  const styleStore = {};
  const element = {
    tagName: String(tagName || "div").toUpperCase(),
    value: "",
    textContent: "",
    className: "",
    children: [],
    dataset: {},
    style: {
      setProperty(name, value) {
        styleStore[name] = value;
      },
      removeProperty(name) {
        delete styleStore[name];
      },
    },
    disabled: false,
    hidden: false,
    selectedIndex: 0,
    append(child) {
      this.children.push(child);
    },
    appendChild(child) {
      this.children.push(child);
    },
    close() {
      this.open = false;
    },
    showModal() {
      this.open = true;
    },
  };
  element.classList = {
    add(...tokens) {
      const classes = new Set(String(element.className || "").split(/\s+/).filter(Boolean));
      tokens.forEach((token) => {
        if (token) classes.add(token);
      });
      element.className = Array.from(classes).join(" ");
    },
    remove(...tokens) {
      const classes = new Set(String(element.className || "").split(/\s+/).filter(Boolean));
      tokens.forEach((token) => {
        classes.delete(token);
      });
      element.className = Array.from(classes).join(" ");
    },
    toggle(token, force) {
      const classes = new Set(String(element.className || "").split(/\s+/).filter(Boolean));
      const shouldHave = force === undefined ? !classes.has(token) : Boolean(force);
      if (shouldHave) classes.add(token);
      else classes.delete(token);
      element.className = Array.from(classes).join(" ");
      return shouldHave;
    },
    contains(token) {
      return String(element.className || "").split(/\s+/).filter(Boolean).includes(token);
    },
  };
  let innerHtmlValue = "";
  Object.defineProperty(element, "innerHTML", {
    get() {
      return innerHtmlValue;
    },
    set(value) {
      innerHtmlValue = String(value);
      if (!innerHtmlValue) {
        this.children = [];
      }
    },
    enumerable: true,
    configurable: true,
  });
  return element;
}

function createNovelsPageHarness(fetchImpl) {
  const scriptPath = path.join(__dirname, "..", "public", "novels.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const elements = new Map();
  const alerts = [];
  const confirms = [];
  const prompts = [];
  const localStorageStore = new Map();
  let confirmResult = true;
  let promptResult = null;

  const getElement = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, createDomElement());
    }
    return elements.get(selector);
  };

  const context = {
    console,
    document: {
      body: createDomElement("body"),
      hidden: false,
      querySelector: (selector) => getElement(selector),
      createElement: (tagName) => createDomElement(tagName),
      addEventListener: () => {},
    },
    fetch: async (url, options = {}) => {
      try {
        return await fetchImpl(url, options);
      } catch (error) {
        const method = String(options?.method || "GET").toUpperCase();
        if (url === "/connection-config" && method === "GET") {
          return createMockJsonResponse({ ok: true, config: { model: "" } });
        }
        throw error;
      }
    },
    alert: (message) => {
      alerts.push(String(message));
    },
    confirm: (message) => {
      confirms.push(String(message));
      return confirmResult;
    },
    prompt: (message, defaultValue) => {
      prompts.push({ message: String(message), defaultValue });
      return promptResult;
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: {
      getItem(key) {
        return localStorageStore.has(key) ? localStorageStore.get(key) : null;
      },
      setItem(key, value) {
        localStorageStore.set(key, String(value));
      },
      removeItem(key) {
        localStorageStore.delete(key);
      },
    },
  };

  context.window = {
    location: { href: "" },
    alert: context.alert,
    confirm: context.confirm,
    prompt: context.prompt,
    addEventListener: () => {},
  };

  vm.runInNewContext(script, context, { filename: scriptPath });

  return {
    alerts,
    confirms,
    prompts,
    getElement,
    setConfirmResult(value) {
      confirmResult = Boolean(value);
    },
    setPromptResult(value) {
      promptResult = value;
    },
    async flush(rounds = 6) {
      for (let index = 0; index < rounds; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

function seedNovelsPageButtonText(harness) {
  harness.getElement("#create-project").textContent = "+";
  harness.getElement("#empty-create-project").textContent = "新建项目";
  harness.getElement("#confirm-create").textContent = "创建并生成设定";
  harness.getElement("#open-chat").textContent = "返回聊天页";
  harness.getElement("#save-project").textContent = "保存";
  harness.getElement("#delete-project").textContent = "删除";
  harness.getElement("#save-setting").textContent = "保存当前设定";
  harness.getElement("#generate-settings").textContent = "重新生成设定";
  harness.getElement("#reconcile-settings").textContent = "按正文整理设定";
  harness.getElement("#batch-generate").textContent = "连续写作";
  harness.getElement("#generate-chapter").textContent = "生成下一章";
  harness.getElement("#delete-chapter").textContent = "删除当前章及后续";
  harness.getElement("#approve-chapter").textContent = "通过待审章";
  harness.getElement("#rewrite-chapter").textContent = "按意见重写";
  harness.getElement("#reader-prev").textContent = "上一章";
  harness.getElement("#reader-next").textContent = "下一章";
  harness.getElement("#reader-generate-next").textContent = "继续生成下一章";
  harness.getElement("#reader-regenerate-current").textContent = "重新生成当前章";
  harness.getElement("#reader-delete-chapter").textContent = "删除当前章及后续";
  harness.getElement("#reader-approve").textContent = "通过本章";
  harness.getElement("#reader-rewrite").textContent = "按意见重写";
  harness.getElement("#close-reader").textContent = "关闭阅读器";
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
      name: "鏃ユ姤鎺ㄩ€",
      prompt: "鐢熸垚鏃ユ姤",
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
      name: "鏃ユ姤鎺ㄩ€",
      prompt: "鐢熸垚鏃ユ姤",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "",
    }), /QQ target ID is required/);
  });

  await runTest("scheduled task sanitization strips legacy model field", async () => {
    const { scheduler } = createSchedulerHarness();
    const task = scheduler.sanitizeScheduledTask({
      name: "閺冦儲濮ら幒銊┾偓",
      prompt: "閻㈢喐鍨氶弮銉﹀Г",
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
        name: "鏃ユ姤鎺ㄩ€",
        prompt: "鐢熸垚鏃ユ姤",
        cronExpression: "0 9 * * *",
        enabled: true,
        qqPushEnabled: true,
        qqTargetType: "group",
        qqTargetId: "123456",
      }),
    ]);

    const sameTask = scheduler.findEquivalentScheduledTask({
      name: "鏃ユ姤鎺ㄩ€",
      prompt: "鐢熸垚鏃ユ姤",
      cronExpression: "0 9 * * *",
      qqPushEnabled: true,
      qqTargetType: "group",
      qqTargetId: "123456",
    });
    const differentTargetTask = scheduler.findEquivalentScheduledTask({
      name: "鏃ユ姤鎺ㄩ€",
      prompt: "鐢熸垚鏃ユ姤",
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
        name: "杈冩棭浠诲姟",
        prompt: "鏃т换鍔",
        cronExpression: "0 8 * * *",
        enabled: true,
        createdAt: 1712970000000,
        updatedAt: 1712970000000,
      }),
      scheduler.sanitizeScheduledTask({
        id: "task-new",
        name: "杈冩柊浠诲姟",
        prompt: "鏂颁换鍔",
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
    assert.equal(groupTasks[0].creatorLabel, "缇?20003");
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
      name: "閺冦儲濮ら幒銊┾偓",
      prompt: "閻㈢喐鍨氶弮銉﹀Г",
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
    assert.equal(groupTasks[0].creatorLabel, "缇?20003");
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
        prompt: "鐢ㄨ仈缃戞悳绱㈠伐鍏锋煡璇㈠浗鍐呭疄鏃剁儹鎼",
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
      prompt: "鐢ㄨ仈缃戞悳绱㈠伐鍏锋煡璇㈠浗鍐呭疄鏃剁儹鎼",
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
              title: "鍥藉唴鐑悳姒",
              url: "https://example.com/hot-search",
              snippet: "杩欐槸鏈€鏂扮殑鐑悳鎽樿",
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
      prompt: "鐢ㄨ仈缃戞悳绱㈠伐鍏锋煡璇㈠浗鍐呭疄鏃剁儹鎼",
    });

    assert.equal(modelCalled, false);
    assert.deepEqual(searchCalls, [{ query: "鍥藉唴瀹炴椂鐑悳", limit: 3 }]);
    assert.match(result, /鍥藉唴瀹炴椂鐑悳/);
    assert.match(result, /鍥藉唴鐑悳姒/);
  });

  await runTest("direct web search supports concise news briefing requests", async () => {
    const searchCalls = [];
    const result = await maybeRunDirectWebSearch({
      text: "甯垜鏁寸悊浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈",
      searchWeb: async (query, limit) => {
        searchCalls.push({ query, limit });
        return {
          query,
          results: [
            {
              title: "姣斾簹杩彂甯冩柊杞﹀瀷",
              url: "https://example.com/byd-1",
              snippet: "鏂拌溅鍨嬪彂甯冨苟鍏竷閰嶇疆涓庡敭浠蜂俊鎭",
            },
            {
              title: "姣斾簹杩竴瀛ｅ害閿€閲忓闀",
              url: "https://example.com/byd-2",
              snippet: "閿€閲忔暟鎹户缁蛋楂橈紝甯傚満鍏虫敞搴︿笂鍗",
            },
          ],
        };
      },
    });

    assert.deepEqual(searchCalls, [{ query: "浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈", limit: 4 }]);
    assert.equal(result?.mode, "brief");
    assert.match(result?.reply || "", /浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈/);
    assert.match(result?.reply || "", /姣斾簹杩彂甯冩柊杞﹀瀷/);
    assert.match(result?.reply || "", /瑕佺偣锛/);
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
              title: "姣斾簹杩彂甯冩柊杞﹀瀷",
              url: "https://example.com/byd-1",
              snippet: "鏂拌溅鍨嬪彂甯冨苟鍏竷閰嶇疆涓庡敭浠蜂俊鎭",
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
      prompt: "鏁寸悊浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈",
    });

    assert.equal(modelCalled, false);
    assert.deepEqual(searchCalls, [{ query: "浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈", limit: 4 }]);
    assert.match(result, /浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈/);
    assert.match(result, /姣斾簹杩彂甯冩柊杞﹀瀷/);
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
      prompt: "鎻愰啋鎴戝紑濮嬪伐浣",
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
      message: "浠嬬粛涓€涓嬩綘鐜板湪鑳藉仛浠€涔",
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
      message: "甯垜鎬荤粨涓€涓嬪浗鍐呭疄鏃剁儹鎼滃苟绠€瑕佸垎鏋",
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
                title: "鍥藉唴鐑悳姒",
                url: "https://example.com/hot-search",
                snippet: "杩欐槸鏈€鏂扮殑鐑悳鎽樿",
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
      message: "甯垜鏌ヤ笅鍥藉唴瀹炴椂鐑悳",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(modelCalled, false);
    assert.deepEqual(toolCalls, [
      { name: "web_search", args: { query: "鍥藉唴瀹炴椂鐑悳", limit: 3 } },
    ]);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /鍥藉唴瀹炴椂鐑悳/);
    assert.match(sentMessages[0].message, /鍥藉唴鐑悳姒/);
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
                title: "姣斾簹杩彂甯冩柊杞﹀瀷",
                url: "https://example.com/byd-1",
                snippet: "鏂拌溅鍨嬪彂甯冨苟鍏竷閰嶇疆涓庡敭浠蜂俊鎭",
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
      message: "甯垜鏁寸悊浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(modelCalled, false);
    assert.deepEqual(toolCalls, [
      { name: "web_search", args: { query: "浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈", limit: 4 } },
    ]);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /浠婂ぉ鍏充簬姣斾簹杩殑鏂伴椈/);
    assert.match(sentMessages[0].message, /姣斾簹杩彂甯冩柊杞﹀瀷/);
    assert.match(sentMessages[0].message, /瑕佺偣锛/);
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
      message: "妯″瀷鍒楄〃",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /褰撳墠鍙敤妯″瀷/);
    assert.match(sentMessages[0].message, /model-alpha锛堝綋鍓嶄娇鐢級/);
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
      message: "褰撳墠妯″瀷",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /褰撳墠妯″瀷/);
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
      message: "褰撳墠浜鸿",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /褰撳墠浜鸿/);
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
      message: "鍒囩2涓汉璁",
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
      message: "鍒囨崲浣跨敤妯″瀷 model-beta",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].message, /宸插垏鎹?QQ 褰撳墠浣跨敤妯″瀷/);
    assert.match(sentMessages[0].message, /褰撳墠妯″瀷锛歮odel-beta/);
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
      message: "鍒囩2涓ā鍨",
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
      message: "鍒囩2涓ā鍨",
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
      message: "鍒囩2涓ā鍨",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    if (sentMessages.length) {
      assert.match(sentMessages[0].message, /鏈巿鏉億瓒呯骇绠＄悊/);
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
      message: "鍒囩2涓汉璁",
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
      { id: "task-a", name: "鏃ユ姤鎺ㄩ€", enabled: true, cronExpression: "0 9 * * *" },
      { id: "task-b", name: "鍛ㄦ姤鎺ㄩ€", enabled: false, cronExpression: "0 18 * * 1" },
    ];

    const createIntent = inferScheduledTaskIntentFromText("鍒涘缓涓€涓瘡澶╂棭涓?鐐?0鏌ヨ鏂伴椈瑕佺偣鐨勫畾鏃朵换鍔", { tasks });
    assert.equal(createIntent?.action, "create");
    assert.equal(createIntent?.args?.cronExpression, "30 8 * * *");
    assert.equal(createIntent?.args?.prompt, "鏌ヨ鏂伴椈瑕佺偣");

    const listIntent = inferScheduledTaskIntentFromText("褰撳墠鏈夊摢浜涘畾鏃朵换鍔", { tasks });
    assert.equal(listIntent?.action, "list");

    const runIntent = inferScheduledTaskIntentFromText("绔嬪嵆鎵ц绗?涓畾鏃朵换鍔", { tasks });
    assert.equal(runIntent?.action, "run");
    assert.equal(runIntent?.args?.id, "task-b");

    const disableIntent = inferScheduledTaskIntentFromText("鏆傚仠绗竴涓换鍔", { tasks });
    assert.equal(disableIntent?.action, "disable");
    assert.equal(disableIntent?.args?.id, "task-a");

    const deleteIntent = inferScheduledTaskIntentFromText("鍒犳帀绗竴涓畾鏃朵换鍔", { tasks });
    assert.equal(deleteIntent?.action, "delete");
    assert.equal(deleteIntent?.args?.id, "task-a");

    const updateIntent = inferScheduledTaskIntentFromText("淇敼绗?涓换鍔′负姣忓ぉ9鐐规彁閱掓垜鍙戝懆鎶", { tasks });
    assert.equal(updateIntent?.action, "update");
    assert.equal(updateIntent?.args?.id, "task-b");
    assert.equal(updateIntent?.args?.cronExpression, "0 9 * * *");
    assert.equal(updateIntent?.args?.prompt, "鎻愰啋鎴戝彂鍛ㄦ姤");
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

    assert.equal(reply.includes("褰撳墠瀹氭椂浠诲姟锛"), true);
    assert.equal(reply.includes("| 搴忓彿 | 浠诲姟 | 鍒涘缓鑰?| 鐘舵€?| Cron |"), true);
    assert.equal(reply.includes("鍒涘缓鏃堕棿"), false);
    assert.equal(reply.includes("鏈€鍚庝慨鏀"), false);
    assert.equal(reply.includes("| 1 | weather-task | 缇?20003 | 宸插惎鐢?| 30 8 * * * |"), true);
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

    assert.equal(reply, "宸茬粡绔嬪嵆鎵ц瀹氭椂浠诲姟锛歸eather-task");
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
      message: "绔嬪嵆鎵ц绗?涓畾鏃朵换鍔",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "run_scheduled_task");
    assert.equal(calls[0].args.id, "task-b");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message, "宸茬粡绔嬪嵆鎵ц瀹氭椂浠诲姟锛歸eekly-report");
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
      message: "褰撳墠鏈夊摢浜涘畾鏃朵换鍔",
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
      message: "褰撳墠鏈夊摢浜涘畾鏃朵换鍔",
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
    assert.equal(sentMessages[0].message.includes("宸茬敤 [褰撳墠QQ] 鏍囨敞褰撳墠 QQ 鍒涘缓鐨勪换鍔°€"), true);
    assert.equal(sentMessages[0].message.includes("QQ 1036986718 [褰撳墠QQ]"), true);
    assert.equal(sentMessages[0].message.includes("QQ 55667788 [褰撳墠QQ]"), false);
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
      message: "鍒犳帀绗竴涓畾鏃朵换鍔",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "delete_scheduled_task");
    assert.equal(calls[0].args.id, "task-a");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message.includes("鍒涘缓鑰"), true);
    assert.equal(sentMessages[0].message.includes("鍒涘缓鏃堕棿"), false);
    assert.equal(sentMessages[0].message.includes("鏈€鍚庝慨鏀"), false);
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
      message: "淇敼绗?涓换鍔′负姣忓ぉ9鐐规彁閱掓垜鍙戝懆鎶",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "update_scheduled_task");
    assert.equal(calls[0].args.id, "task-b");
    assert.equal(calls[0].args.cronExpression, "0 9 * * *");
    assert.equal(calls[0].args.prompt, "鎻愰啋鎴戝彂鍛ㄦ姤");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].message.includes("褰撳墠 Cron"), true);
    assert.equal(sentMessages[0].message.includes("鍒涘缓鑰"), true);
    assert.equal(sentMessages[0].message.includes("鍒涘缓鏃堕棿"), false);
    assert.equal(sentMessages[0].message.includes("鏈€鍚庝慨鏀"), false);
  });

  await runTest("novels page keeps the workspace empty until a sidebar project is selected", async () => {
    const project = {
      id: "project-1",
      name: "project-one",
      genre: "ai-sci-fi",
      theme: "alignment",
      premise: "premise",
      targetChapters: 24,
      chapterWordTarget: 2600,
      stylePreference: "clean",
      audience: "general",
      protagonist: "engineer",
      keywords: ["ai", "robot"],
      notes: "notes",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };
    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter: 0,
            pendingDraftChapter: 0,
          }],
        });
      }
      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          project,
          state: {
            phase: "planning",
            currentChapter: 0,
            lastGeneratedChapter: 0,
            lastApprovedChapter: 0,
            pendingDraftChapter: null,
            autoWriteEnabled: false,
            autoWriteLastCount: 0,
          },
          review: { pending: [] },
          chapters: [{
            chapterNo: 1,
            status: "approved",
            title: "chapter one",
            characterCount: 1200,
          }],
          settings: {
            "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
          },
        });
      }
      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);

    assert.equal(harness.getElement("#empty-state").hidden, false);
    assert.equal(harness.getElement("#project-content").hidden, true);
    assert.equal(harness.getElement("#project-actions").hidden, true);
    assert.equal(harness.getElement("#project-title").textContent, "灏忚椤圭洰宸ュ潑");
    assert.equal(harness.getElement("#project-list").children.length, 1);

    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    assert.equal(harness.getElement("#empty-state").hidden, true);
    assert.equal(harness.getElement("#project-content").hidden, false);
    assert.equal(harness.getElement("#project-actions").hidden, false);
    assert.equal(harness.getElement("#project-title").textContent, "project-one");
    assert.equal(harness.getElement("#project-meta").textContent.includes("ai-sci-fi"), true);
    assert.equal(harness.getElement("#project-list").children.length, 1);
    assert.equal(harness.getElement("#chapter-list").children[0].innerHTML.includes("1200 姹夊瓧"), true);
  });

  await runTest("novels page shows the current model and refreshes sidebar preview while editing", async () => {
    const project = {
      id: "project-live-preview",
      name: "initial-project",
      genre: "科幻",
      theme: "旧主题",
      premise: "premise",
      targetChapters: 20,
      chapterWordTarget: 2800,
      stylePreference: "clean",
      audience: "general",
      protagonist: "lead",
      keywords: ["ai"],
      notes: "notes",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };
    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (url === "/connection-config" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          config: { model: "model-live-preview" },
        });
      }
      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            theme: project.theme,
            lastApprovedChapter: 1,
            pendingDraftChapter: 0,
          }],
        });
      }
      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          project,
          state: {
            phase: "planning",
            currentChapter: 1,
            lastGeneratedChapter: 1,
            lastApprovedChapter: 1,
            pendingDraftChapter: null,
            autoWriteEnabled: false,
            autoWriteLastCount: 0,
          },
          review: { pending: [] },
          chapters: [],
          settings: {
            "base-info": { key: "base-info", title: "基础信息" },
          },
        });
      }
      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(10);

    assert.equal(harness.getElement("#current-model-meta").textContent.includes("model-live-preview"), true);

    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    assert.equal(harness.getElement("#project-meta").textContent.includes("model-live-preview"), true);

    harness.getElement("#project-name").value = "draft-project-name";
    harness.getElement("#project-name").oninput();
    harness.getElement("#project-genre").value = "都市奇幻";
    harness.getElement("#project-genre").oninput();
    harness.getElement("#project-theme").value = "新主题";
    harness.getElement("#project-theme").oninput();

    assert.equal(harness.getElement("#project-title").textContent, "draft-project-name");
    assert.equal(harness.getElement("#project-meta").textContent.includes("都市奇幻"), true);
    assert.equal(harness.getElement("#project-meta").textContent.includes("新主题"), true);
    assert.equal(harness.getElement("#project-list-meta").textContent.includes("draft-project-name"), true);
    assert.equal(harness.getElement("#project-list").children[0].innerHTML.includes("draft-project-name"), true);
    assert.equal(harness.getElement("#project-list").children[0].innerHTML.includes("新主题"), true);
  });

  await runTest("novels page create flow shows progress, suppresses duplicate clicks, and waits for sidebar selection", async () => {
    const fetchCalls = [];
    let createdProject = null;
    let releaseCreateRequest;
    const createRequestGate = new Promise((resolve) => {
      releaseCreateRequest = resolve;
    });
    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      fetchCalls.push({ url, options: { ...options, method } });

      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: createdProject
            ? [{
              id: createdProject.id,
              name: createdProject.name,
              genre: createdProject.genre,
              lastApprovedChapter: 0,
              pendingDraftChapter: 0,
            }]
            : [],
        });
      }

      if (url === "/novels/projects" && method === "POST") {
        const payload = JSON.parse(String(options.body || "{}"));
        createdProject = {
          id: "project-2",
          name: payload.name,
          genre: payload.genre,
          theme: payload.theme,
          premise: payload.premise,
          targetChapters: payload.targetChapters,
          chapterWordTarget: payload.chapterWordTarget,
          stylePreference: payload.stylePreference,
          audience: payload.audience,
          protagonist: payload.protagonist,
          keywords: String(payload.keywords || "").split(/[锛?\s]+/).filter(Boolean),
          notes: payload.notes,
          qqReviewEnabled: payload.qqReviewEnabled,
          qqTargetType: payload.qqTargetType,
          qqTargetId: payload.qqTargetId,
        };
        await createRequestGate;
        return createMockJsonResponse({
          ok: true,
          project: { id: createdProject.id },
        });
      }

      if (url === "/novels/projects/project-2" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          project: createdProject,
          state: {
            phase: "planning",
            currentChapter: 0,
            lastGeneratedChapter: 0,
            lastApprovedChapter: 0,
            pendingDraftChapter: null,
            autoWriteEnabled: false,
            autoWriteLastCount: 0,
          },
          review: { pending: [] },
          chapters: [],
          settings: {
            "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
          },
        });
      }

      if (url === "/novels/projects/project-2/settings/base-info" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }

      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);

    await harness.getElement("#create-project").onclick();
    assert.equal(Boolean(harness.getElement("#project-dialog").open), true);

    harness.getElement("#new-name").value = "new-project";
    harness.getElement("#new-genre").value = "ai-sci-fi";
    harness.getElement("#new-chapter-word-target").value = "2800";
    harness.getElement("#new-notes").value = "create dialog notes";
    harness.getElement("#new-qq-enabled").value = "true";
    harness.getElement("#new-qq-type").value = "group";
    harness.getElement("#new-qq-id").value = "123456";

    const firstCreate = harness.getElement("#confirm-create").onclick({ preventDefault() {} });
    await harness.flush(2);
    harness.getElement("#confirm-create").onclick({ preventDefault() {} });

    const postCalls = fetchCalls.filter((call) => call.url === "/novels/projects" && call.options.method === "POST");
    assert.equal(postCalls.length, 1);
    assert.equal(harness.getElement("#confirm-create").disabled, true);
    assert.equal(harness.getElement("#confirm-create").textContent, "鍒涘缓涓?..");
    assert.equal(harness.getElement("#create-operation-feedback").hidden, false);
    assert.equal(harness.getElement("#operation-feedback").hidden, true);
    assert.equal(harness.getElement("#project-content").hidden, true);

    releaseCreateRequest();
    await firstCreate;
    await harness.flush(12);

    assert.equal(JSON.parse(String(postCalls[0].options.body || "{}")).name, "new-project");
    assert.equal(JSON.parse(String(postCalls[0].options.body || "{}")).chapterWordTarget, 2800);
    assert.equal(JSON.parse(String(postCalls[0].options.body || "{}")).notes, "create dialog notes");
    assert.equal(JSON.parse(String(postCalls[0].options.body || "{}")).qqReviewEnabled, true);
    assert.equal(JSON.parse(String(postCalls[0].options.body || "{}")).qqTargetType, "group");
    assert.equal(JSON.parse(String(postCalls[0].options.body || "{}")).qqTargetId, "123456");
    assert.equal(harness.getElement("#project-title").textContent, "灏忚椤圭洰宸ュ潑");
    assert.equal(harness.getElement("#empty-state").hidden, false);
    assert.equal(harness.getElement("#project-content").hidden, true);
    assert.equal(harness.getElement("#project-list").children.length, 1);
    assert.equal(harness.getElement("#confirm-create").disabled, false);
    assert.equal(harness.getElement("#confirm-create").textContent, "鍒涘缓骞剁敓鎴愯瀹");
    assert.equal(Boolean(harness.getElement("#project-dialog").open), false);
    assert.equal(harness.getElement("#create-operation-feedback").hidden, true);

    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    assert.equal(harness.getElement("#project-title").textContent, "new-project");
    assert.equal(harness.getElement("#project-content").hidden, false);
    assert.equal(harness.getElement("#empty-state").hidden, true);
    assert.equal(harness.alerts.length, 0);
  });

  await runTest("novels page create dialog confirms before closing", async () => {
    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [],
        });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);

    await harness.getElement("#create-project").onclick();
    assert.equal(Boolean(harness.getElement("#project-dialog").open), true);

    harness.getElement("#new-name").value = "draft-project";
    harness.setConfirmResult(false);
    harness.getElement("#cancel-create").onclick({ preventDefault() {} });

    assert.equal(harness.confirms.length, 1);
    assert.equal(Boolean(harness.getElement("#project-dialog").open), true);
    assert.equal(harness.getElement("#new-name").value, "draft-project");

    harness.setConfirmResult(true);
    harness.getElement("#project-dialog").oncancel({ preventDefault() {} });

    assert.equal(harness.confirms.length, 2);
    assert.equal(Boolean(harness.getElement("#project-dialog").open), false);
    assert.equal(harness.getElement("#new-name").value, "");

    await harness.getElement("#create-project").onclick();
    harness.getElement("#new-name").value = "draft-two";
    harness.getElement("#close-create-dialog").onclick({ preventDefault() {} });

    assert.equal(harness.confirms.length, 3);
    assert.equal(Boolean(harness.getElement("#project-dialog").open), false);
    assert.equal(harness.getElement("#new-name").value, "");
  });

  await runTest("novels page project info and settings support collapsing", async () => {
    const project = {
      id: "project-collapse",
      name: "collapse-target",
      genre: "ai-sci-fi",
      theme: "theme",
      premise: "premise",
      targetChapters: 16,
      stylePreference: "clean",
      audience: "general",
      protagonist: "lead",
      keywords: ["ai"],
      notes: "note",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter: 0,
            pendingDraftChapter: 0,
          }],
        });
      }
      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          project,
          state: {
            phase: "planning",
            currentChapter: 0,
            lastGeneratedChapter: 0,
            lastApprovedChapter: 0,
            pendingDraftChapter: null,
            autoWriteEnabled: false,
            autoWriteLastCount: 0,
          },
          review: { pending: [] },
          chapters: [],
          settings: {
            "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
          },
        });
      }
      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    assert.equal(harness.getElement("#project-info-body").hidden, false);
    assert.equal(harness.getElement("#settings-body").hidden, false);
    assert.equal(harness.getElement("#toggle-project-info").textContent, "鎶樺彔");
    assert.equal(harness.getElement("#toggle-settings").textContent, "鎶樺彔");

    harness.getElement("#toggle-project-info").onclick();
    harness.getElement("#toggle-settings").onclick();

    assert.equal(harness.getElement("#project-info-body").hidden, true);
    assert.equal(harness.getElement("#settings-body").hidden, true);
    assert.equal(harness.getElement("#toggle-project-info").textContent, "灞曞紑");
    assert.equal(harness.getElement("#toggle-settings").textContent, "灞曞紑");
    assert.equal(String(harness.getElement("#project-info-panel").className).includes("is-collapsed"), true);
    assert.equal(String(harness.getElement("#settings-panel").className).includes("is-collapsed"), true);

    harness.getElement("#toggle-project-info").onclick();
    harness.getElement("#toggle-settings").onclick();

    assert.equal(harness.getElement("#project-info-body").hidden, false);
    assert.equal(harness.getElement("#settings-body").hidden, false);
    assert.equal(harness.getElement("#toggle-project-info").textContent, "鎶樺彔");
    assert.equal(harness.getElement("#toggle-settings").textContent, "鎶樺彔");
  });

  await runTest("novels page reader opens on double click and supports chapter navigation", async () => {
    const project = {
      id: "project-reader",
      name: "reader-target",
      genre: "ai-sci-fi",
      theme: "theme",
      premise: "premise",
      targetChapters: 12,
      chapterWordTarget: 2600,
      stylePreference: "clean",
      audience: "general",
      protagonist: "lead",
      keywords: ["ai"],
      notes: "",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };

    const chapterContents = {
      1: { title: "绗?1 绔?璧峰", content: "# 绗?1 绔?璧峰\n\n绗竴绔犲唴瀹", characterCount: 1200 },
      2: { title: "绗?2 绔?杩涘睍", content: "# 绗?2 绔?杩涘睍\n\n绗簩绔犲唴瀹", characterCount: 1800 },
      3: { title: "绗?3 绔?浣欐尝", content: "# 绗?3 绔?浣欐尝\n\n绗笁绔犲唴瀹", characterCount: 1500 },
    };

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter: 2,
            pendingDraftChapter: 0,
          }],
        });
      }
      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          project,
          state: {
            phase: "planning",
            currentChapter: 3,
            lastGeneratedChapter: 3,
            lastApprovedChapter: 2,
            pendingDraftChapter: null,
            autoWriteEnabled: false,
            autoWriteLastCount: 0,
          },
          review: { pending: [] },
          chapters: [
            { chapterNo: 1, status: "approved", title: chapterContents[1].title, characterCount: chapterContents[1].characterCount },
            { chapterNo: 2, status: "approved", title: chapterContents[2].title, characterCount: chapterContents[2].characterCount },
            { chapterNo: 3, status: "draft", title: chapterContents[3].title, characterCount: chapterContents[3].characterCount },
          ],
          settings: {
            "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
          },
        });
      }
      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }
      const chapterMatch = url.match(/\/novels\/projects\/project-reader\/chapters\/(\d+)$/);
      if (chapterMatch && method === "GET") {
        const chapterNo = Number(chapterMatch[1]);
        const chapter = chapterContents[chapterNo];
        return createMockJsonResponse({
          ok: true,
          chapterNo,
          status: chapterNo === 3 ? "draft" : "approved",
          title: chapter.title,
          content: chapter.content,
          characterCount: chapter.characterCount,
        });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);
    await harness.getElement("#chapter-list").children[0].onclick();
    await harness.flush(8);

    assert.equal(harness.getElement("#chapter-viewer").value, chapterContents[1].content);

    await harness.getElement("#chapter-viewer").ondblclick();
    assert.equal(Boolean(harness.getElement("#chapter-reader-dialog").open), true);
    assert.equal(harness.getElement("#reader-title").textContent, chapterContents[1].title);
    assert.equal(harness.getElement("#reader-content").textContent.includes("绗竴绔犲唴瀹"), true);
    assert.equal(harness.getElement("#reader-prev").disabled, true);
    assert.equal(harness.getElement("#reader-next").disabled, false);

    await harness.getElement("#reader-next").onclick();
    await harness.flush(8);

    assert.equal(harness.getElement("#reader-title").textContent, chapterContents[2].title);
    assert.equal(harness.getElement("#reader-content").textContent.includes("绗簩绔犲唴瀹"), true);
    assert.equal(harness.getElement("#reader-prev").disabled, false);
    assert.equal(harness.getElement("#reader-next").disabled, false);

    await harness.getElement("#reader-next").onclick();
    await harness.flush(8);

    assert.equal(harness.getElement("#reader-title").textContent, chapterContents[3].title);
    assert.equal(harness.getElement("#reader-content").textContent.includes("绗笁绔犲唴瀹"), true);
    assert.equal(harness.getElement("#reader-next").disabled, true);

    harness.getElement("#close-reader").onclick();
    assert.equal(Boolean(harness.getElement("#chapter-reader-dialog").open), false);
  });

  await runTest("novels page reader supports reviewing the pending draft chapter", async () => {
    const fetchCalls = [];
    const project = {
      id: "project-reader-review",
      name: "reader-review-target",
      genre: "ai-sci-fi",
      theme: "theme",
      premise: "premise",
      targetChapters: 12,
      chapterWordTarget: 2600,
      stylePreference: "clean",
      audience: "general",
      protagonist: "lead",
      keywords: ["ai"],
      notes: "",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };
    let pendingDraftChapter = 2;
    const chapterContents = {
      1: { title: "绗?1 绔?宸查€氳繃", content: "# 绗?1 绔?宸查€氳繃\n\n绗竴绔犲唴瀹", characterCount: 1200, status: "approved" },
      2: { title: "绗?2 绔?鑽夌", content: "# 绗?2 绔?鑽夌\n\n鏃ц崏绋垮唴瀹", characterCount: 1400, status: "draft" },
    };

    const createDetailResponse = () => ({
      ok: true,
      project,
      state: {
        phase: "planning",
        currentChapter: 2,
        lastGeneratedChapter: 2,
        lastApprovedChapter: 1,
        pendingDraftChapter,
        autoWriteEnabled: false,
        autoWriteLastCount: 0,
      },
      review: {
        pending: pendingDraftChapter ? [{ chapterNo: 2, title: chapterContents[2].title }] : [],
      },
      chapters: [
        { chapterNo: 1, status: chapterContents[1].status, title: chapterContents[1].title, characterCount: chapterContents[1].characterCount },
        { chapterNo: 2, status: chapterContents[2].status, title: chapterContents[2].title, characterCount: chapterContents[2].characterCount },
      ],
      settings: {
        "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
      },
    });

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      fetchCalls.push({ url, options: { ...options, method } });

      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter: 1,
            pendingDraftChapter,
          }],
        });
      }
      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse(createDetailResponse());
      }
      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }
      const chapterMatch = url.match(/\/novels\/projects\/project-reader-review\/chapters\/(\d+)$/);
      if (chapterMatch && method === "GET") {
        const chapterNo = Number(chapterMatch[1]);
        const chapter = chapterContents[chapterNo];
        return createMockJsonResponse({
          ok: true,
          chapterNo,
          status: chapter.status,
          title: chapter.title,
          content: chapter.content,
          characterCount: chapter.characterCount,
        });
      }
      if (url === `/novels/projects/${project.id}/chapters/2/rewrite` && method === "POST") {
        const payload = JSON.parse(String(options.body || "{}"));
        chapterContents[2] = {
          title: "绗?2 绔?鑽夌锛堥噸鍐欙級",
          content: "# 绗?2 绔?鑽夌锛堥噸鍐欙級\n\n鏂拌崏绋垮唴瀹",
          characterCount: 1680,
          status: "draft",
        };
        assert.equal(payload.feedback, "鍔犲己鍐茬獊");
        return createMockJsonResponse({ ok: true, chapterNo: 2 });
      }
      if (url === `/novels/projects/${project.id}/chapters/2/approve` && method === "POST") {
        chapterContents[2] = {
          ...chapterContents[2],
          status: "approved",
        };
        pendingDraftChapter = 0;
        return createMockJsonResponse({ ok: true, chapterNo: 2 });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);
    await harness.getElement("#chapter-list").children[1].onclick();
    await harness.flush(8);

    await harness.getElement("#chapter-viewer").ondblclick();
    assert.equal(Boolean(harness.getElement("#chapter-reader-dialog").open), true);
    assert.equal(harness.getElement("#reader-review-body").hidden, true);
    const initialReviewToggleText = harness.getElement("#toggle-reader-review").textContent;
    assert.equal(Boolean(initialReviewToggleText), true);
    harness.getElement("#toggle-reader-review").onclick();
    assert.equal(harness.getElement("#reader-review-body").hidden, false);
    assert.notEqual(harness.getElement("#toggle-reader-review").textContent, initialReviewToggleText);
    assert.equal(harness.getElement("#reader-approve").disabled, false);
    assert.equal(harness.getElement("#reader-rewrite").disabled, false);

    harness.getElement("#reader-review-feedback").value = "鍔犲己鍐茬獊";
    harness.getElement("#reader-review-feedback").oninput();

    await harness.getElement("#reader-rewrite").onclick();
    await harness.flush(10);

    const rewriteCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/2/rewrite` && call.options.method === "POST");
    assert.equal(rewriteCalls.length, 1);
    assert.equal(harness.getElement("#reader-content").textContent.includes("鏂拌崏绋垮唴瀹"), true);
    assert.equal(harness.getElement("#chapter-viewer").value, chapterContents[2].content);
    assert.equal(harness.getElement("#reader-approve").disabled, false);

    await harness.getElement("#reader-approve").onclick();
    await harness.flush(10);

    const approveCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/2/approve` && call.options.method === "POST");
    assert.equal(approveCalls.length, 1);
    assert.equal(harness.getElement("#reader-meta").textContent.includes("approved"), true);
    assert.equal(harness.getElement("#reader-approve").disabled, true);
    assert.equal(harness.getElement("#reader-rewrite").disabled, true);
  });

  await runTest("novels page reader can continue writing and regenerate the current chapter", async () => {
    const fetchCalls = [];
    const project = {
      id: "project-reader-actions",
      name: "reader-actions-target",
      genre: "ai-sci-fi",
      theme: "theme",
      premise: "premise",
      targetChapters: 12,
      chapterWordTarget: 2600,
      stylePreference: "clean",
      audience: "general",
      protagonist: "lead",
      keywords: ["ai"],
      notes: "",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };
    let lastApprovedChapter = 1;
    let pendingDraftChapter = 2;
    let lastGeneratedChapter = 2;
    const chapterContents = {
      1: { title: "Chapter 1 Approved", content: "# Chapter 1 Approved\n\nchapter one approved body", characterCount: 1200, status: "approved" },
      2: { title: "Chapter 2 Draft", content: "# Chapter 2 Draft\n\nchapter two draft body", characterCount: 1400, status: "draft" },
    };

    const createDetailResponse = () => ({
      ok: true,
      project,
      state: {
        phase: "planning",
        currentChapter: lastGeneratedChapter,
        lastGeneratedChapter,
        lastApprovedChapter,
        pendingDraftChapter,
        autoWriteEnabled: false,
        autoWriteLastCount: 0,
      },
      review: {
        pending: pendingDraftChapter ? [{ chapterNo: pendingDraftChapter, title: chapterContents[pendingDraftChapter].title }] : [],
      },
      chapters: Object.entries(chapterContents)
        .map(([chapterNo, chapter]) => ({
          chapterNo: Number(chapterNo),
          status: chapter.status,
          title: chapter.title,
          characterCount: chapter.characterCount,
        }))
        .sort((a, b) => a.chapterNo - b.chapterNo),
      settings: {
        "base-info": { key: "base-info", title: "閸╄櫣顢呮穱鈩冧紖" },
      },
    });

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      fetchCalls.push({ url, options: { ...options, method } });

      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter,
            pendingDraftChapter,
          }],
        });
      }
      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse(createDetailResponse());
      }
      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }
      const chapterMatch = url.match(/\/novels\/projects\/project-reader-actions\/chapters\/(\d+)$/);
      if (chapterMatch && method === "GET") {
        const chapterNo = Number(chapterMatch[1]);
        const chapter = chapterContents[chapterNo];
        return createMockJsonResponse({
          ok: true,
          chapterNo,
          status: chapter.status,
          title: chapter.title,
          content: chapter.content,
          characterCount: chapter.characterCount,
        });
      }
      if (url === `/novels/projects/${project.id}/chapters/2/approve` && method === "POST") {
        chapterContents[2] = {
          ...chapterContents[2],
          status: "approved",
        };
        lastApprovedChapter = 2;
        pendingDraftChapter = 0;
        return createMockJsonResponse({ ok: true, chapterNo: 2 });
      }
      if (url === `/novels/projects/${project.id}/chapters/generate-next` && method === "POST") {
        chapterContents[3] = {
          title: "Chapter 3 Draft",
          content: "# Chapter 3 Draft\n\nchapter three fresh draft",
          characterCount: 1660,
          status: "draft",
        };
        lastGeneratedChapter = 3;
        pendingDraftChapter = 3;
        return createMockJsonResponse({
          ok: true,
          chapterNo: 3,
          title: chapterContents[3].title,
          draft: chapterContents[3].content,
        });
      }
      if (url === `/novels/projects/${project.id}/chapters/3/regenerate` && method === "POST") {
        chapterContents[3] = {
          title: "Chapter 3 Draft Regenerated",
          content: "# Chapter 3 Draft Regenerated\n\nchapter three regenerated draft",
          characterCount: 1740,
          status: "draft",
        };
        return createMockJsonResponse({
          ok: true,
          chapterNo: 3,
          title: chapterContents[3].title,
          draft: chapterContents[3].content,
        });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);
    await harness.getElement("#chapter-list").children[1].onclick();
    await harness.flush(8);

    await harness.getElement("#chapter-viewer").ondblclick();
    assert.equal(Boolean(harness.getElement("#chapter-reader-dialog").open), true);
    harness.getElement("#toggle-reader-review").onclick();
    assert.equal(harness.getElement("#reader-review-body").hidden, false);

    const continueFirst = harness.getElement("#reader-generate-next").onclick();
    const continueSecond = harness.getElement("#reader-generate-next").onclick();
    await Promise.all([continueFirst, continueSecond]);
    await harness.flush(12);

    const approveCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/2/approve` && call.options.method === "POST");
    const continueCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/generate-next` && call.options.method === "POST");
    assert.equal(approveCalls.length, 1);
    assert.equal(continueCalls.length, 1);
    assert.equal(harness.getElement("#reader-title").textContent, chapterContents[3].title);
    assert.equal(harness.getElement("#reader-content").textContent.includes("chapter three fresh draft"), true);
    assert.equal(harness.getElement("#chapter-viewer").value, chapterContents[3].content);
    assert.equal(harness.getElement("#reader-review-body").hidden, true);
    assert.equal(harness.getElement("#reader-approve").disabled, false);

    harness.getElement("#toggle-reader-review").onclick();
    assert.equal(harness.getElement("#reader-review-body").hidden, false);

    const regenerateFirst = harness.getElement("#reader-regenerate-current").onclick();
    const regenerateSecond = harness.getElement("#reader-regenerate-current").onclick();
    await Promise.all([regenerateFirst, regenerateSecond]);
    await harness.flush(12);

    const regenerateCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/3/regenerate` && call.options.method === "POST");
    assert.equal(regenerateCalls.length, 1);
    assert.equal(harness.getElement("#reader-title").textContent, chapterContents[3].title);
    assert.equal(harness.getElement("#reader-content").textContent.includes("chapter three regenerated draft"), true);
    assert.equal(harness.getElement("#chapter-viewer").value, chapterContents[3].content);
    assert.equal(harness.getElement("#reader-review-body").hidden, true);
  });

  await runTest("novels page save shows progress and suppresses duplicate saves", async () => {
    const fetchCalls = [];
    let releaseSaveRequest;
    const saveRequestGate = new Promise((resolve) => {
      releaseSaveRequest = resolve;
    });
    let project = {
      id: "project-save",
      name: "save-target",
      genre: "initial",
      theme: "theme",
      premise: "premise",
      targetChapters: 18,
      chapterWordTarget: 2200,
      stylePreference: "clean",
      audience: "general",
      protagonist: "lead",
      keywords: ["ai"],
      notes: "note",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      fetchCalls.push({ url, options: { ...options, method } });

      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter: 0,
            pendingDraftChapter: 0,
          }],
        });
      }

      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          project,
          state: {
            phase: "planning",
            currentChapter: 0,
            lastGeneratedChapter: 0,
            lastApprovedChapter: 0,
            pendingDraftChapter: null,
            autoWriteEnabled: false,
            autoWriteLastCount: 0,
          },
          review: { pending: [] },
          chapters: [],
          settings: {
            "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
          },
        });
      }

      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }

      if (url === `/novels/projects/${project.id}` && method === "PUT") {
        const payload = JSON.parse(String(options.body || "{}"));
        await saveRequestGate;
        project = {
          ...project,
          ...payload,
          keywords: String(payload.keywords || "").split(/[锛?\s]+/).filter(Boolean),
        };
        return createMockJsonResponse({ ok: true });
      }

      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    harness.getElement("#project-genre").value = "updated-genre";
    harness.getElement("#project-chapter-word-target").value = "3200";

    const firstSave = harness.getElement("#save-project").onclick();
    await harness.flush(2);
    harness.getElement("#save-project").onclick();

    const putCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}` && call.options.method === "PUT");
    assert.equal(putCalls.length, 1);
    assert.equal(harness.getElement("#save-project").disabled, true);
    assert.equal(harness.getElement("#save-project").textContent, "淇濆瓨涓?..");
    assert.equal(harness.getElement("#operation-feedback").hidden, false);
    assert.equal(harness.getElement("#create-operation-feedback").hidden, true);

    releaseSaveRequest();
    await firstSave;
    await harness.flush(12);

    assert.equal(JSON.parse(String(putCalls[0].options.body || "{}")).genre, "updated-genre");
    assert.equal(JSON.parse(String(putCalls[0].options.body || "{}")).chapterWordTarget, 3200);
    assert.equal(harness.getElement("#save-project").disabled, false);
    assert.equal(harness.getElement("#save-project").textContent, "淇濆瓨");
    assert.equal(harness.getElement("#project-title").textContent, "save-target");
    assert.equal(harness.getElement("#project-meta").textContent.includes("updated-genre"), true);
  });

  await runTest("novels page generation actions show progress and suppress duplicate requests", async () => {
    const fetchCalls = [];
    let releaseSettingsRequest;
    let releaseChapterRequest;
    let releaseBatchRequest;
    const settingsGate = new Promise((resolve) => {
      releaseSettingsRequest = resolve;
    });
    const chapterGate = new Promise((resolve) => {
      releaseChapterRequest = resolve;
    });
    const batchGate = new Promise((resolve) => {
      releaseBatchRequest = resolve;
    });
    const project = {
      id: "project-gen",
      name: "generator",
      genre: "ai-sci-fi",
      theme: "alignment",
      premise: "premise",
      targetChapters: 20,
      chapterWordTarget: 2400,
      stylePreference: "clean",
      audience: "general",
      protagonist: "engineer",
      keywords: ["ai"],
      notes: "",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };

    const createDetailResponse = () => ({
      ok: true,
      project,
      state: {
        phase: "planning",
        currentChapter: 2,
        lastGeneratedChapter: 2,
        lastApprovedChapter: 1,
        pendingDraftChapter: null,
        autoWriteEnabled: false,
        autoWriteLastCount: 0,
      },
      review: { pending: [] },
      chapters: [{
        chapterNo: 1,
        status: "approved",
        title: "chapter one",
        characterCount: 900,
      }],
      settings: {
        "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
      },
    });

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      fetchCalls.push({ url, options: { ...options, method } });

      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter: 1,
            pendingDraftChapter: 0,
          }],
        });
      }

      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse(createDetailResponse());
      }

      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }

      if (url === `/novels/projects/${project.id}/generate-settings` && method === "POST") {
        await settingsGate;
        return createMockJsonResponse({ ok: true });
      }

      if (url === `/novels/projects/${project.id}/chapters/generate-next` && method === "POST") {
        await chapterGate;
        return createMockJsonResponse({
          ok: true,
          draft: "generated next chapter",
        });
      }

      if (url === `/novels/projects/${project.id}/chapters/batch-generate` && method === "POST") {
        await batchGate;
        return createMockJsonResponse({
          ok: true,
          generated: [{ chapterNo: 3 }],
          haltedReason: "",
        });
      }

      if (url === `/novels/projects/${project.id}/chapters/3` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          content: "batch generated chapter",
        });
      }

      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    const firstSettings = harness.getElement("#generate-settings").onclick();
    await harness.flush(2);
    harness.getElement("#generate-settings").onclick();

    const settingsCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/generate-settings` && call.options.method === "POST");
    assert.equal(settingsCalls.length, 1);
    assert.equal(harness.getElement("#generate-settings").disabled, true);
    assert.equal(harness.getElement("#generate-settings").textContent, "鐢熸垚涓?..");
    assert.equal(harness.getElement("#operation-feedback").hidden, false);

    releaseSettingsRequest();
    await firstSettings;
    await harness.flush(12);

    assert.equal(harness.getElement("#generate-settings").disabled, false);
    assert.equal(harness.getElement("#generate-settings").textContent, "閲嶆柊鐢熸垚璁惧畾");
    assert.equal(harness.getElement("#operation-feedback").hidden, true);

    const firstChapter = harness.getElement("#generate-chapter").onclick();
    await harness.flush(2);
    harness.getElement("#generate-chapter").onclick();

    const chapterCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/generate-next` && call.options.method === "POST");
    assert.equal(chapterCalls.length, 1);
    assert.equal(harness.getElement("#generate-chapter").disabled, true);
    assert.equal(harness.getElement("#generate-chapter").textContent, "鐢熸垚涓?..");
    assert.equal(harness.getElement("#operation-feedback").hidden, false);

    releaseChapterRequest();
    await firstChapter;
    await harness.flush(12);

    assert.equal(harness.getElement("#generate-chapter").disabled, false);
    assert.equal(harness.getElement("#generate-chapter").textContent, "鐢熸垚涓嬩竴绔");
    assert.equal(harness.getElement("#chapter-viewer").value, "generated next chapter");

    harness.setPromptResult("2");
    harness.setConfirmResult(true);
    const firstBatch = harness.getElement("#batch-generate").onclick();
    await harness.flush(2);
    harness.getElement("#batch-generate").onclick();

    const batchCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/batch-generate` && call.options.method === "POST");
    assert.equal(batchCalls.length, 1);
    assert.equal(JSON.parse(String(batchCalls[0].options.body || "{}")).count, 2);
    assert.equal(JSON.parse(String(batchCalls[0].options.body || "{}")).autoApprove, true);
    assert.equal(harness.prompts.length, 1);
    assert.equal(harness.confirms.length, 1);
    assert.equal(harness.getElement("#batch-generate").disabled, true);
    assert.equal(harness.getElement("#batch-generate").textContent, "鍐欎綔涓?..");
    assert.equal(harness.getElement("#operation-feedback").hidden, false);

    releaseBatchRequest();
    await firstBatch;
    await harness.flush(12);

    assert.equal(harness.getElement("#batch-generate").disabled, false);
    assert.equal(harness.getElement("#batch-generate").textContent, "杩炵画鍐欎綔");
    assert.equal(harness.getElement("#chapter-viewer").value, "batch generated chapter");
    assert.equal(harness.alerts.length, 1);
    assert.equal(harness.alerts[0].includes("宸插鐞?1 绔"), true);
  });

  await runTest("novels page can reconcile settings from written chapters", async () => {
    const fetchCalls = [];
    let releaseReconcileRequest;
    const reconcileGate = new Promise((resolve) => {
      releaseReconcileRequest = resolve;
    });
    const project = {
      id: "project-reconcile-settings",
      name: "reconcile-settings-target",
      genre: "ai-sci-fi",
      theme: "alignment",
      premise: "premise",
      targetChapters: 20,
      chapterWordTarget: 2400,
      stylePreference: "clean",
      audience: "general",
      protagonist: "engineer",
      keywords: ["ai"],
      notes: "",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };

    const createDetailResponse = () => ({
      ok: true,
      project,
      state: {
        phase: "review",
        currentChapter: 1,
        lastGeneratedChapter: 1,
        lastApprovedChapter: 0,
        pendingDraftChapter: 1,
        autoWriteEnabled: false,
        autoWriteLastCount: 0,
      },
      review: { pending: [{ chapterNo: 1, title: "chapter one draft" }] },
      chapters: [{
        chapterNo: 1,
        status: "draft",
        title: "chapter one draft",
        characterCount: 1400,
      }],
      settings: {
        "base-info": { key: "base-info", title: "閸╄櫣顢呮穱鈩冧紖" },
        "chapter-plan": { key: "chapter-plan", title: "缁旂姾濡紒鍡欑堪" },
      },
    });

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      fetchCalls.push({ url, options: { ...options, method } });

      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter: 0,
            pendingDraftChapter: 1,
          }],
        });
      }

      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse(createDetailResponse());
      }

      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }

      if (url === `/novels/projects/${project.id}/reconcile-settings` && method === "POST") {
        await reconcileGate;
        return createMockJsonResponse({
          ok: true,
          projectId: project.id,
          generated: {
            world: "# world\n\nreconciled",
          },
        });
      }

      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    harness.setConfirmResult(true);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    const firstReconcile = harness.getElement("#reconcile-settings").onclick();
    await harness.flush(2);
    harness.getElement("#reconcile-settings").onclick();

    const reconcileCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/reconcile-settings` && call.options.method === "POST");
    assert.equal(reconcileCalls.length, 1);
    assert.equal(harness.confirms.length, 1);
    assert.equal(harness.getElement("#reconcile-settings").disabled, true);
    assert.equal(harness.getElement("#reconcile-settings").textContent, "鏁寸悊涓?..");
    assert.equal(harness.getElement("#operation-feedback").hidden, false);

    releaseReconcileRequest();
    await firstReconcile;
    await harness.flush(12);

    assert.equal(harness.getElement("#reconcile-settings").disabled, false);
    assert.equal(harness.getElement("#reconcile-settings").textContent, "鎸夋鏂囨暣鐞嗚瀹");
    assert.equal(harness.getElement("#operation-feedback").hidden, true);
  });

  await runTest("novels page can delete the current chapter and rewind progress", async () => {
    const fetchCalls = [];
    const project = {
      id: "project-delete-chapter",
      name: "delete-chapter-target",
      genre: "ai-sci-fi",
      theme: "alignment",
      premise: "premise",
      targetChapters: 20,
      chapterWordTarget: 2400,
      stylePreference: "clean",
      audience: "general",
      protagonist: "engineer",
      keywords: ["ai"],
      notes: "",
      qqReviewEnabled: false,
      qqTargetType: "private",
      qqTargetId: "",
    };
    let currentChapter = 3;
    let lastGeneratedChapter = 3;
    let lastApprovedChapter = 2;
    let pendingDraftChapter = 3;
    const chapterContents = {
      1: { title: "Chapter 1 Approved", content: "# Chapter 1 Approved\n\nchapter one approved", characterCount: 1200, status: "approved" },
      2: { title: "Chapter 2 Approved", content: "# Chapter 2 Approved\n\nchapter two approved", characterCount: 1450, status: "approved" },
      3: { title: "Chapter 3 Draft", content: "# Chapter 3 Draft\n\nchapter three draft", characterCount: 1660, status: "draft" },
    };

    const createDetailResponse = () => ({
      ok: true,
      project,
      state: {
        phase: pendingDraftChapter ? "review" : "writing",
        currentChapter,
        lastGeneratedChapter,
        lastApprovedChapter,
        pendingDraftChapter,
        autoWriteEnabled: false,
        autoWriteLastCount: 0,
      },
      review: {
        pending: pendingDraftChapter ? [{ chapterNo: pendingDraftChapter, title: chapterContents[pendingDraftChapter].title }] : [],
      },
      chapters: Object.entries(chapterContents)
        .map(([chapterNo, chapter]) => ({
          chapterNo: Number(chapterNo),
          status: chapter.status,
          title: chapter.title,
          characterCount: chapter.characterCount,
        }))
        .sort((a, b) => a.chapterNo - b.chapterNo),
      settings: {
        "base-info": { key: "base-info", title: "閸╄櫣顢呮穱鈩冧紖" },
      },
    });

    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      fetchCalls.push({ url, options: { ...options, method } });

      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: [{
            id: project.id,
            name: project.name,
            genre: project.genre,
            lastApprovedChapter,
            pendingDraftChapter,
          }],
        });
      }

      if (url === `/novels/projects/${project.id}` && method === "GET") {
        return createMockJsonResponse(createDetailResponse());
      }

      if (url === `/novels/projects/${project.id}/settings/base-info` && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }

      const chapterMatch = url.match(/\/novels\/projects\/project-delete-chapter\/chapters\/(\d+)$/);
      if (chapterMatch && method === "GET") {
        const chapterNo = Number(chapterMatch[1]);
        const chapter = chapterContents[chapterNo];
        return createMockJsonResponse({
          ok: true,
          chapterNo,
          status: chapter.status,
          title: chapter.title,
          content: chapter.content,
          characterCount: chapter.characterCount,
        });
      }

      if (url === `/novels/projects/${project.id}/chapters/2` && method === "DELETE") {
        delete chapterContents[2];
        delete chapterContents[3];
        currentChapter = 1;
        lastGeneratedChapter = 1;
        lastApprovedChapter = 1;
        pendingDraftChapter = 0;
        return createMockJsonResponse({
          ok: true,
          deletedFromChapter: 2,
          deletedChapterCount: 2,
          resetToChapter: 1,
        });
      }

      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);
    await harness.getElement("#chapter-list").children[1].onclick();
    await harness.flush(8);

    assert.equal(harness.getElement("#chapter-viewer").value, chapterContents[2].content);

    const firstDelete = harness.getElement("#delete-chapter").onclick();
    await harness.flush(2);
    harness.getElement("#delete-chapter").onclick();
    await firstDelete;
    await harness.flush(12);

    const deleteCalls = fetchCalls.filter((call) => call.url === `/novels/projects/${project.id}/chapters/2` && call.options.method === "DELETE");
    assert.equal(deleteCalls.length, 1);
    assert.equal(harness.confirms.length, 1);
    assert.equal(harness.getElement("#chapter-list").children.length, 1);
    assert.equal(harness.getElement("#chapter-list").children[0].innerHTML.includes("Chapter 1 Approved"), true);
    assert.equal(harness.getElement("#chapter-viewer").value, chapterContents[1].content);
    assert.equal(harness.getElement("#project-meta").textContent.includes("1"), true);
  });

  await runTest("novels page delete restores the workspace to the initial state", async () => {
    let projects = [
      {
        id: "project-a",
        name: "project-a",
        genre: "genre-a",
      },
      {
        id: "project-b",
        name: "project-b",
        genre: "genre-b",
      },
    ];
    const harness = createNovelsPageHarness(async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (url === "/novels/projects" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          projects: projects.map((project) => ({
            ...project,
            lastApprovedChapter: 0,
            pendingDraftChapter: 0,
          })),
        });
      }
      if (url === "/novels/projects/project-a" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          project: {
            ...projects[0],
            theme: "",
            premise: "",
            targetChapters: 10,
            stylePreference: "",
            audience: "",
            protagonist: "",
            keywords: [],
            notes: "",
            qqReviewEnabled: false,
            qqTargetType: "private",
            qqTargetId: "",
          },
          state: {
            phase: "planning",
            currentChapter: 0,
            lastGeneratedChapter: 0,
            lastApprovedChapter: 0,
            pendingDraftChapter: null,
            autoWriteEnabled: false,
            autoWriteLastCount: 0,
          },
          review: { pending: [] },
          chapters: [],
          settings: {
            "base-info": { key: "base-info", title: "鍩虹淇℃伅" },
          },
        });
      }
      if (url === "/novels/projects/project-a/settings/base-info" && method === "GET") {
        return createMockJsonResponse({
          ok: true,
          key: "base-info",
          content: "# base info",
        });
      }
      if (url === "/novels/projects/project-a" && method === "DELETE") {
        projects = projects.filter((project) => project.id !== "project-a");
        return createMockJsonResponse({ ok: true });
      }
      throw new Error(`Unexpected novels page request: ${method} ${url}`);
    });

    seedNovelsPageButtonText(harness);
    await harness.flush(8);
    await harness.getElement("#project-list").children[0].onclick();
    await harness.flush(10);

    await harness.getElement("#delete-project").onclick();
    await harness.flush(10);

    assert.equal(harness.getElement("#project-title").textContent, "灏忚椤圭洰宸ュ潑");
    assert.equal(harness.getElement("#project-content").hidden, true);
    assert.equal(harness.getElement("#empty-state").hidden, false);
    assert.equal(harness.getElement("#project-actions").hidden, true);
    assert.equal(harness.getElement("#project-list").children.length, 1);
    assert.equal(harness.confirms.length, 1);
  });

  await runTest("novel module creates project structure and generated settings", async () => {
    const calls = [];
    const { novelModule, novelsDir } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        calls.push(purpose);
        return `# ${purpose}\n\n鍐呭`;
      },
    });

    const detail = await novelModule.createProject({
      name: "鏄熸捣浣欑儸",
      genre: "鐜勫够",
      chapterWordTarget: 2800,
      theme: "鎴愰暱",
      autoGenerateSettings: true,
    });

    assert.equal(detail.project.name, "鏄熸捣浣欑儸");
    assert.equal(detail.project.chapterWordTarget, 2800);
    assert.equal(calls.includes("novel_setting_world"), true);
    const baseInfo = await readTextFile(path.join(novelsDir, detail.project.id, "settings", "base-info.md"), "");
    assert.equal(baseInfo.includes("鏄熸捣浣欑儸"), true);
    assert.equal(baseInfo.includes("姣忕珷瀛楁暟瑕佹眰锛氱害 2800 涓腑鏂囨眽瀛"), true);
  });

  await runTest("novel module updates keywords from string payloads", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose }) => `# ${purpose}\n\ncontent`,
    });

    const detail = await novelModule.createProject({
      name: "keyword-save-test",
      keywords: "alpha,beta",
      autoGenerateSettings: false,
    });

    const updated = await novelModule.updateProject(detail.project.id, {
      keywords: "gamma, delta epsilon",
      chapterWordTarget: 3600,
    });

    assert.deepEqual(updated.project.keywords, ["gamma", "delta", "epsilon"]);
    assert.equal(updated.project.chapterWordTarget, 3600);
  });

  await runTest("novel module prioritizes the current chapter outline in generation prompts", async () => {
    let chapterPrompt = "";
    const { novelModule, novelsDir } = createNovelModuleHarness({
      generateText: async ({ purpose, userPrompt }) => {
        if (purpose === "novel_chapter") {
          chapterPrompt = String(userPrompt || "");
          return "# 绗?绔?鏈€浣庤胺鐨勮凯浠n\n姝ｆ枃";
        }
        if (purpose === "novel_summary") {
          return "# 鎽樿\n\n鎽樿";
        }
        if (purpose === "novel_snapshot") {
          return "# 蹇収\n\n蹇収";
        }
        return `# ${purpose}\n\ncontent`;
      },
    });

    const detail = await novelModule.createProject({
      name: "outline-priority-test",
      genre: "绉戝够",
      autoGenerateSettings: false,
    });

    await writeFileAtomic(path.join(novelsDir, detail.project.id, "settings", "chapter-plan.md"), [
      "# 绔犺妭缁嗙翰",
      "",
      "* **绗?3绔狅細閫昏緫鐨勫潔濉?*",
      "  * 鍐呭锛氭灄涓€澶卞幓涓€鍒囷紝鍐冲畾瀛ゆ敞涓€鎺枫€",
      "",
      "* **绗?4绔狅細鏈€浣庤胺鐨勮凯浠?*",
      "  * 鍐呭锛氬彧鍐欏湴涓嬪閲岀殑鏈€鍚庝竴娆″叧閿凯浠ｄ笌鈥滅敓瀛樻鏈涒€濈殑娉ㄥ叆锛屼笉瑕佽绻佹槦姝ｅ紡瑙夐啋銆",
      "",
      "* **绗?5绔狅細璇炵敓涓庢敞瑙?*",
      "  * 鍐呭锛氱箒鏄熻婵€娲伙紝骞跺嚭鐜扮涓€娆′富鍔ㄥ彂闂€",
      "",
    ].join("\n"));

    await novelModule.generateChapter(detail.project.id, {
      chapterNo: 4,
      force: true,
    });

    assert.equal(chapterPrompt.includes("### 褰撳墠绔犺妭缁嗙翰锛堟渶楂樹紭鍏堢骇锛"), true);
    assert.equal(chapterPrompt.includes("绗?4绔狅細鏈€浣庤胺鐨勮凯浠"), true);
    assert.equal(chapterPrompt.includes("涓嶈璁╃箒鏄熸寮忚閱"), true);
    assert.equal(chapterPrompt.includes("绗?5绔狅細璇炵敓涓庢敞瑙"), true);
    assert.equal(chapterPrompt.includes("涓嶅緱鎻愬墠鍐欏叆涓嬩竴绔犵殑澶т簨浠"), true);
  });

  await runTest("novel module can reconcile settings from written chapters", async () => {
    let reconciledPrompt = "";
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose, userPrompt }) => {
        if (purpose === "novel_chapter") {
          return "# Chapter 1 Start\n\nchapter one underground debugging with first response";
        }
        if (purpose === "novel_summary") {
          return "# Summary\n\nsummary of chapter one";
        }
        if (purpose === "novel_snapshot") {
          return "# Snapshot\n\nsnapshot-lin-yi: basement\nsnapshot-fanxing: first-response";
        }
        if (purpose === "novel_setting_world") {
          reconciledPrompt = String(userPrompt || "");
        }
        return `# ${purpose}\n\ncontent`;
      },
    });

    const detail = await novelModule.createProject({
      name: "reconcile-from-chapters-test",
      genre: "sci-fi",
      autoGenerateSettings: false,
    });

    await novelModule.generateChapter(detail.project.id);
    await novelModule.reconcileSettingsFromChapters(detail.project.id, { overwrite: true });

    assert.equal(reconciledPrompt.includes("draft"), true);
    assert.equal(reconciledPrompt.includes("chapter one underground debugging with first response"), true);
    assert.equal(reconciledPrompt.includes("summary of chapter one"), true);
    assert.equal(reconciledPrompt.includes("snapshot-lin-yi: basement"), true);
    assert.equal(reconciledPrompt.includes("snapshot-fanxing: first-response"), true);
  });

  await runTest("novel module counts chinese characters for chapter metadata", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        if (purpose === "novel_chapter") {
          return "# 绗?绔?鏄熺伀\n\n杩欐槸涓枃ABC娴嬭瘯";
        }
        if (purpose === "novel_summary") {
          return "# 鎽樿\n\n鎽樿";
        }
        if (purpose === "novel_snapshot") {
          return "# 鐘舵€乗n\n鐘舵€";
        }
        return `# ${purpose}\n\ncontent`;
      },
    });

    const detail = await novelModule.createProject({
      name: "瀛楁暟缁熻娴嬭瘯",
      genre: "绉戝够",
      autoGenerateSettings: false,
    });

    await novelModule.generateChapter(detail.project.id);
    const afterGenerate = await novelModule.getProjectDetail(detail.project.id);
    const draftMeta = afterGenerate.chapters.find((chapter) => chapter.chapterNo === 1);
    const chapter = await novelModule.getChapterContent(detail.project.id, 1);

    assert.equal(draftMeta?.characterCount, 10);
    assert.equal(chapter.characterCount, 10);
  });

  await runTest("novel module generates draft chapter and supports approval", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        if (purpose === "novel_chapter") {
          return "# 绗?绔?鏄熺伀鍒濈噧\n\n杩欐槸姝ｆ枃銆";
        }
        if (purpose === "novel_summary") {
          return "# 鎽樿\n\n涓昏韪忎笂鏃呯▼銆";
        }
        if (purpose === "novel_snapshot") {
          return "# 鐘舵€佸揩鐓n\n涓昏锛氬嚭鍙戙€";
        }
        return `# ${purpose}\n\n鍐呭`;
      },
    });

    const detail = await novelModule.createProject({
      name: "闀垮鑸伅",
      genre: "绉戝够",
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

  await runTest("novel module can regenerate the pending draft chapter", async () => {
    let chapterCallCount = 0;
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        if (purpose === "novel_chapter") {
          chapterCallCount += 1;
          return chapterCallCount === 1
            ? "# Chapter 1 Draft\n\nfirst draft content"
            : "# Chapter 1 Draft Regenerated\n\nregenerated draft content";
        }
        if (purpose === "novel_summary") {
          return "# Summary\n\nsummary";
        }
        if (purpose === "novel_snapshot") {
          return "# Snapshot\n\nsnapshot";
        }
        return `# ${purpose}\n\ncontent`;
      },
    });

    const detail = await novelModule.createProject({
      name: "regenerate-test",
      genre: "sci-fi",
      autoGenerateSettings: false,
    });

    await novelModule.generateChapter(detail.project.id);
    const regenerated = await novelModule.regenerateChapter(detail.project.id, 1);
    const chapter = await novelModule.getChapterContent(detail.project.id, 1, { preferDraft: true });
    const afterRegenerate = await novelModule.getProjectDetail(detail.project.id);

    assert.equal(regenerated.chapterNo, 1);
    assert.equal(chapter.status, "draft");
    assert.equal(chapter.title, "Chapter 1 Draft Regenerated");
    assert.equal(chapter.content.includes("regenerated draft content"), true);
    assert.equal(afterRegenerate.state.pendingDraftChapter, 1);
  });

  await runTest("novel module can delete chapters and rewind progress", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose, userPrompt }) => {
        if (purpose === "novel_chapter") {
          const match = String(userPrompt || "").match(/绗琝s*(\d+)\s*绔/);
          const chapterNo = match?.[1] || "1";
          return `# Chapter ${chapterNo}\n\nchapter ${chapterNo} body`;
        }
        if (purpose === "novel_summary") {
          return "# Summary\n\nsummary";
        }
        if (purpose === "novel_snapshot") {
          return "# Snapshot\n\nsnapshot";
        }
        return `# ${purpose}\n\ncontent`;
      },
    });

    const detail = await novelModule.createProject({
      name: "delete-chapter-test",
      genre: "sci-fi",
      autoGenerateSettings: false,
    });

    await novelModule.generateChapter(detail.project.id);
    await novelModule.approveChapter(detail.project.id, 1);
    await novelModule.generateChapter(detail.project.id);
    await novelModule.approveChapter(detail.project.id, 2);
    await novelModule.generateChapter(detail.project.id);

    const deleted = await novelModule.deleteChapterAndProgress(detail.project.id, 2);
    const afterDelete = await novelModule.getProjectDetail(detail.project.id);

    assert.equal(deleted.deletedFromChapter, 2);
    assert.equal(deleted.deletedChapterCount, 2);
    assert.equal(deleted.resetToChapter, 1);
    assert.deepEqual(afterDelete.chapters.map((chapter) => chapter.chapterNo), [1]);
    assert.equal(afterDelete.state.currentChapter, 1);
    assert.equal(afterDelete.state.lastGeneratedChapter, 1);
    assert.equal(afterDelete.state.lastApprovedChapter, 1);
    assert.equal(afterDelete.state.pendingDraftChapter, null);
    await assert.rejects(novelModule.getChapterContent(detail.project.id, 2, { preferDraft: true }), /Chapter not found/);
  });

  await runTest("novel module supports batch generation with auto approval", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose, userPrompt }) => {
        if (purpose === "novel_chapter") {
          const match = String(userPrompt || "").match(/绗琝s+(\d+)\s+绔/);
          const chapterNo = match?.[1] || "1";
          return `# 绗?{chapterNo}绔?鎵归噺鐢熸垚\n\n姝ｆ枃 ${chapterNo}`;
        }
        if (purpose === "novel_summary") {
          return "# 鎽樿\n\n鎽樿";
        }
        if (purpose === "novel_snapshot") {
          return "# 蹇収\n\n蹇収";
        }
        return `# ${purpose}\n\n鍐呭`;
      },
    });

    const detail = await novelModule.createProject({
      name: "缇ゆ槦鍥炲搷",
      genre: "濂囧够",
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
          return "# 绗?绔?鍒濈珷\n\n姝ｆ枃";
        }
        if (purpose === "novel_summary") {
          return "# 鎽樿\n\n鎽樿";
        }
        if (purpose === "novel_snapshot") {
          return "# 蹇収\n\n蹇収";
        }
        return `# ${purpose}\n\n鍐呭`;
      },
    });

    const detail = await novelModule.createProject({
      name: "闇滄渤绾",
      autoGenerateSettings: false,
    });
    await novelModule.generateChapter(detail.project.id);

    const reply = await novelModule.handleQqCommand({
      text: "-n 閫氳繃 闇滄渤绾?绗?绔",
    });

    assert.equal(reply.includes("宸查€氳繃"), true);
  });

  await runTest("qq novel commands format summary and chapter content for reading", async () => {
    const { novelModule } = createNovelModuleHarness({
      generateText: async ({ purpose }) => {
        if (purpose === "novel_chapter") {
          return "# Chapter 1 Dawn\n\nThis is the chapter body for qq reading.";
        }
        if (purpose === "novel_summary") {
          return "# Summary\n\nThis is a concise summary.";
        }
        if (purpose === "novel_snapshot") {
          return "# Snapshot\n\nsnapshot";
        }
        return `# ${purpose}\n\ncontent`;
      },
    });

    const detail = await novelModule.createProject({
      name: "qq-layout-test",
      autoGenerateSettings: false,
    });
    await novelModule.generateChapter(detail.project.id);

    const summaryReply = await novelModule.handleQqCommand({
      text: "-n 查看 qq-layout-test 第1章摘要",
    });
    const contentReply = await novelModule.handleQqCommand({
      text: "-n 查看 qq-layout-test 第1章正文",
    });

    assert.equal(summaryReply.includes("【qq-layout-test｜第 1 章摘要】"), true);
    assert.equal(summaryReply.includes("This is a concise summary."), true);
    assert.equal(summaryReply.includes("# Summary"), false);
    assert.equal(contentReply.includes("【qq-layout-test｜第 1 章正文】"), true);
    assert.equal(contentReply.includes("标题：Chapter 1 Dawn"), true);
    assert.equal(contentReply.includes("状态：待审草稿"), true);
    assert.equal(contentReply.includes("This is the chapter body for qq reading."), true);
  });

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});


