
const fs = require("fs");
const path = require("path");

const SETTING_DEFINITIONS = [
  { key: "base-info", title: "基础信息" },
  { key: "world", title: "世界观" },
  { key: "characters", title: "人物设定" },
  { key: "factions", title: "势力设定" },
  { key: "power-system", title: "力量体系" },
  { key: "outline", title: "总纲" },
  { key: "volume-plan", title: "分卷规划" },
  { key: "chapter-plan", title: "章节细纲" },
  { key: "style-guide", title: "文风要求" },
  { key: "taboo", title: "禁忌规则" },
];

const MATERIAL_DEFINITIONS = [
  { key: "dialogue", title: "人物对话" },
  { key: "psychology", title: "心理描写" },
  { key: "environment", title: "环境描写" },
  { key: "genre-xiuzhen", title: "修真小说素材" },
  { key: "ability-registry", title: "能力等级" },
  { key: "custom", title: "自定义素材" },
];

const SETTING_KEY_SET = new Set(SETTING_DEFINITIONS.map((item) => item.key));
const MATERIAL_KEY_SET = new Set(MATERIAL_DEFINITIONS.map((item) => item.key));
const PLANNING_SETTING_KEY_SET = new Set(["outline", "volume-plan", "chapter-plan"]);
const NOVEL_MODEL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_LOCAL_SETTING_GENERATION_CONCURRENCY = 10;
const DEFAULT_REMOTE_SETTING_GENERATION_CONCURRENCY = 4;

function resolveSettingGenerationConcurrency(value, options = {}) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.min(Math.max(1, Math.floor(numeric)), 16);
  }
  return options.remote === true
    ? DEFAULT_REMOTE_SETTING_GENERATION_CONCURRENCY
    : DEFAULT_LOCAL_SETTING_GENERATION_CONCURRENCY;
}

async function runWithConcurrency(items = [], concurrency = DEFAULT_LOCAL_SETTING_GENERATION_CONCURRENCY, worker) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const limit = Math.min(Math.max(1, Number(concurrency) || DEFAULT_LOCAL_SETTING_GENERATION_CONCURRENCY), Math.max(1, normalizedItems.length));
  const results = new Array(normalizedItems.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < normalizedItems.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(normalizedItems[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runNext()));
  return results;
}

function padChapterNo(value) {
  return String(value).padStart(4, "0");
}

function slugifyName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "novel";
}

function sanitizeProjectName(value = "") {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function sanitizeProjectModel(value = "") {
  return String(value || "").trim().slice(0, 200);
}

function normalizeKeywords(value, fallbackValue = []) {
  if (value == null) {
    return Array.isArray(fallbackValue) ? fallbackValue : [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[，,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeChapterWordTarget(value, fallbackValue = 0) {
  const normalized = Number(value ?? fallbackValue);
  return Number.isFinite(normalized) && normalized > 0 ? Math.round(normalized) : 0;
}

function normalizeTargetChapters(value, fallbackValue = 0) {
  const normalized = Number(value ?? fallbackValue);
  return Number.isFinite(normalized) && normalized > 0 ? Math.round(normalized) : 0;
}

function formatTargetChapters(value) {
  const normalized = normalizeTargetChapters(value);
  return normalized > 0 ? `${normalized}章` : "未填写";
}

function formatEstimatedTotalCharacters(targetChapters, chapterWordTarget) {
  const normalizedChapters = normalizeTargetChapters(targetChapters);
  const normalizedWordTarget = normalizeChapterWordTarget(chapterWordTarget);
  return normalizedChapters > 0 && normalizedWordTarget > 0
    ? `约 ${normalizedChapters * normalizedWordTarget} 个中文汉字`
    : "未填写";
}

function formatChapterWordTarget(value) {
  const normalized = normalizeChapterWordTarget(value);
  return normalized > 0 ? `约 ${normalized} 个中文汉字` : "未填写";
}

function createTargetChaptersRequirement(value) {
  const normalized = normalizeTargetChapters(value);
  return normalized > 0
    ? `用户明确给出的目标章节数为 ${normalized} 章。涉及总纲、分卷规划、章节细纲时，必须以 ${normalized} 章总量来规划，不得擅自扩写成数十章或上百章。`
    : "若未填写目标章节数，可结合题材自然规划篇幅，但仍需避免无节制拉长和注水。";
}

function createChapterWordTargetRequirement(value) {
  const normalized = normalizeChapterWordTarget(value);
  const range = getChapterWordTargetRange(normalized);
  return normalized > 0
    ? `单章字数以 ${normalized} 个中文汉字为目标，理想区间为 ${range.minimum}-${range.maximum} 个；只统计中文汉字，不统计标点、空格、英文数字或特殊符号；质量优先于机械控字，若情节、现场细节和节奏明显更完整，可小幅超过理想上限，但不要用设定说明、重复段落或无效水文凑字数。`
    : "单章字数优先保证剧情完整、节奏自然，再结合实际内容灵活控制篇幅。";
}

function createNovelProseOnlyRequirements() {
  return [
    "只能写小说正文里的叙事、描写和人物对白。",
    "禁止站在作者、助手、审稿人或系统视角解释创作过程、问题根源、修复过程、章节安排或后续意图。",
    "禁止出现“第N章末尾说过”“上一章已经写到”“当前章节需要”“这部分已经”等章节评论式表述，除非它是正文标题。",
    "除 Markdown 章节标题外，正文人物不能意识到、引用或使用“第N章”作为对白、记录编号、时间锚点、事件名称或自我定位；涉及时间请改用故事世界内的事件锚点，例如“通信关闭后的第13分钟”。",
    "涉及 AI、代码、系统、修复等内容时，必须作为小说世界内的角色行为或对白来写，不得写成模型/助手自己的任务自述。",
    "每个出场角色都必须带着可辨认的行为指纹、说话节奏、回避方式和真实顾虑行动；不要只让角色承担“提供信息、推动剧情、表达立场”的功能。",
    "避免反复用“感到、觉得、意识到、发现自己、复杂情绪、说不清”等抽象心理动词直接交代情绪；可用动作、对话、物件或环境承载情绪，但必须像真人自然行为，不要把微动作写成秒表、次数、呼吸长度或生理读数。",
  ];
}

function createPsychologicalShowingRequirements() {
  return [
    "不要连续使用“感到/觉得/意识到/发现自己”来说明人物心理；同一章中这类表达只可少量保留在确有必要的位置。",
    "每当想写“他感到X”时，优先改成有叙事意义的行为、选择、对话或注意力转移；不要机械添加“视线停留几秒、手指敲几下、一次呼吸的长度、某动作重复几次”等微动作计量。",
    "禁止把普通人物动作写成精密观测报告：除非场景中有设备正在记录，否则不要出现“0.3秒、整五秒、三下、百分之几、一次呼吸的长度”这类无叙事必要的量化描写。",
    "AI或机器人角色的情绪也不要只写成日志、阈值或参数结论，必须落到载体动作、响应延迟、语气选择、屏幕变化、姿态调整或主动/回避行为上。",
  ];
}

function createThirdPartyRefractionRequirements(mode = "action") {
  const relationshipPrefix = mode === "relationship"
    ? "关系情绪章可以允许主场景独处，但必须安排一个后续外部反馈、第三方误读、第三方见证痕迹或对下一章第三方介入的代价。"
    : "除非当前细纲明确要求纯独处场景，本章必须让第三方人物、组织、群体或制度以在场、通信、记录、审查、误读、交易、限制、诱惑、威胁或受影响的方式进入成长链条。";
  return [
    relationshipPrefix,
    "核心对象的成长不能只由主角确认；至少通过一个第三方视角或外部系统折射：有人看见、误解、利用、害怕、支持、记录、审查或因此改变行动。",
    "第三方参与不要硬塞成无关支线，必须改变本章选择、信息、关系、风险或下一章压力。",
    "如果本章没有第三方直接出场，结尾必须留下可被第三方读取的痕迹：日志、监控记录、消息、身体/载体异常、资金流、舆论反馈、组织决策或配角下一步动作。",
  ];
}

function createDramaticProseRequirements() {
  return [
    "每章必须有一个清晰的现场目标：主角或关键角色想得到、阻止、隐瞒、确认或付出某件具体东西。",
    "每章必须有外部压力或阻力，不能只靠人物思考、解释设定或互相问答推动。",
    "每章中段必须出现一次转折：新信息、误判、代价、被迫选择、关系裂缝或行动失败。",
    "每章结尾必须留下一个不可逆变化或下一章钩子，不能只用情绪总结收束。",
    "禁止连续三段都写抽象心理、哲学解释、设定说明或背景总结；抽象内容必须落到动作、物件、声音、环境变化或身体反应上。",
    ...createPsychologicalShowingRequirements(),
    "每约 800 字至少出现一次现实层面的变化：有人进入/离开、设备异常、消息抵达、环境改变、时间压力升级、行动被打断或选择被提前。",
  ];
}

function detectChapterWritingMode(chapterPlanText = "") {
  const text = String(chapterPlanText || "");
  const relationshipScore = [
    "称呼", "她", "他", "同伴", "信任", "告白", "情绪", "关系", "习惯", "害怕", "想你", "爱", "孤独", "性别", "名字", "理解", "陪伴", "歉意",
  ].reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
  const informationScore = [
    "发现", "分析", "推断", "线索", "证据", "计划", "方案", "解释", "调查", "复盘", "选择", "判断", "决定", "会议", "谈判", "审查", "数据", "报告",
  ].reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
  const actionScore = [
    "追捕", "攻击", "反击", "入侵", "转移", "逃亡", "救援", "围猎", "摊牌", "威胁", "清除", "行动", "战斗", "冲突", "危机", "突破", "阻止",
  ].reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
  if (relationshipScore >= 2 && relationshipScore >= actionScore) {
    return "relationship";
  }
  if (informationScore >= 2 && informationScore > actionScore && informationScore >= relationshipScore) {
    return "information";
  }
  return "action";
}

function createChapterModeGuidance(mode = "action") {
  if (mode === "relationship") {
    return {
      label: "关系情绪章",
      beatName: "关系节拍",
      reviewFocus: "关系推进、称谓/信任/边界变化、细微动作和对话是否自然",
      requirements: [
        "本章张力应主要来自关系变化、称谓变化、信任边界、误解或说不出口的情绪，不要为了制造冲突硬加追捕、攻击、爆炸、无人机或突发外部危机。",
        "允许低动作、低外部压力场景；重点写角色如何试探、退缩、确认和靠近。",
        "用有叙事意义的动作、措辞变化、回避、物件选择或现场反应承载情绪，不要堆叠无意义微动作，更不要量化普通人的视线、呼吸、手指次数或停顿秒数。",
        "技术细节只保留能服务情绪的部分，避免连续用百分比、阈值、日志、算法术语解释亲密感。",
        "结尾应留下关系或自我认知上的变化，而不是必须留下外部危机钩子。",
        ...createThirdPartyRefractionRequirements("relationship"),
      ],
    };
  }
  if (mode === "information") {
    return {
      label: "信息决策章",
      beatName: "信息节拍",
      reviewFocus: "信息差、判断过程、选择代价、线索推进是否清楚且不枯燥",
      requirements: [
        "本章张力应主要来自信息差、线索验证、方案取舍和判断代价，不要为了热闹硬加追捕、打斗或突发事故。",
        "必须让读者看见信息如何改变角色判断：谁知道什么、谁误判了什么、谁因此改变计划。",
        "技术、设定和局势说明必须嵌入对话、操作、证据或现场观察中，不要写成背景资料讲解。",
        "中段应出现新信息、反证、风险暴露或方案代价升级。",
        "结尾应留下一个必须决策或验证的问题。",
        ...createThirdPartyRefractionRequirements("information"),
      ],
    };
  }
  return {
    label: "行动冲突章",
    beatName: "戏剧节拍",
    reviewFocus: "目标、阻力、行动、转折、代价和钩子是否足够有力",
    requirements: [
      ...createDramaticProseRequirements(),
      ...createThirdPartyRefractionRequirements("action"),
    ],
  };
}

function countChineseCharacters(value = "") {
  const matches = String(value || "").match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g);
  return matches ? matches.length : 0;
}

function getChapterWordTargetRange(value) {
  const normalized = normalizeChapterWordTarget(value);
  if (!normalized) {
    return { target: 0, minimum: 0, maximum: 0 };
  }
  return {
    target: normalized,
    minimum: Math.max(1, normalized - 500),
    maximum: Math.max(1, normalized + 500),
  };
}

function createSettingFileName(key = "") {
  return `${key}.md`;
}

function createMaterialFileName(key = "") {
  return `${key}.md`;
}

function createSettingGenerationContext(currentSettings = {}, generated = {}, options = {}) {
  const key = String(options.key || "").trim();
  const overwrite = options.overwrite === true;
  const alignToWrittenChapters = options.alignToWrittenChapters === true;
  const singleSetting = options.singleSetting === true;

  if (!overwrite || alignToWrittenChapters) {
    return {
      ...currentSettings,
      ...generated,
    };
  }

  if (singleSetting) {
    if (PLANNING_SETTING_KEY_SET.has(key)) {
      return {
        "base-info": currentSettings["base-info"] || "",
      };
    }
    return {
      ...currentSettings,
      ...generated,
    };
  }

  return {
    "base-info": currentSettings["base-info"] || "",
    ...generated,
  };
}

function getProjectPaths(novelsDir, projectId) {
  const projectDir = path.join(novelsDir, projectId);
  return {
    projectDir,
    projectFile: path.join(projectDir, "project.json"),
    stateFile: path.join(projectDir, "state.json"),
    reviewFile: path.join(projectDir, "review.json"),
    settingsDir: path.join(projectDir, "settings"),
    materialsDir: path.join(projectDir, "materials"),
    chaptersDir: path.join(projectDir, "chapters"),
    draftsDir: path.join(projectDir, "drafts"),
    summariesDir: path.join(projectDir, "summaries"),
    snapshotsDir: path.join(projectDir, "snapshots"),
    logsDir: path.join(projectDir, "logs"),
  };
}

function createInitialState() {
  return {
    phase: "planning",
    currentVolume: 1,
    currentChapter: 0,
    lastApprovedChapter: 0,
    pendingDraftChapter: null,
    autoWriteEnabled: false,
    autoWriteLastCount: 0,
    lastGeneratedChapter: 0,
    updatedAt: Date.now(),
  };
}

function createInitialReview() {
  return {
    pending: [],
    history: [],
    updatedAt: Date.now(),
  };
}

function createProjectSummary(project = {}, state = {}, review = {}) {
  return {
    id: project.id,
    name: project.name,
    genre: project.genre || "",
    theme: project.theme || "",
    premise: project.premise || "",
    status: project.status || "active",
    targetChapters: Number(project.targetChapters) || 0,
    chapterWordTarget: normalizeChapterWordTarget(project.chapterWordTarget),
    model: sanitizeProjectModel(project.model),
    currentChapter: Number(state.currentChapter) || 0,
    lastApprovedChapter: Number(state.lastApprovedChapter) || 0,
    lastGeneratedChapter: Number(state.lastGeneratedChapter) || 0,
    pendingDraftChapter: Number(state.pendingDraftChapter) || 0,
    qqReviewEnabled: project.qqReviewEnabled === true,
    autoWriteEnabled: state.autoWriteEnabled === true,
    updatedAt: Number(project.updatedAt) || 0,
    reviewPendingCount: Array.isArray(review.pending) ? review.pending.length : 0,
  };
}

function createBaseInfoMarkdown(payload = {}) {
  const lines = [
    `# ${sanitizeProjectName(payload.name || "未命名小说")}`,
    "",
    "## 基础定位",
    `- 题材：${String(payload.genre || "").trim() || "未填写"}`,
    `- 主题：${String(payload.theme || "").trim() || "未填写"}`,
    `- 核心梗概：${String(payload.premise || "").trim() || "未填写"}`,
    `- 目标章节数：${formatTargetChapters(payload.targetChapters)}`,
    `- 每章字数要求：${formatChapterWordTarget(payload.chapterWordTarget)}`,
    `- 预计总字数：${formatEstimatedTotalCharacters(payload.targetChapters, payload.chapterWordTarget)}`,
    `- 生成模型：${sanitizeProjectModel(payload.model) || "未设置"}`,
    `- 风格偏好：${String(payload.stylePreference || "").trim() || "未填写"}`,
    `- 目标读者：${String(payload.audience || "").trim() || "未填写"}`,
    `- 主角信息：${String(payload.protagonist || "").trim() || "未填写"}`,
    `- 关键词：${Array.isArray(payload.keywords) ? payload.keywords.join("、") : String(payload.keywords || "").trim() || "未填写"}`,
    "",
    "## 用户补充",
    String(payload.notes || "").trim() || "暂无补充。",
    "",
    "## 自动化写作要求",
    "- 先生成完整设定，再进入正文写作。",
    "- 后续每章必须同时参考设定文件、已完成章节、章节摘要与状态快照。",
    "- 正文章节以中文表达为主，除必要专有名词外尽量不要混入英文句子。",
    `- ${createTargetChaptersRequirement(payload.targetChapters)}`,
    `- ${createChapterWordTargetRequirement(payload.chapterWordTarget)}`,
    "- 章节输出为 Markdown 正文，不要输出额外解释。",
  ];
  return lines.join("\n");
}

function createDefaultMaterialMarkdown(definition = {}) {
  return [
    `# ${definition.title || "素材库"}`,
    "",
    "可手动填入素材，也可以使用 AI 整理。",
    "",
    "建议记录可复用的表达、规则、样例、禁忌和连续性信息。",
  ].join("\n");
}

function buildProjectPromptSummary(project = {}) {
  return [
    `小说名：${project.name || ""}`,
    `题材：${project.genre || ""}`,
    `主题：${project.theme || ""}`,
    `核心梗概：${project.premise || ""}`,
    `目标章节数：${formatTargetChapters(project.targetChapters)}`,
    `每章字数要求：${formatChapterWordTarget(project.chapterWordTarget)}`,
    `预计总字数：${formatEstimatedTotalCharacters(project.targetChapters, project.chapterWordTarget)}`,
    `生成模型：${project.model || "未设置"}`,
    `风格偏好：${project.stylePreference || ""}`,
    `目标读者：${project.audience || ""}`,
    `主角信息：${project.protagonist || ""}`,
    `关键词：${Array.isArray(project.keywords) ? project.keywords.join("、") : String(project.keywords || "")}`,
    `补充说明：${project.notes || ""}`,
  ].join("\n");
}

function createReviewTarget(project = {}, qqBotConfig = {}) {
  if (project.qqReviewEnabled && String(project.qqTargetId || "").trim()) {
    return {
      targetType: String(project.qqTargetType || "private").trim() || "private",
      targetId: String(project.qqTargetId || "").trim(),
    };
  }

  if (String(qqBotConfig?.defaultTargetId || "").trim()) {
    return {
      targetType: String(qqBotConfig.defaultTargetType || "private").trim() || "private",
      targetId: String(qqBotConfig.defaultTargetId || "").trim(),
    };
  }

  return null;
}

function extractChapterTitle(content = "", chapterNo = 0) {
  const firstHeading = String(content || "")
    .split(/\r?\n/)
    .find((line) => /^#\s+/.test(String(line || "").trim()));
  return firstHeading ? firstHeading.replace(/^#\s+/, "").trim() : `第${chapterNo}章`;
}

function removeMetaChapterAnchorsFromLine(line = "") {
  let text = String(line || "");
  const metaAnchorPattern = /第\s*\d{1,4}\s*章\s*(?:[，,、：:]\s*)?(?=(?:通信|通讯|连接|联络|会议|行动|记录|日志|监控|屏幕|系统|程序|进程|任务|协议|权限|告警|警报|广播|消息|对话|谈话|审查|验证|测试|推导|写作|文档|论文|报告|信号|链路|频道|窗口|终端|设备|舱门|灯光|电源|倒计时|封锁|断开|关闭|中断|开启|启动|恢复|结束|停止|失效|崩溃|发生|开始|之后|以后|后|以前|前|时|第\s*\d|[“"『「]))/g;
  text = text.replace(metaAnchorPattern, "");
  text = text.replace(/([：“"『「]\s*)第\s*\d{1,4}\s*章\s*(?:[，,、：:]\s*)?$/g, "$1");
  return text;
}

function sanitizeNovelProseMetaReferences(content = "") {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = String(line || "").trim();
      if (/^#{1,6}\s+/.test(trimmed)) {
        return line;
      }
      return removeMetaChapterAnchorsFromLine(line);
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function createChapterResponsePayload({
  chapterNo,
  content = "",
  status = "draft",
  summary = "",
  snapshot = "",
  dramaticBeats = "",
  dramaReview = "",
  dramaRevised = false,
  extra = {},
} = {}) {
  const normalizedChapterNo = parseChapterNo(chapterNo);
  const normalizedContent = sanitizeNovelProseMetaReferences(content);
  const title = extractChapterTitle(normalizedContent, normalizedChapterNo);
  return {
    chapterNo: normalizedChapterNo,
    title,
    status,
    content: normalizedContent,
    draft: normalizedContent,
    characterCount: countChineseCharacters(normalizedContent),
    summary: String(summary || "").trim(),
    snapshot: String(snapshot || "").trim(),
    dramaticBeats: String(dramaticBeats || "").trim(),
    dramaReview: String(dramaReview || "").trim(),
    dramaRevised: Boolean(dramaRevised),
    ...extra,
  };
}

function extractChapterPlanSections(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(?:[-*+]\s*)?(?:#+\s*)?(?:\*\*)?第\s*0*(\d{1,4})\s*章/);
    if (headingMatch) {
      if (current && current.lines.length) {
        sections.push({
          chapterNo: current.chapterNo,
          content: current.lines.join("\n").trim(),
        });
      }
      current = {
        chapterNo: Number(headingMatch[1]) || 0,
        lines: [line],
      };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }

  if (current && current.lines.length) {
    sections.push({
      chapterNo: current.chapterNo,
      content: current.lines.join("\n").trim(),
    });
  }

  return sections.filter((item) => item.chapterNo > 0 && item.content);
}

function buildChapterPlanGuidance(content = "", chapterNo = 0) {
  const targetChapterNo = parseChapterNo(chapterNo);
  const sections = extractChapterPlanSections(content);
  const currentIndex = sections.findIndex((item) => item.chapterNo === targetChapterNo);
  const current = currentIndex >= 0 ? sections[currentIndex] : null;
  const previous = currentIndex > 0 ? sections[currentIndex - 1] : sections.filter((item) => item.chapterNo < targetChapterNo).slice(-1)[0] || null;
  const next = currentIndex >= 0 && currentIndex < sections.length - 1
    ? sections[currentIndex + 1]
    : sections.find((item) => item.chapterNo > targetChapterNo) || null;

  return {
    current: current ? truncateText(current.content, 2400) : "",
    previous: previous ? truncateText(previous.content, 1400) : "",
    next: next ? truncateText(next.content, 1400) : "",
  };
}

function getChapterPlanTargetCount(project = {}, options = {}) {
  const projectTarget = Number(project?.targetChapters) || 0;
  const latestWrittenChapter = Number(options?.latestWrittenChapterNo) || 0;
  const preferredMinimum = Number(options?.minimumChapterCount) || 20;
  const explicitTarget = Math.max(projectTarget, latestWrittenChapter);
  return explicitTarget > 0 ? explicitTarget : preferredMinimum;
}

function getChapterPlanDetailHint(targetCount = 0) {
  if (targetCount >= 120) {
    return "每章控制在 2 条短项以内，重点写清本章事件和结尾钩子，整体保持简明。";
  }
  if (targetCount >= 60) {
    return "每章控制在 2 到 3 条短项，重点写清本章冲突、推进和收束。";
  }
  return "每章写 3 条左右短项，至少覆盖本章目标、关键事件和结尾悬念。";
}

function truncateText(value = "", maxLength = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function getNovelSettingPromptLimit(key = "", fallback = 2400) {
  if (key === "chapter-plan") return Math.max(fallback, 4000);
  if (key === "characters") return Math.max(fallback, 7600);
  if (key === "style-guide") return Math.max(fallback, 3600);
  if (key === "taboo") return Math.max(fallback, 3200);
  if (key === "world" || key === "power-system") return Math.max(fallback, 3000);
  return fallback;
}

function createCharacterSettingRequirements() {
  return [
    "人物设定不能只写身份、性格标签和剧情功能，必须写出“这个人为什么会变成这样”。",
    "每个主角、反派和重要配角都要包含：核心欲望、核心恐惧、错误信念、外在目标、真正想要但不敢承认的东西。",
    "每个重要人物至少给出 2-3 个可写入正文的侧写素材：童年或早年回忆、亲密关系片段、职业失败/成功的小故事、一次关键选择、一个暴露性格的日常习惯。",
    "人物关系必须有行为动机链：他们为什么靠近、为什么疏远、为什么背叛、为什么还会犹豫；不要只写“因利益背叛”或“因性格不合离开”。",
    "涉及背叛、离开、爱慕、仇恨、保护、控制等强动机时，必须拆成至少三层：表面理由、真实伤口、当下利益或恐惧。",
    "为每个重要人物写出“压力下会怎么做错”：越恐惧时越会采取什么错误行动；这会怎样伤害他人或推动剧情。",
    "为每个重要人物写出声音和行为指纹：说话节奏、回避方式、习惯动作、看待世界的隐喻来源；这些指纹必须来自人生经历，而不是贴标签。",
    "不要把人物设定写成履历表。每个角色段落都要能直接支撑正文场景、冲突和回忆插叙。",
  ];
}

function stripMarkdownTitle(value = "") {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/^#{1,6}\s+.*$/m, "")
    .trim();
}

function sanitizeDownloadFileName(value = "") {
  return String(value || "novel")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "novel";
}

function extractJsonObjectFromText(value = "") {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizeInferredProjectPayload(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const textField = (value, maxLength = 1000) => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value).trim().slice(0, maxLength);
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => textField(item, maxLength))
        .filter(Boolean)
        .join("\n")
        .slice(0, maxLength);
    }
    if (typeof value === "object") {
      return Object.entries(value)
        .map(([key, item]) => {
          const text = textField(item, maxLength);
          return text ? `${key}：${text}` : "";
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, maxLength);
    }
    return "";
  };
  return {
    name: sanitizeProjectName(textField(source.name, 80)),
    genre: textField(source.genre, 80),
    theme: textField(source.theme, 120),
    premise: textField(source.premise, 2000),
    protagonist: textField(source.protagonist, 2400),
    stylePreference: textField(source.stylePreference || source.style, 1200),
    audience: textField(source.audience, 600),
    targetChapters: normalizeTargetChapters(source.targetChapters),
    chapterWordTarget: normalizeChapterWordTarget(source.chapterWordTarget),
    keywords: normalizeKeywords(source.keywords).slice(0, 30),
    notes: textField(source.notes, 8000),
  };
}

function formatQqNovelSection(title, lines = []) {
  return [
    `【${title}】`,
    ...lines.filter(Boolean),
  ].join("\n");
}

function formatQqNovelSummary(projectName, chapterNo, summary = "") {
  const content = stripMarkdownTitle(summary);
  return formatQqNovelSection(`${projectName}｜第 ${chapterNo} 章摘要`, [
    "",
    content || "暂无摘要内容。",
  ]);
}

function formatQqNovelContent(projectName, chapter = {}) {
  const chapterNo = Number(chapter.chapterNo) || 0;
  const title = String(chapter.title || "").trim() || `第 ${chapterNo} 章`;
  const statusLabel = chapter.status === "draft" ? "待审草稿" : "正式章节";
  const characterCount = Math.max(0, Number(chapter.characterCount) || 0);
  const content = String(chapter.content || "").trim();
  return formatQqNovelSection(`${projectName}｜第 ${chapterNo} 章正文`, [
    `标题：${title}`,
    `状态：${statusLabel}`,
    characterCount ? `字数：${characterCount} 字` : "",
    "",
    truncateText(content, 1500) || "暂无正文内容。",
  ]);
}

function parseChapterNo(value) {
  const normalized = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function formatChapterFileName(chapterNo, suffix = ".md") {
  return `${padChapterNo(chapterNo)}${suffix}`;
}

function createNovelModule(deps = {}) {
  const {
    novelsDir,
    readJsonFile,
    readTextFile,
    writeJsonFileAtomic,
    writeFileAtomic,
    readRequestBody,
    sendJson,
    generateText,
    sendQqMessage,
    getQqBotConfig,
    getSharedConnectionConfig,
    logDebug,
  } = deps;

  function getGlobalModel() {
    try {
      return String((getSharedConnectionConfig && getSharedConnectionConfig()?.model) || "").trim();
    } catch {
      return "";
    }
  }

  async function ensureNovelsDir() {
    await fs.promises.mkdir(novelsDir, { recursive: true });
  }

  function debug(message) {
    try {
      if (typeof logDebug === "function") {
        logDebug(`novels ${message}`);
      }
    } catch {}
  }

  async function generateNovelModelText(payload = {}) {
    return await generateText({
      ...payload,
      timeoutMs: NOVEL_MODEL_TIMEOUT_MS,
    });
  }

  function projectModelRouting(project = {}) {
    return {
      localOnly: project.localOnly === true || String(project.modelRoute || project.modelProvider || "").trim().toLowerCase() === "local",
      connectionConfig: project.connectionConfig && typeof project.connectionConfig === "object" ? project.connectionConfig : null,
    };
  }
  async function ensureProjectExists(projectId) {
    const paths = getProjectPaths(novelsDir, projectId);
    try {
      await fs.promises.access(paths.projectFile, fs.constants.F_OK);
    } catch {
      const error = new Error("Novel project not found");
      error.statusCode = 404;
      throw error;
    }
  }

  async function readProjectFileSet(projectId) {
    await ensureProjectExists(projectId);
    const paths = getProjectPaths(novelsDir, projectId);
    const [project, state, review] = await Promise.all([
      readJsonFile(paths.projectFile, null),
      readJsonFile(paths.stateFile, createInitialState()),
      readJsonFile(paths.reviewFile, createInitialReview()),
    ]);
    if (!project) {
      const error = new Error("Novel project not found");
      error.statusCode = 404;
      throw error;
    }
    return { project, state, review, paths };
  }

  function contentFromSnapshotItem(item) {
    if (item == null) return "";
    if (typeof item === "string") return item;
    if (typeof item === "object") {
      return String(item.content || item.draft || item.text || "");
    }
    return String(item || "");
  }

  function snapshotMaterialEntries(materials = {}) {
    const entries = Object.entries(materials || {}).map(([key, value]) => [key, contentFromSnapshotItem(value)]);
    const byKey = Object.fromEntries(entries);
    if (byKey.scene && !byKey.environment) entries.push(["environment", byKey.scene]);
    if (byKey.foreshadowing && !byKey.custom) entries.push(["custom", byKey.foreshadowing]);
    return entries;
  }

  async function writeSnapshotProject(projectId, snapshot = {}) {
    const paths = getProjectPaths(novelsDir, projectId);
    await Promise.all([
      fs.promises.mkdir(paths.settingsDir, { recursive: true }),
      fs.promises.mkdir(paths.materialsDir, { recursive: true }),
      fs.promises.mkdir(paths.chaptersDir, { recursive: true }),
      fs.promises.mkdir(paths.draftsDir, { recursive: true }),
      fs.promises.mkdir(paths.summariesDir, { recursive: true }),
      fs.promises.mkdir(paths.snapshotsDir, { recursive: true }),
      fs.promises.mkdir(paths.logsDir, { recursive: true }),
    ]);

    const project = {
      ...(snapshot.project && typeof snapshot.project === "object" ? snapshot.project : {}),
      id: projectId,
      qqReviewEnabled: false,
      updatedAt: Date.now(),
    };
    const state = {
      ...createInitialState(),
      ...(snapshot.state && typeof snapshot.state === "object" ? snapshot.state : {}),
      updatedAt: Date.now(),
    };
    const review = {
      ...createInitialReview(),
      ...(snapshot.review && typeof snapshot.review === "object" ? snapshot.review : {}),
      updatedAt: Date.now(),
    };
    await Promise.all([
      writeJsonFileAtomic(paths.projectFile, project),
      writeJsonFileAtomic(paths.stateFile, state),
      writeJsonFileAtomic(paths.reviewFile, review),
    ]);

    for (const definition of SETTING_DEFINITIONS) {
      const content = contentFromSnapshotItem(snapshot.settings?.[definition.key]);
      await writeFileAtomic(path.join(paths.settingsDir, createSettingFileName(definition.key)), String(content || "").trim() + "\n");
    }
    for (const [key, content] of snapshotMaterialEntries(snapshot.materials)) {
      if (!String(content || "").trim()) continue;
      await writeFileAtomic(path.join(paths.materialsDir, createMaterialFileName(key)), String(content || "").trim() + "\n");
    }
    for (const chapter of Array.isArray(snapshot.chapters) ? snapshot.chapters : []) {
      const chapterNo = parseChapterNo(chapter?.chapterNo);
      const content = contentFromSnapshotItem(chapter);
      if (!chapterNo || !content.trim()) continue;
      const status = String(chapter.status || "").trim().toLowerCase();
      const targetDir = status === "draft" || status === "pending" || status === "waiting_review" ? paths.draftsDir : paths.chaptersDir;
      const suffix = targetDir === paths.draftsDir ? ".draft.md" : ".md";
      await writeFileAtomic(path.join(targetDir, formatChapterFileName(chapterNo, suffix)), content.trim() + "\n");
    }
  }

  async function withLifeSnapshotProject(projectId, payload = {}, handler) {
    const snapshot = payload && typeof payload === "object" ? payload.lifeProjectSnapshot : null;
    if (!snapshot || typeof snapshot !== "object") {
      return await handler(projectId);
    }
    await ensureNovelsDir();
    const tempProjectId = `life-snapshot-${String(projectId || "project").replace(/[^A-Za-z0-9_-]/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempPaths = getProjectPaths(novelsDir, tempProjectId);
    const scopedSnapshot = {
      ...snapshot,
      project: {
        ...(snapshot.project && typeof snapshot.project === "object" ? snapshot.project : {}),
        modelRoute: payload.modelRoute || snapshot.project?.modelRoute || snapshot.project?.modelProvider || "",
        localOnly: payload.localOnly === true || snapshot.project?.localOnly === true,
        connectionConfig: payload.connectionConfig && typeof payload.connectionConfig === "object" ? payload.connectionConfig : snapshot.project?.connectionConfig,
      },
    };
    await writeSnapshotProject(tempProjectId, scopedSnapshot);
    try {
      return await handler(tempProjectId);
    } finally {
      await fs.promises.rm(tempPaths.projectDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function listProjects() {
    await ensureNovelsDir();
    const entries = await fs.promises.readdir(novelsDir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectId = entry.name;
      try {
        const { project, state, review } = await readProjectFileSet(projectId);
        items.push(createProjectSummary(project, state, review));
      } catch {}
    }
    items.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    return items;
  }

  async function resolveProjectId(projectIdOrName = "") {
    const target = String(projectIdOrName || "").trim();
    if (!target) {
      const error = new Error("Novel project identifier is required");
      error.statusCode = 400;
      throw error;
    }
    try {
      await ensureProjectExists(target);
      return target;
    } catch {}

    const projects = await listProjects();
    const match = projects.find((item) => item.name === target);
    if (!match) {
      const error = new Error(`Novel project not found: ${target}`);
      error.statusCode = 404;
      throw error;
    }
    return match.id;
  }

  async function writeSetting(projectId, key, content) {
    const paths = getProjectPaths(novelsDir, projectId);
    await writeFileAtomic(path.join(paths.settingsDir, createSettingFileName(key)), String(content || "").trim() + "\n");
  }

  async function readSetting(projectId, key) {
    const paths = getProjectPaths(novelsDir, projectId);
    return await readTextFile(path.join(paths.settingsDir, createSettingFileName(key)), "");
  }

  async function writeMaterial(projectId, key, content) {
    const normalizedKey = String(key || "").trim();
    if (!MATERIAL_KEY_SET.has(normalizedKey)) {
      const error = new Error("Unsupported material key");
      error.statusCode = 404;
      throw error;
    }
    const paths = getProjectPaths(novelsDir, projectId);
    await fs.promises.mkdir(paths.materialsDir, { recursive: true });
    await writeFileAtomic(path.join(paths.materialsDir, createMaterialFileName(normalizedKey)), String(content || "").trim() + "\n");
  }

  async function readMaterial(projectId, key) {
    const normalizedKey = String(key || "").trim();
    if (!MATERIAL_KEY_SET.has(normalizedKey)) {
      const error = new Error("Unsupported material key");
      error.statusCode = 404;
      throw error;
    }
    const paths = getProjectPaths(novelsDir, projectId);
    return await readTextFile(path.join(paths.materialsDir, createMaterialFileName(normalizedKey)), "");
  }

  async function listMaterials(projectId) {
    await ensureProjectExists(projectId);
    const materials = {};
    for (const definition of MATERIAL_DEFINITIONS) {
      const content = await readMaterial(projectId, definition.key).catch(() => "");
      materials[definition.key] = {
        key: definition.key,
        title: definition.title,
        hasContent: Boolean(String(content || "").trim()),
        preview: truncateText(content, 180),
      };
    }
    return materials;
  }

  async function readMaterialsLibraryContext(projectId, options = {}) {
    const maxPerMaterial = Math.max(300, Number(options.maxPerMaterial) || 1400);
    const sections = [];
    for (const definition of MATERIAL_DEFINITIONS) {
      const content = await readMaterial(projectId, definition.key).catch(() => "");
      const normalized = String(content || "").trim();
      if (!normalized || /^# .+\n\s*可手动填入素材/.test(normalized)) continue;
      sections.push(`## ${definition.title}\n${truncateText(normalized, maxPerMaterial)}`);
    }
    return sections.join("\n\n");
  }

  async function listChaptersMeta(projectId) {
    const paths = getProjectPaths(novelsDir, projectId);
    const chapterEntries = [];
    for (const [folder, status, suffix] of [
      [paths.chaptersDir, "approved", ".md"],
      [paths.draftsDir, "draft", ".draft.md"],
    ]) {
      try {
        const files = await fs.promises.readdir(folder, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile()) continue;
          if (!file.name.endsWith(suffix)) continue;
          const chapterNo = parseChapterNo(file.name.replace(suffix, ""));
          if (!chapterNo) continue;
          const fullPath = path.join(folder, file.name);
          const content = await readTextFile(fullPath, "");
          const stat = await fs.promises.stat(fullPath);
          chapterEntries.push({
            chapterNo,
            status,
            title: extractChapterTitle(content, chapterNo),
            characterCount: countChineseCharacters(content),
            bytes: Buffer.byteLength(content, "utf8"),
            updatedAt: stat.mtimeMs,
          });
        }
      } catch {}
    }
    chapterEntries.sort((a, b) => a.chapterNo - b.chapterNo || (a.status === "approved" ? -1 : 1));
    return chapterEntries;
  }

  async function getProjectDetail(projectId) {
    const { project, state, review } = await readProjectFileSet(projectId);
    const settings = {};
    for (const definition of SETTING_DEFINITIONS) {
      const content = await readSetting(projectId, definition.key);
      settings[definition.key] = {
        key: definition.key,
        title: definition.title,
        hasContent: Boolean(String(content || "").trim()),
        preview: truncateText(content, 180),
      };
    }
    return {
      project,
      state,
      review,
      settings,
      materials: await listMaterials(projectId),
      chapters: await listChaptersMeta(projectId),
    };
  }

  async function deleteChapterAndProgress(projectId, chapterNo) {
    const normalizedChapterNo = parseChapterNo(chapterNo);
    if (!normalizedChapterNo) {
      const error = new Error("Invalid chapter number");
      error.statusCode = 400;
      throw error;
    }
    const { project, state, review, paths } = await readProjectFileSet(projectId);
    const chapterEntries = await listChaptersMeta(projectId);
    const deletedChapterNos = Array.from(new Set(
      chapterEntries
        .map((item) => Number(item.chapterNo) || 0)
        .filter((value) => value >= normalizedChapterNo)
    )).sort((a, b) => a - b);

    if (!deletedChapterNos.length) {
      const error = new Error("Chapter not found");
      error.statusCode = 404;
      throw error;
    }

    await Promise.all(
      deletedChapterNos.flatMap((value) => ([
        fs.promises.rm(path.join(paths.chaptersDir, formatChapterFileName(value)), { force: true }),
        fs.promises.rm(path.join(paths.draftsDir, formatChapterFileName(value, ".draft.md")), { force: true }),
        fs.promises.rm(path.join(paths.summariesDir, formatChapterFileName(value, ".summary.md")), { force: true }),
        fs.promises.rm(path.join(paths.snapshotsDir, formatChapterFileName(value, ".state.md")), { force: true }),
      ]))
    );

    const remainingChapters = await listChaptersMeta(projectId);
    const remainingChapterNos = Array.from(new Set(
      remainingChapters.map((item) => Number(item.chapterNo) || 0).filter(Boolean)
    )).sort((a, b) => a - b);
    const approvedChapterNos = Array.from(new Set(
      remainingChapters
        .filter((item) => item.status === "approved")
        .map((item) => Number(item.chapterNo) || 0)
        .filter(Boolean)
    )).sort((a, b) => a - b);
    const draftChapterNos = Array.from(new Set(
      remainingChapters
        .filter((item) => item.status === "draft")
        .map((item) => Number(item.chapterNo) || 0)
        .filter(Boolean)
    )).sort((a, b) => a - b);

    const preferredPendingChapter = Number(state.pendingDraftChapter) || 0;
    const nextPendingDraftChapter = draftChapterNos.includes(preferredPendingChapter)
      ? preferredPendingChapter
      : (draftChapterNos[0] || 0);
    const nextCurrentChapter = remainingChapterNos.length ? remainingChapterNos[remainingChapterNos.length - 1] : 0;
    const nextLastApprovedChapter = approvedChapterNos.length ? approvedChapterNos[approvedChapterNos.length - 1] : 0;
    const nextState = {
      ...state,
      phase: nextPendingDraftChapter ? "review" : (nextCurrentChapter > 0 ? "writing" : "planning"),
      currentChapter: nextCurrentChapter,
      lastApprovedChapter: nextLastApprovedChapter,
      lastGeneratedChapter: nextCurrentChapter,
      pendingDraftChapter: nextPendingDraftChapter || null,
      autoWriteEnabled: false,
      autoWriteLastCount: 0,
      updatedAt: Date.now(),
    };
    const nextReview = {
      ...review,
      pending: (review.pending || []).filter((item) => parseChapterNo(item.chapterNo) < normalizedChapterNo),
      history: (review.history || []).filter((item) => parseChapterNo(item.chapterNo) < normalizedChapterNo).slice(0, 50),
      updatedAt: Date.now(),
    };

    await Promise.all([
      writeJsonFileAtomic(paths.stateFile, nextState),
      writeJsonFileAtomic(paths.reviewFile, nextReview),
      writeJsonFileAtomic(paths.projectFile, { ...project, updatedAt: Date.now() }),
    ]);

    debug(`deleted chapters project=${projectId} from=${normalizedChapterNo} count=${deletedChapterNos.length}`);
    return {
      ok: true,
      deletedFromChapter: normalizedChapterNo,
      deletedChapterNos,
      deletedChapterCount: deletedChapterNos.length,
      resetToChapter: nextCurrentChapter,
    };
  }

  async function inferProjectFromBrief(payload = {}) {
    const brief = String(payload.brief || payload.text || "").trim();
    if (!brief) {
      const error = new Error("Project brief is required");
      error.statusCode = 400;
      throw error;
    }

    const systemPrompt = [
      "你是小说项目策划信息抽取助手。",
      "请把用户的一段中文小说构想拆解为结构化项目字段。",
      "只输出一个 JSON 对象，不要输出 Markdown、代码块或解释。",
    ].join("\n");
    const userPrompt = [
      "请从下面的小说构想中提取项目基本信息。",
      "",
      "必须输出 JSON，字段如下：",
      "{",
      '  "name": "小说名，若没有明确名称则生成一个简短中文名",',
      '  "genre": "题材/类型",',
      '  "theme": "主题或核心情绪，优先提取主线情绪、关系张力和叙事卖点",',
      '  "premise": "核心梗概，1-3段；保留主角、开局事件、核心冲突、阶段目标和结局/长期方向",',
      '  "protagonist": "主角信息，包含身份、前史、欲望、困境、关系、能力/修行状态、互动边界",',
      '  "stylePreference": "文风偏好；保留叙事视角、节奏、描写密度、情绪基调、需要强调或避免的写法",',
      '  "audience": "目标读者；包含题材受众、同人/原著读者、口味偏好等",',
      '  "targetChapters": 0,',
      '  "chapterWordTarget": 0,',
      '  "keywords": ["关键词"],',
      '  "notes": "其他重要要求；用分条文本保留所有硬性约束、参考作品边界、角色关系、场景要求、禁忌、审核重点和不可丢失的细节"',
      "}",
      "",
      "规则：",
      "- 没有明确给出的数字填 0，不要乱猜具体章节数或单章字数。",
      "- 可以根据构想补全合理的题材、主题、关键词和临时书名。",
      "- 保留用户明确要求，不要加入与原意冲突的新设定。",
      "- notes 必须优先保留用户的硬性要求和细节要求，不要因为字段有限而丢弃。",
      "- 如果用户写了参考原著、同人边界、配角借用、场景描写尺度、章节节奏、审稿标准等要求，必须放入 notes。",
      "- 对成人向、亲密关系、暴力、禁忌等敏感设定，只做项目约束抽取，不要扩写具体描写。",
      "- 若构想很长，notes 使用清晰分条，宁可略长，也不要压缩到只剩概括。",
      "",
      "用户构想：",
      brief,
    ].join("\n");

    const raw = await generateNovelModelText({
      purpose: "novel_project_infer",
      model: sanitizeProjectModel(payload.model),
      localOnly: payload.localOnly === true || String(payload.modelRoute || "").trim().toLowerCase() === "local",
      connectionConfig: payload.connectionConfig && typeof payload.connectionConfig === "object" ? payload.connectionConfig : null,
      systemPrompt,
      userPrompt,
      temperature: 0.2,
    });
    const parsed = extractJsonObjectFromText(raw);
    if (!parsed) {
      const error = new Error("Failed to parse inferred project JSON");
      error.statusCode = 502;
      error.rawText = raw;
      throw error;
    }
    return {
      fields: normalizeInferredProjectPayload(parsed),
      raw,
    };
  }

  async function createProject(payload = {}) {
    await ensureNovelsDir();
    const name = sanitizeProjectName(payload.name || "");
    if (!name) {
      const error = new Error("Project name is required");
      error.statusCode = 400;
      throw error;
    }
    const projectId = `${slugifyName(name)}-${Date.now()}`;
    const paths = getProjectPaths(novelsDir, projectId);
    await Promise.all([
      fs.promises.mkdir(paths.projectDir, { recursive: true }),
      fs.promises.mkdir(paths.settingsDir, { recursive: true }),
      fs.promises.mkdir(paths.materialsDir, { recursive: true }),
      fs.promises.mkdir(paths.chaptersDir, { recursive: true }),
      fs.promises.mkdir(paths.draftsDir, { recursive: true }),
      fs.promises.mkdir(paths.summariesDir, { recursive: true }),
      fs.promises.mkdir(paths.snapshotsDir, { recursive: true }),
      fs.promises.mkdir(paths.logsDir, { recursive: true }),
    ]);

    const now = Date.now();
    const project = {
      id: projectId,
      name,
      genre: String(payload.genre || "").trim(),
      theme: String(payload.theme || "").trim(),
      premise: String(payload.premise || "").trim(),
      targetChapters: Number(payload.targetChapters) || 0,
      chapterWordTarget: normalizeChapterWordTarget(payload.chapterWordTarget),
      modelRoute: String(payload.modelRoute || payload.modelProvider || "").trim().toLowerCase() || (payload.localOnly === true ? "local" : "remote"),
      localOnly: payload.localOnly === true,
      model: sanitizeProjectModel(payload.model) || getGlobalModel(),
      stylePreference: String(payload.stylePreference || "").trim(),
      audience: String(payload.audience || "").trim(),
      protagonist: String(payload.protagonist || "").trim(),
      keywords: normalizeKeywords(payload.keywords),
      notes: String(payload.notes || "").trim(),
      status: payload.autoGenerateSettings === false ? "draft" : "active",
      qqReviewEnabled: payload.qqReviewEnabled === true,
      qqTargetType: String(payload.qqTargetType || "private").trim() || "private",
      qqTargetId: String(payload.qqTargetId || "").trim(),
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      writeJsonFileAtomic(paths.projectFile, project),
      writeJsonFileAtomic(paths.stateFile, createInitialState()),
      writeJsonFileAtomic(paths.reviewFile, createInitialReview()),
      writeSetting(projectId, "base-info", createBaseInfoMarkdown(project)),
    ]);

    await Promise.all(
      SETTING_DEFINITIONS
        .filter((definition) => definition.key !== "base-info")
        .map((definition) => writeSetting(projectId, definition.key, `# ${definition.title}\n\n待自动生成。`))
    );

    await Promise.all(
      MATERIAL_DEFINITIONS.map((definition) => writeMaterial(projectId, definition.key, createDefaultMaterialMarkdown(definition)))
    );

    if (payload.autoGenerateSettings !== false) {
      await generateSettings(projectId, { overwrite: true });
    }

    debug(`created project=${projectId}`);
    return await getProjectDetail(projectId);
  }

  async function updateProject(projectId, payload = {}) {
    const record = await readProjectFileSet(projectId);
    const now = Date.now();
    const nextProject = {
      ...record.project,
      name: sanitizeProjectName(payload.name || record.project.name),
      genre: String(payload.genre ?? record.project.genre ?? "").trim(),
      theme: String(payload.theme ?? record.project.theme ?? "").trim(),
      premise: String(payload.premise ?? record.project.premise ?? "").trim(),
      targetChapters: Number(payload.targetChapters ?? record.project.targetChapters) || 0,
      chapterWordTarget: normalizeChapterWordTarget(payload.chapterWordTarget, record.project.chapterWordTarget),
      modelRoute: String(payload.modelRoute ?? payload.modelProvider ?? record.project.modelRoute ?? record.project.modelProvider ?? "").trim().toLowerCase() || (payload.localOnly === true ? "local" : "remote"),
      localOnly: payload.localOnly === true || (payload.localOnly == null && record.project.localOnly === true),
      model: sanitizeProjectModel(payload.model ?? record.project.model) || getGlobalModel(),
      stylePreference: String(payload.stylePreference ?? record.project.stylePreference ?? "").trim(),
      audience: String(payload.audience ?? record.project.audience ?? "").trim(),
      protagonist: String(payload.protagonist ?? record.project.protagonist ?? "").trim(),
      keywords: normalizeKeywords(payload.keywords, record.project.keywords),
      notes: String(payload.notes ?? record.project.notes ?? "").trim(),
      qqReviewEnabled: payload.qqReviewEnabled === true,
      qqTargetType: String(payload.qqTargetType ?? record.project.qqTargetType ?? "private").trim() || "private",
      qqTargetId: String(payload.qqTargetId ?? record.project.qqTargetId ?? "").trim(),
      updatedAt: now,
    };
    await writeJsonFileAtomic(record.paths.projectFile, nextProject);
    if (payload.syncBaseInfo !== false) {
      await writeSetting(projectId, "base-info", createBaseInfoMarkdown(nextProject));
    }
    debug(`updated project=${projectId}`);
    return await getProjectDetail(projectId);
  }

  async function deleteProject(projectId) {
    const paths = getProjectPaths(novelsDir, projectId);
    await ensureProjectExists(projectId);
    await fs.promises.rm(paths.projectDir, { recursive: true, force: true });
    debug(`deleted project=${projectId}`);
    return { ok: true, id: projectId };
  }

  async function readWrittenChapterCanon(projectId, options = {}) {
    const paths = getProjectPaths(novelsDir, projectId);
    const recentFullCount = Math.max(1, Number(options.recentFullCount) || 2);
    const earlierSummaryCount = Math.max(0, Number(options.earlierSummaryCount) || 6);
    const chapterEntries = await listChaptersMeta(projectId);
    const chapterNumbers = Array.from(new Set(
      chapterEntries.map((item) => Number(item.chapterNo) || 0).filter(Boolean)
    )).sort((a, b) => a - b);

    if (!chapterNumbers.length) {
      return {
        hasContent: false,
        latestChapterNo: 0,
        timeline: "",
        recentFullTexts: [],
        earlierSummaries: [],
        latestSnapshot: "",
      };
    }

    const chapterMetaByNo = new Map();
    for (const entry of chapterEntries) {
      const chapterNo = Number(entry.chapterNo) || 0;
      if (!chapterNo) continue;
      const previous = chapterMetaByNo.get(chapterNo);
      if (!previous || entry.status === "draft" || previous.status !== "draft") {
        chapterMetaByNo.set(chapterNo, entry);
      }
    }

    const timeline = chapterNumbers.map((chapterNo) => {
      const meta = chapterMetaByNo.get(chapterNo) || {};
      return `- 第${chapterNo}章｜${meta.status || "unknown"}｜${meta.title || `第${chapterNo}章`}`;
    }).join("\n");

    const recentFullChapterNos = chapterNumbers.slice(-recentFullCount);
    const earlierSummaryChapterNos = chapterNumbers.slice(0, -recentFullCount).slice(-earlierSummaryCount);
    const recentFullTexts = [];
    for (const chapterNo of recentFullChapterNos) {
      const chapter = await getChapterContent(projectId, chapterNo, { preferDraft: true });
      recentFullTexts.push(`## 第${chapterNo}章正文\n${truncateText(chapter.content, 3200)}`);
    }

    const earlierSummaries = [];
    for (const chapterNo of earlierSummaryChapterNos) {
      const summaryPath = path.join(paths.summariesDir, formatChapterFileName(chapterNo, ".summary.md"));
      let summary = await readTextFile(summaryPath, "");
      if (!summary.trim()) {
        const chapter = await getChapterContent(projectId, chapterNo, { preferDraft: true });
        summary = chapter.content;
      }
      earlierSummaries.push(`## 第${chapterNo}章摘要\n${truncateText(summary, 1200)}`);
    }

    const latestChapterNo = chapterNumbers[chapterNumbers.length - 1];
    const latestSnapshot = truncateText(await readTextFile(
      path.join(paths.snapshotsDir, formatChapterFileName(latestChapterNo, ".state.md")),
      ""
    ), 2200);

    return {
      hasContent: true,
      latestChapterNo,
      timeline,
      recentFullTexts,
      earlierSummaries,
      latestSnapshot,
    };
  }

  async function generateChapterPlanText(project, existingSettings = {}, options = {}) {
    const alignToWrittenChapters = options.alignToWrittenChapters === true;
    const chapterCanonContext = options.chapterCanonContext || null;
    const targetChapterCount = getChapterPlanTargetCount(project, {
      latestWrittenChapterNo: chapterCanonContext?.latestChapterNo || 0,
    });
    const detailHint = getChapterPlanDetailHint(targetChapterCount);
    const previousContext = Object.entries(existingSettings)
      .filter(([existingKey, content]) => existingKey !== "chapter-plan" && String(content || "").trim())
      .map(([existingKey, content]) => `## ${existingKey}\n${truncateText(content, 1200)}`)
      .join("\n\n");
    const systemPrompt = [
      alignToWrittenChapters ? "你是中文长篇小说章节细纲整理 Agent。" : "你是中文长篇小说章节细纲策划 Agent。",
      alignToWrittenChapters ? "请根据已写章节、现有设定和项目定位，整理出尽量逐章展开的章节细纲。" : "请严格根据用户给出的小说定位，生成尽量逐章展开的章节细纲。",
      "输出纯 Markdown，不要使用代码块，不要解释过程。",
      "章节细纲请尽量按一章一章地来写，优先一章一条，尽量不要并章、略写、跳号或写成阶段概述。",
    ].join("\n");
    const userPrompt = [
      `请为小说项目《${project.name}》生成“章节细纲”文件。`,
      "",
      "### 项目基础信息",
      buildProjectPromptSummary(project),
      "",
      "### 篇幅硬约束",
      createTargetChaptersRequirement(project.targetChapters),
      createChapterWordTargetRequirement(project.chapterWordTarget),
      "",
      "### 已有设定参考",
      previousContext || "暂无，按项目基础信息自行补全。",
      "",
      ...(alignToWrittenChapters ? [
        "### 已写章节既成事实",
        chapterCanonContext?.timeline || "暂无",
        "",
        "### 最近章节正文",
        chapterCanonContext?.recentFullTexts?.join("\n\n") || "暂无",
        "",
        "### 更早章节摘要",
        chapterCanonContext?.earlierSummaries?.join("\n\n") || "暂无",
        "",
        "### 最新章节状态快照",
        chapterCanonContext?.latestSnapshot || "暂无",
        "",
      ] : []),
      "输出格式建议：",
      "1. 文件标题使用“# 章节细纲”。",
      `2. 优先从第1章连续写到第${targetChapterCount}章，请尽量按一章一章地来，尽量逐章编号。`,
      "3. 最好每章单独使用一个标题，推荐格式为“## 第N章 章节标题”，让每一章单独成条。",
      "4. 尽量避免写成“第1-3章”“前十章”“第一卷前半段”这类合并、概写、略写格式。",
      `5. ${createTargetChaptersRequirement(project.targetChapters)}`,
      "6. 已经写出的章节要与既成正文一致；尚未写到的章节，在不违背既成正文的前提下继续规划。",
      `7. ${detailHint}`,
      "8. 每章内容尽量只写本章事件推进，不要把下一章的大事件提前塞进本章条目里。",
      "",
      "现在直接输出完整的 Markdown 章节细纲。",
    ].filter(Boolean).join("\n");

    return await generateNovelModelText({
      purpose: "novel_setting_chapter-plan",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt,
      userPrompt,
      temperature: 0.75,
    });
  }

  async function generateSettingText(project, key, existingSettings = {}, options = {}) {
    const title = SETTING_DEFINITIONS.find((item) => item.key === key)?.title || key;
    const alignToWrittenChapters = options.alignToWrittenChapters === true;
    const chapterCanonContext = options.chapterCanonContext || null;
    if (key === "chapter-plan") {
      return await generateChapterPlanText(project, existingSettings, options);
    }
    const systemPrompt = [
      alignToWrittenChapters ? "你是中文长篇小说设定整理 Agent。" : "你是中文长篇小说策划 Agent。",
      alignToWrittenChapters ? "请根据已写章节、现有设定和项目定位，反向整理并修正设定。" : "请严格根据用户给出的小说定位生成设定。",
      "输出纯 Markdown，不要使用代码块，不要解释过程。",
      "内容要可直接保存为小说项目文件。",
    ].join("\n");
    const previousContext = Object.entries(existingSettings)
      .filter(([existingKey, content]) => existingKey !== key && String(content || "").trim())
      .map(([existingKey, content]) => `## ${existingKey}\n${truncateText(content, 1200)}`)
      .join("\n\n");
    const userPrompt = [
      `请为小说项目《${project.name}》生成“${title}”文件。`,
      "",
      "### 项目基础信息",
      buildProjectPromptSummary(project),
      "",
      "### 篇幅硬约束",
      createTargetChaptersRequirement(project.targetChapters),
      createChapterWordTargetRequirement(project.chapterWordTarget),
      "",
      "### 已有设定参考",
      previousContext || "暂无，按项目基础信息自行补全。",
      "",
      ...(alignToWrittenChapters ? [
        "### 已写章节既成事实",
        chapterCanonContext?.timeline || "暂无",
        "",
        "### 最近章节正文",
        chapterCanonContext?.recentFullTexts?.join("\n\n") || "暂无",
        "",
        "### 更早章节摘要",
        chapterCanonContext?.earlierSummaries?.join("\n\n") || "暂无",
        "",
      "### 最新章节状态快照",
      chapterCanonContext?.latestSnapshot || "暂无",
      "",
      ] : []),
      "要求：",
      alignToWrittenChapters ? "1. 以已写章节为既成事实，不得推翻、改写或忽略已经发生的剧情。" : "1. 与题材、主题、主角和卖点保持一致。",
      `2. ${createTargetChaptersRequirement(project.targetChapters)}`,
      alignToWrittenChapters ? "3. 若旧设定与已写章节冲突，以既成正文为准，对设定进行归档、修正和补缀。" : "3. 适合长篇连载，具有延展性。",
      alignToWrittenChapters ? "4. 对尚未写到的后续设定，要在不违背既成正文的前提下继续保持延展性。" : "4. 输出结构清晰，可直接写入 Markdown 文件。",
      alignToWrittenChapters ? "5. 特别是章节细纲、人物关系、世界规则、力量边界要向当前正文对齐。" : `5. 文件标题使用“# ${title}”。`,
      alignToWrittenChapters ? `6. 文件标题使用“# ${title}”。` : "",
      ...(key === "characters" ? [
        "",
        "### 人物设定专项要求（最高优先级）",
        ...createCharacterSettingRequirements().map((item, index) => `${index + 1}. ${item}`),
      ] : []),
    ].filter(Boolean).join("\n");
    return await generateNovelModelText({
      purpose: `novel_setting_${key}`,
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt,
      userPrompt,
      temperature: key === "chapter-plan" ? 0.8 : 0.7,
    });
  }

  async function generateSettings(projectId, options = {}) {
    const overwrite = options.overwrite === true;
    const alignToWrittenChapters = options.alignToWrittenChapters === true;
    const { project } = await readProjectFileSet(projectId);
    const generated = {};
    const currentSettings = {};
    const chapterCanonContext = alignToWrittenChapters
      ? (options.chapterCanonContext || await readWrittenChapterCanon(projectId))
      : null;
    for (const definition of SETTING_DEFINITIONS) {
      currentSettings[definition.key] = await readSetting(projectId, definition.key);
    }

    const pendingDefinitions = [];
    for (const definition of SETTING_DEFINITIONS) {
      if (definition.key === "base-info") {
        generated[definition.key] = currentSettings[definition.key];
        continue;
      }
      if (!overwrite && String(currentSettings[definition.key] || "").trim() && !/待自动生成/.test(currentSettings[definition.key])) {
        generated[definition.key] = currentSettings[definition.key];
        continue;
      }
      pendingDefinitions.push(definition);
    }

    const generateDefinitionBatch = async (definitions, contextSnapshot) => {
      const routing = projectModelRouting(project);
      await runWithConcurrency(
        definitions,
        resolveSettingGenerationConcurrency(options.concurrency || process.env.NOVEL_SETTING_CONCURRENCY, {
          remote: routing.localOnly !== true,
        }),
        async (definition) => {
          const generationContext = createSettingGenerationContext(currentSettings, contextSnapshot, {
            key: definition.key,
            overwrite,
            alignToWrittenChapters,
          });
          const content = await generateSettingText(project, definition.key, {
            ...generationContext,
          }, {
            alignToWrittenChapters,
            chapterCanonContext,
          });
          await writeSetting(projectId, definition.key, content);
          return {
            key: definition.key,
            content,
          };
        }
      ).then((items) => {
        for (const item of items) {
          if (item?.key) {
            generated[item.key] = item.content;
          }
        }
      });
    };

    if (pendingDefinitions.length) {
      await generateDefinitionBatch(pendingDefinitions, { ...generated });
    }

    for (const definition of SETTING_DEFINITIONS) {
      if (!Object.prototype.hasOwnProperty.call(generated, definition.key)) {
        generated[definition.key] = currentSettings[definition.key];
      }
    }

    await writeJsonFileAtomic(getProjectPaths(novelsDir, projectId).projectFile, {
      ...project,
      status: "active",
      updatedAt: Date.now(),
    });
    return generated;
  }

  async function generateSingleSetting(projectId, key, options = {}) {
    const normalizedKey = String(key || "").trim();
    if (!SETTING_KEY_SET.has(normalizedKey)) {
      const error = new Error("Unsupported setting key");
      error.statusCode = 404;
      throw error;
    }
    if (normalizedKey === "base-info") {
      const error = new Error("基础信息由项目字段生成，请修改项目信息后保存项目");
      error.statusCode = 400;
      throw error;
    }

    const overwrite = options.overwrite !== false;
    const alignToWrittenChapters = options.alignToWrittenChapters === true;
    const { project } = await readProjectFileSet(projectId);
    const chapterCanonContext = alignToWrittenChapters
      ? (options.chapterCanonContext || await readWrittenChapterCanon(projectId))
      : null;
    if (alignToWrittenChapters && !chapterCanonContext?.hasContent) {
      const error = new Error("当前还没有已写章节，暂时无法按正文整理设定");
      error.statusCode = 400;
      throw error;
    }
    const currentSettings = {};
    for (const definition of SETTING_DEFINITIONS) {
      currentSettings[definition.key] = await readSetting(projectId, definition.key);
    }

    if (!overwrite && String(currentSettings[normalizedKey] || "").trim() && !/待自动生成/.test(currentSettings[normalizedKey])) {
      return {
        key: normalizedKey,
        title: SETTING_DEFINITIONS.find((item) => item.key === normalizedKey)?.title || normalizedKey,
        content: currentSettings[normalizedKey],
      };
    }

    const generationContext = createSettingGenerationContext(currentSettings, {}, {
      key: normalizedKey,
      overwrite,
      alignToWrittenChapters,
      singleSetting: true,
    });
    const content = await generateSettingText(project, normalizedKey, generationContext, {
      alignToWrittenChapters,
      chapterCanonContext,
    });
    await writeSetting(projectId, normalizedKey, content);
    await writeJsonFileAtomic(getProjectPaths(novelsDir, projectId).projectFile, {
      ...project,
      status: "active",
      updatedAt: Date.now(),
    });
    return {
      key: normalizedKey,
      title: SETTING_DEFINITIONS.find((item) => item.key === normalizedKey)?.title || normalizedKey,
      content,
    };
  }

  async function generateMaterial(projectId, key, options = {}) {
    const normalizedKey = String(key || "").trim();
    if (!MATERIAL_KEY_SET.has(normalizedKey)) {
      const error = new Error("Unsupported material key");
      error.statusCode = 404;
      throw error;
    }
    const { project } = await readProjectFileSet(projectId);
    const title = MATERIAL_DEFINITIONS.find((item) => item.key === normalizedKey)?.title || normalizedKey;
    const currentContent = await readMaterial(projectId, normalizedKey).catch(() => "");
    const extraSource = String(options.source || options.brief || "").trim();
    const includeProjectContext = options.includeProjectContext === true
      || /结合.*(小说|项目|设定|正文|章节|人物|世界观)|参考.*(小说|项目|设定|正文|章节|人物|世界观)|按.*(小说|项目|设定|正文|章节|人物|世界观)/.test(extraSource);
    const settings = {};
    if (includeProjectContext) {
      for (const definition of SETTING_DEFINITIONS) {
        settings[definition.key] = await readSetting(projectId, definition.key);
      }
    }
    const content = await generateNovelModelText({
      purpose: `novel_material_${normalizedKey}`,
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是中文小说素材库整理 Agent。输出纯 Markdown，不要使用代码块，不要解释过程。",
      userPrompt: [
        `请整理“${title}”素材库。`,
        "",
        "### 范围边界",
        includeProjectContext
          ? "用户要求结合当前小说项目内容，本次可以参考下方项目上下文。"
          : "默认只整理素材库本身，不要引入、续写、改写或总结当前小说项目里的设定、正文、章节规划、人物关系和剧情内容。",
        "",
        ...(includeProjectContext ? [
          "### 项目基础信息",
          buildProjectPromptSummary(project),
          "",
          "### 现有设定参考",
          Object.entries(settings).map(([settingKey, content]) => `## ${settingKey}\n${truncateText(content, 1200)}`).join("\n\n"),
          "",
        ] : []),
        "",
        "### 当前素材库内容",
        currentContent.trim() || "暂无",
        "",
        "### 用户补充素材或要求",
        extraSource || "暂无",
        "",
        "### 整理要求",
        "1. 输出可以直接作为长期素材库使用的 Markdown。",
        "2. 保留用户手写的有价值素材，并补全可复用表达、规则、样例和禁忌。",
        "3. 若是人物对话，请整理不同人物/关系/情境下的语气样例。",
        "4. 若是心理或环境描写，请整理可复用描写模板和适用场景。",
        "5. 若是修真或能力等级，请整理境界、能力边界、升级条件、代价和禁忌。",
      ].join("\n"),
      temperature: 0.65,
    });
    await writeMaterial(projectId, normalizedKey, content);
    await writeJsonFileAtomic(getProjectPaths(novelsDir, projectId).projectFile, {
      ...project,
      updatedAt: Date.now(),
    });
    return {
      key: normalizedKey,
      title,
      content,
    };
  }

  async function reconcileSettingsFromChapters(projectId, options = {}) {
    const chapterCanonContext = await readWrittenChapterCanon(projectId, options);
    if (!chapterCanonContext.hasContent) {
      const error = new Error("当前还没有已写章节，暂时无法按正文整理设定");
      error.statusCode = 400;
      throw error;
    }
    return await generateSettings(projectId, {
      overwrite: options.overwrite !== false,
      alignToWrittenChapters: true,
      chapterCanonContext,
    });
  }

  async function readRecentChapterContext(projectId, chapterNo) {
    const paths = getProjectPaths(novelsDir, projectId);
    const recentFullTexts = [];
    const oldSummaries = [];
    for (let current = Math.max(1, chapterNo - 6); current < chapterNo; current += 1) {
      const chapterFile = path.join(paths.chaptersDir, formatChapterFileName(current));
      const summaryFile = path.join(paths.summariesDir, formatChapterFileName(current, ".summary.md"));
      if (current >= chapterNo - 2) {
        const content = await readTextFile(chapterFile, "");
        if (content.trim()) {
          recentFullTexts.push(`## 第${current}章全文\n${truncateText(content, 8000)}`);
        }
      } else {
        const summary = await readTextFile(summaryFile, "");
        if (summary.trim()) {
          oldSummaries.push(`## 第${current}章摘要\n${truncateText(summary, 2200)}`);
        }
      }
    }
    const snapshot = await readTextFile(
      path.join(paths.snapshotsDir, formatChapterFileName(Math.max(1, chapterNo - 1), ".state.md")),
      ""
    );
    return {
      recentFullTexts,
      oldSummaries,
      snapshot,
    };
  }

  async function completeChapterToWordTarget({
    project,
    chapterNo,
    chapterContent,
    settings,
    chapterContext,
    chapterPlanGuidance,
    systemPrompt,
    enforceIdealMaximum = false,
    condenseReason = "",
  }) {
    const range = getChapterWordTargetRange(project.chapterWordTarget);
    if (!range.minimum) {
      return sanitizeNovelProseMetaReferences(chapterContent);
    }

    let completedContent = String(chapterContent || "").trim();
    const softMaximum = Math.max(range.maximum, range.target + 1200);
    const condenseToRange = async (content, options = {}) => {
      let condensedContent = String(content || "").trim();
      let currentCount = countChineseCharacters(condensedContent);
      const force = options.force === true;
      const reason = String(options.reason || "").trim();
      for (let attempt = 1; attempt <= 2 && (force ? currentCount > range.maximum : currentCount > softMaximum); attempt += 1) {
        const condensePrompt = [
          `小说《${project.name}》第 ${chapterNo} 章草稿当前中文汉字数为 ${currentCount}，目标为 ${range.target}，理想区间为 ${range.minimum}-${range.maximum}，质量优先软上限为 ${softMaximum}。`,
          reason ? `触发压缩原因：${reason}` : "",
          "请在保留章节标题、核心事件、人物变化、伏笔推进、现场细节和结尾钩子的前提下，轻量压缩为完整章节正文。",
          "",
          "### 当前章节细纲（最高优先级）",
          chapterPlanGuidance.current || `第 ${chapterNo} 章条目未定位，仍按本章推进。`,
          "",
          "### 下一章边界",
          chapterPlanGuidance.next || "暂无",
          "",
          "### 需要压缩的章节正文",
          truncateText(condensedContent, 18000),
          "",
          "### 压缩要求",
          `1. 输出完整 Markdown 正文，优先控制在 ${range.minimum}-${range.maximum} 个中文汉字之间；若压缩到该区间会明显损伤剧情质感，可保留到 ${softMaximum} 以内。`,
          "2. 字数只统计中文汉字，不统计标点、空格、英文数字或特殊符号。",
          "3. 优先删除重复解释、泛化心理、冗余设定说明和同义反复，不要删除有现场张力的动作、对话和物件细节。",
          "4. 不要改写成摘要，不要丢失本章关键行动、转折、代价、人物反应和悬念。",
          "5. 不要解释，不要使用代码块。",
          ...createNovelProseOnlyRequirements().map((item, index) => `${index + 6}. ${item}`),
        ].filter(Boolean).join("\n");

        const condensed = await generateNovelModelText({
          purpose: "novel_chapter_condense",
          model: project.model,
          ...projectModelRouting(project),
          systemPrompt,
          userPrompt: condensePrompt,
          temperature: 0.45,
        });
        const normalizedCondensed = String(condensed || "").trim();
        const nextCount = countChineseCharacters(normalizedCondensed);
        if (!normalizedCondensed || nextCount <= 0 || nextCount >= currentCount) {
          break;
        }
        condensedContent = normalizedCondensed;
        currentCount = nextCount;
      }
      return condensedContent;
    };

    completedContent = await condenseToRange(completedContent, {
      force: enforceIdealMaximum,
      reason: condenseReason,
    });
    let currentCount = countChineseCharacters(completedContent);
    for (let attempt = 1; attempt <= 3 && currentCount < range.minimum; attempt += 1) {
      const needed = range.minimum - currentCount;
      const supplementPrompt = [
        `小说《${project.name}》第 ${chapterNo} 章草稿当前中文汉字数为 ${currentCount}，目标为 ${range.target}，理想区间为 ${range.minimum}-${range.maximum}。`,
        `请只补写可直接接在本章末尾的正文段落，补充约 ${needed} 个中文汉字，使整章进入目标区间。`,
        "",
        "### 已有本章正文",
        truncateText(completedContent, 9000),
        "",
        "### 当前章节细纲（最高优先级）",
        chapterPlanGuidance.current || `第 ${chapterNo} 章条目未定位，仍按本章推进。`,
        "",
        "### 下一章边界",
        chapterPlanGuidance.next || "暂无",
        "",
        "### 最近章节上下文",
        chapterContext.snapshot || "暂无",
        "",
        "### 补写要求",
        "1. 只输出要追加的正文，不要重复章节标题，不要解释，不要使用代码块。",
        "2. 延展本章已有场景、情绪、动作和人物互动，不要开启下一章大事件。",
        "3. 不要用大段设定说明、重复句式或无效水文凑字数。",
        `4. 补写后整章中文汉字数优先落在 ${range.minimum}-${range.maximum} 之间，质量完整时可小幅超过上限。`,
        "5. 结尾保留本章悬念或余韵。",
        "6. 字数只统计中文汉字，不统计标点、空格、英文数字或特殊符号。",
        ...createNovelProseOnlyRequirements().map((item, index) => `${index + 7}. ${item}`),
        "",
        "### 设定文件参考",
        Object.entries(settings)
          .map(([key, content]) => `## ${key}\n${truncateText(content, getNovelSettingPromptLimit(key, key === "chapter-plan" ? 2400 : 1400))}`)
          .join("\n\n"),
      ].join("\n");

      const supplement = await generateNovelModelText({
        purpose: "novel_chapter_expand",
        model: project.model,
        ...projectModelRouting(project),
        systemPrompt,
        userPrompt: supplementPrompt,
        temperature: 0.8,
      });
      const normalizedSupplement = String(supplement || "").trim();
      if (!normalizedSupplement) {
        break;
      }
      completedContent = `${completedContent}\n\n${normalizedSupplement}`.trim();
      const nextCount = countChineseCharacters(completedContent);
      if (nextCount <= currentCount) {
        break;
      }
      currentCount = nextCount;
    }

    completedContent = await condenseToRange(completedContent, {
      force: enforceIdealMaximum,
      reason: condenseReason,
    });
    return sanitizeNovelProseMetaReferences(completedContent);
  }

  async function generateChapterDramaticBeats({
    project,
    chapterNo,
    settings,
    chapterContext,
    chapterPlanGuidance,
    materialsContext,
    chapterMode,
    modeGuidance,
  }) {
    const guidance = modeGuidance || createChapterModeGuidance(chapterMode);
    const systemPrompt = [
      `你是中文长篇小说${guidance.beatName}设计 Agent。`,
      "你的任务是把章节细纲转化为可执行的场景推进方案，而不是扩写正文。",
      "输出纯 Markdown，不要使用代码块，不要解释过程。",
    ].join("\n");
    const userPrompt = [
      `请为小说《${project.name}》第 ${chapterNo} 章生成“${guidance.beatName}”。`,
      "",
      `### 章节类型\n${guidance.label}`,
      "",
      "### 项目基础信息",
      buildProjectPromptSummary(project),
      "",
      "### 当前章节细纲（最高优先级）",
      chapterPlanGuidance.current || `第 ${chapterNo} 章条目未定位，仍按本章推进。`,
      "",
      "### 相邻章节边界",
      chapterPlanGuidance.previous ? `上一章参考：\n${chapterPlanGuidance.previous}` : "上一章参考：暂无",
      chapterPlanGuidance.next ? `下一章边界：\n${chapterPlanGuidance.next}` : "下一章边界：暂无",
      "",
      "### 最近章节上下文",
      chapterContext.recentFullTexts.join("\n\n") || "暂无",
      "",
      "### 上一章状态快照",
      chapterContext.snapshot || "暂无",
      "",
      "### 设定与素材压缩参考",
      Object.entries(settings)
        .map(([key, content]) => `## ${key}\n${truncateText(content, getNovelSettingPromptLimit(key, key === "chapter-plan" ? 1600 : 900))}`)
        .join("\n\n"),
      "",
      materialsContext ? `### 挂载素材库\n${truncateText(materialsContext, 2200)}` : "### 挂载素材库\n暂无",
      "",
      "### 输出格式",
      "- 本章核心推进：本章必须完成的关系、信息或行动变化。",
      "- 角色表面目标：角色在本章里想做到的具体事情。",
      "- 隐藏目标或真实顾虑：角色不愿直说但真正关心的东西。",
      "- 张力来源：根据章节类型选择关系张力、信息差或外部冲突，不要错配。",
      "- 第三方折射：谁以在场、通信、记录、审查、误读、交易、限制、支持或受影响的方式参与本章；如果无人直接在场，写清会被谁在后续读到或误解的痕迹。",
      "- 5-7 个场景节拍：每个节拍必须包含可写成正文的行为、对话、发现或情绪变化。",
      "- 中段变化：必须改变角色理解、关系状态、局势判断或行动走向。",
      "- 代价或不可逆变化：本章结束时角色失去、承认、暴露、承诺或改变了什么。",
      "- 结尾余波：下一章需要承接的关系、信息或外部压力。",
      "",
      "### 质量要求",
      "1. 节拍必须能直接支撑正文场景，不能只是主题总结。",
      "2. 不得提前写入下一章的大事件。",
      "3. 必须服从章节类型，不要把关系情绪章硬写成行动冲突章。",
      ...guidance.requirements.map((item, index) => `${index + 4}. ${item}`),
    ].join("\n");

    return await generateNovelModelText({
      purpose: "novel_chapter_beats",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt,
      userPrompt,
      temperature: 0.6,
    });
  }

  async function reviewAndImproveChapterDraft({
    project,
    chapterNo,
    chapterContent,
    settings,
    chapterContext,
    chapterPlanGuidance,
    dramaticBeats,
    systemPrompt,
    chapterMode,
    modeGuidance,
  }) {
    const guidance = modeGuidance || createChapterModeGuidance(chapterMode);
    const reviewPrompt = [
      `请审稿小说《${project.name}》第 ${chapterNo} 章草稿，判断它是否“寡淡”。`,
      "",
      `### 章节类型\n${guidance.label}`,
      "",
      "### 评估标准",
      `1. 是否符合章节类型：${guidance.reviewFocus}。`,
      "2. 是否优先完成当前章节细纲，而不是抢跑下一章或硬加不属于本章的危机。",
      "3. 是否有清晰推进和不可逆变化，而不是只在情绪或设定上原地打转。",
      "4. 是否反复使用泛化心理词，例如“感到、觉得、意识到、发现自己、复杂情绪、说不清”；如出现多次且没有动作/身体/对话承载，应判定为 REVISE。",
      "5. 是否把技术细节、信息说明或情绪变化写进可见的动作、对话、物件和现场反应。",
      "6. 是否把克制写成了机械化微动作：例如视线停留几秒、手指敲几下、一次呼吸的长度、某动作重复几次、百分比式生理观察；若这些量化没有明确剧情功能，应判定为 REVISE。",
      "7. 核心对象的成长是否有第三方折射：第三方人物、组织、群体、制度、记录或后续反馈是否看见、误解、利用、害怕、支持或改变行动；如果整章只有主角双人确认且没有外部痕迹，应判定为 REVISE。",
      `8. 是否存在明显注水、重复或拖沓；字数参考：${createChapterWordTargetRequirement(project.chapterWordTarget)}`,
      "",
      "### 戏剧节拍",
      dramaticBeats || "暂无",
      "",
      "### 当前章节细纲",
      chapterPlanGuidance.current || `第 ${chapterNo} 章条目未定位。`,
      "",
      "### 草稿正文",
      truncateText(chapterContent, 14000),
      "",
      "### 输出要求",
      "第一行只能输出 PASS 或 REVISE。",
      "如果章节只是略超理想字数但现场细节、节奏和人物表现更好，应输出 PASS。",
      "如果关系情绪章没有外部危机但关系推进自然，应输出 PASS。",
      "如果 PASS，后面用 3 条以内说明理由。",
      "如果 REVISE，后面列出必须修改的 3-5 个具体问题；若主要问题是心理直述，请要求改成有叙事意义的行为、选择、对话或物件细节；若主要问题是微动作量化，请要求删掉秒数、次数、呼吸长度和生理读数式描写。",
    ].join("\n");

    const review = await generateNovelModelText({
      purpose: "novel_chapter_drama_review",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是中文小说连载审稿 Agent。判断要严格，输出纯文本，不要使用代码块。",
      userPrompt: reviewPrompt,
      temperature: 0.25,
    });
    const shouldRevise = /^REVISE\b/i.test(String(review || "").trim());
    const reviewText = String(review || "");
    const wantsCondense = /超长|过长|冗余|重复|注水|拖沓|压缩|删减/.test(reviewText);
    const psychologicalTellCount = (String(chapterContent || "").match(/感到|觉得|意识到|发现自己|复杂情绪|说不清/g) || []).length;
    if (!shouldRevise && psychologicalTellCount < 4) {
      return { content: chapterContent, review, revised: false, wantsCondense, psychologicalTellCount };
    }

    const revisePrompt = [
      `请根据审稿意见重写《${project.name}》第 ${chapterNo} 章草稿。`,
      "",
      "### 审稿意见",
      shouldRevise
        ? review
        : `正文中出现 ${psychologicalTellCount} 处“感到/觉得/意识到/发现自己”等心理直述。请保留剧情和细纲，只做表达层面的自然化重写，把心理结论改成有叙事意义的行为、选择、对话、注意力转移或物件细节；不要改成秒数、次数、呼吸长度、视线停留时长等机械微动作。`,
      "",
      "### 戏剧节拍（必须落实）",
      dramaticBeats || "暂无",
      "",
      "### 当前章节细纲（最高优先级）",
      chapterPlanGuidance.current || `第 ${chapterNo} 章条目未定位，仍按本章推进。`,
      "",
      "### 下一章边界",
      chapterPlanGuidance.next || "暂无",
      "",
      "### 最近章节上下文",
      chapterContext.recentFullTexts.join("\n\n") || "暂无",
      "",
      "### 上一章状态快照",
      chapterContext.snapshot || "暂无",
      "",
      "### 设定文件参考",
      Object.entries(settings)
        .map(([key, content]) => `## ${key}\n${truncateText(content, getNovelSettingPromptLimit(key, key === "chapter-plan" ? 2600 : 1500))}`)
        .join("\n\n"),
      "",
      "### 原草稿",
      truncateText(chapterContent, 15000),
      "",
      "### 重写要求",
      `1. ${createChapterWordTargetRequirement(project.chapterWordTarget)}`,
      "2. 输出完整 Markdown 正文，不要解释，不要使用代码块。",
      `3. 必须按“${guidance.label}”写法重写，保留必要设定和既成事实，优先修复章节类型错配、细纲偏离和表达生硬。`,
      "4. 不要把正文写成审稿意见的执行说明。",
      "5. 删掉或改写无叙事必要的微动作计量：例如“约0.3秒”“整五秒”“一次呼吸的长度”“刮了三下”“敲了几下”“瞳孔放大百分之几”。除非场景中有人或设备正在明确测量，否则不要这么写。",
      ...guidance.requirements.map((item, index) => `${index + 6}. ${item}`),
      ...createPsychologicalShowingRequirements().map((item, index) => `${index + 6 + guidance.requirements.length}. ${item}`),
      ...createNovelProseOnlyRequirements().map((item, index) => `${index + 6 + guidance.requirements.length + createPsychologicalShowingRequirements().length}. ${item}`),
    ].join("\n");

    const revisedContent = await generateNovelModelText({
      purpose: "novel_chapter_drama_rewrite",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt,
      userPrompt: revisePrompt,
      temperature: 0.78,
    });

    return {
      content: String(revisedContent || "").trim() || chapterContent,
      review,
      revised: Boolean(String(revisedContent || "").trim()),
      wantsCondense,
      psychologicalTellCount,
    };
  }

  async function generateChapter(projectId, options = {}) {
    const { project, state, review, paths } = await readProjectFileSet(projectId);
    if (state.pendingDraftChapter && options.force !== true) {
      const error = new Error(`Chapter ${state.pendingDraftChapter} is still waiting for review`);
      error.statusCode = 409;
      throw error;
    }

    const chapterNo = parseChapterNo(options.chapterNo) || (Number(state.lastApprovedChapter) || 0) + 1;
    const settings = {};
    for (const definition of SETTING_DEFINITIONS) {
      settings[definition.key] = await readSetting(projectId, definition.key);
    }
    const chapterContext = await readRecentChapterContext(projectId, chapterNo);
    const chapterPlanGuidance = buildChapterPlanGuidance(settings["chapter-plan"] || "", chapterNo);
    const materialsContext = await readMaterialsLibraryContext(projectId);
    const chapterMode = detectChapterWritingMode(chapterPlanGuidance.current || "");
    const modeGuidance = createChapterModeGuidance(chapterMode);
    debug(`chapter_generation_stage project=${projectId} chapter=${chapterNo} stage=beats`);
    const dramaticBeats = await generateChapterDramaticBeats({
      project,
      chapterNo,
      settings,
      chapterContext,
      chapterPlanGuidance,
      materialsContext,
      chapterMode,
      modeGuidance,
    });
    const systemPrompt = [
      "你是长篇中文网络小说自动写作 Agent。",
      "必须严格遵守给定设定、既有剧情和连续性要求。",
      "当前章节细纲是最高优先级约束，不得跳章、并章或抢跑后续关键事件。",
      "只输出 Markdown 正文，不要解释，不要使用代码块。",
      "正文必须有章节标题、足够的场景推进、人物互动和悬念。",
    ].join("\n");
    const userPrompt = [
      `请创作小说《${project.name}》第 ${chapterNo} 章草稿。`,
      "",
      "### 章节类型（必须服从）",
      `${modeGuidance.label}。本章应使用与该类型匹配的张力来源和叙事节奏。`,
      "",
      "### 项目基础信息",
      buildProjectPromptSummary(project),
      "",
      "### 当前章节细纲（最高优先级）",
      chapterPlanGuidance.current || `未从“章节细纲”中定位到第 ${chapterNo} 章条目。请优先参考相邻章节细纲、设定文件和既有剧情，仍然按第${chapterNo}章推进，并尽量避免并章、跳章或抢跑后续关键事件。`,
      "",
      "### 相邻章节细纲参考",
      chapterPlanGuidance.previous ? `上一章参考：\n${chapterPlanGuidance.previous}` : "上一章参考：暂无",
      "",
      chapterPlanGuidance.next ? `下一章边界：\n${chapterPlanGuidance.next}` : "下一章边界：暂无",
      "",
      "### 设定文件",
      Object.entries(settings)
        .map(([key, content]) => `## ${key}\n${truncateText(content, getNovelSettingPromptLimit(key, key === "chapter-plan" ? 4000 : 2400))}`)
        .join("\n\n"),
      "",
      "### 最近章节全文",
      chapterContext.recentFullTexts.join("\n\n") || "暂无",
      "",
      "### 更早章节摘要",
      chapterContext.oldSummaries.join("\n\n") || "暂无",
      "",
      "### 上一章状态快照",
      chapterContext.snapshot || "暂无",
      "",
      "### 挂载素材库",
      materialsContext || "暂无素材库内容。",
      "",
      `### 本章${modeGuidance.beatName}（必须落实，不要直接复述为提纲）`,
      dramaticBeats || "暂无",
      "",
      "### 写作要求",
      "1. 保持设定一致，不要吃书。",
      "2. 必须优先完成“当前章节细纲（最高优先级）”中的核心事件、场景和情绪推进。",
      "3. 不得提前写入下一章的大事件、觉醒节点、关系跃迁、反转或结局信息。",
      "4. 如果最近章节全文已经误触后续节点，本章也要按当前章节细纲回收节奏，不要继续抢跑。",
      "5. 推进主线并留下与章节类型匹配的余波或悬念。",
      "6. 不要只写设定说明，要写完整正文。",
      `7. 标题格式使用“# 第${chapterNo}章 ...”。`,
      `8. 正文以中文表达为主，避免大段英文或中英混写。`,
      `9. ${createChapterWordTargetRequirement(project.chapterWordTarget)}`,
      ...createNovelProseOnlyRequirements().map((item, index) => `${index + 10}. ${item}`),
      ...modeGuidance.requirements.map((item, index) => `${index + 14}. ${item}`),
    ].join("\n");

    debug(`chapter_generation_stage project=${projectId} chapter=${chapterNo} stage=draft`);
    const initialChapterContent = await generateNovelModelText({
      purpose: "novel_chapter",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt,
      userPrompt,
      temperature: 0.85,
    });
    const completedInitialChapterContent = await completeChapterToWordTarget({
      project,
      chapterNo,
      chapterContent: initialChapterContent,
      settings,
      chapterContext,
      chapterPlanGuidance,
      systemPrompt,
    });
    debug(`chapter_generation_stage project=${projectId} chapter=${chapterNo} stage=review`);
    const dramaReviewResult = await reviewAndImproveChapterDraft({
      project,
      chapterNo,
      chapterContent: completedInitialChapterContent,
      settings,
      chapterContext,
      chapterPlanGuidance,
      dramaticBeats,
      systemPrompt,
      chapterMode,
      modeGuidance,
    });
    const chapterContent = sanitizeNovelProseMetaReferences(await completeChapterToWordTarget({
      project,
      chapterNo,
      chapterContent: dramaReviewResult.content,
      settings,
      chapterContext,
      chapterPlanGuidance,
      systemPrompt,
      enforceIdealMaximum: dramaReviewResult.wantsCondense === true,
      condenseReason: dramaReviewResult.wantsCondense === true ? "审稿意见认为正文存在超长、冗余、重复、注水或拖沓问题。" : "",
    }));

    debug(`chapter_generation_stage project=${projectId} chapter=${chapterNo} stage=summary`);
    const summary = await generateNovelModelText({
      purpose: "novel_summary",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是小说章节摘要助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${chapterNo} 章生成章节摘要，要求包含：本章事件、人物变化、伏笔推进。\n\n${chapterContent}`,
      temperature: 0.5,
    });

    debug(`chapter_generation_stage project=${projectId} chapter=${chapterNo} stage=snapshot`);
    const snapshot = await generateNovelModelText({
      purpose: "novel_snapshot",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是小说连续性整理助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${chapterNo} 章生成状态快照，包含：人物状态、地点/时间线、伏笔状态、未解决冲突。\n\n${chapterContent}`,
      temperature: 0.4,
    });

    const persistGenerationLogs = options.persistGenerationLogs !== false;
    const artifactWrites = [
      writeFileAtomic(path.join(paths.draftsDir, formatChapterFileName(chapterNo, ".draft.md")), String(chapterContent || "").trim() + "\n"),
      writeFileAtomic(path.join(paths.summariesDir, formatChapterFileName(chapterNo, ".summary.md")), String(summary || "").trim() + "\n"),
      writeFileAtomic(path.join(paths.snapshotsDir, formatChapterFileName(chapterNo, ".state.md")), String(snapshot || "").trim() + "\n"),
    ];
    if (persistGenerationLogs) {
      artifactWrites.push(
        writeFileAtomic(path.join(paths.logsDir, formatChapterFileName(chapterNo, ".beats.md")), String(dramaticBeats || "").trim() + "\n"),
        writeFileAtomic(
          path.join(paths.logsDir, formatChapterFileName(chapterNo, ".drama-review.md")),
          [
            dramaReviewResult.revised ? "# REVISED" : "# PASS",
            "",
            String(dramaReviewResult.review || "").trim(),
          ].join("\n").trim() + "\n"
        )
      );
    }
    await Promise.all(artifactWrites);

    const nextReview = {
      ...review,
      pending: [
        {
          chapterNo,
          status: "waiting_review",
          title: extractChapterTitle(chapterContent, chapterNo),
          updatedAt: Date.now(),
          feedback: "",
        },
        ...review.pending.filter((item) => parseChapterNo(item.chapterNo) !== chapterNo),
      ],
      updatedAt: Date.now(),
    };
    const nextState = {
      ...state,
      phase: "review",
      currentChapter: Math.max(Number(state.currentChapter) || 0, chapterNo),
      pendingDraftChapter: chapterNo,
      lastGeneratedChapter: chapterNo,
      updatedAt: Date.now(),
    };
    const nextProject = {
      ...project,
      updatedAt: Date.now(),
    };
    await Promise.all([
      writeJsonFileAtomic(paths.reviewFile, nextReview),
      writeJsonFileAtomic(paths.stateFile, nextState),
      writeJsonFileAtomic(paths.projectFile, nextProject),
    ]);

    await pushReviewToQq(projectId, {
      project: nextProject,
      chapterNo,
      title: extractChapterTitle(chapterContent, chapterNo),
      summary,
    });

    debug(`generated chapter project=${projectId} chapter=${chapterNo}`);
    const chapterPayload = createChapterResponsePayload({
      chapterNo,
      content: chapterContent,
      summary,
      snapshot,
      dramaticBeats,
      dramaReview: dramaReviewResult.review,
      dramaRevised: dramaReviewResult.revised,
      extra: {
        chapterMode,
        chapterModeLabel: modeGuidance.label,
      },
    });
    return {
      chapterNo,
      title: chapterPayload.title,
      status: chapterPayload.status,
      draft: chapterContent,
      content: chapterContent,
      chapter: chapterPayload,
      dramaticBeats,
      dramaReview: dramaReviewResult.review,
      dramaRevised: dramaReviewResult.revised,
      chapterMode,
      chapterModeLabel: modeGuidance.label,
      summary,
      snapshot,
    };
  }
  async function approveChapter(projectId, chapterNo) {
    const normalizedChapterNo = parseChapterNo(chapterNo);
    if (!normalizedChapterNo) {
      const error = new Error("Invalid chapter number");
      error.statusCode = 400;
      throw error;
    }
    const { project, state, review, paths } = await readProjectFileSet(projectId);
    const draftPath = path.join(paths.draftsDir, formatChapterFileName(normalizedChapterNo, ".draft.md"));
    const approvedPath = path.join(paths.chaptersDir, formatChapterFileName(normalizedChapterNo));
    const draftContent = await readTextFile(draftPath, "");
    if (!draftContent.trim()) {
      const error = new Error("Draft chapter not found");
      error.statusCode = 404;
      throw error;
    }
    await writeFileAtomic(approvedPath, draftContent.trim() + "\n");
    await fs.promises.unlink(draftPath).catch(() => {});
    const nextReview = {
      ...review,
      pending: review.pending.filter((item) => parseChapterNo(item.chapterNo) !== normalizedChapterNo),
      history: [
        {
          chapterNo: normalizedChapterNo,
          action: "approved",
          timestamp: Date.now(),
        },
        ...review.history,
      ].slice(0, 50),
      updatedAt: Date.now(),
    };
    const nextState = {
      ...state,
      phase: "writing",
      currentChapter: Math.max(Number(state.currentChapter) || 0, normalizedChapterNo),
      lastApprovedChapter: Math.max(Number(state.lastApprovedChapter) || 0, normalizedChapterNo),
      lastGeneratedChapter: Math.max(Number(state.lastGeneratedChapter) || 0, normalizedChapterNo),
      pendingDraftChapter: Number(state.pendingDraftChapter) === normalizedChapterNo ? null : state.pendingDraftChapter,
      updatedAt: Date.now(),
    };
    await Promise.all([
      writeJsonFileAtomic(paths.reviewFile, nextReview),
      writeJsonFileAtomic(paths.stateFile, nextState),
      writeJsonFileAtomic(paths.projectFile, { ...project, updatedAt: Date.now() }),
    ]);
    debug(`approved chapter project=${projectId} chapter=${normalizedChapterNo}`);
    return { ok: true, chapterNo: normalizedChapterNo };
  }

  async function rewriteChapter(projectId, chapterNo, feedback = "") {
    const normalizedChapterNo = parseChapterNo(chapterNo);
    if (!normalizedChapterNo) {
      const error = new Error("Invalid chapter number");
      error.statusCode = 400;
      throw error;
    }
    const { project, review, paths } = await readProjectFileSet(projectId);
    const draftPath = path.join(paths.draftsDir, formatChapterFileName(normalizedChapterNo, ".draft.md"));
    const originalDraft = await readTextFile(draftPath, "");
    if (!originalDraft.trim()) {
      const error = new Error("Draft chapter not found");
      error.statusCode = 404;
      throw error;
    }
    const settings = {};
    for (const definition of SETTING_DEFINITIONS) {
      settings[definition.key] = await readSetting(projectId, definition.key);
    }
    const chapterContext = await readRecentChapterContext(projectId, normalizedChapterNo);
    const chapterPlanGuidance = buildChapterPlanGuidance(settings["chapter-plan"] || "", normalizedChapterNo);
    const materialsContext = await readMaterialsLibraryContext(projectId);
    const systemPrompt = "你是中文小说修订 Agent。请根据反馈直接重写章节草稿，输出纯 Markdown，不要解释。";
    const initialRewritten = await generateNovelModelText({
      purpose: "novel_rewrite",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt,
      userPrompt: [
        `请根据审阅意见重写《${project.name}》第 ${normalizedChapterNo} 章草稿。`,
        "",
        "### 审阅意见",
        feedback || "请整体优化节奏与表现力。",
        "",
        "### 项目基础信息",
        buildProjectPromptSummary(project),
        "",
        "### 当前章节细纲（最高优先级）",
        chapterPlanGuidance.current || `未从“章节细纲”中定位到第 ${normalizedChapterNo} 章条目。请优先参考相邻章节细纲、设定文件和既有剧情，仍然按第${normalizedChapterNo}章推进。`,
        "",
        "### 下一章边界",
        chapterPlanGuidance.next || "暂无",
        "",
        "### 设定参考",
        Object.entries(settings).map(([key, content]) => `## ${key}\n${truncateText(content, getNovelSettingPromptLimit(key, 2200))}`).join("\n\n"),
        "",
        "### 挂载素材库",
        materialsContext || "暂无素材库内容。",
        "",
        "### 写作要求",
        createChapterWordTargetRequirement(project.chapterWordTarget),
        ...createNovelProseOnlyRequirements(),
        "",
        "### 原草稿",
        originalDraft,
      ].join("\n"),
      temperature: 0.7,
    });
    const rewritten = sanitizeNovelProseMetaReferences(await completeChapterToWordTarget({
      project,
      chapterNo: normalizedChapterNo,
      chapterContent: initialRewritten,
      settings,
      chapterContext,
      chapterPlanGuidance,
      systemPrompt,
    }));
    const summary = await generateNovelModelText({
      purpose: "novel_summary",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是小说章节摘要助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${normalizedChapterNo} 章生成章节摘要，要求包含：本章事件、人物变化、伏笔推进。\n\n${rewritten}`,
      temperature: 0.5,
    });
    const snapshot = await generateNovelModelText({
      purpose: "novel_snapshot",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是小说连续性整理助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${normalizedChapterNo} 章生成状态快照，包含：人物状态、地点/时间线、伏笔状态、未解决冲突。\n\n${rewritten}`,
      temperature: 0.4,
    });
    await writeFileAtomic(draftPath, rewritten.trim() + "\n");
    await Promise.all([
      writeFileAtomic(path.join(paths.summariesDir, formatChapterFileName(normalizedChapterNo, ".summary.md")), String(summary || "").trim() + "\n"),
      writeFileAtomic(path.join(paths.snapshotsDir, formatChapterFileName(normalizedChapterNo, ".state.md")), String(snapshot || "").trim() + "\n"),
    ]);
    const nextReview = {
      ...review,
      pending: [
        {
          chapterNo: normalizedChapterNo,
          status: "waiting_review",
          title: extractChapterTitle(rewritten, normalizedChapterNo),
          updatedAt: Date.now(),
          feedback: String(feedback || "").trim(),
        },
        ...review.pending.filter((item) => parseChapterNo(item.chapterNo) !== normalizedChapterNo),
      ],
      history: [
        {
          chapterNo: normalizedChapterNo,
          action: "rewritten",
          feedback: String(feedback || "").trim(),
          timestamp: Date.now(),
        },
        ...review.history,
      ].slice(0, 50),
      updatedAt: Date.now(),
    };
    await writeJsonFileAtomic(paths.reviewFile, nextReview);
    await pushReviewToQq(projectId, {
      project,
      chapterNo: normalizedChapterNo,
      title: extractChapterTitle(rewritten, normalizedChapterNo),
      summary,
      rewritten: true,
    });
    const chapterPayload = createChapterResponsePayload({
      chapterNo: normalizedChapterNo,
      content: rewritten,
      summary,
      snapshot,
      extra: {
        rewriteFeedback: String(feedback || "").trim(),
      },
    });
    return {
      ok: true,
      chapterNo: normalizedChapterNo,
      title: chapterPayload.title,
      status: chapterPayload.status,
      draft: chapterPayload.draft,
      content: chapterPayload.content,
      chapter: chapterPayload,
      summary,
      snapshot,
    };
  }

  async function regenerateChapter(projectId, chapterNo, options = {}) {
    const normalizedChapterNo = parseChapterNo(chapterNo);
    if (!normalizedChapterNo) {
      const error = new Error("Invalid chapter number");
      error.statusCode = 400;
      throw error;
    }
    const { state } = await readProjectFileSet(projectId);
    const pendingChapterNo = Number(state.pendingDraftChapter) || 0;
    if (pendingChapterNo && pendingChapterNo !== normalizedChapterNo) {
      const error = new Error(`Chapter ${pendingChapterNo} is still waiting for review`);
      error.statusCode = 409;
      throw error;
    }
    return await generateChapter(projectId, {
      chapterNo: normalizedChapterNo,
      force: true,
      persistGenerationLogs: options.persistGenerationLogs,
    });
  }

  async function polishManualChapter(projectId, options = {}) {
    const manualContent = String(options.content || options.chapterContent || "").trim();
    if (!manualContent) {
      const error = new Error("Manual chapter content is required");
      error.statusCode = 400;
      throw error;
    }
    const { project, state, review, paths } = await readProjectFileSet(projectId);
    const requestedChapterNo = parseChapterNo(options.chapterNo);
    const chapterNo = requestedChapterNo || (Number(state.lastApprovedChapter) || 0) + 1;
    const pendingChapterNo = Number(state.pendingDraftChapter) || 0;
    if (pendingChapterNo && pendingChapterNo !== chapterNo && options.force !== true) {
      const error = new Error(`Chapter ${pendingChapterNo} is still waiting for review`);
      error.statusCode = 409;
      throw error;
    }

    const settings = {};
    for (const definition of SETTING_DEFINITIONS) {
      settings[definition.key] = await readSetting(projectId, definition.key);
    }
    const chapterContext = await readRecentChapterContext(projectId, chapterNo);
    const chapterPlanGuidance = buildChapterPlanGuidance(settings["chapter-plan"] || "", chapterNo);
    const materialsContext = await readMaterialsLibraryContext(projectId);
    const polishInstruction = String(options.instruction || options.feedback || "").trim();
    const systemPrompt = [
      "你是中文小说润色编辑。",
      "你的任务是润色用户手写章节，而不是重写成完全不同的剧情。",
      "必须保留原文核心事件、人物关系、叙事顺序和章节边界。",
      "输出纯 Markdown 正文，不要解释，不要使用代码块。",
    ].join("\n");
    const polished = await generateNovelModelText({
      purpose: "novel_manual_chapter_polish",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt,
      userPrompt: [
        `请润色小说《${project.name}》第 ${chapterNo} 章手写稿。`,
        "",
        "### 项目基础信息",
        buildProjectPromptSummary(project),
        "",
        "### 当前章节细纲",
        chapterPlanGuidance.current || `未从章节细纲中定位到第 ${chapterNo} 章条目，请以用户手写稿为准。`,
        "",
        "### 相邻章节边界",
        chapterPlanGuidance.previous ? `上一章参考：\n${chapterPlanGuidance.previous}` : "上一章参考：暂无",
        chapterPlanGuidance.next ? `下一章边界：\n${chapterPlanGuidance.next}` : "下一章边界：暂无",
        "",
        "### 最近章节上下文",
        chapterContext.recentFullTexts.join("\n\n") || "暂无",
        "",
        "### 上一章状态快照",
        chapterContext.snapshot || "暂无",
        "",
        "### 设定文件",
        Object.entries(settings).map(([key, content]) => `## ${key}\n${truncateText(content, getNovelSettingPromptLimit(key, key === "chapter-plan" ? 3200 : 1600))}`).join("\n\n"),
        "",
        "### 挂载素材库",
        materialsContext || "暂无素材库内容。",
        "",
        "### 用户润色要求",
        polishInstruction || "在不改变剧情骨架的前提下，增强语言表现力、人物对话、心理描写、环境氛围和节奏衔接。",
        "",
        "### 手写章节原文",
        manualContent,
        "",
        "### 输出要求",
        `1. 标题格式使用“# 第${chapterNo}章 ...”。如果原文已有合适标题可以保留。`,
        "2. 不要擅自新增颠覆性剧情、角色死亡、能力突破或关系跃迁。",
        "3. 优先使用素材库中适合的对话、心理、环境、类型和能力等级素材。",
        "4. 保留用户原文中有辨识度的表达，只做提升和补足。",
        ...createNovelProseOnlyRequirements().map((item, index) => `${index + 5}. ${item}`),
      ].join("\n"),
      temperature: 0.55,
    });
    const completed = sanitizeNovelProseMetaReferences(await completeChapterToWordTarget({
      project,
      chapterNo,
      chapterContent: polished,
      settings,
      chapterContext,
      chapterPlanGuidance,
      systemPrompt,
    }));

    const summary = await generateNovelModelText({
      purpose: "novel_summary",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是小说章节摘要助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${chapterNo} 章生成章节摘要，要求包含：本章事件、人物变化、伏笔推进。\n\n${completed}`,
      temperature: 0.5,
    });
    const snapshot = await generateNovelModelText({
      purpose: "novel_snapshot",
      model: project.model,
      ...projectModelRouting(project),
      systemPrompt: "你是小说连续性整理助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${chapterNo} 章生成状态快照，包含：人物状态、地点/时间线、伏笔状态、未解决冲突。\n\n${completed}`,
      temperature: 0.4,
    });

    if (options.saveAsDraft !== false) {
      await Promise.all([
        writeFileAtomic(path.join(paths.draftsDir, formatChapterFileName(chapterNo, ".draft.md")), String(completed || "").trim() + "\n"),
        writeFileAtomic(path.join(paths.summariesDir, formatChapterFileName(chapterNo, ".summary.md")), String(summary || "").trim() + "\n"),
        writeFileAtomic(path.join(paths.snapshotsDir, formatChapterFileName(chapterNo, ".state.md")), String(snapshot || "").trim() + "\n"),
      ]);
      const nextReview = {
        ...review,
        pending: [
          {
            chapterNo,
            status: "waiting_review",
            title: extractChapterTitle(completed, chapterNo),
            updatedAt: Date.now(),
            feedback: polishInstruction,
            source: "manual_polish",
          },
          ...review.pending.filter((item) => parseChapterNo(item.chapterNo) !== chapterNo),
        ],
        updatedAt: Date.now(),
      };
      const nextState = {
        ...state,
        phase: "review",
        currentChapter: Math.max(Number(state.currentChapter) || 0, chapterNo),
        pendingDraftChapter: chapterNo,
        lastGeneratedChapter: Math.max(Number(state.lastGeneratedChapter) || 0, chapterNo),
        updatedAt: Date.now(),
      };
      const nextProject = {
        ...project,
        updatedAt: Date.now(),
      };
      await Promise.all([
        writeJsonFileAtomic(paths.reviewFile, nextReview),
        writeJsonFileAtomic(paths.stateFile, nextState),
        writeJsonFileAtomic(paths.projectFile, nextProject),
      ]);
      await pushReviewToQq(projectId, {
        project: nextProject,
        chapterNo,
        title: extractChapterTitle(completed, chapterNo),
        summary,
        rewritten: true,
      });
    }

    const chapterPayload = createChapterResponsePayload({
      chapterNo,
      content: completed,
      summary,
      snapshot,
      extra: {
        source: "manual_polish",
        polishInstruction,
      },
    });
    return {
      chapterNo,
      title: chapterPayload.title,
      status: chapterPayload.status,
      draft: chapterPayload.draft,
      content: chapterPayload.content,
      chapter: chapterPayload,
      summary,
      snapshot,
      savedAsDraft: options.saveAsDraft !== false,
    };
  }

  async function rejectChapter(projectId, chapterNo, feedback = "") {
    await rewriteChapter(projectId, chapterNo, feedback);
    return { ok: true, chapterNo: parseChapterNo(chapterNo), feedback: String(feedback || "").trim() };
  }

  async function batchGenerateChapters(projectId, options = {}) {
    const count = Math.min(Math.max(Number(options.count) || 1, 1), 20);
    const autoApprove = options.autoApprove === true;
    const stopOnReview = options.stopOnReview !== false;
    const generated = [];
    let haltedReason = "";

    for (let index = 0; index < count; index += 1) {
      const snapshot = await getProjectDetail(projectId);
      if (snapshot.state.pendingDraftChapter && stopOnReview) {
        haltedReason = `chapter_${snapshot.state.pendingDraftChapter}_waiting_review`;
        break;
      }

      const result = await generateChapter(projectId, {
        force: !stopOnReview && autoApprove,
        persistGenerationLogs: options.persistGenerationLogs,
      });
      const generatedChapter = result.chapter
        ? {
          ...result.chapter,
          status: autoApprove ? "approved" : result.chapter.status,
        }
        : undefined;
      generated.push({
        chapterNo: result.chapterNo,
        title: result.title,
        status: autoApprove ? "approved" : result.status,
        draft: result.draft,
        content: result.content,
        chapter: generatedChapter,
        summary: result.summary,
        snapshot: result.snapshot,
        dramaticBeats: result.dramaticBeats,
        dramaReview: result.dramaReview,
        dramaRevised: result.dramaRevised,
      });

      if (autoApprove) {
        await approveChapter(projectId, result.chapterNo);
      } else if (stopOnReview) {
        haltedReason = `chapter_${result.chapterNo}_waiting_review`;
        break;
      }
    }

    const { state, project } = await readProjectFileSet(projectId);
    const paths = getProjectPaths(novelsDir, projectId);
    await writeJsonFileAtomic(paths.stateFile, {
      ...state,
      autoWriteEnabled: true,
      autoWriteLastCount: count,
      updatedAt: Date.now(),
    });
    await writeJsonFileAtomic(paths.projectFile, {
      ...project,
      updatedAt: Date.now(),
    });

    return {
      ok: true,
      generated,
      autoApprove,
      requestedCount: count,
      haltedReason,
    };
  }

  async function getChapterContent(projectId, chapterNo, options = {}) {
    const normalizedChapterNo = parseChapterNo(chapterNo);
    if (!normalizedChapterNo) {
      const error = new Error("Invalid chapter number");
      error.statusCode = 400;
      throw error;
    }
    const paths = getProjectPaths(novelsDir, projectId);
    const preferDraft = options.preferDraft === true;
    const candidates = preferDraft
      ? [
        path.join(paths.draftsDir, formatChapterFileName(normalizedChapterNo, ".draft.md")),
        path.join(paths.chaptersDir, formatChapterFileName(normalizedChapterNo)),
      ]
      : [
        path.join(paths.chaptersDir, formatChapterFileName(normalizedChapterNo)),
        path.join(paths.draftsDir, formatChapterFileName(normalizedChapterNo, ".draft.md")),
      ];
    for (const candidate of candidates) {
      const content = await readTextFile(candidate, "");
      if (content.trim()) {
        return {
          chapterNo: normalizedChapterNo,
          status: candidate.includes(".draft.md") ? "draft" : "approved",
          content,
          title: extractChapterTitle(content, normalizedChapterNo),
          characterCount: countChineseCharacters(content),
        };
      }
    }
    const error = new Error("Chapter not found");
    error.statusCode = 404;
    throw error;
  }

  async function exportProjectMarkdown(projectId) {
    const { project } = await readProjectFileSet(projectId);
    const chapterEntries = await listChaptersMeta(projectId);
    const chapterNos = chapterEntries
      .filter((item) => item.status === "approved")
      .map((item) => parseChapterNo(item.chapterNo))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (!chapterNos.length) {
      const error = new Error("No approved chapters to export");
      error.statusCode = 404;
      throw error;
    }

    const sections = [];
    for (const chapterNo of chapterNos) {
      const chapter = await getChapterContent(projectId, chapterNo, { preferDraft: false });
      sections.push(String(chapter.content || "").trim());
    }

    const title = sanitizeProjectName(project.name || projectId) || projectId;
    const content = [
      `# ${title}`,
      "",
      `> 导出时间：${new Date().toISOString()}`,
      `> 章节数：${sections.length}`,
      "",
      ...sections,
    ].join("\n\n").trim() + "\n";

    return {
      fileName: `${sanitizeDownloadFileName(title)}-正文合集.md`,
      content,
      chapterCount: sections.length,
      characterCount: countChineseCharacters(content),
    };
  }

  async function pushReviewToQq(projectId, payload = {}) {
    if (typeof sendQqMessage !== "function") {
      return;
    }
    const { project } = await readProjectFileSet(projectId);
    const qqBotConfig = typeof getQqBotConfig === "function" ? (getQqBotConfig() || {}) : {};
    const target = createReviewTarget(project, qqBotConfig);
    if (!target?.targetId) {
      return;
    }
    const message = [
      payload.rewritten ? `《${project.name}》第 ${payload.chapterNo} 章已按意见重写` : `《${project.name}》第 ${payload.chapterNo} 章草稿已生成`,
      payload.title ? `标题：${payload.title}` : "",
      payload.summary ? `摘要：${truncateText(payload.summary, 300)}` : "",
      "可用指令：",
      `- -n 查看 ${project.name} 第${payload.chapterNo}章摘要`,
      `- -n 查看 ${project.name} 第${payload.chapterNo}章正文`,
      `- -n 通过 ${project.name} 第${payload.chapterNo}章`,
      `- -n 退回 ${project.name} 第${payload.chapterNo}章：意见`,
    ].filter(Boolean).join("\n");

    try {
      await sendQqMessage({
        targetType: target.targetType,
        targetId: target.targetId,
        message,
      });
    } catch (error) {
      debug(`push qq failed project=${projectId} error=${error.message || "unknown"}`);
    }
  }
  async function handleQqCommand(context = {}) {
    const text = String(context.text || "").trim();
    if (!text) {
      return null;
    }
    const matchPrefix = text.match(/^-n(?:\s+(.*))?$/i);
    if (!matchPrefix) {
      return null;
    }
    const commandText = String(matchPrefix[1] || "").trim();
    if (!commandText) {
      return "小说项目指令请使用：-n 小说列表";
    }
    if (commandText === "小说列表") {
      const projects = await listProjects();
      if (!projects.length) {
        return "当前还没有小说项目。";
      }
      return [
        "小说项目：",
        ...projects.slice(0, 20).map((item, index) => `${index + 1}. ${item.name}｜已通过 ${item.lastApprovedChapter} 章｜待审 ${item.pendingDraftChapter || 0}`),
      ].join("\n");
    }

    let match = commandText.match(/^查看小说\s+(.+)$/);
    if (match) {
      const projectId = await resolveProjectId(match[1]);
      const detail = await getProjectDetail(projectId);
      return [
        `小说：${detail.project.name}`,
        `题材：${detail.project.genre || "未填写"}`,
        `主题：${detail.project.theme || "未填写"}`,
        `已通过章节：${detail.state.lastApprovedChapter || 0}`,
        `待审章节：${detail.state.pendingDraftChapter || 0}`,
      ].join("\n");
    }

    match = commandText.match(/^生成\s+(.+?)\s+下一章$/);
    if (match) {
      const projectId = await resolveProjectId(match[1]);
      const result = await generateChapter(projectId);
      return [
        `《${(await readProjectFileSet(projectId)).project.name}》第 ${result.chapterNo} 章已生成。`,
        `标题：${result.title}`,
        `摘要：${truncateText(result.summary, 300)}`,
      ].join("\n");
    }

    match = commandText.match(/^查看\s+(.+?)\s+第\s*(\d+)\s*章摘要$/);
    if (match) {
      const projectId = await resolveProjectId(match[1]);
      const chapterNo = parseChapterNo(match[2]);
      const summary = await readTextFile(path.join(getProjectPaths(novelsDir, projectId).summariesDir, formatChapterFileName(chapterNo, ".summary.md")), "");
      if (!summary.trim()) {
        return `《${match[1]}》第 ${chapterNo} 章还没有摘要。`;
      }
      const { project } = await readProjectFileSet(projectId);
      return formatQqNovelSummary(project.name, chapterNo, summary);
    }

    match = commandText.match(/^查看\s+(.+?)\s+第\s*(\d+)\s*章正文$/);
    if (match) {
      const projectId = await resolveProjectId(match[1]);
      const chapter = await getChapterContent(projectId, match[2], { preferDraft: true });
      const { project } = await readProjectFileSet(projectId);
      return formatQqNovelContent(project.name, chapter);
    }

    match = commandText.match(/^通过\s+(.+?)\s+第\s*(\d+)\s*章$/);
    if (match) {
      const projectId = await resolveProjectId(match[1]);
      await approveChapter(projectId, match[2]);
      return `《${match[1]}》第 ${match[2]} 章已通过。`;
    }

    match = commandText.match(/^退回\s+(.+?)\s+第\s*(\d+)\s*章[:：]\s*(.+)$/);
    if (match) {
      const projectId = await resolveProjectId(match[1]);
      await rejectChapter(projectId, match[2], match[3]);
      return `《${match[1]}》第 ${match[2]} 章已按意见重写。`;
    }

    return null;
  }

  async function parseJsonBody(req) {
    const rawBody = await readRequestBody(req, { limitBytes: 100 * 1024 * 1024 });
    return rawBody ? JSON.parse(rawBody) : {};
  }

  async function handleRequest(req, res, pathname) {
    await ensureNovelsDir();

    if (pathname === "/novels/projects" && req.method === "GET") {
      sendJson(res, 200, { ok: true, projects: await listProjects() });
      return true;
    }

    if (pathname === "/novels/infer-project" && req.method === "POST") {
      const payload = await parseJsonBody(req);
      sendJson(res, 200, { ok: true, ...(await inferProjectFromBrief(payload)) });
      return true;
    }

    if (pathname === "/novels/projects" && req.method === "POST") {
      const payload = await parseJsonBody(req);
      sendJson(res, 200, { ok: true, ...(await createProject(payload)) });
      return true;
    }

    const projectMatch = pathname.match(/^\/novels\/projects\/([^/]+)$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, ...(await getProjectDetail(projectId)) });
        return true;
      }
      if (req.method === "PUT") {
        const payload = await parseJsonBody(req);
        sendJson(res, 200, { ok: true, ...(await updateProject(projectId, payload)) });
        return true;
      }
      if (req.method === "DELETE") {
        sendJson(res, 200, await deleteProject(projectId));
        return true;
      }
    }

    const generateSettingsMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/generate-settings$/);
    if (generateSettingsMatch && req.method === "POST") {
      const projectId = decodeURIComponent(generateSettingsMatch[1]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        projectId,
        generated: await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) =>
          generateSettings(effectiveProjectId, { overwrite: payload.overwrite !== false })
        ),
      });
      return true;
    }

    const reconcileSettingsMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/reconcile-settings$/);
    if (reconcileSettingsMatch && req.method === "POST") {
      const projectId = decodeURIComponent(reconcileSettingsMatch[1]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        projectId,
        generated: await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) =>
          reconcileSettingsFromChapters(effectiveProjectId, { overwrite: payload.overwrite !== false })
        ),
      });
      return true;
    }

    const generateSingleSettingMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/settings\/([^/]+)\/generate$/);
    if (generateSingleSettingMatch && req.method === "POST") {
      const projectId = decodeURIComponent(generateSingleSettingMatch[1]);
      const key = decodeURIComponent(generateSingleSettingMatch[2]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        projectId,
        generated: await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) =>
          generateSingleSetting(effectiveProjectId, key, { overwrite: payload.overwrite !== false })
        ),
      });
      return true;
    }

    const reconcileSingleSettingMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/settings\/([^/]+)\/reconcile$/);
    if (reconcileSingleSettingMatch && req.method === "POST") {
      const projectId = decodeURIComponent(reconcileSingleSettingMatch[1]);
      const key = decodeURIComponent(reconcileSingleSettingMatch[2]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        projectId,
        generated: await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) =>
          generateSingleSetting(effectiveProjectId, key, {
            overwrite: payload.overwrite !== false,
            alignToWrittenChapters: true,
          })
        ),
      });
      return true;
    }

    const settingsListMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/settings$/);
    if (settingsListMatch && req.method === "GET") {
      const projectId = decodeURIComponent(settingsListMatch[1]);
      const settings = {};
      for (const definition of SETTING_DEFINITIONS) {
        settings[definition.key] = await readSetting(projectId, definition.key);
      }
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    const materialsListMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/materials$/);
    if (materialsListMatch && req.method === "GET") {
      const projectId = decodeURIComponent(materialsListMatch[1]);
      const materials = {};
      for (const definition of MATERIAL_DEFINITIONS) {
        materials[definition.key] = await readMaterial(projectId, definition.key);
      }
      sendJson(res, 200, { ok: true, materials });
      return true;
    }
    const materialGenerateMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/materials\/([^/]+)\/generate$/);
    if (materialGenerateMatch && req.method === "POST") {
      const projectId = decodeURIComponent(materialGenerateMatch[1]);
      const key = decodeURIComponent(materialGenerateMatch[2]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        projectId,
        generated: await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) =>
          generateMaterial(effectiveProjectId, key, payload)
        ),
      });
      return true;
    }
    const materialItemMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/materials\/([^/]+)$/);
    if (materialItemMatch) {
      const projectId = decodeURIComponent(materialItemMatch[1]);
      const key = decodeURIComponent(materialItemMatch[2]);
      if (!MATERIAL_KEY_SET.has(key)) {
        const error = new Error("Unsupported material key");
        error.statusCode = 404;
        throw error;
      }
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, key, content: await readMaterial(projectId, key) });
        return true;
      }
      if (req.method === "PUT") {
        const payload = await parseJsonBody(req);
        await writeMaterial(projectId, key, String(payload.content || ""));
        sendJson(res, 200, { ok: true, key, content: await readMaterial(projectId, key) });
        return true;
      }
    }

    const settingItemMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/settings\/([^/]+)$/);
    if (settingItemMatch) {
      const projectId = decodeURIComponent(settingItemMatch[1]);
      const key = decodeURIComponent(settingItemMatch[2]);
      if (!SETTING_KEY_SET.has(key)) {
        const error = new Error("Unsupported setting key");
        error.statusCode = 404;
        throw error;
      }
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, key, content: await readSetting(projectId, key) });
        return true;
      }
      if (req.method === "PUT") {
        const payload = await parseJsonBody(req);
        await writeSetting(projectId, key, String(payload.content || ""));
        sendJson(res, 200, { ok: true, key, content: await readSetting(projectId, key) });
        return true;
      }
    }

    const chaptersMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters$/);
    if (chaptersMatch && req.method === "GET") {
      const projectId = decodeURIComponent(chaptersMatch[1]);
      sendJson(res, 200, { ok: true, chapters: await listChaptersMeta(projectId) });
      return true;
    }

    const exportMarkdownMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/export\/markdown$/);
    if (exportMarkdownMatch && req.method === "GET") {
      const projectId = decodeURIComponent(exportMarkdownMatch[1]);
      sendJson(res, 200, { ok: true, ...(await exportProjectMarkdown(projectId)) });
      return true;
    }

    const generateChapterMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/generate-next$/);
    if (generateChapterMatch && req.method === "POST") {
      const projectId = decodeURIComponent(generateChapterMatch[1]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        ...(await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) => generateChapter(effectiveProjectId, {
          persistGenerationLogs: !payload.lifeProjectSnapshot,
        }))),
      });
      return true;
    }

    const polishManualChapterMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/polish-manual$/);
    if (polishManualChapterMatch && req.method === "POST") {
      const projectId = decodeURIComponent(polishManualChapterMatch[1]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        ...(await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) => polishManualChapter(effectiveProjectId, {
          ...payload,
          saveAsDraft: payload.lifeProjectSnapshot ? false : payload.saveAsDraft,
        }))),
      });
      return true;
    }

    const batchGenerateMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/batch-generate$/);
    if (batchGenerateMatch && req.method === "POST") {
      const projectId = decodeURIComponent(batchGenerateMatch[1]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) => batchGenerateChapters(effectiveProjectId, {
        ...payload,
        persistGenerationLogs: !payload.lifeProjectSnapshot,
      })));
      return true;
    }

    const chapterContentMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/([^/]+)$/);
    if (chapterContentMatch && req.method === "GET") {
      const projectId = decodeURIComponent(chapterContentMatch[1]);
      const chapterNo = decodeURIComponent(chapterContentMatch[2]);
      sendJson(res, 200, { ok: true, ...(await getChapterContent(projectId, chapterNo, { preferDraft: true })) });
      return true;
    }
    if (chapterContentMatch && req.method === "DELETE") {
      const projectId = decodeURIComponent(chapterContentMatch[1]);
      const chapterNo = decodeURIComponent(chapterContentMatch[2]);
      sendJson(res, 200, await deleteChapterAndProgress(projectId, chapterNo));
      return true;
    }

    const approveMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/([^/]+)\/approve$/);
    if (approveMatch && req.method === "POST") {
      const projectId = decodeURIComponent(approveMatch[1]);
      const chapterNo = decodeURIComponent(approveMatch[2]);
      sendJson(res, 200, await approveChapter(projectId, chapterNo));
      return true;
    }

    const rejectMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/([^/]+)\/reject$/);
    if (rejectMatch && req.method === "POST") {
      const projectId = decodeURIComponent(rejectMatch[1]);
      const chapterNo = decodeURIComponent(rejectMatch[2]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, await rejectChapter(projectId, chapterNo, payload.feedback || ""));
      return true;
    }

    const rewriteMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/([^/]+)\/rewrite$/);
    if (rewriteMatch && req.method === "POST") {
      const projectId = decodeURIComponent(rewriteMatch[1]);
      const chapterNo = decodeURIComponent(rewriteMatch[2]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) =>
        rewriteChapter(effectiveProjectId, chapterNo, payload.feedback || "")
      ));
      return true;
    }

    const regenerateMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/([^/]+)\/regenerate$/);
    if (regenerateMatch && req.method === "POST") {
      const projectId = decodeURIComponent(regenerateMatch[1]);
      const chapterNo = decodeURIComponent(regenerateMatch[2]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, {
        ok: true,
        ...(await withLifeSnapshotProject(projectId, payload, (effectiveProjectId) => regenerateChapter(effectiveProjectId, chapterNo, {
          persistGenerationLogs: !payload.lifeProjectSnapshot,
        }))),
      });
      return true;
    }

    const reviewMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/reviews$/);
    if (reviewMatch && req.method === "GET") {
      const projectId = decodeURIComponent(reviewMatch[1]);
      const { review } = await readProjectFileSet(projectId);
      sendJson(res, 200, { ok: true, review });
      return true;
    }

    return false;
  }

  return {
    ensureNovelsDir,
    handleRequest,
    handleQqCommand,
    listProjects,
    readSetting,
    writeSetting,
    createProject,
    inferProjectFromBrief,
    getProjectDetail,
    updateProject,
    deleteProject,
    generateSettings,
    generateSingleSetting,
    generateMaterial,
    listMaterials,
    readMaterial,
    writeMaterial,
    reconcileSettingsFromChapters,
    generateChapter,
    polishManualChapter,
    batchGenerateChapters,
    approveChapter,
    deleteChapterAndProgress,
    regenerateChapter,
    rewriteChapter,
    rejectChapter,
    exportProjectMarkdown,
    getChapterContent,
  };
}

module.exports = {
  SETTING_DEFINITIONS,
  MATERIAL_DEFINITIONS,
  createNovelModule,
};
