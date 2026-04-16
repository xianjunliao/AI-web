const LIVE_WEB_QUERY_HINT_RE = /(?:\bweb_search\b|联网|上网|网页|网络搜索|联网搜索|搜索工具|联网工具|最新|实时|热搜|新闻|资讯|热点|榜单|要点|发布|价格|股价|汇率|排行|数据)/i;
const LIVE_WEB_QUERY_ACTION_RE = /(?:查下|查一下|查一查|查询|搜索|搜下|搜一下|搜一搜|获取|整理|汇总|总结|播报|看看|看下|找下|找一下)/i;
const DIRECT_WEB_SEARCH_ACTION_RE = /(?:查下|查一下|查一查|查询|搜索|搜下|搜一下|搜一搜|获取|看看|看下|找下|找一下)/i;
const DIRECT_WEB_SEARCH_BRIEF_ACTION_RE = /(?:整理|汇总|总结|播报)/i;
const DIRECT_WEB_SEARCH_BLOCK_RE = /(?:定时任务|cron|创建任务|新建任务|添加任务|修改任务|更新任务|删除任务|暂停任务|启用任务|运行任务|执行任务|QQ|群里|私聊|写入文件|保存到|保存为|read_file|write_file|run_shell_command|run_cli_command|代码|脚本|目录|文件|技能|persona)/i;
const DIRECT_WEB_SEARCH_ANALYSIS_RE = /(?:并|同时|对比|分析|点评|原因|为什么|怎么|详细|深入|趋势|解读|结合)/i;
const LEADING_ASSISTANT_MENTION_RE = /^@\S+\s*/;
const LEADING_POLITE_PREFIX_RE = /^(?:请|麻烦|帮我|帮忙|请你|请帮我|请帮忙|能否|能不能|可以|可否|想让你|替我)\s*/i;
const LEADING_SEARCH_TOOL_RE = /^(?:(?:用)?(?:联网搜索工具|联网工具|搜索工具|web_search 工具|web_search工具|web_search|联网搜索|网络搜索|网页搜索|上网搜索|上网))\s*/i;
const LEADING_ACTION_RE = /^(?:(?:来)?(?:查下|查一下|查一查|查询|搜索|搜下|搜一下|搜一搜|获取|整理|汇总|总结|播报|看看|看下|找下|找一下))\s*/i;
const TRAILING_FILLER_RE = /(?:一下|看看|好吗|可以吗|谢谢|谢谢你)?[。！!？?]*$/i;

function normalizeWebSearchText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function detectDirectWebSearchMode(text = "") {
  const normalizedText = normalizeWebSearchText(text);
  if (!normalizedText) {
    return "";
  }
  if (DIRECT_WEB_SEARCH_BLOCK_RE.test(normalizedText)) {
    return "";
  }
  if (DIRECT_WEB_SEARCH_ANALYSIS_RE.test(normalizedText)) {
    return "";
  }
  if (!LIVE_WEB_QUERY_HINT_RE.test(normalizedText)) {
    return "";
  }
  if (DIRECT_WEB_SEARCH_ACTION_RE.test(normalizedText)) {
    return "list";
  }
  if (DIRECT_WEB_SEARCH_BRIEF_ACTION_RE.test(normalizedText)) {
    return "brief";
  }
  return "";
}

function canHandleAsDirectWebSearch(text = "") {
  return Boolean(detectDirectWebSearchMode(text));
}

function extractDirectWebSearchQuery(text = "") {
  let query = normalizeWebSearchText(text);
  if (!query) {
    return "";
  }

  const cleanupPatterns = [
    LEADING_ASSISTANT_MENTION_RE,
    LEADING_POLITE_PREFIX_RE,
    LEADING_SEARCH_TOOL_RE,
    LEADING_ACTION_RE,
  ];

  for (const pattern of cleanupPatterns) {
    query = query.replace(pattern, "").trim();
  }

  query = query
    .replace(/^(?:请|麻烦|帮我|帮忙)\s*/i, "")
    .replace(TRAILING_FILLER_RE, "")
    .replace(/[。！!？?]+$/g, "")
    .trim();

  return query || normalizeWebSearchText(text);
}

function formatDirectWebSearchReply(result = {}, options = {}) {
  const intro = String(options.intro || "已完成联网搜索").trim() || "已完成联网搜索";
  const query = normalizeWebSearchText(result?.query || options.query || "");
  const results = Array.isArray(result?.results) ? result.results : [];
  const mode = String(options.mode || "list").trim() || "list";

  if (!results.length) {
    return query
      ? `${intro}：${query}\n未找到可用结果。`
      : `${intro}\n未找到可用结果。`;
  }

  const maxItems = Math.min(Math.max(Number(options.maxItems) || (mode === "brief" ? 4 : 3), 1), 5);
  const lines = [query ? `${intro}：${query}` : intro];

  for (const [index, item] of results.slice(0, maxItems).entries()) {
    const title = normalizeWebSearchText(item?.title || `结果 ${index + 1}`);
    const snippet = normalizeWebSearchText(item?.snippet || "");
    const url = normalizeWebSearchText(item?.url || "");
    lines.push(`${index + 1}. ${title}`);
    if (snippet) {
      lines.push(`   ${mode === "brief" ? "要点" : "摘要"}：${snippet}`);
    }
    if (url) {
      lines.push(`   链接：${url}`);
    }
  }

  return lines.join("\n");
}

async function maybeRunDirectWebSearch({
  text = "",
  searchWeb,
  enabled = true,
  limit,
  intro = "已完成联网搜索",
} = {}) {
  if (!enabled || typeof searchWeb !== "function") {
    return null;
  }

  const mode = detectDirectWebSearchMode(text);
  if (!mode) {
    return null;
  }

  const query = extractDirectWebSearchQuery(text);
  if (!query) {
    return null;
  }

  const preferredLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Number(limit)
    : (mode === "brief" ? 4 : 3);
  const resolvedLimit = Math.min(Math.max(preferredLimit, 1), 5);
  const result = await searchWeb(query, resolvedLimit);
  return {
    query,
    result,
    mode,
    reply: formatDirectWebSearchReply(result, {
      intro,
      query,
      mode,
      maxItems: resolvedLimit,
    }),
  };
}

module.exports = {
  canHandleAsDirectWebSearch,
  detectDirectWebSearchMode,
  extractDirectWebSearchQuery,
  formatDirectWebSearchReply,
  maybeRunDirectWebSearch,
};
