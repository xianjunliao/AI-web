const fs = require("fs");

function createDataInitializer({
  dataDir,
  personaPresetsDir,
  legacyPersonaPresetsDir,
  scheduledTasksFile,
  legacyScheduledTasksFile,
  qqBotConfigFile,
  legacyQqBotConfigFile,
  qqBotSessionsFile,
  legacyQqBotSessionsFile,
  connectionConfigFile,
  legacyConnectionConfigFile,
  migrateLegacyDataFile,
} = {}) {
  return async function initializeDataFiles() {
    await fs.promises.mkdir(dataDir, { recursive: true });
    try {
      await fs.promises.access(personaPresetsDir, fs.constants.F_OK);
    } catch {
      try {
        await fs.promises.rename(legacyPersonaPresetsDir, personaPresetsDir);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        await fs.promises.mkdir(personaPresetsDir, { recursive: true });
      }
    }

    await migrateLegacyDataFile({
      currentPath: scheduledTasksFile,
      legacyPath: legacyScheduledTasksFile,
      fallbackValue: [],
    });
    await migrateLegacyDataFile({
      currentPath: qqBotConfigFile,
      legacyPath: legacyQqBotConfigFile,
      fallbackValue: {},
    });
    await migrateLegacyDataFile({
      currentPath: qqBotSessionsFile,
      legacyPath: legacyQqBotSessionsFile,
      fallbackValue: {},
    });
    await migrateLegacyDataFile({
      currentPath: connectionConfigFile,
      legacyPath: legacyConnectionConfigFile,
      fallbackValue: {},
    });
  };
}

function createServerBootstrap({
  initializeDataFiles,
  runStartupCleanup,
  loadScheduledTasks,
  loadSharedConnectionConfig,
  loadQqBotConfig,
  loadQqBotSessions,
  startScheduledTaskLoop,
  server,
  port,
  host,
  targetOrigin,
} = {}) {
  return async function bootstrapServer() {
    await initializeDataFiles();
    await runStartupCleanup();
    await Promise.all([
      loadScheduledTasks(),
      loadSharedConnectionConfig(),
    ]);
    await Promise.all([
      loadQqBotConfig(),
      loadQqBotSessions(),
    ]);

    startScheduledTaskLoop();
    await new Promise((resolve, reject) => {
      server.listen(port, host, (error) => {
        if (error) {
          reject(error);
          return;
        }
        console.log(`Local AI workbench running at http://${host}:${port}`);
        console.log(`Proxy target: ${targetOrigin}`);
        console.log(`QQ bot webhook: http://${host}:${port}/qq/webhook`);
        resolve();
      });
    });
  };
}

module.exports = {
  createDataInitializer,
  createServerBootstrap,
};
