const fs = require("fs");
const path = require("path");

function createStartupCleanup({
  dataDir,
  logsDir,
  appendServerDebugLog = () => {},
  maxLogAgeMs = 7 * 24 * 60 * 60 * 1000,
  tempDirName = "temp",
  runnerBrowserProfileTestDirName = "runner-browser-profile-test3",
  runnerBrowserProfilesDirName = "runner-browser-profiles",
} = {}) {
  const tempDir = path.join(dataDir, tempDirName);
  const runnerBrowserProfileTestDir = path.join(dataDir, runnerBrowserProfileTestDirName);
  const runnerBrowserProfilesDir = path.join(dataDir, runnerBrowserProfilesDirName);

  async function pathExists(targetPath) {
    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function removePathIfExists(targetPath) {
    if (!(await pathExists(targetPath))) {
      return false;
    }
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    return true;
  }

  async function cleanupOldLogFiles() {
    await fs.promises.mkdir(logsDir, { recursive: true });
    const entries = await fs.promises.readdir(logsDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name === "server.pid") {
        continue;
      }
      const fullPath = path.join(logsDir, entry.name);
      const stat = await fs.promises.stat(fullPath);
      const isLogLike =
        entry.name.endsWith(".log") ||
        entry.name.endsWith(".out.log") ||
        entry.name.endsWith(".err.log");
      if (!isLogLike) {
        continue;
      }
      if (now - stat.mtimeMs >= maxLogAgeMs) {
        await fs.promises.unlink(fullPath);
      }
    }
  }

  async function cleanupDataTempFiles() {
    await fs.promises.mkdir(dataDir, { recursive: true });
    const entries = await fs.promises.readdir(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".tmp")) {
        continue;
      }
      await fs.promises.unlink(path.join(dataDir, entry.name));
    }
    await removePathIfExists(tempDir);
    await removePathIfExists(runnerBrowserProfileTestDir);
    await removePathIfExists(runnerBrowserProfilesDir);
  }

  async function cleanupStalePidFiles() {
    await fs.promises.mkdir(logsDir, { recursive: true });
    const pidFiles = ["server.pid"];
    for (const pidFile of pidFiles) {
      const pidPath = path.join(logsDir, pidFile);
      if (!(await pathExists(pidPath))) {
        continue;
      }
      const rawPid = String(await fs.promises.readFile(pidPath, "utf8")).trim();
      const pid = Number(rawPid);
      if (!Number.isInteger(pid) || pid <= 0) {
        await fs.promises.unlink(pidPath);
        continue;
      }
      let isAlive = true;
      try {
        process.kill(pid, 0);
      } catch {
        isAlive = false;
      }
      if (!isAlive) {
        await fs.promises.unlink(pidPath);
      }
    }
  }

  return async function runStartupCleanup() {
    try {
      await cleanupOldLogFiles();
      await cleanupDataTempFiles();
      await cleanupStalePidFiles();
      appendServerDebugLog("startup cleanup completed");
    } catch (error) {
      appendServerDebugLog(`startup cleanup failed: ${error.message || String(error)}`);
    }
  };
}

module.exports = {
  createStartupCleanup,
};
