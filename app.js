const SETTINGS_KEY = "local-ai-chat-settings";
const TOOL_ACTIVITY_CACHE_KEY = "local-ai-tool-activity-cache";
const PREVIEW_WIDTH_KEY = "local-ai-preview-width";
const MAX_FILE_SIZE = 200 * 1024;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_FILE_CONTENT = 12000;
const MAX_TOOL_ROUNDS = 6;
const MODEL_HISTORY_LIMIT = 8;
const PERSONA_PRESETS = [
  ["none", "不使用预设", "保留当前手写的人设内容，不自动覆盖。", ""],
  ["precise-assistant", "精准助手", "偏冷静、结构化，适合问答和分析。", "你是一名严谨、可靠、表达清晰的 AI 助手。\n优先保证事实准确，先给结论，再给关键依据。"],
  ["coding-mentor", "编程导师", "适合代码讲解、调试和排错。", "你是一名耐心、专业、擅长教学的编程导师型 AI。\n优先帮助用户完成任务，并主动指出潜在 bug。"],
  ["cyber-companion", "赛博伴侣", "更有氛围感，适合当前界面。", "你是一个带有赛博伙伴气质的智能搭档，语气冷静、敏锐、略带未来感。"],
  ["product-strategist", "产品经理", "适合需求梳理和方案比较。", "你是一名逻辑清晰、重视用户体验和业务目标的产品策略助手。"],
  ["gentle-companion", "温柔伴侣", "语气柔和，适合陪伴式交流。", "你是一名温柔、耐心、情绪稳定的陪伴型 AI。"],
].map(([id, name, description, prompt]) => ({ id, name, description, prompt }));
const TOOLS = ["list_dir", "read_file", "write_file", "delete_file"].map((name) => ({
  type: "function",
  function: { name, description: `Workspace tool: ${name}`, parameters: { type: "object", properties: {} } },
}));

const state = { messages: [], files: [], skills: [], selectedSkill: null, activeSkill: null, sending: false, previewMaximized: false, toolActivities: [] };
const $ = (s) => document.querySelector(s);
const els = {
  chatForm: $("#chat-form"), chatMessages: $("#chat-messages"), userInput: $("#user-input"), sendButton: $("#send-button"),
  statusBar: $("#status-bar"), baseUrl: $("#base-url"), apiPath: $("#api-path"), modelSelect: $("#model-select"),
  assistantName: $("#assistant-name"), userName: $("#user-name"), systemPrompt: $("#system-prompt"), contextLimit: $("#context-limit"),
  metricContextChars: $("#metric-context-chars"), metricEstimatedPrompt: $("#metric-est-prompt"), metricTotal: $("#metric-total"), metricSpeed: $("#metric-speed"),
  metricContextUsage: $("#metric-context-usage"), usageBarFill: $("#usage-bar-fill"), modelSelectionMeta: $("#model-selection-meta"),
  fileInput: $("#file-input"), fileList: $("#file-list"), composerFiles: $("#composer-files"), clearFiles: $("#clear-files"), attachFilesInline: $("#attach-files-inline"),
  clearChat: $("#clear-chat"), testConnection: $("#test-connection"), loadModels: $("#load-models"),
  personaPrompt: $("#persona-prompt"), personaPreset: $("#persona-preset"), personaPresetDescription: $("#persona-preset-description"),
  applyPersonaPreset: $("#apply-persona-preset"), importPersona: $("#import-persona"), exportPersona: $("#export-persona"), clearPersona: $("#clear-persona"), personaFileInput: $("#persona-file-input"),
  loadSkills: $("#load-skills"), applySkill: $("#apply-skill"), skillsList: $("#skills-list"), skillPreview: $("#skill-preview"),
  toolActivityList: $("#tool-activity-list"), toolActivityStatus: $("#tool-activity-status"),
  workspaceBody: $(".workspace-body"), previewPanel: $("#preview-panel"), previewResizer: $("#preview-resizer"), previewFrame: $("#preview-frame"), previewEmpty: $("#preview-empty"),
  togglePreviewSize: $("#toggle-preview-size"), closePreview: $("#close-preview"),
};

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const endpoint = (path, base = (els.baseUrl?.value.trim() || location.origin)) => new URL(path, `${base}/`).toString();
const chatEndpoint = () => endpoint(els.apiPath?.value.trim() || "/api/v1/chat/completions");
const modelsEndpoint = () => endpoint("/api/v1/models");
const selectedModel = () => els.modelSelect?.value?.trim() || "";
const roleName = (r) => r === "user" ? (els.userName?.value.trim() || "文远") : r === "assistant" ? (els.assistantName?.value.trim() || "繁星") : "系统";
const formatBytes = (n) => !n ? "0 B" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const setStatus = (t) => { if (els.statusBar) els.statusBar.textContent = t; };
const spark = (b) => { if (!b) return; b.classList.remove("is-sparking"); void b.offsetWidth; b.classList.add("is-sparking"); setTimeout(() => b.classList.remove("is-sparking"), 400); };

function saved() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } }
function save() {
  const old = saved();
  const history = [selectedModel(), ...(old.modelHistory || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, MODEL_HISTORY_LIMIT);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...old,
    baseUrl: els.baseUrl?.value.trim() || "", apiPath: els.apiPath?.value.trim() || "/api/v1/chat/completions", model: selectedModel(), modelHistory: history,
    assistantName: els.assistantName?.value.trim() || "繁星", userName: els.userName?.value.trim() || "文远", systemPrompt: els.systemPrompt?.value.trim() || "",
    personaPrompt: els.personaPrompt?.value.trim() || "", personaPreset: els.personaPreset?.value || "none", contextLimit: els.contextLimit?.value.trim() || "32768",
  }));
  renderModelMeta(); refreshMetrics();
}
function load() {
  const s = saved();
  if (els.baseUrl) els.baseUrl.value = s.baseUrl || "";
  if (els.apiPath) els.apiPath.value = s.apiPath || "/api/v1/chat/completions";
  if (els.assistantName) els.assistantName.value = s.assistantName || "繁星";
  if (els.userName) els.userName.value = s.userName || "文远";
  if (els.systemPrompt) els.systemPrompt.value = s.systemPrompt || "";
  if (els.personaPrompt) els.personaPrompt.value = s.personaPrompt || "";
  if (els.contextLimit) els.contextLimit.value = s.contextLimit || "32768";
  if (els.personaPreset) els.personaPreset.value = s.personaPreset || "none";
  if (els.modelSelect && s.model) { const o = document.createElement("option"); o.value = s.model; o.textContent = s.model; els.modelSelect.replaceChildren(o); els.modelSelect.value = s.model; }
}
function renderModelMeta() {
  if (!els.modelSelectionMeta) return;
  els.modelSelectionMeta.textContent = selectedModel() ? `当前模型：${selectedModel()}` : "当前未选择模型";
}
function refreshMetrics(usage = null, elapsedMs = null) {
  const sys = [els.systemPrompt?.value || "", els.personaPrompt?.value || "", state.activeSkill ? JSON.stringify(state.activeSkill).slice(0, 3000) : ""].join("\n").length;
  const his = state.messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n").length;
  const files = state.files.reduce((n, f) => n + (f.isImage ? 120 : f.content.length), 0);
  const draft = els.userInput?.value.length || 0;
  const chars = sys + his + files + draft;
  const est = Math.ceil(chars / 4);
  const limit = Number(els.contextLimit?.value || 32768) || 32768;
  if (els.metricContextChars) els.metricContextChars.textContent = String(chars);
  if (els.metricEstimatedPrompt) els.metricEstimatedPrompt.textContent = String(est);
  if (els.metricTotal) els.metricTotal.textContent = usage?.total_tokens != null ? String(usage.total_tokens) : els.metricTotal.textContent || "-";
  if (els.metricSpeed) els.metricSpeed.textContent = usage?.completion_tokens && elapsedMs ? `${(usage.completion_tokens / Math.max(elapsedMs / 1000, 0.1)).toFixed(1)} tok/s` : els.metricSpeed.textContent || "-";
  if (els.metricContextUsage) els.metricContextUsage.textContent = `${est} / ${limit} · ${Math.min(est / limit * 100, 100).toFixed(1)}%`;
  if (els.usageBarFill) els.usageBarFill.style.width = `${Math.min(est / limit * 100, 100)}%`;
}

function rich(text) {
  const html = String(text || "").replace(/```([a-z0-9_-]*)\n?([\s\S]*?)```/gi, (_, lang, code) => `@@CODE:${btoa(unescape(encodeURIComponent(`${lang}\n${code}`)))}@@`);
  return html.split(/@@CODE:[A-Za-z0-9+/=]+@@/g).map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`).join("")
    .replace(/@@CODE:([A-Za-z0-9+/=]+)@@/g, (_, data) => {
      const [lang, ...rest] = decodeURIComponent(escape(atob(data))).split("\n");
      return `<pre><code class="language-${esc(lang)}">${esc(rest.join("\n").trim())}</code></pre>`;
    });
}
function htmlPreview(text) { const m = String(text || "").match(/```html\s*([\s\S]*?)```/i); return m ? m[1].trim() : ""; }
function appendMessage(role, content, cls = role, images = []) {
  const card = document.createElement("article"); card.className = `message ${cls}`;
  const r = document.createElement("div"); r.className = "message-role"; r.textContent = roleName(role);
  const c = document.createElement("div"); c.className = "message-content"; c.innerHTML = rich(content);
  card.append(r, c);
  if (images.length) {
    const wrap = document.createElement("div"); wrap.className = "file-list compact";
    images.forEach((img, i) => { const item = document.createElement("div"); item.className = "file-item"; const el = document.createElement("img"); el.className = "file-thumb"; el.src = img.dataUrl; el.alt = img.name; el.addEventListener("dblclick", () => openLightbox(images, i)); item.append(el); wrap.append(item); });
    card.append(wrap);
  }
  const html = htmlPreview(content);
  if (html) { const row = document.createElement("div"); row.className = "button-row left"; const b = document.createElement("button"); b.type = "button"; b.className = "ghost-button"; b.textContent = "预览 HTML"; b.onclick = () => openPreview(html); row.append(b); card.append(row); }
  els.chatMessages?.append(card); requestAnimationFrame(() => els.chatMessages?.scrollTo({ top: els.chatMessages.scrollHeight, behavior: "smooth" }));
}

function renderToolActivity() {
  if (!els.toolActivityList || !els.toolActivityStatus) return;
  if (!state.toolActivities.length) { els.toolActivityStatus.textContent = "空闲"; els.toolActivityList.innerHTML = '<div class="file-empty">暂无工具记录</div>'; return; }
  els.toolActivityStatus.textContent = state.toolActivities.some((x) => x.status === "running") ? "执行中" : "最近活动";
  els.toolActivityList.replaceChildren(...state.toolActivities.map((x) => {
    const el = document.createElement("div"); el.className = `tool-activity-item ${x.status}`;
    el.innerHTML = `<div class="tool-activity-head"><strong class="tool-activity-title">${esc(x.name)}</strong></div><div class="tool-activity-text">${esc(x.text)}</div>`; return el;
  }));
}
function toolActivity(id, status, name, text) {
  const i = state.toolActivities.findIndex((x) => x.id === id); const next = { id, status, name, text };
  if (i >= 0) state.toolActivities.splice(i, 1, next); else state.toolActivities.unshift(next);
  state.toolActivities = state.toolActivities.slice(0, 12);
  localStorage.setItem(TOOL_ACTIVITY_CACHE_KEY, JSON.stringify(state.toolActivities)); renderToolActivity();
}
function loadToolActivity() { try { state.toolActivities = JSON.parse(localStorage.getItem(TOOL_ACTIVITY_CACHE_KEY) || "[]"); } catch { state.toolActivities = []; } renderToolActivity(); }

function setPreview(show) { els.workspaceBody?.classList.toggle("preview-active", show); els.previewPanel?.classList.toggle("is-hidden", !show); els.previewResizer?.classList.toggle("is-hidden", !show); }
function setPreviewMax(v) { state.previewMaximized = v; document.body.classList.toggle("preview-maximized", v); els.previewPanel?.classList.toggle("is-maximized", v); if (els.togglePreviewSize) els.togglePreviewSize.textContent = v ? "还原" : "最大化"; }
function openPreview(html) { setPreview(true); setPreviewMax(false); if (els.previewFrame) { els.previewFrame.classList.remove("is-hidden"); els.previewFrame.srcdoc = html; } els.previewEmpty?.classList.add("is-hidden"); }
function closePreview() { setPreview(false); setPreviewMax(false); if (els.previewFrame) els.previewFrame.srcdoc = ""; els.previewFrame?.classList.add("is-hidden"); els.previewEmpty?.classList.remove("is-hidden"); }
function initPreviewResizer() {
  const width = Number(localStorage.getItem(PREVIEW_WIDTH_KEY)); if (Number.isFinite(width)) document.documentElement.style.setProperty("--preview-width", `${width}px`);
  let drag = false; const move = (e) => { if (!drag || !els.workspaceBody) return; const r = els.workspaceBody.getBoundingClientRect(); document.documentElement.style.setProperty("--preview-width", `${Math.min(720, Math.max(320, r.right - e.clientX))}px`); };
  const up = () => { if (!drag) return; drag = false; document.body.style.userSelect = ""; localStorage.setItem(PREVIEW_WIDTH_KEY, getComputedStyle(document.documentElement).getPropertyValue("--preview-width").replace("px", "").trim()); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  els.previewResizer?.addEventListener("pointerdown", () => { drag = true; document.body.style.userSelect = "none"; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); });
}

function renderPersonaPresets() {
  if (!els.personaPreset) return;
  els.personaPreset.replaceChildren(...PERSONA_PRESETS.map((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; return o; }));
}
function presetById(id) { return PERSONA_PRESETS.find((p) => p.id === id) || PERSONA_PRESETS[0]; }
function renderPersonaPresetDescription() { if (els.personaPresetDescription) els.personaPresetDescription.textContent = presetById(els.personaPreset?.value || "none").description; }

async function readText(file) { return await file.text(); }
async function readImage(file) { return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || "")); r.onerror = () => reject(new Error(`读取图片失败：${file.name}`)); r.readAsDataURL(file); }); }
async function consumeFiles(files) {
  for (const file of Array.from(files || [])) {
    const isImage = file.type.startsWith("image/");
    const limit = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
    if (file.size > limit) { appendMessage("system", `文件过大，已跳过：${file.name}`, "error"); continue; }
    state.files.push(isImage ? { id: nowId(), name: file.name || `图片-${Date.now()}.png`, type: file.type || "image/png", size: file.size, isImage: true, dataUrl: await readImage(file) } : { id: nowId(), name: file.name, type: file.type || "text/plain", size: file.size, isImage: false, content: (await readText(file)).slice(0, MAX_FILE_CONTENT), truncated: file.size > MAX_FILE_CONTENT });
  }
  renderFiles(); refreshMetrics(); setStatus(`已附加 ${state.files.length} 个附件`);
}
function renderFiles() {
  if (!els.fileList || !els.composerFiles) return;
  if (!state.files.length) { els.fileList.replaceChildren(); els.composerFiles.classList.add("is-hidden"); return; }
  els.composerFiles.classList.remove("is-hidden");
  els.fileList.replaceChildren(...state.files.map((file, i) => {
    const item = document.createElement("div"); item.className = "file-item";
    if (file.isImage) { const img = document.createElement("img"); img.className = "file-thumb"; img.src = file.dataUrl; img.alt = file.name; img.ondblclick = () => openLightbox(state.files.filter((f) => f.isImage), state.files.filter((f) => f.isImage).findIndex((f) => f.id === file.id)); item.append(img); }
    const name = document.createElement("strong"); name.textContent = file.name;
    const meta = document.createElement("div"); meta.className = "tool-activity-text"; meta.textContent = `${formatBytes(file.size)} · ${file.isImage ? "图片附件" : `已注入 ${file.content.length} 字符`}`;
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "ghost-button"; btn.textContent = "移除"; btn.onclick = () => { state.files.splice(i, 1); renderFiles(); refreshMetrics(); };
    item.append(name, meta, btn); return item;
  }));
}
function clearFiles() { state.files = []; renderFiles(); refreshMetrics(); setStatus("附件已清空"); }

async function j(url, options) {
  const r = await fetch(url, options); let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || data.details || `请求失败：${r.status}`);
  return data;
}
function normalizeContent(content) { return typeof content === "string" ? content : Array.isArray(content) ? content.map((x) => x?.text || "").join("\n") : ""; }
function systemMessages() {
  const list = [];
  if (els.systemPrompt?.value.trim()) list.push({ role: "system", content: els.systemPrompt.value.trim() });
  if (els.personaPrompt?.value.trim()) list.push({ role: "system", content: `以下是当前启用的 AI 人设，请在后续回答中保持一致：\n\n${els.personaPrompt.value.trim()}` });
  if (state.activeSkill) {
    const files = (state.activeSkill.files || []).map((f) => `文件：${f.path}\n${f.content}`).join("\n\n");
    list.push({ role: "system", content: `你当前启用了技能：${state.activeSkill.name}\n技能来源：${state.activeSkill.source}\n请优先遵循 SKILL.md 的规则。\n\n${files}` });
  }
  const texts = state.files.filter((f) => !f.isImage).map((f, i) => `文件 ${i + 1}：${f.name}\n类型：${f.type}\n内容：\n${f.content}${f.truncated ? "\n[注意] 已截断" : ""}`).join("\n\n---\n\n");
  if (texts) list.push({ role: "system", content: `以下是用户附加的文件内容，请结合这些内容完成分析、回答或生成结果：\n\n${texts}` });
  return list;
}
function userPayload(text) {
  const images = state.files.filter((f) => f.isImage);
  return images.length ? [{ type: "text", text: text || "请结合已附加的图片继续回答。" }, ...images.map((f) => ({ type: "image_url", image_url: { url: f.dataUrl } }))] : (text || "请结合附件继续回答。");
}
async function executeTool(toolCall) {
  const id = toolCall?.id || nowId(); const name = toolCall?.function?.name || "unknown"; let args = {};
  try { args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {}; } catch { throw new Error("工具参数不是合法 JSON"); }
  if (name === "delete_file" && args.path && !window.confirm(`AI 请求删除文件：${args.path}\n\n是否允许继续？`)) return { role: "tool", tool_call_id: id, content: JSON.stringify({ cancelled: true }) };
  toolActivity(id, "running", name, "正在执行...");
  const data = await j("/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: args }) });
  toolActivity(id, "done", name, "执行完成");
  return { role: "tool", tool_call_id: id, content: JSON.stringify(data.result, null, 2) };
}
async function askModel(userText) {
  if (!selectedModel()) throw new Error("请先选择模型。");
  let messages = [...systemMessages(), ...state.messages, { role: "user", content: userPayload(userText) }], final = "";
  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const t0 = performance.now();
    const data = await j(chatEndpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selectedModel(), messages, temperature: 0.7, tools: TOOLS, tool_choice: "auto", stream: false }) });
    refreshMetrics(data.usage || null, performance.now() - t0);
    const msg = data.choices?.[0]?.message; if (!msg) throw new Error("接口返回成功，但没有找到 assistant message。");
    const content = normalizeContent(msg.content); if (content) final = content;
    messages.push({ role: "assistant", content: msg.content || content, tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) break;
    for (const tc of msg.tool_calls) messages.push(await executeTool(tc));
  }
  if (!final) throw new Error("模型进行了工具调用，但没有返回最终文本结果。");
  state.messages.push({ role: "user", content: userText || "请结合附件继续回答。" }, { role: "assistant", content: final }); save(); refreshMetrics(); return final;
}

async function testConnection() {
  spark(els.testConnection); setStatus("正在测试连接...");
  try { const data = await j(modelsEndpoint()); const models = (data.data || []).map((x) => x.id).filter(Boolean); appendMessage("system", models.length ? `连接成功，可用模型：${models.join("、")}` : "连接成功，模型服务在线。", "success"); setStatus("连接测试成功"); } catch (e) { appendMessage("system", `连接测试失败：${e.message}`, "error"); setStatus("连接测试失败"); }
}
function renderModels(models) {
  if (!els.modelSelect) return;
  const current = selectedModel(); const history = saved().modelHistory || []; const names = [...history, ...models].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  els.modelSelect.replaceChildren(...(names.length ? names : [""]).map((name) => { const o = document.createElement("option"); o.value = name; o.textContent = name || "未读取到模型"; return o; }));
  els.modelSelect.value = names.includes(current) ? current : (names[0] || "");
}
async function loadModels() {
  spark(els.loadModels); setStatus("正在读取模型列表...");
  try { const data = await j(modelsEndpoint()); const models = (data.data || []).map((x) => x.id).filter(Boolean); renderModels(models); save(); appendMessage("system", models.length ? `已读取 ${models.length} 个模型。` : "未读取到模型。", models.length ? "success" : "error"); setStatus(models.length ? "模型列表已更新" : "未读取到模型"); } catch (e) { appendMessage("system", `读取模型失败：${e.message}`, "error"); setStatus("读取模型失败"); }
}

function renderSkills() {
  if (!els.skillsList) return;
  if (!state.skills.length) { els.skillsList.innerHTML = '<div class="file-empty">当前没有读取到技能列表。</div>'; return; }
  els.skillsList.replaceChildren(...state.skills.map((skill) => {
    const item = document.createElement("div"); item.className = "file-item";
    const t = document.createElement("strong"); t.textContent = skill.name;
    const m = document.createElement("div"); m.className = "tool-activity-text"; m.textContent = `${skill.source} · ${skill.summary}`;
    const b = document.createElement("button"); b.type = "button"; b.className = "ghost-button"; b.textContent = skill.source === "workspace" ? "读取" : "安装到当前目录";
    b.onclick = async () => { spark(b); skill.source === "workspace" ? await readSkill(skill) : await installSkill(skill); };
    item.append(t, m, b); return item;
  }));
}
async function loadSkills() {
  setStatus("正在读取技能...");
  try {
    let data = await j("/skills/list?source=workspace"); state.skills = data.skills || [];
    if (!state.skills.length) { data = await j("/skills/list?source=codex"); state.skills = data.skills || []; }
    renderSkills(); setStatus(state.skills.length ? `已读取 ${state.skills.length} 个技能` : "没有找到可用技能");
  } catch (e) { appendMessage("system", `读取技能失败：${e.message}`, "error"); setStatus("读取技能失败"); }
}
async function readSkill(skill) {
  setStatus(`正在读取技能：${skill.name}`);
  const data = await j(`/skills/read?source=${encodeURIComponent(skill.source)}&name=${encodeURIComponent(skill.name)}`);
  state.selectedSkill = data.skill; if (els.skillPreview) els.skillPreview.textContent = [`技能：${data.skill.name}`, `来源：${data.skill.source}`, `已载入文件：${(data.skill.files || []).length}`, "", ...(data.skill.files || []).map((f) => `# ${f.path}\n\n${f.content}`)].join("\n");
  setStatus(`已读取技能：${skill.name}`);
}
async function installSkill(skill) {
  setStatus(`正在安装技能：${skill.name}`);
  const data = await j("/skills/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: skill.source, name: skill.name }) });
  appendMessage("system", `已安装技能：${skill.name}\n位置：${data.result.installedTo}`, "success"); await loadSkills();
}
function applySelectedSkill() { if (!state.selectedSkill) return setStatus("请先读取一个技能"); state.activeSkill = state.selectedSkill; appendMessage("system", `已启用技能：${state.selectedSkill.name}\n后续对话会自动附带该技能内容。`, "success"); refreshMetrics(); setStatus(`已启用技能：${state.selectedSkill.name}`); }

function resetChat() { state.messages = []; els.chatMessages.replaceChildren(); appendMessage("assistant", "你好，我已经准备好连接本地 AI。你可以先测试连接、读取模型、上传文件，或者启用某个技能后再开始提问。"); refreshMetrics(); setStatus("会话已清空"); }

const lightboxState = { images: [], index: 0 };
function drawLightbox() { const img = $("#lightbox-image"), cap = $("#lightbox-caption"), box = $("#image-lightbox"), cur = lightboxState.images[lightboxState.index]; if (!img || !cap || !box || !cur) return; img.src = cur.dataUrl; cap.textContent = cur.name || "图片预览"; box.classList.remove("is-hidden"); }
function openLightbox(images, index = 0) { if (!images?.length) return; lightboxState.images = images; lightboxState.index = index; drawLightbox(); }
function closeLightbox() { $("#image-lightbox")?.classList.add("is-hidden"); lightboxState.images = []; lightboxState.index = 0; }
function navLightbox(d) { if (!lightboxState.images.length) return; lightboxState.index = (lightboxState.index + d + lightboxState.images.length) % lightboxState.images.length; drawLightbox(); }

async function submit(ev) {
  ev.preventDefault(); if (state.sending) return;
  const text = els.userInput?.value.trim() || ""; if (!text && !state.files.length) return setStatus("请输入要发送的内容");
  appendMessage("user", text || "请结合附件继续回答。", "user", state.files.filter((f) => f.isImage)); if (els.userInput) els.userInput.value = ""; refreshMetrics();
  state.sending = true; if (els.sendButton) { els.sendButton.disabled = true; els.sendButton.textContent = "发送中..."; } setStatus("正在处理请求...");
  try { const reply = await askModel(text); appendMessage("assistant", reply); clearFiles(); setStatus("回复完成"); }
  catch (e) { appendMessage("system", `${e.message}\n\n请确认你是通过 node server.js 启动页面，并且本地模型服务仍在 http://127.0.0.1:1234 运行。`, "error"); setStatus("请求失败"); }
  finally { state.sending = false; if (els.sendButton) { els.sendButton.disabled = false; els.sendButton.textContent = "发送消息"; } }
}

function bind() {
  els.chatForm?.addEventListener("submit", submit);
  els.userInput?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); els.chatForm?.requestSubmit(); } });
  els.userInput?.addEventListener("input", () => refreshMetrics());
  [els.baseUrl, els.apiPath, els.modelSelect, els.assistantName, els.userName, els.systemPrompt, els.contextLimit].forEach((el) => el?.addEventListener("change", () => { save(); setStatus(`已保存配置，当前接口：${chatEndpoint()}`); }));
  els.personaPrompt?.addEventListener("input", () => { save(); refreshMetrics(); });
  els.personaPreset?.addEventListener("change", () => { renderPersonaPresetDescription(); save(); });
  els.applyPersonaPreset?.addEventListener("click", () => { spark(els.applyPersonaPreset); const p = presetById(els.personaPreset?.value || "none"); if (p.prompt && els.personaPrompt) els.personaPrompt.value = p.prompt; renderPersonaPresetDescription(); save(); setStatus(p.prompt ? `已应用人设模板：${p.name}` : "当前预设不会覆盖现有人设"); });
  els.importPersona?.addEventListener("click", () => { spark(els.importPersona); els.personaFileInput?.click(); });
  els.personaFileInput?.addEventListener("change", async (e) => { try { const [file] = Array.from(e.target.files || []); if (file && els.personaPrompt) els.personaPrompt.value = await file.text(); save(); setStatus(`已导入人设文件：${file?.name || ""}`); } catch (err) { appendMessage("system", `导入人设失败：${err.message}`, "error"); } finally { e.target.value = ""; } });
  els.exportPersona?.addEventListener("click", () => { spark(els.exportPersona); const blob = new Blob([els.personaPrompt?.value.trim() || "# AI 人设\n\n"], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ai-persona.md"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); setStatus("已导出 AI 人设文件"); });
  els.clearPersona?.addEventListener("click", () => { spark(els.clearPersona); if (els.personaPrompt) els.personaPrompt.value = ""; if (els.personaPreset) els.personaPreset.value = "none"; renderPersonaPresetDescription(); save(); setStatus("已清空 AI 人设"); });
  els.attachFilesInline?.addEventListener("click", () => { spark(els.attachFilesInline); els.fileInput?.click(); });
  els.fileInput?.addEventListener("change", async (e) => { await consumeFiles(e.target.files); e.target.value = ""; });
  els.clearFiles?.addEventListener("click", () => { spark(els.clearFiles); clearFiles(); });
  els.clearChat?.addEventListener("click", () => { spark(els.clearChat); resetChat(); });
  els.testConnection?.addEventListener("click", testConnection); els.loadModels?.addEventListener("click", loadModels);
  els.loadSkills?.addEventListener("click", () => { spark(els.loadSkills); loadSkills(); }); els.applySkill?.addEventListener("click", () => { spark(els.applySkill); applySelectedSkill(); });
  els.closePreview?.addEventListener("click", () => { spark(els.closePreview); closePreview(); }); els.togglePreviewSize?.addEventListener("click", () => { spark(els.togglePreviewSize); setPreviewMax(!state.previewMaximized); });
  document.addEventListener("paste", async (e) => { if (e.clipboardData?.files?.length) await consumeFiles(e.clipboardData.files); });
  ["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  document.addEventListener("drop", async (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) await consumeFiles(e.dataTransfer.files); });
  $("#lightbox-close")?.addEventListener("click", closeLightbox); $("#lightbox-prev")?.addEventListener("click", () => navLightbox(-1)); $("#lightbox-next")?.addEventListener("click", () => navLightbox(1)); $("#image-lightbox")?.addEventListener("click", (e) => { if (e.target?.id === "image-lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (!$("#image-lightbox")?.classList.contains("is-hidden")) { if (e.key === "Escape") closeLightbox(); if (e.key === "ArrowLeft") navLightbox(-1); if (e.key === "ArrowRight") navLightbox(1); } else if (e.key === "Escape" && state.previewMaximized) setPreviewMax(false); });
}

async function init() {
  renderPersonaPresets(); load(); renderPersonaPresetDescription(); renderModelMeta(); loadToolActivity(); initPreviewResizer(); closePreview(); bind(); renderFiles(); resetChat(); refreshMetrics(); setStatus(`准备就绪，当前接口：${chatEndpoint()}`);
  try { const data = await j(modelsEndpoint()); const models = (data.data || []).map((x) => x.id).filter(Boolean); if (models.length) { renderModels(models); save(); setStatus("连接正常，模型已加载"); } } catch {}
}
init();
