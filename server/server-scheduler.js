function createScheduler(deps) {
  const {
    scheduledTasksFile,
    readJsonFile,
    writeJsonFileAtomic,
    readRequestBody,
    sendJson,
    callLocalModelForTask,
    schedulerTickMs,
    getScheduledTasks,
    setScheduledTasks,
    runningScheduledTaskIds,
  } = deps;

  function normalizeTaskSignatureValue(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function normalizeScheduledTaskMatchValue(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function expandCronSegment(segment, min, max) {
    const values = new Set();
    const trimmed = String(segment || "").trim();
    if (!trimmed) {
      return values;
    }

    const parts = trimmed.split(",");
    for (const part of parts) {
      const [base, stepText] = part.split("/");
      const step = stepText ? Number(stepText) : 1;
      if (!Number.isFinite(step) || step <= 0) {
        throw new Error(`Invalid cron step: ${part}`);
      }

      let rangeStart = min;
      let rangeEnd = max;
      if (base && base !== "*") {
        if (base.includes("-")) {
          const [startText, endText] = base.split("-");
          rangeStart = Number(startText);
          rangeEnd = Number(endText);
        } else {
          rangeStart = Number(base);
          rangeEnd = Number(base);
        }
      }

      if (
        !Number.isFinite(rangeStart) ||
        !Number.isFinite(rangeEnd) ||
        rangeStart < min ||
        rangeEnd > max ||
        rangeStart > rangeEnd
      ) {
        throw new Error(`Invalid cron range: ${part}`);
      }

      for (let value = rangeStart; value <= rangeEnd; value += step) {
        values.add(value);
      }
    }

    return values;
  }

  function parseCronExpression(cronExpression) {
    const fields = String(cronExpression || "").trim().split(/\s+/);
    if (fields.length !== 5) {
      throw new Error("cronExpression must have 5 fields: minute hour day month weekday");
    }

    return {
      minute: expandCronSegment(fields[0], 0, 59),
      hour: expandCronSegment(fields[1], 0, 23),
      dayOfMonth: expandCronSegment(fields[2], 1, 31),
      month: expandCronSegment(fields[3], 1, 12),
      dayOfWeek: expandCronSegment(fields[4], 0, 6),
    };
  }

  function matchesCronDate(parsed, date) {
    return (
      parsed.minute.has(date.getMinutes()) &&
      parsed.hour.has(date.getHours()) &&
      parsed.dayOfMonth.has(date.getDate()) &&
      parsed.month.has(date.getMonth() + 1) &&
      parsed.dayOfWeek.has(date.getDay())
    );
  }

  function computeNextRunAt(task, fromTime = Date.now()) {
    if (!task.enabled) {
      return null;
    }

    if (task.scheduleType === "cron" && task.cronExpression) {
      const parsed = parseCronExpression(task.cronExpression);
      const cursor = new Date(fromTime);
      cursor.setSeconds(0, 0);
      cursor.setMinutes(cursor.getMinutes() + 1);

      for (let i = 0; i < 60 * 24 * 366; i += 1) {
        if (matchesCronDate(parsed, cursor)) {
          return cursor.getTime();
        }
        cursor.setMinutes(cursor.getMinutes() + 1);
      }

      throw new Error("Unable to compute next run time from cron expression");
    }

    const error = new Error("Only cron-based scheduled tasks are supported");
    error.statusCode = 400;
    throw error;
  }

  function sanitizeScheduledTask(task = {}) {
    const scheduleType = "cron";
    const enabled = Boolean(task.enabled);
    const sanitized = {
      id: String(task.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      name: String(task.name || "未命名任务").trim() || "未命名任务",
      prompt: String(task.prompt || "").trim(),
      model: String(task.model || "").trim(),
      scheduleType,
      intervalMinutes: 0,
      cronExpression: String(task.cronExpression || "").trim(),
      enabled,
      createdAt: Number(task.createdAt) || Date.now(),
      updatedAt: Number(task.updatedAt) || Date.now(),
      nextRunAt: Number(task.nextRunAt) || null,
      lastRunAt: Number(task.lastRunAt) || null,
      lastStatus: String(task.lastStatus || "idle"),
      lastResult: String(task.lastResult || ""),
      lastError: String(task.lastError || ""),
    };

    if (!sanitized.cronExpression) {
      sanitized.enabled = false;
      sanitized.nextRunAt = null;
    }

    if (!sanitized.nextRunAt && sanitized.enabled) {
      sanitized.nextRunAt = computeNextRunAt(sanitized, Date.now());
    }

    return sanitized;
  }

  function validateScheduledTaskPayload(payload = {}, { partial = false } = {}) {
    const next = {};

    if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
      next.name = String(payload.name || "").trim();
      if (!next.name) {
        const error = new Error("Task name is required");
        error.statusCode = 400;
        throw error;
      }
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, "prompt")) {
      next.prompt = String(payload.prompt || "").trim();
      if (!next.prompt) {
        const error = new Error("Task prompt is required");
        error.statusCode = 400;
        throw error;
      }
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, "model")) {
      next.model = String(payload.model || "").trim();
      if (!next.model) {
        const error = new Error("Task model is required");
        error.statusCode = 400;
        throw error;
      }
    }

    next.scheduleType = "cron";
    if (
      !partial ||
      Object.prototype.hasOwnProperty.call(payload, "cronExpression") ||
      Object.prototype.hasOwnProperty.call(payload, "scheduleType")
    ) {
      next.cronExpression = String(payload.cronExpression || "").trim();
      if (!next.cronExpression) {
        const error = new Error("cronExpression is required");
        error.statusCode = 400;
        throw error;
      }
      parseCronExpression(next.cronExpression);
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, "enabled")) {
      next.enabled = Boolean(payload.enabled);
    }

    return next;
  }

  async function loadScheduledTasks() {
    const records = await readJsonFile(scheduledTasksFile, []);
    setScheduledTasks(Array.isArray(records) ? records.map((task) => sanitizeScheduledTask(task)) : []);
  }

  async function saveScheduledTasks() {
    await writeJsonFileAtomic(scheduledTasksFile, getScheduledTasks());
  }

  function listScheduledTasks() {
    return getScheduledTasks()
      .slice()
      .sort((left, right) => {
        if (left.enabled !== right.enabled) {
          return left.enabled ? -1 : 1;
        }
        return (left.nextRunAt || Infinity) - (right.nextRunAt || Infinity);
      })
      .map((task) => ({
        ...task,
        running: runningScheduledTaskIds.has(task.id),
      }));
  }

  function findEquivalentScheduledTask(taskLike = {}) {
    const scheduleType = "cron";
    const normalizedName = normalizeTaskSignatureValue(taskLike.name);
    const normalizedPrompt = normalizeTaskSignatureValue(taskLike.prompt);
    const normalizedModel = normalizeTaskSignatureValue(taskLike.model);
    const normalizedCron = normalizeTaskSignatureValue(taskLike.cronExpression);

    return (
      getScheduledTasks().find((task) => {
        if (task.scheduleType !== scheduleType) {
          return false;
        }
        if (normalizeTaskSignatureValue(task.name) !== normalizedName) {
          return false;
        }
        if (normalizeTaskSignatureValue(task.prompt) !== normalizedPrompt) {
          return false;
        }
        if (normalizeTaskSignatureValue(task.model) !== normalizedModel) {
          return false;
        }
        return normalizeTaskSignatureValue(task.cronExpression) === normalizedCron;
      }) || null
    );
  }

  function findScheduledTask(taskId) {
    return getScheduledTasks().find((task) => task.id === taskId);
  }

  function ensureScheduledTask(taskId) {
    const task = findScheduledTask(taskId);
    if (!task) {
      const error = new Error("Scheduled task not found");
      error.statusCode = 404;
      throw error;
    }
    return task;
  }

  function resolveScheduledTask(args = {}) {
    const directId = String(args.id || "").trim();
    if (directId) {
      return ensureScheduledTask(directId);
    }

    const name = normalizeScheduledTaskMatchValue(args.name);
    if (name) {
      const byName = getScheduledTasks().find(
        (task) => normalizeScheduledTaskMatchValue(task.name) === name
      );
      if (byName) {
        return byName;
      }
    }

    const error = new Error("Scheduled task not found");
    error.statusCode = 404;
    throw error;
  }

  async function runScheduledTask(taskId) {
    const task = ensureScheduledTask(taskId);
    if (runningScheduledTaskIds.has(task.id)) {
      return task;
    }

    runningScheduledTaskIds.add(task.id);
    task.lastStatus = "running";
    task.lastError = "";
    task.updatedAt = Date.now();
    await saveScheduledTasks();

    try {
      const result = await callLocalModelForTask(task);
      task.lastStatus = "success";
      task.lastResult = result.slice(0, 4000);
      task.lastRunAt = Date.now();
      task.updatedAt = task.lastRunAt;
      task.lastError = "";
    } catch (error) {
      task.lastStatus = "error";
      task.lastError = error.message || "Task execution failed";
      task.lastRunAt = Date.now();
      task.updatedAt = task.lastRunAt;
    } finally {
      runningScheduledTaskIds.delete(task.id);
      task.nextRunAt = task.enabled ? computeNextRunAt(task, Date.now()) : null;
      await saveScheduledTasks();
    }

    return task;
  }

  async function tickScheduledTasks() {
    const now = Date.now();
    const dueTasks = getScheduledTasks().filter(
      (task) => task.enabled && !runningScheduledTaskIds.has(task.id) && task.nextRunAt && task.nextRunAt <= now
    );

    for (const task of dueTasks) {
      try {
        await runScheduledTask(task.id);
      } catch {
        // Ignore per-task failures to keep scheduler alive.
      }
    }
  }

  function startScheduledTaskLoop() {
    setInterval(() => {
      tickScheduledTasks().catch(() => {});
    }, schedulerTickMs);
  }

  async function handleScheduledTasksList(res) {
    sendJson(res, 200, { ok: true, tasks: listScheduledTasks() });
  }

  async function handleScheduledTasksCreate(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const input = validateScheduledTaskPayload(payload);
      const existingTask = findEquivalentScheduledTask({
        ...input,
        enabled: payload.enabled !== false,
      });
      if (existingTask) {
        sendJson(res, 200, { ok: true, task: existingTask, deduplicated: true });
        return;
      }
      const nextTasks = getScheduledTasks();
      const task = sanitizeScheduledTask({
        ...input,
        enabled: payload.enabled !== false,
      });
      nextTasks.unshift(task);
      setScheduledTasks(nextTasks);
      await saveScheduledTasks();
      sendJson(res, 200, { ok: true, task });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to create scheduled task",
      });
    }
  }

  async function handleScheduledTaskUpdate(req, res, taskId) {
    try {
      const task = ensureScheduledTask(taskId);
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const patch = validateScheduledTaskPayload(payload, { partial: true });
      Object.assign(task, patch);
      task.updatedAt = Date.now();
      task.nextRunAt = task.enabled ? computeNextRunAt(task, Date.now()) : null;
      await saveScheduledTasks();
      sendJson(res, 200, { ok: true, task });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to update scheduled task",
      });
    }
  }

  async function handleScheduledTaskDelete(res, taskId) {
    try {
      ensureScheduledTask(taskId);
      setScheduledTasks(getScheduledTasks().filter((task) => task.id !== taskId));
      runningScheduledTaskIds.delete(taskId);
      await saveScheduledTasks();
      sendJson(res, 200, { ok: true, deleted: true });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to delete scheduled task",
      });
    }
  }

  async function handleScheduledTaskRun(res, taskId) {
    try {
      const task = await runScheduledTask(taskId);
      sendJson(res, 200, { ok: true, task });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to run scheduled task",
      });
    }
  }

  return {
    loadScheduledTasks,
    saveScheduledTasks,
    listScheduledTasks,
    findEquivalentScheduledTask,
    ensureScheduledTask,
    resolveScheduledTask,
    validateScheduledTaskPayload,
    computeNextRunAt,
    sanitizeScheduledTask,
    runScheduledTask,
    tickScheduledTasks,
    startScheduledTaskLoop,
    handleScheduledTasksList,
    handleScheduledTasksCreate,
    handleScheduledTaskUpdate,
    handleScheduledTaskDelete,
    handleScheduledTaskRun,
  };
}

module.exports = {
  createScheduler,
};
