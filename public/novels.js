const $ = (s) => document.querySelector(s);
const els = {
  list: $("#project-list"),
  title: $("#project-title"),
  meta: $("#project-meta"),
  progress: $("#project-progress"),
  settingSelect: $("#setting-select"),
  settingEditor: $("#setting-editor"),
  chapterList: $("#chapter-list"),
  chapterViewer: $("#chapter-viewer"),
  reviewFeedback: $("#review-feedback"),
  dialog: $("#project-dialog"),
  createProject: $("#create-project"),
  confirmCreate: $("#confirm-create"),
  openChat: $("#open-chat"),
  saveProject: $("#save-project"),
  deleteProject: $("#delete-project"),
  saveSetting: $("#save-setting"),
  generateSettings: $("#generate-settings"),
  batchGenerate: $("#batch-generate"),
  generateChapter: $("#generate-chapter"),
  approveChapter: $("#approve-chapter"),
  rewriteChapter: $("#rewrite-chapter"),
  fields: {
    name: $("#project-name"), genre: $("#project-genre"), theme: $("#project-theme"), targetChapters: $("#project-target"), stylePreference: $("#project-style"), audience: $("#project-audience"), protagonist: $("#project-protagonist"), premise: $("#project-premise"), keywords: $("#project-keywords"), notes: $("#project-notes"), qqReviewEnabled: $("#project-qq-enabled"), qqTargetType: $("#project-qq-type"), qqTargetId: $("#project-qq-id")
  },
  newFields: {
    name: $("#new-name"), genre: $("#new-genre"), theme: $("#new-theme"), premise: $("#new-premise"), protagonist: $("#new-protagonist"), stylePreference: $("#new-style"), audience: $("#new-audience"), targetChapters: $("#new-target"), keywords: $("#new-keywords"), qqTargetId: $("#new-qq-id")
  }
};

const state = { projects: [], activeId: "", settings: {}, activeSetting: "base-info", detail: null };

async function j(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function projectPayloadFromFields(source) {
  return {
    name: source.name.value.trim(),
    genre: source.genre.value.trim(),
    theme: source.theme.value.trim(),
    premise: source.premise.value.trim(),
    protagonist: source.protagonist.value.trim(),
    stylePreference: source.stylePreference.value.trim(),
    audience: source.audience.value.trim(),
    targetChapters: Number(source.targetChapters.value || 0),
    keywords: source.keywords.value.trim(),
    notes: source.notes ? source.notes.value.trim() : "",
    qqReviewEnabled: source.qqReviewEnabled ? source.qqReviewEnabled.value === "true" : Boolean(source.qqTargetId.value.trim()),
    qqTargetType: source.qqTargetType ? source.qqTargetType.value : "private",
    qqTargetId: source.qqTargetId.value.trim(),
  };
}

function renderProjectList() {
  els.list.innerHTML = "";
  if (!state.projects.length) {
    els.list.innerHTML = '<div class="stack-item">还没有小说项目。</div>';
    return;
  }
  state.projects.forEach((project) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `project-item ${project.id === state.activeId ? "active" : ""}`;
    item.innerHTML = `<strong>${project.name}</strong><div class="muted">${project.genre || "未设置题材"}</div><div class="muted">已通过 ${project.lastApprovedChapter || 0} 章 / 待审 ${project.pendingDraftChapter || 0}</div>`;
    item.onclick = () => loadProject(project.id);
    els.list.append(item);
  });
}

function renderProjectDetail(detail) {
  state.detail = detail;
  const { project, state: projectState, review, chapters, settings } = detail;
  state.settings = settings;
  els.title.textContent = project.name;
  els.meta.textContent = `${project.genre || "未设置题材"} · 已通过 ${projectState.lastApprovedChapter || 0} 章 · 待审 ${projectState.pendingDraftChapter || 0}`;
  Object.entries(els.fields).forEach(([key, input]) => {
    if (!input) return;
    if (key === "keywords") input.value = Array.isArray(project[key]) ? project[key].join(", ") : project[key] || "";
    else if (key === "qqReviewEnabled") input.value = project.qqReviewEnabled ? "true" : "false";
    else input.value = project[key] ?? "";
  });

  els.progress.innerHTML = "";
  [
    `阶段：${projectState.phase || "planning"}`,
    `当前章：${projectState.currentChapter || 0}`,
    `最近生成：${projectState.lastGeneratedChapter || 0}`,
    `最后通过：${projectState.lastApprovedChapter || 0}`,
    `待审：${projectState.pendingDraftChapter || 0}`,
    `审阅队列：${(review.pending || []).length}`,
    `连续写作：${projectState.autoWriteEnabled ? `已启用（最近批量 ${projectState.autoWriteLastCount || 0} 章）` : "未启用"}`,
  ].forEach((text) => {
    const div = document.createElement("div");
    div.className = "stack-item";
    div.textContent = text;
    els.progress.append(div);
  });

  els.settingSelect.innerHTML = Object.values(settings).map((item) => `<option value="${item.key}">${item.title}</option>`).join("");
  els.settingSelect.value = state.activeSetting;
  loadSetting(state.activeSetting);

  els.chapterList.innerHTML = "";
  (chapters || []).forEach((chapter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chapter-item";
    button.innerHTML = `<strong>第 ${chapter.chapterNo} 章</strong><div class="muted">${chapter.status} · ${chapter.title}</div>`;
    button.onclick = () => loadChapter(chapter.chapterNo);
    els.chapterList.append(button);
  });
  if (!chapters.length) {
    els.chapterList.innerHTML = '<div class="stack-item">暂无章节。</div>';
    els.chapterViewer.value = "";
  }
}

async function refreshProjects(preferredId = state.activeId) {
  const data = await j("/novels/projects");
  state.projects = data.projects || [];
  renderProjectList();
  const targetId = preferredId || state.projects[0]?.id;
  if (targetId) await loadProject(targetId);
}

async function loadProject(projectId) {
  state.activeId = projectId;
  renderProjectList();
  const detail = await j(`/novels/projects/${encodeURIComponent(projectId)}`);
  renderProjectDetail(detail);
}

async function loadSetting(key) {
  if (!state.activeId) return;
  state.activeSetting = key;
  const data = await j(`/novels/projects/${encodeURIComponent(state.activeId)}/settings/${encodeURIComponent(key)}`);
  els.settingEditor.value = data.content || "";
}

async function loadChapter(chapterNo) {
  if (!state.activeId) return;
  const data = await j(`/novels/projects/${encodeURIComponent(state.activeId)}/chapters/${chapterNo}`);
  els.chapterViewer.value = data.content || "";
}

async function createProject() {
  const payload = projectPayloadFromFields(els.newFields);
  if (!payload.name) throw new Error("请填写项目名称");
  const data = await j("/novels/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  els.dialog.close();
  await refreshProjects(data.project.id);
}

async function saveProject() {
  if (!state.activeId) return;
  await j(`/novels/projects/${encodeURIComponent(state.activeId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(projectPayloadFromFields(els.fields)) });
  await refreshProjects(state.activeId);
}

async function deleteProject() {
  if (!state.activeId || !confirm("确认删除当前小说项目吗？")) return;
  await j(`/novels/projects/${encodeURIComponent(state.activeId)}`, { method: "DELETE" });
  state.activeId = "";
  await refreshProjects("");
}

async function saveSetting() {
  if (!state.activeId) return;
  await j(`/novels/projects/${encodeURIComponent(state.activeId)}/settings/${encodeURIComponent(state.activeSetting)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: els.settingEditor.value }) });
  await loadProject(state.activeId);
}

async function generateSettings() {
  if (!state.activeId) return;
  await j(`/novels/projects/${encodeURIComponent(state.activeId)}/generate-settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ overwrite: true }) });
  await loadProject(state.activeId);
}

async function generateChapter() {
  if (!state.activeId) return;
  const data = await j(`/novels/projects/${encodeURIComponent(state.activeId)}/chapters/generate-next`, { method: "POST" });
  await loadProject(state.activeId);
  els.chapterViewer.value = data.draft || "";
}

async function batchGenerate() {
  if (!state.activeId) return;
  const rawCount = window.prompt("连续写作多少章？建议 1-5 章。", "3");
  if (rawCount == null) return;
  const count = Number(rawCount);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("请输入有效的章节数量");
  }
  const autoApprove = window.confirm("是否自动通过每章并继续写下一章？\n选择“确定”会直接把生成的章节转正；选择“取消”则生成一章草稿后等待审阅。");
  const data = await j(`/novels/projects/${encodeURIComponent(state.activeId)}/chapters/batch-generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count, autoApprove }),
  });
  await loadProject(state.activeId);
  if (data.generated?.length) {
    const last = data.generated[data.generated.length - 1];
    await loadChapter(last.chapterNo);
  }
  window.alert(`已处理 ${data.generated?.length || 0} 章。${data.haltedReason ? `\n停止原因：${data.haltedReason}` : ""}`);
}

async function approveChapter() {
  if (!state.activeId || !state.detail?.state?.pendingDraftChapter) return;
  await j(`/novels/projects/${encodeURIComponent(state.activeId)}/chapters/${state.detail.state.pendingDraftChapter}/approve`, { method: "POST" });
  await loadProject(state.activeId);
}

async function rewriteChapter() {
  if (!state.activeId || !state.detail?.state?.pendingDraftChapter) return;
  await j(`/novels/projects/${encodeURIComponent(state.activeId)}/chapters/${state.detail.state.pendingDraftChapter}/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback: els.reviewFeedback.value.trim() }) });
  await loadProject(state.activeId);
}

els.createProject.onclick = () => els.dialog.showModal();
els.confirmCreate.onclick = async (event) => { event.preventDefault(); await createProject().catch((error) => alert(error.message)); };
els.openChat.onclick = () => { window.location.href = "/"; };
els.saveProject.onclick = () => saveProject().catch((error) => alert(error.message));
els.deleteProject.onclick = () => deleteProject().catch((error) => alert(error.message));
els.saveSetting.onclick = () => saveSetting().catch((error) => alert(error.message));
els.settingSelect.onchange = () => loadSetting(els.settingSelect.value).catch((error) => alert(error.message));
els.generateSettings.onclick = () => generateSettings().catch((error) => alert(error.message));
els.batchGenerate.onclick = () => batchGenerate().catch((error) => alert(error.message));
els.generateChapter.onclick = () => generateChapter().catch((error) => alert(error.message));
els.approveChapter.onclick = () => approveChapter().catch((error) => alert(error.message));
els.rewriteChapter.onclick = () => rewriteChapter().catch((error) => alert(error.message));

refreshProjects().catch((error) => {
  els.meta.textContent = error.message;
});
