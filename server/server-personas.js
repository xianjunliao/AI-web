const fs = require("fs");
const path = require("path");

function sanitizePersonaFileName(name = "") {
  const normalized = String(name || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `persona-${Date.now()}`;
}

async function collectPersonaFiles(currentDir, rootDir, personas) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectPersonaFiles(fullPath, rootDir, personas);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    const content = await fs.promises.readFile(fullPath, "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    const description =
      lines.find((line) => line && !line.startsWith("#")) ||
      `${relativePath} · Workspace persona file`;
    personas.push({
      id: `workspace:${relativePath}`,
      name: path.basename(entry.name, ".md"),
      path: relativePath,
      description,
      prompt: content,
      source: "workspace",
    });
  }
}

function createPersonaHandlers({ personaPresetsDir, sendJson, readRequestBody }) {
  function resolvePersonaPresetPath(relativePath = "") {
    const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const rootPath = path.resolve(personaPresetsDir);
    const targetPath = path.resolve(rootPath, normalized);
    const relativeTarget = path.relative(rootPath, targetPath);

    if (!normalized || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      const error = new Error("Invalid persona preset path");
      error.statusCode = 400;
      throw error;
    }

    return targetPath;
  }

  async function listPersonaPresets() {
    try {
      const stat = await fs.promises.stat(personaPresetsDir);
      if (!stat.isDirectory()) return [];
    } catch {
      return [];
    }
    const personas = [];
    await collectPersonaFiles(personaPresetsDir, personaPresetsDir, personas);
    personas.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    return personas;
  }

  async function handlePersonaPresetsListRequest(res) {
    try {
      const presets = await listPersonaPresets();
      sendJson(res, 200, { ok: true, presets });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to list persona presets",
      });
    }
  }

  async function savePersonaPreset(payload = {}) {
    const name = String(payload.name || "").trim();
    const prompt = String(payload.prompt || "").trim();

    if (!name) {
      const error = new Error("Missing persona name");
      error.statusCode = 400;
      throw error;
    }
    if (!prompt) {
      const error = new Error("Missing persona prompt");
      error.statusCode = 400;
      throw error;
    }

    const fileName = `${sanitizePersonaFileName(name)}.md`;
    const targetPath = path.join(personaPresetsDir, fileName);
    await fs.promises.mkdir(personaPresetsDir, { recursive: true });
    await fs.promises.writeFile(targetPath, `${prompt}\n`, "utf8");

    return {
      name,
      fileName,
      path: fileName,
    };
  }

  async function handlePersonaPresetSaveRequest(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const result = await savePersonaPreset(payload);
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to save persona preset",
      });
    }
  }

  async function deletePersonaPreset(payload = {}) {
    const presetId = String(payload.id || "").trim();
    const presetPath =
      String(payload.path || "").trim() ||
      (presetId.startsWith("workspace:") ? presetId.slice("workspace:".length) : "");

    if (!presetPath) {
      const error = new Error("Missing persona preset path");
      error.statusCode = 400;
      throw error;
    }

    const targetPath = resolvePersonaPresetPath(presetPath);

    try {
      const stat = await fs.promises.stat(targetPath);
      if (!stat.isFile() || path.extname(targetPath).toLowerCase() !== ".md") {
        const error = new Error("Persona preset file not found");
        error.statusCode = 404;
        throw error;
      }
    } catch (error) {
      if (error && error.statusCode) {
        throw error;
      }
      const notFoundError = new Error("Persona preset file not found");
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    await fs.promises.unlink(targetPath);

    return {
      id: presetId || `workspace:${presetPath.replace(/\\/g, "/")}`,
      path: presetPath.replace(/\\/g, "/"),
    };
  }

  async function handlePersonaPresetDeleteRequest(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const result = await deletePersonaPreset(payload);
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Failed to delete persona preset",
      });
    }
  }

  return {
    listPersonaPresets,
    handlePersonaPresetsListRequest,
    handlePersonaPresetSaveRequest,
    handlePersonaPresetDeleteRequest,
  };
}

module.exports = {
  createPersonaHandlers,
};
