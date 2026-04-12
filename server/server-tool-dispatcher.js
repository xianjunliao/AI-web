const fs = require("fs");
const path = require("path");

function createExecuteToolCall(deps) {
  const {
    root,
    resolveWorkspacePath,
    getWeatherByLocation,
    searchClawHubSkills,
    installClawHubSkill,
    runWorkspaceSkill,
    listScheduledTasks,
    validateScheduledTaskPayload,
    findEquivalentScheduledTask,
    sanitizeScheduledTask,
    saveScheduledTasks,
    ensureScheduledTask,
    computeNextRunAt,
    runScheduledTask,
    sendQqMessage,
    getScheduledTasks,
    setScheduledTasks,
    runningScheduledTaskIds,
  } = deps;

  return async function executeToolCall(name, args = {}) {
    switch (name) {
      case "list_dir": {
        const targetPath = resolveWorkspacePath(root, args.path || ".");
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        return {
          path: path.relative(root, targetPath) || ".",
          entries: entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
          })),
        };
      }
      case "read_file": {
        const targetPath = resolveWorkspacePath(root, args.path);
        const content = await fs.promises.readFile(targetPath, "utf8");
        return {
          path: path.relative(root, targetPath) || path.basename(targetPath),
          content,
        };
      }
      case "write_file": {
        const targetPath = resolveWorkspacePath(root, args.path);
        const content = String(args.content ?? "");
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, content, "utf8");
        return {
          path: path.relative(root, targetPath) || path.basename(targetPath),
          bytesWritten: Buffer.byteLength(content, "utf8"),
        };
      }
      case "delete_file": {
        const targetPath = resolveWorkspacePath(root, args.path);
        const stat = await fs.promises.stat(targetPath);
        if (stat.isDirectory()) {
          const error = new Error("delete_file only supports files");
          error.statusCode = 400;
          throw error;
        }
        await fs.promises.unlink(targetPath);
        return {
          path: path.relative(root, targetPath) || path.basename(targetPath),
          deleted: true,
        };
      }
      case "get_weather": {
        return await getWeatherByLocation(args.location);
      }
      case "search_clawhub_skills": {
        const query = String(args.query || "").trim();
        const skills = await searchClawHubSkills(query, Number(args.limit) || 6);
        return {
          query,
          preferredSource: "https://clawhub.ai/skills?sort=downloads&nonSuspicious=true",
          skills,
        };
      }
      case "install_clawhub_skill": {
        return await installClawHubSkill(args);
      }
      case "run_workspace_skill": {
        return await runWorkspaceSkill(args);
      }
      case "list_scheduled_tasks": {
        return { tasks: listScheduledTasks() };
      }
      case "create_scheduled_task": {
        const input = validateScheduledTaskPayload(args);
        const existingTask = findEquivalentScheduledTask({
          ...input,
          enabled: args.enabled !== false,
        });
        if (existingTask) {
          return {
            ...existingTask,
            deduplicated: true,
          };
        }
        const task = sanitizeScheduledTask({
          ...input,
          enabled: args.enabled !== false,
        });
        const nextTasks = getScheduledTasks();
        nextTasks.unshift(task);
        setScheduledTasks(nextTasks);
        await saveScheduledTasks();
        return task;
      }
      case "update_scheduled_task": {
        const task = ensureScheduledTask(args.id);
        const patch = validateScheduledTaskPayload(args, { partial: true });
        Object.assign(task, patch);
        task.updatedAt = Date.now();
        task.nextRunAt = task.enabled ? computeNextRunAt(task, Date.now()) : null;
        await saveScheduledTasks();
        return task;
      }
      case "delete_scheduled_task": {
        ensureScheduledTask(args.id);
        setScheduledTasks(getScheduledTasks().filter((task) => task.id !== args.id));
        runningScheduledTaskIds.delete(args.id);
        await saveScheduledTasks();
        return { deleted: true, id: args.id };
      }
      case "run_scheduled_task": {
        return await runScheduledTask(args.id);
      }
      case "send_qq_message": {
        return await sendQqMessage(args);
      }
      default: {
        const error = new Error(`Unsupported tool: ${name}`);
        error.statusCode = 400;
        throw error;
      }
    }
  };
}

module.exports = {
  createExecuteToolCall,
};
