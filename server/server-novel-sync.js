const fs = require("fs");
const path = require("path");

function createNovelSyncModule(deps = {}) {
  const {
    novelsDir,
    stateFile,
    readJsonFile,
    writeFileAtomic,
    writeJsonFileAtomic,
    requestJson,
    queryMysql,
    novelModule,
    logDebug,
    defaultCloudBaseUrl,
  } = deps;

  function debug(message) {
    try {
      if (typeof logDebug === "function") {
        logDebug(`novel_sync ${message}`);
      }
    } catch {}
  }

  async function readState() {
    const state = await readJsonFile(stateFile, {
      cloudBaseUrl: "",
      lastCloudUpdatedAt: 0,
      lastLocalScanAt: 0,
      localProjectFingerprints: {},
      projectHashes: {},
      enabled: true,
    });
    if (!state.cloudBaseUrl && defaultCloudBaseUrl) {
      state.cloudBaseUrl = defaultCloudBaseUrl;
    }
    return state;
  }

  async function saveState(state) {
    await writeJsonFileAtomic(stateFile, {
      ...(state || {}),
      updatedAt: Date.now(),
    });
  }

  function normalizeBaseUrl(value = "") {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  async function listLocalProjectIds() {
    try {
      const entries = await fs.promises.readdir(novelsDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function getLocalSnapshot() {
    if (!novelModule || typeof novelModule.getProjectDetail !== "function") {
      return [];
    }
    const ids = await listLocalProjectIds();
    const projects = [];
    for (const projectId of ids) {
      try {
        const detail = await createFullProjectDetail(projectId);
        projects.push({
          projectId,
          detail,
          updatedAt: Date.now(),
        });
      } catch (error) {
        debug(`read_local_project_failed projectId=${projectId} error=${error.message || error}`);
      }
    }
    return projects;
  }

  async function createFullProjectDetail(projectId) {
    const detail = await novelModule.getProjectDetail(projectId);
    const settings = {};
    for (const [key, meta] of Object.entries(detail.settings || {})) {
      const content = typeof novelModule.readSetting === "function"
        ? await novelModule.readSetting(projectId, key).catch(() => "")
        : "";
      settings[key] = {
        ...(meta || {}),
        key,
        content,
        hasContent: Boolean(String(content || "").trim()),
      };
    }
    const materials = {};
    for (const [key, meta] of Object.entries(detail.materials || {})) {
      const content = typeof novelModule.readMaterial === "function"
        ? await novelModule.readMaterial(projectId, key).catch(() => "")
        : "";
      materials[key] = {
        ...(meta || {}),
        key,
        content,
        hasContent: Boolean(String(content || "").trim()),
      };
    }
    const chapters = [];
    for (const meta of detail.chapters || []) {
      try {
        const chapter = await novelModule.getChapterContent(projectId, meta.chapterNo, { preferDraft: true });
        chapters.push({
          ...(meta || {}),
          ...chapter,
          content: chapter.content || "",
        });
      } catch {
        chapters.push(meta);
      }
    }
    return {
      ...detail,
      settings,
      materials,
      chapters,
    };
  }

  function stableStringify(value) {
    if (value == null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  function hashText(value = "") {
    let hash = 0;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return String(hash >>> 0);
  }

  function parseJson(value, fallback = {}) {
    if (value == null || value === "") return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(String(value || ""));
    } catch {
      return fallback;
    }
  }

  function firstRows(result) {
    return Array.isArray(result?.[0]) ? result[0] : [];
  }

  async function pullProjectFromMysql(projectId) {
    const target = String(projectId || "").trim();
    if (!target || typeof queryMysql !== "function") {
      return false;
    }
    const projectRows = firstRows(await queryMysql(
      "SELECT project_json,state_json,review_json,updated_at FROM novel_project WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
      [target]
    ));
    if (!projectRows.length) {
      debug(`mysql_project_not_found projectId=${target}`);
      return false;
    }
    const [settingRows, materialRows, chapterRows] = await Promise.all([
      queryMysql("SELECT setting_key,title,content,meta_json,updated_at FROM novel_setting WHERE project_id = ? ORDER BY setting_key ASC", [target]).then(firstRows),
      queryMysql("SELECT material_key,title,content,meta_json,updated_at FROM novel_material WHERE project_id = ? ORDER BY material_key ASC", [target]).then(firstRows),
      queryMysql("SELECT chapter_no,title,status,content,character_count,meta_json,updated_at FROM novel_chapter WHERE project_id = ? AND deleted_at IS NULL ORDER BY chapter_no ASC, status ASC", [target]).then(firstRows),
    ]);
    const detail = {
      project: parseJson(projectRows[0].project_json, { id: target }),
      state: parseJson(projectRows[0].state_json, {}),
      review: parseJson(projectRows[0].review_json, { pending: [] }),
      settings: {},
      materials: {},
      chapters: [],
    };
    detail.project.id = target;
    for (const row of settingRows) {
      const key = String(row.setting_key || "").trim();
      if (!key) continue;
      detail.settings[key] = {
        ...parseJson(row.meta_json, {}),
        key,
        title: String(row.title || key),
        content: String(row.content || ""),
        updatedAt: Number(row.updated_at || 0),
      };
    }
    for (const row of materialRows) {
      const key = String(row.material_key || "").trim();
      if (!key) continue;
      detail.materials[key] = {
        ...parseJson(row.meta_json, {}),
        key,
        title: String(row.title || key),
        content: String(row.content || ""),
        updatedAt: Number(row.updated_at || 0),
      };
    }
    const chapterByNo = new Map();
    for (const row of chapterRows) {
      const chapterNo = Number(row.chapter_no || 0);
      if (!chapterNo) continue;
      const status = String(row.status || "").trim().toLowerCase();
      const existing = chapterByNo.get(chapterNo);
      if (existing && existing.status === "draft" && status !== "draft") {
        continue;
      }
      chapterByNo.set(chapterNo, {
        ...parseJson(row.meta_json, {}),
        chapterNo,
        title: String(row.title || ""),
        status: status || "approved",
        content: String(row.content || ""),
        characterCount: Number(row.character_count || 0),
        updatedAt: Number(row.updated_at || 0),
      });
    }
    detail.chapters = Array.from(chapterByNo.values()).sort((a, b) => a.chapterNo - b.chapterNo);
    await applyProjectSnapshot({ projectId: target, detail, updatedAt: Number(projectRows[0].updated_at || Date.now()) });
    debug(`mysql_project_pulled projectId=${target} chapters=${detail.chapters.length}`);
    return true;
  }

  async function pushChangedLocalProjects(state) {
    const cloudBaseUrl = normalizeBaseUrl(state.cloudBaseUrl);
    if (!cloudBaseUrl) return 0;
    const ids = await listLocalProjectIds();
    const localProjectFingerprints = state.localProjectFingerprints || {};
    const projectHashes = state.projectHashes || {};
    const changed = [];
    for (const projectId of ids) {
      const fingerprint = await getProjectFileFingerprint(projectId);
      if (localProjectFingerprints[projectId] === fingerprint) {
        continue;
      }
      try {
        const detail = await createFullProjectDetail(projectId);
        const hash = hashText(stableStringify(detail));
        localProjectFingerprints[projectId] = fingerprint;
        if (projectHashes[projectId] !== hash) {
          changed.push({ projectId, detail, updatedAt: Date.now() });
          projectHashes[projectId] = hash;
        }
      } catch (error) {
        debug(`read_changed_local_project_failed projectId=${projectId} error=${error.message || error}`);
      }
    }
    if (!changed.length) {
      state.localProjectFingerprints = localProjectFingerprints;
      state.projectHashes = projectHashes;
      return 0;
    }
    await requestJson(`${cloudBaseUrl}/api/novel-sync/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ source: "ai-web", projects: changed }),
      timeoutMs: 60_000,
      retryCount: 1,
    });
    state.localProjectFingerprints = localProjectFingerprints;
    state.projectHashes = projectHashes;
    return changed.length;
  }

  async function getProjectFileFingerprint(projectId) {
    const projectDir = path.join(novelsDir, projectId);
    let latestMtime = 0;
    let totalSize = 0;
    let fileCount = 0;
    async function visit(dirPath) {
      let entries;
      try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const itemPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await visit(itemPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const stat = await fs.promises.stat(itemPath);
        latestMtime = Math.max(latestMtime, Math.floor(stat.mtimeMs));
        totalSize += stat.size;
        fileCount += 1;
      }
    }
    await visit(projectDir);
    return `${latestMtime}:${totalSize}:${fileCount}`;
  }

  async function pullCloudSnapshot(state) {
    const cloudBaseUrl = normalizeBaseUrl(state.cloudBaseUrl);
    if (!cloudBaseUrl) return 0;
    const data = await requestJson(`${cloudBaseUrl}/api/novel-sync/export?since=${encodeURIComponent(state.lastCloudUpdatedAt || 0)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: 60_000,
      retryCount: 1,
    });
    const projects = Array.isArray(data?.projects) ? data.projects : [];
    const projectHashes = state.projectHashes || {};
    for (const project of projects) {
      await applyProjectSnapshot(project);
      if (project?.projectId && project?.detail && !project.deletedAt) {
        projectHashes[project.projectId] = hashText(stableStringify(project.detail));
      }
    }
    state.projectHashes = projectHashes;
    if (Number(data?.latestUpdatedAt) > Number(state.lastCloudUpdatedAt || 0)) {
      state.lastCloudUpdatedAt = Number(data.latestUpdatedAt);
    }
    return projects.length;
  }

  async function pullCloudEvents(state) {
    const cloudBaseUrl = normalizeBaseUrl(state.cloudBaseUrl);
    if (!cloudBaseUrl) return 0;
    const data = await requestJson(`${cloudBaseUrl}/api/novel-sync/events?limit=100`, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: 30_000,
      retryCount: 1,
    });
    const events = Array.isArray(data?.events) ? data.events : [];
    const done = [];
    const failed = [];
    for (const event of events) {
      try {
        await applySyncEvent(event);
        done.push(event.eventId);
      } catch (error) {
        failed.push({ eventId: event.eventId, error: error.message || String(error) });
      }
    }
    if (done.length) {
      await requestJson(`${cloudBaseUrl}/api/novel-sync/events/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ eventIds: done, status: "done" }),
        timeoutMs: 30_000,
        retryCount: 1,
      });
    }
    for (const item of failed) {
      await requestJson(`${cloudBaseUrl}/api/novel-sync/events/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ eventIds: [item.eventId], status: "error", error: item.error }),
        timeoutMs: 30_000,
        retryCount: 0,
      }).catch(() => {});
    }
    return events.length;
  }

  async function applySyncEvent(event = {}) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    if (event.eventType === "project.delete") {
      await deleteProjectFiles(event.projectId);
      return;
    }
    if (event.eventType === "project.create" || event.eventType === "project.update") {
      if (payload.project || payload.settings || payload.materials || payload.chapters) {
        await applyProjectSnapshot({ projectId: event.projectId, detail: payload });
        return;
      }
      const existing = await readProjectDetailOrEmpty(event.projectId);
      existing.project = { ...(existing.project || {}), ...payload };
      await writeProjectDetail(event.projectId, existing);
      return;
    }
    if (event.eventType === "chapter.delete-after") {
      const chapterNo = Number(payload.chapterNo || 0);
      if (chapterNo > 0 && novelModule && typeof novelModule.deleteChapterAndProgress === "function") {
        await novelModule.deleteChapterAndProgress(event.projectId, chapterNo);
      }
      return;
    }
    if (event.eventType === "setting.update") {
      const key = String(event.path || "").split("/").pop();
      if (novelModule && typeof novelModule.writeSetting === "function") {
        await novelModule.writeSetting(event.projectId, key, String(payload.content || ""));
      }
      return;
    }
    if (event.eventType === "material.update") {
      const key = String(event.path || "").split("/").pop();
      if (novelModule && typeof novelModule.writeMaterial === "function") {
        await novelModule.writeMaterial(event.projectId, key, String(payload.content || ""));
      }
      return;
    }
    if (payload.detail) {
      await applyProjectSnapshot({ projectId: event.projectId, detail: payload.detail });
    }
  }

  async function readProjectDetailOrEmpty(projectId) {
    if (novelModule && typeof novelModule.getProjectDetail === "function") {
      try {
        return await novelModule.getProjectDetail(projectId);
      } catch {}
    }
    return {
      project: { id: projectId },
      state: {},
      review: { pending: [] },
      settings: {},
      materials: {},
      chapters: [],
    };
  }

  async function applyProjectSnapshot(project = {}) {
    const projectId = String(project.projectId || project?.detail?.project?.id || "").trim();
    if (!projectId) return;
    if (Number(project.deletedAt || 0) > 0) {
      await deleteProjectFiles(projectId);
      return;
    }
    const detail = project.detail && typeof project.detail === "object" ? project.detail : null;
    if (!detail) return;
    await writeProjectDetail(projectId, detail);
  }

  async function deleteProjectFiles(projectId) {
    if (!projectId) return;
    await fs.promises.rm(path.join(novelsDir, projectId), { recursive: true, force: true });
  }

  async function writeProjectDetail(projectId, detail = {}) {
    const projectDir = path.join(novelsDir, projectId);
    await fs.promises.mkdir(projectDir, { recursive: true });
    await writeJsonFileAtomic(path.join(projectDir, "project.json"), { ...(detail.project || {}), id: projectId, updatedAt: Date.now() });
    await writeJsonFileAtomic(path.join(projectDir, "state.json"), detail.state || {});
    await writeJsonFileAtomic(path.join(projectDir, "review.json"), detail.review || { pending: [] });

    await writeKeyedMarkdownFiles(path.join(projectDir, "settings"), detail.settings || {});
    await writeKeyedMarkdownFiles(path.join(projectDir, "materials"), detail.materials || {});
    await writeChapters(projectDir, detail.chapters || []);
  }

  async function writeKeyedMarkdownFiles(dirPath, values = {}) {
    await fs.promises.mkdir(dirPath, { recursive: true });
    for (const [key, value] of Object.entries(values || {})) {
      const content = typeof value === "string" ? value : String(value?.content || "");
      await writeTextFileAtomic(path.join(dirPath, `${key}.md`), content.trim() ? `${content.trim()}\n` : "");
    }
  }

  function padChapterNo(value) {
    return String(Number(value) || 0).padStart(4, "0");
  }

  async function writeChapters(projectDir, chapters = []) {
    const chaptersDir = path.join(projectDir, "chapters");
    const draftsDir = path.join(projectDir, "drafts");
    await fs.promises.mkdir(chaptersDir, { recursive: true });
    await fs.promises.mkdir(draftsDir, { recursive: true });
    await clearChapterMarkdownFiles(chaptersDir, ".md");
    await clearChapterMarkdownFiles(draftsDir, ".draft.md");
    for (const chapter of chapters || []) {
      const chapterNo = Number(chapter?.chapterNo || 0);
      const content = String(chapter?.content || chapter?.draft || "").trim();
      if (!chapterNo || !content) continue;
      const status = String(chapter?.status || "").toLowerCase();
      const fileName = status === "draft" ? `${padChapterNo(chapterNo)}.draft.md` : `${padChapterNo(chapterNo)}.md`;
      const targetDir = status === "draft" ? draftsDir : chaptersDir;
      await writeTextFileAtomic(path.join(targetDir, fileName), `${content}\n`);
    }
  }

  async function clearChapterMarkdownFiles(dirPath, suffix) {
    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => fs.promises.unlink(path.join(dirPath, entry.name))));
  }

  async function writeTextFileAtomic(filePath, content) {
    if (typeof writeFileAtomic === "function") {
      await writeFileAtomic(filePath, content);
      return;
    }
    await fs.promises.writeFile(filePath, content, "utf8");
  }

  async function tick() {
    const state = await readState();
    if (state.enabled === false || !normalizeBaseUrl(state.cloudBaseUrl)) {
      return;
    }
    const pulled = await pullCloudSnapshot(state);
    const events = await pullCloudEvents(state);
    const pushed = await pushChangedLocalProjects(state);
    state.lastLocalScanAt = Date.now();
    await saveState(state);
    if (pulled || events || pushed) {
      debug(`tick pulled=${pulled} events=${events} pushed=${pushed}`);
    }
  }

  function start() {
    let running = false;
    const loop = async () => {
      if (running) return;
      running = true;
      try {
        await tick();
      } catch (error) {
        debug(`tick_failed ${error.message || error}`);
      } finally {
        running = false;
      }
    };
    setInterval(() => loop().catch(() => {}), 5000);
    loop().catch(() => {});
    debug("worker_started");
  }

  return {
    start,
    tick,
    getLocalSnapshot,
    applyProjectSnapshot,
    pullProjectFromMysql,
  };
}

module.exports = {
  createNovelSyncModule,
};
