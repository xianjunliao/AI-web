const { maybeRunDirectWebSearch } = require("./server-live-web-search");

const FORCE_WEB_SEARCH_RE = /(?:\bweb_search\b|联网|上网|网页|网络搜索|联网搜索|搜索工具|联网工具)/i;
const LIVE_DATA_TOPIC_RE = /(?:最新|实时|热搜|新闻|资讯|数据|价格|股价|汇率|排行|榜单|热点|发布|要点)/i;
const LIVE_DATA_ACTION_RE = /(?:查询|搜索|获取|整理|汇总|总结|播报|查下|查一查|看看)/i;

function shouldForceWebSearch(task = {}) {
  const prompt = String(task?.prompt || "").trim();
  if (!prompt) {
    return false;
  }
  if (FORCE_WEB_SEARCH_RE.test(prompt)) {
    return true;
  }
  return LIVE_DATA_TOPIC_RE.test(prompt) && LIVE_DATA_ACTION_RE.test(prompt);
}

function createTaskModelInvoker({ callLocalModelWithTools, getTaskModel, searchWeb }) {
  return async function callLocalModelForTask(task) {
    const requireWebSearch = shouldForceWebSearch(task);
    const directWebSearch = await maybeRunDirectWebSearch({
      text: task?.prompt,
      searchWeb,
      enabled: requireWebSearch,
      intro: "定时任务联网搜索结果",
    });
    if (directWebSearch?.reply) {
      return directWebSearch.reply;
    }

    const model = String(
      typeof getTaskModel === "function"
        ? getTaskModel(task)
        : ""
    ).trim();
    if (!model) {
      const error = new Error("Base connection model is not configured");
      error.statusCode = 400;
      throw error;
    }
    const taskTools = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get current weather for a city or location.",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "web_search",
          description: "Search the live web for current information. Use one focused query and keep the result count small.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
              limit: { type: "number" },
            },
            required: ["query"],
          },
        },
      },
    ];

    return await callLocalModelWithTools({
      model,
      messages: [
        {
          role: "system",
          content: [
            "你正在执行一个定时任务。请直接完成任务，不要只解释能力限制。",
            "如果任务涉及天气，请调用 get_weather。",
            "If the task needs current internet information such as news, prices, releases, or webpage findings, call web_search instead of guessing.",
            requireWebSearch ? "This task explicitly needs live web data. You must call web_search exactly once, then write the final answer concisely." : "",
          ].join("\n"),
        },
        {
          role: "user",
          content: task.prompt,
        },
      ],
      tools: taskTools,
      requiredToolName: requireWebSearch ? "web_search" : "",
      singleUseToolNames: requireWebSearch ? ["web_search"] : [],
    });
  };
}

module.exports = {
  createTaskModelInvoker,
};
