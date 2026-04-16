const EXPLICIT_CRON_RE = /\b(\*|[0-5]?\d)\s+(\*|[01]?\d|2[0-3])\s+(\*|[1-9]|[12]\d|3[01])\s+(\*|[1-9]|1[0-2])\s+(\*|[0-6])\b/;
const TIME_WORD_RE = /(凌晨|早上|上午|中午|下午|傍晚|晚上)/;
const DAILY_RE = /(每天|每日)(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?:\s*(?:点|:|：)\s*(\d{1,2}))?\s*(?:分)?/;
const WEEKLY_RE = /(每周|每星期|每个星期)\s*([一二三四五六日天])\s*(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?:\s*(?:点|:|：)\s*(\d{1,2}))?\s*(?:分)?/;
const WORKDAY_RE = /(每个?工作日|工作日)(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?:\s*(?:点|:|：)\s*(\d{1,2}))?\s*(?:分)?/;
const GENERIC_TIME_RE = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?:\s*(?:点|:|：)\s*(\d{1,2}))?\s*(?:分)?/;

const CREATE_VERB_RE = /(?:创建|新建|添加|设定|设置|建立|安排|schedule|create)/i;
const CREATE_VERB_GLOBAL_RE = /(?:创建|新建|添加|设定|设置|建立|安排)/g;
const UPDATE_INTENT_RE = /(?:修改|改成|改为|改到|调整|更新|改一下|换成|换到|变成).*(?:定时任务|任务)|(?:定时任务|任务).*(?:修改|改成|改为|改到|调整|更新|改一下|换成|换到|变成)/i;
const UPDATE_VERB_GLOBAL_RE = /(?:修改|改成|改为|改到|调整|更新|改一下|换成|换到|变成|修改为|修改成|调整为|调整成|调整到|设置为|设置成|设为)/g;
const TASK_HINT_RE = /(?:定时任务|定时|计划任务|周期任务|提醒|通知|自动执行|周期执行|每天|每日|每周|每星期|工作日|cron|schedule)/i;
const TASK_WORD_GLOBAL_RE = /(?:定时任务|定时|计划任务|周期任务)/g;

const LIST_INTENT_RE = /(?:(?:查看|列出|显示|看看|看下|看一下|查询)(?:一下)?(?:当前|现有|所有)?(?:的)?(?:定时任务|任务)(?:列表)?|(?:当前|现有|所有)(?:的)?(?:定时任务|任务)(?:列表)?|(?:定时任务|任务)列表|有(?:哪|什么)(?:些)?(?:定时任务|任务))/i;
const RUN_INTENT_RE = /(?:立即执行|马上执行|立刻执行|现在执行|运行|执行|跑一下|跑下).*(?:定时任务|任务)|(?:定时任务|任务).*(?:立即执行|马上执行|立刻执行|现在执行|运行|执行|跑一下|跑下)/i;
const DELETE_INTENT_RE = /(?:删除|删掉|删了|移除|去掉|取消|干掉).*(?:定时任务|任务)|(?:定时任务|任务).*(?:删除|删掉|删了|移除|去掉|取消|干掉)/i;
const DISABLE_INTENT_RE = /(?:暂停|停掉|停用|关闭|关掉|禁用).*(?:定时任务|任务)|(?:定时任务|任务).*(?:暂停|停掉|停用|关闭|关掉|禁用)/i;
const ENABLE_INTENT_RE = /(?:启用|开启|打开|恢复|继续).*(?:定时任务|任务)|(?:定时任务|任务).*(?:启用|开启|打开|恢复|继续)/i;
const LXJ_ACTION_RE = /启动\s*lxj|运行\s*lxj/i;
const DISPLAY_TIME_ZONE = "Asia/Shanghai";

function normalizeHourByMeridiem(hour, meridiem) {
  let nextHour = Number(hour);
  const tag = String(meridiem || "").trim();

  if ((tag === "下午" || tag === "傍晚" || tag === "晚上") && nextHour < 12) {
    nextHour += 12;
  } else if (tag === "中午" && nextHour < 11) {
    nextHour += 12;
  } else if (tag === "凌晨" && nextHour === 12) {
    nextHour = 0;
  }

  return nextHour;
}

function buildCron(minute, hour, weekday = "*") {
  return `${minute} ${hour} * * ${weekday}`;
}

function inferCronExpressionFromText(text = "") {
  const source = String(text || "").trim();
  if (!source) return "";

  const explicitCron = source.match(EXPLICIT_CRON_RE);
  if (explicitCron) {
    return explicitCron[0].trim();
  }

  const weeklyMatch = source.match(WEEKLY_RE);
  if (weeklyMatch) {
    const weekdayMap = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      日: 0,
      天: 0,
    };
    const weekday = weekdayMap[weeklyMatch[2]];
    const hour = normalizeHourByMeridiem(weeklyMatch[4], weeklyMatch[3]);
    const minute = Number(weeklyMatch[5] || 0);
    if (Number.isInteger(weekday) && Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return buildCron(minute, hour, weekday);
    }
  }

  const workdayMatch = source.match(WORKDAY_RE);
  if (workdayMatch) {
    const hour = normalizeHourByMeridiem(workdayMatch[3], workdayMatch[2]);
    const minute = Number(workdayMatch[4] || 0);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return buildCron(minute, hour, "1-5");
    }
  }

  const dailyMatch = source.match(DAILY_RE);
  if (dailyMatch) {
    const hour = normalizeHourByMeridiem(dailyMatch[3], dailyMatch[2]);
    const minute = Number(dailyMatch[4] || 0);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return buildCron(minute, hour);
    }
  }

  const genericTime = source.match(GENERIC_TIME_RE);
  if (genericTime && /(每天|每日|工作日)/.test(source)) {
    const weekday = /(工作日)/.test(source) ? "1-5" : "*";
    const hour = normalizeHourByMeridiem(genericTime[2], genericTime[1]);
    const minute = Number(genericTime[3] || 0);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return buildCron(minute, hour, weekday);
    }
  }

  return "";
}

function hasCreateScheduledTaskIntent(text = "") {
  const source = String(text || "").trim();
  if (!source) return false;
  return Boolean(inferCronExpressionFromText(source)) && (CREATE_VERB_RE.test(source) || TASK_HINT_RE.test(source));
}

function hasListScheduledTaskIntent(text = "") {
  const source = String(text || "").trim();
  if (!source) return false;
  return LIST_INTENT_RE.test(source);
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTaskPrompt(text = "") {
  const source = String(text || "").trim();
  if (!source) return "";

  if (LXJ_ACTION_RE.test(source)) {
    return "启动 lxj";
  }

  const prompt = source
    .replace(/^(请帮我|麻烦你|麻烦|请你|请)\s*/g, "")
    .replace(CREATE_VERB_GLOBAL_RE, "")
    .replace(/(?:一个|一条|一项|一下)\s*/g, "")
    .replace(TASK_WORD_GLOBAL_RE, "")
    .replace(/(?:每周|每星期|每个星期)\s*[一二三四五六日天]/g, "")
    .replace(/(?:每天|每日|每个工作日|工作日)/g, "")
    .replace(TIME_WORD_RE, "")
    .replace(/\d{1,2}\s*(?:点|:|：)\s*\d{0,2}\s*(?:分)?/g, "")
    .replace(/\bcron\b/gi, "")
    .replace(/[，。；;:：]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedPrompt = prompt.replace(/\s*的\s*$/, "").trim();

  return normalizedPrompt || prompt || source;
}

function inferScheduledTaskName(prompt = "", cronExpression = "") {
  const normalizedPrompt = String(prompt || "").trim();
  if (LXJ_ACTION_RE.test(normalizedPrompt)) {
    return /\*\s\*\s[0-6]$/.test(cronExpression) ? "lxj 每周任务" : "lxj 每日任务";
  }
  if (!normalizedPrompt) {
    return "定时任务";
  }
  const compact = normalizedPrompt.replace(/[，。；;:：]/g, "").trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact;
}

function inferScheduledTaskArgsFromText(text = "", options = {}) {
  const source = String(text || "").trim();
  if (!source || !hasCreateScheduledTaskIntent(source)) {
    return null;
  }

  const cronExpression = inferCronExpressionFromText(source);
  if (!cronExpression) {
    return null;
  }

  const prompt = extractTaskPrompt(source);
  if (!prompt) {
    return null;
  }

  return {
    name: inferScheduledTaskName(prompt, cronExpression),
    prompt,
    scheduleType: "cron",
    cronExpression,
    enabled: true,
  };
}

function normalizeScheduledTaskMatchValue(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseScheduledTaskIndexToken(token = "") {
  const source = String(token || "").trim();
  if (!source) return 0;
  if (/^\d+$/.test(source)) {
    return Number(source);
  }

  const digitMap = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (source === "十") {
    return 10;
  }
  if (source.includes("十")) {
    const [tensToken, unitsToken] = source.split("十");
    const tens = tensToken ? (digitMap[tensToken] || 0) : 1;
    const units = unitsToken ? (digitMap[unitsToken] || 0) : 0;
    return tens * 10 + units;
  }

  return digitMap[source] || 0;
}

function findReferencedScheduledTaskByIndex(tasks = [], text = "") {
  const source = String(text || "").trim();
  if (!source) return null;

  const indexMatch = source.match(/第\s*([0-9]+|[一二两三四五六七八九十]{1,3})\s*(?:个|条)?(?:定时任务|任务)?/i);
  if (!indexMatch) {
    return null;
  }

  const taskIndex = parseScheduledTaskIndexToken(indexMatch[1]);
  if (!Number.isInteger(taskIndex) || taskIndex <= 0) {
    return null;
  }

  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  return normalizedTasks[taskIndex - 1] || null;
}

function findReferencedScheduledTask(tasks = [], text = "") {
  const indexedTask = findReferencedScheduledTaskByIndex(tasks, text);
  if (indexedTask) {
    return indexedTask;
  }

  const normalizedText = normalizeScheduledTaskMatchValue(text).replace(/[“”"'`]/g, "");
  if (!normalizedText) return null;

  const matches = (Array.isArray(tasks) ? tasks : [])
    .map((task) => ({
      task,
      normalizedName: normalizeScheduledTaskMatchValue(task?.name || ""),
    }))
    .filter((item) => item.normalizedName && normalizedText.includes(item.normalizedName))
    .sort((left, right) => right.normalizedName.length - left.normalizedName.length);

  if (!matches.length) return null;
  if (matches.length === 1) return matches[0].task;
  if (matches[0].normalizedName === matches[1].normalizedName) return null;
  return matches[0].task;
}

function stripReferencedTaskText(text = "", task = {}) {
  let next = String(text || "").trim();
  next = next.replace(/第\s*([0-9]+|[一二两三四五六七八九十]{1,3})\s*(?:个|条)?(?:定时任务|任务)?/gi, " ");
  if (task?.name) {
    next = next.replace(new RegExp(escapeRegExp(task.name), "gi"), " ");
  }
  return next;
}

function normalizeUpdatedPromptCandidate(text = "") {
  return String(text || "")
    .replace(/^(?:为|成|到|一下|一下子|一下吧|一下哦)\s*/g, "")
    .replace(/(?:的时间|时间|执行时间|cron表达式|cron|表达式)$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUpdatedTaskPrompt(text = "", task = {}) {
  const source = stripReferencedTaskText(text, task);
  if (!source) return "";

  const prompt = source
    .replace(/^(请帮我|麻烦你|麻烦|请你|请|把)\s*/g, "")
    .replace(UPDATE_VERB_GLOBAL_RE, " ")
    .replace(/(?:任务内容|提醒内容|任务文案|文案|内容|提示词|时间|执行时间)\s*/g, " ")
    .replace(TASK_WORD_GLOBAL_RE, " ")
    .replace(EXPLICIT_CRON_RE, " ")
    .replace(/(?:每周|每星期|每个星期)\s*[一二三四五六日天]/g, " ")
    .replace(/(?:每天|每日|每个工作日|工作日)/g, " ")
    .replace(TIME_WORD_RE, " ")
    .replace(/\d{1,2}\s*(?:点|:|：)\s*\d{0,2}\s*(?:分)?/g, " ")
    .replace(/[，。；;:：]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normalized = normalizeUpdatedPromptCandidate(prompt);
  if (!normalized) {
    return "";
  }
  if (/^(?:启用|开启|打开|恢复|继续|暂停|停掉|停用|关闭|关掉|禁用)$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function inferScheduledTaskUpdateArgsFromText(text = "", task = {}) {
  const source = String(text || "").trim();
  if (!source || !task || !task.id || !UPDATE_INTENT_RE.test(source)) {
    return null;
  }

  const args = { id: task.id };
  const cronExpression = inferCronExpressionFromText(source);
  if (cronExpression) {
    args.cronExpression = cronExpression;
  }

  const prompt = extractUpdatedTaskPrompt(source, task);
  if (prompt) {
    args.prompt = prompt;
    args.name = inferScheduledTaskName(prompt, args.cronExpression || String(task.cronExpression || ""));
  }

  return Object.keys(args).length > 1 ? args : null;
}

function inferScheduledTaskIntentFromText(text = "", options = {}) {
  const source = String(text || "").trim();
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  if (!source) return null;

  const referencedTask = findReferencedScheduledTask(tasks, source);
  if (referencedTask) {
    if (RUN_INTENT_RE.test(source)) {
      return { action: "run", args: { id: referencedTask.id }, task: referencedTask };
    }
    if (DELETE_INTENT_RE.test(source)) {
      return { action: "delete", args: { id: referencedTask.id }, task: referencedTask };
    }
    if (DISABLE_INTENT_RE.test(source)) {
      return { action: "disable", args: { id: referencedTask.id, enabled: false }, task: referencedTask };
    }
    if (ENABLE_INTENT_RE.test(source)) {
      return { action: "enable", args: { id: referencedTask.id, enabled: true }, task: referencedTask };
    }

    const updateArgs = inferScheduledTaskUpdateArgsFromText(source, referencedTask);
    if (updateArgs) {
      return { action: "update", args: updateArgs, task: referencedTask };
    }
  }

  const createArgs = inferScheduledTaskArgsFromText(source);
  if (createArgs && CREATE_VERB_RE.test(source)) {
    return { action: "create", args: createArgs };
  }

  if (hasListScheduledTaskIntent(source)) {
    return { action: "list" };
  }

  if (createArgs) {
    return { action: "create", args: createArgs };
  }

  return null;
}

function formatScheduledTaskCreationReply(task = {}) {
  const name = String(task.name || "定时任务").trim();
  const cronExpression = String(task.cronExpression || "").trim();
  const qqPushText = task.qqPushEnabled && String(task.qqTargetId || "").trim()
    ? `\nQQ 推送：${String(task.qqTargetType || "").trim().toLowerCase() === "group" ? "群" : "QQ"} ${String(task.qqTargetId || "").trim()}`
    : "";
  return `已经帮你创建好定时任务：${name}\n执行时间使用 Cron 表达式：${cronExpression}${qqPushText}`;
}

function formatScheduledTaskDateTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(/\//g, "-");
}

function sortScheduledTasksForDisplay(tasks = []) {
  return (Array.isArray(tasks) ? tasks : [])
    .slice()
    .sort((left, right) => {
      const createdDiff = Number(right?.createdAt || 0) - Number(left?.createdAt || 0);
      if (createdDiff) {
        return createdDiff;
      }
      return Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0);
    });
}

function formatScheduledTaskTableCell(value = "") {
  return String(value || "")
    .replace(/\|/g, "/")
    .replace(/\r?\n/g, " ")
    .trim() || "-";
}

function formatScheduledTaskListReply(result = {}) {
  const tasks = sortScheduledTasksForDisplay(result.tasks);
  if (!tasks.length) {
    return "当前还没有定时任务。";
  }

  const rows = tasks.slice(0, 20).map((task, index) => {
    const name = formatScheduledTaskTableCell(task?.name || "未命名任务");
    const status = formatScheduledTaskTableCell(task?.running ? "运行中" : task?.enabled ? "已启用" : "已暂停");
    const cronExpression = formatScheduledTaskTableCell(task?.cronExpression || "");
    const createdAt = formatScheduledTaskTableCell(formatScheduledTaskDateTime(task?.createdAt));
    const updatedAt = formatScheduledTaskTableCell(formatScheduledTaskDateTime(task?.updatedAt));
    return `| ${index + 1} | ${name} | ${status} | ${cronExpression} | ${createdAt} | ${updatedAt} |`;
  });

  return [
    "当前定时任务：",
    "| 序号 | 任务 | 状态 | Cron | 创建时间 | 最后修改 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function appendScheduledTaskListAfterAction(summary = "", tasks = []) {
  const listText = formatScheduledTaskListReply({ tasks });
  return [String(summary || "").trim(), listText].filter(Boolean).join("\n\n");
}

function formatScheduledTaskActionReply(intent = {}, result = {}, options = {}) {
  if (!intent || typeof intent !== "object") return "";

  const taskName = String(result.name || intent.task?.name || "未命名任务").trim() || "未命名任务";
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  switch (intent.action) {
    case "create":
      return appendScheduledTaskListAfterAction(formatScheduledTaskCreationReply(result), tasks);
    case "list":
      return formatScheduledTaskListReply(result);
    case "run":
      return appendScheduledTaskListAfterAction(`已经立即执行定时任务：${taskName}`, tasks);
    case "delete":
      return appendScheduledTaskListAfterAction(`已经删除定时任务：${taskName}`, tasks);
    case "disable":
      return appendScheduledTaskListAfterAction(`已经暂停定时任务：${taskName}`, tasks);
    case "enable":
      return appendScheduledTaskListAfterAction(`已经启用定时任务：${taskName}`, tasks);
    case "update": {
      const cronExpression = String(result.cronExpression || intent.args?.cronExpression || "").trim();
      const summary = cronExpression
        ? `已经更新定时任务：${taskName}\n当前 Cron：${cronExpression}`
        : `已经更新定时任务：${taskName}`;
      return appendScheduledTaskListAfterAction(summary, tasks);
    }
    default:
      return "";
  }
}

function matchesScheduledTaskHighlight(task = {}, options = {}) {
  const highlightCreatorId = String(options?.highlightCreatorId || "").trim();
  if (!highlightCreatorId) {
    return false;
  }
  const highlightCreatorType = String(options?.highlightCreatorType || "private").trim().toLowerCase() || "private";
  const creatorType = String(task?.creatorType || "").trim().toLowerCase() || "private";
  const creatorId = String(task?.creatorId || "").trim();
  return creatorType === highlightCreatorType && creatorId === highlightCreatorId;
}

function formatScheduledTaskListReply(result = {}, options = {}) {
  const tasks = sortScheduledTasksForDisplay(result.tasks);
  if (!tasks.length) {
    return "\u5f53\u524d\u8fd8\u6ca1\u6709\u5b9a\u65f6\u4efb\u52a1\u3002";
  }

  let highlightedCount = 0;
  const rows = tasks.slice(0, 20).map((task, index) => {
    const highlighted = matchesScheduledTaskHighlight(task, options);
    if (highlighted) {
      highlightedCount += 1;
    }
    const name = formatScheduledTaskTableCell(task?.name || "\u672a\u547d\u540d\u4efb\u52a1");
    const creatorText = task?.creatorLabel || `${String(task?.creatorType || "").trim().toLowerCase() === "group" ? "\u7fa4" : "QQ"} ${String(task?.creatorId || "").trim() || "1036986718"}`;
    const creator = formatScheduledTaskTableCell(
      highlighted ? `${creatorText} [\u5f53\u524dQQ]` : creatorText
    );
    const status = formatScheduledTaskTableCell(task?.running ? "\u8fd0\u884c\u4e2d" : task?.enabled ? "\u5df2\u542f\u7528" : "\u5df2\u6682\u505c");
    const cronExpression = formatScheduledTaskTableCell(task?.cronExpression || "");
    return `| ${index + 1} | ${name} | ${creator} | ${status} | ${cronExpression} |`;
  });

  return [
    "\u5f53\u524d\u5b9a\u65f6\u4efb\u52a1\uff1a",
    highlightedCount ? "\u5df2\u7528 [\u5f53\u524dQQ] \u6807\u6ce8\u5f53\u524d QQ \u521b\u5efa\u7684\u4efb\u52a1\u3002" : "",
    "| \u5e8f\u53f7 | \u4efb\u52a1 | \u521b\u5efa\u8005 | \u72b6\u6001 | Cron |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].filter(Boolean).join("\n");
}

function appendScheduledTaskListAfterAction(summary = "", tasks = [], options = {}) {
  const listText = formatScheduledTaskListReply({ tasks }, options);
  return [String(summary || "").trim(), listText].filter(Boolean).join("\n\n");
}

function formatScheduledTaskActionReply(intent = {}, result = {}, options = {}) {
  if (!intent || typeof intent !== "object") return "";

  const taskName = String(result.name || intent.task?.name || "\u672a\u547d\u540d\u4efb\u52a1").trim() || "\u672a\u547d\u540d\u4efb\u52a1";
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  switch (intent.action) {
    case "create":
      return appendScheduledTaskListAfterAction(formatScheduledTaskCreationReply(result), tasks, options);
    case "list":
      return formatScheduledTaskListReply(result, options);
    case "run":
      return `\u5df2\u7ecf\u7acb\u5373\u6267\u884c\u5b9a\u65f6\u4efb\u52a1\uff1a${taskName}`;
    case "delete":
      return appendScheduledTaskListAfterAction(`\u5df2\u7ecf\u5220\u9664\u5b9a\u65f6\u4efb\u52a1\uff1a${taskName}`, tasks, options);
    case "disable":
      return appendScheduledTaskListAfterAction(`\u5df2\u7ecf\u6682\u505c\u5b9a\u65f6\u4efb\u52a1\uff1a${taskName}`, tasks, options);
    case "enable":
      return appendScheduledTaskListAfterAction(`\u5df2\u7ecf\u542f\u7528\u5b9a\u65f6\u4efb\u52a1\uff1a${taskName}`, tasks, options);
    case "update": {
      const cronExpression = String(result.cronExpression || intent.args?.cronExpression || "").trim();
      const summary = cronExpression
        ? `\u5df2\u7ecf\u66f4\u65b0\u5b9a\u65f6\u4efb\u52a1\uff1a${taskName}\n\u5f53\u524d Cron\uff1a${cronExpression}`
        : `\u5df2\u7ecf\u66f4\u65b0\u5b9a\u65f6\u4efb\u52a1\uff1a${taskName}`;
      return appendScheduledTaskListAfterAction(summary, tasks, options);
    }
    default:
      return "";
  }
}

module.exports = {
  inferCronExpressionFromText,
  hasCreateScheduledTaskIntent,
  inferScheduledTaskArgsFromText,
  inferScheduledTaskIntentFromText,
  formatScheduledTaskCreationReply,
  formatScheduledTaskActionReply,
};
