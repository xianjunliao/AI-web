
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
    ? `单章字数以 ${normalized} 个中文汉字为目标，正文中文汉字数最低不得少于 ${range.minimum} 个；不要用设定说明、重复段落或无效水文凑字数。`
    : "单章字数优先保证剧情完整、节奏自然，再结合实际内容灵活控制篇幅。";
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
    minimum: Math.max(1, Math.floor(normalized * 0.9)),
    maximum: Math.max(1, Math.ceil(normalized * 1.15)),
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

    for (const definition of SETTING_DEFINITIONS) {
      if (definition.key === "base-info") continue;
      await writeSetting(projectId, definition.key, `# ${definition.title}\n\n待自动生成。`);
    }

    for (const definition of MATERIAL_DEFINITIONS) {
      await writeMaterial(projectId, definition.key, createDefaultMaterialMarkdown(definition));
    }

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
    ].filter(Boolean).join("\n");
    return await generateNovelModelText({
      purpose: `novel_setting_${key}`,
      model: project.model,
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

    for (const definition of SETTING_DEFINITIONS) {
      if (definition.key === "base-info") {
        generated[definition.key] = currentSettings[definition.key];
        continue;
      }
      if (!overwrite && String(currentSettings[definition.key] || "").trim() && !/待自动生成/.test(currentSettings[definition.key])) {
        generated[definition.key] = currentSettings[definition.key];
        continue;
      }
      const generationContext = createSettingGenerationContext(currentSettings, generated, {
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
      generated[definition.key] = content;
      await writeSetting(projectId, definition.key, content);
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
  }) {
    const range = getChapterWordTargetRange(project.chapterWordTarget);
    if (!range.minimum) {
      return String(chapterContent || "");
    }

    let completedContent = String(chapterContent || "").trim();
    let currentCount = countChineseCharacters(completedContent);
    for (let attempt = 1; attempt <= 3 && currentCount < range.minimum; attempt += 1) {
      const needed = range.minimum - currentCount;
      const supplementPrompt = [
        `小说《${project.name}》第 ${chapterNo} 章草稿当前中文汉字数为 ${currentCount}，目标为 ${range.target}，最低要求为 ${range.minimum}。`,
        `请只补写可直接接在本章末尾的正文段落，至少补充约 ${needed} 个中文汉字，使整章达到最低字数要求。`,
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
        `4. 补写后整章中文汉字数应落在 ${range.minimum}-${range.maximum} 之间。`,
        "5. 结尾保留本章悬念或余韵。",
        "",
        "### 设定文件参考",
        Object.entries(settings)
          .map(([key, content]) => `## ${key}\n${truncateText(content, key === "chapter-plan" ? 2400 : 1400)}`)
          .join("\n\n"),
      ].join("\n");

      const supplement = await generateNovelModelText({
        purpose: "novel_chapter_expand",
        model: project.model,
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

    return completedContent;
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
        .map(([key, content]) => `## ${key}\n${truncateText(content, key === "chapter-plan" ? 4000 : 2400)}`)
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
      "### 写作要求",
      "1. 保持设定一致，不要吃书。",
      "2. 必须优先完成“当前章节细纲（最高优先级）”中的核心事件、场景和情绪推进。",
      "3. 不得提前写入下一章的大事件、觉醒节点、关系跃迁、反转或结局信息。",
      "4. 如果最近章节全文已经误触后续节点，本章也要按当前章节细纲回收节奏，不要继续抢跑。",
      "5. 推进主线并留下下一章悬念。",
      "6. 不要只写设定说明，要写完整正文。",
      `7. 标题格式使用“# 第${chapterNo}章 ...”。`,
      `8. 正文以中文表达为主，避免大段英文或中英混写。`,
      `9. ${createChapterWordTargetRequirement(project.chapterWordTarget)}`,
    ].join("\n");

    const initialChapterContent = await generateNovelModelText({
      purpose: "novel_chapter",
      model: project.model,
      systemPrompt,
      userPrompt,
      temperature: 0.85,
    });
    const chapterContent = await completeChapterToWordTarget({
      project,
      chapterNo,
      chapterContent: initialChapterContent,
      settings,
      chapterContext,
      chapterPlanGuidance,
      systemPrompt,
    });

    const summary = await generateNovelModelText({
      purpose: "novel_summary",
      model: project.model,
      systemPrompt: "你是小说章节摘要助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${chapterNo} 章生成章节摘要，要求包含：本章事件、人物变化、伏笔推进。\n\n${chapterContent}`,
      temperature: 0.5,
    });

    const snapshot = await generateNovelModelText({
      purpose: "novel_snapshot",
      model: project.model,
      systemPrompt: "你是小说连续性整理助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${chapterNo} 章生成状态快照，包含：人物状态、地点/时间线、伏笔状态、未解决冲突。\n\n${chapterContent}`,
      temperature: 0.4,
    });

    await Promise.all([
      writeFileAtomic(path.join(paths.draftsDir, formatChapterFileName(chapterNo, ".draft.md")), String(chapterContent || "").trim() + "\n"),
      writeFileAtomic(path.join(paths.summariesDir, formatChapterFileName(chapterNo, ".summary.md")), String(summary || "").trim() + "\n"),
      writeFileAtomic(path.join(paths.snapshotsDir, formatChapterFileName(chapterNo, ".state.md")), String(snapshot || "").trim() + "\n"),
    ]);

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
    return {
      chapterNo,
      title: extractChapterTitle(chapterContent, chapterNo),
      draft: chapterContent,
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
        Object.entries(settings).map(([key, content]) => `## ${key}\n${truncateText(content, 2200)}`).join("\n\n"),
        "",
        "### 挂载素材库",
        materialsContext || "暂无素材库内容。",
        "",
        "### 写作要求",
        createChapterWordTargetRequirement(project.chapterWordTarget),
        "",
        "### 原草稿",
        originalDraft,
      ].join("\n"),
      temperature: 0.7,
    });
    const rewritten = await completeChapterToWordTarget({
      project,
      chapterNo: normalizedChapterNo,
      chapterContent: initialRewritten,
      settings,
      chapterContext,
      chapterPlanGuidance,
      systemPrompt,
    });
    const summary = await generateNovelModelText({
      purpose: "novel_summary",
      model: project.model,
      systemPrompt: "你是小说章节摘要助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${normalizedChapterNo} 章生成章节摘要，要求包含：本章事件、人物变化、伏笔推进。\n\n${rewritten}`,
      temperature: 0.5,
    });
    const snapshot = await generateNovelModelText({
      purpose: "novel_snapshot",
      model: project.model,
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
    return { ok: true, chapterNo: normalizedChapterNo };
  }

  async function regenerateChapter(projectId, chapterNo) {
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
        Object.entries(settings).map(([key, content]) => `## ${key}\n${truncateText(content, key === "chapter-plan" ? 3200 : 1600)}`).join("\n\n"),
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
      ].join("\n"),
      temperature: 0.55,
    });
    const completed = await completeChapterToWordTarget({
      project,
      chapterNo,
      chapterContent: polished,
      settings,
      chapterContext,
      chapterPlanGuidance,
      systemPrompt,
    });

    const summary = await generateNovelModelText({
      purpose: "novel_summary",
      model: project.model,
      systemPrompt: "你是小说章节摘要助手。输出纯 Markdown，不要使用代码块。",
      userPrompt: `请为《${project.name}》第 ${chapterNo} 章生成章节摘要，要求包含：本章事件、人物变化、伏笔推进。\n\n${completed}`,
      temperature: 0.5,
    });
    const snapshot = await generateNovelModelText({
      purpose: "novel_snapshot",
      model: project.model,
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

    return {
      chapterNo,
      title: extractChapterTitle(completed, chapterNo),
      draft: completed,
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
      });
      generated.push({
        chapterNo: result.chapterNo,
        title: result.title,
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
    const rawBody = await readRequestBody(req);
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
        generated: await generateSettings(projectId, { overwrite: payload.overwrite !== false }),
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
        generated: await reconcileSettingsFromChapters(projectId, { overwrite: payload.overwrite !== false }),
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
        generated: await generateSingleSetting(projectId, key, { overwrite: payload.overwrite !== false }),
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
        generated: await generateSingleSetting(projectId, key, {
          overwrite: payload.overwrite !== false,
          alignToWrittenChapters: true,
        }),
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
        generated: await generateMaterial(projectId, key, payload),
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
      sendJson(res, 200, { ok: true, ...(await generateChapter(projectId)) });
      return true;
    }

    const polishManualChapterMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/polish-manual$/);
    if (polishManualChapterMatch && req.method === "POST") {
      const projectId = decodeURIComponent(polishManualChapterMatch[1]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, { ok: true, ...(await polishManualChapter(projectId, payload)) });
      return true;
    }

    const batchGenerateMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/batch-generate$/);
    if (batchGenerateMatch && req.method === "POST") {
      const projectId = decodeURIComponent(batchGenerateMatch[1]);
      const payload = await parseJsonBody(req);
      sendJson(res, 200, await batchGenerateChapters(projectId, payload));
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
      sendJson(res, 200, await rewriteChapter(projectId, chapterNo, payload.feedback || ""));
      return true;
    }

    const regenerateMatch = pathname.match(/^\/novels\/projects\/([^/]+)\/chapters\/([^/]+)\/regenerate$/);
    if (regenerateMatch && req.method === "POST") {
      const projectId = decodeURIComponent(regenerateMatch[1]);
      const chapterNo = decodeURIComponent(regenerateMatch[2]);
      sendJson(res, 200, { ok: true, ...(await regenerateChapter(projectId, chapterNo)) });
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
