const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  createStaticPathGuard,
  migrateLegacyDataFile,
  readRequestBody,
  resolveWorkspacePath,
  writeJsonFileAtomic,
} = require("../server/server-utils");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-web-test-"));
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

async function main() {
  await runTest("resolveWorkspacePath keeps access inside workspace root", async () => {
    const root = createTempDir();
    const inside = resolveWorkspacePath(root, "notes/file.txt");
    assert.equal(inside, path.join(root, "notes", "file.txt"));
    assert.throws(() => resolveWorkspacePath(root, "../outside.txt"), /Path escapes workspace/);
  });

  await runTest("writeJsonFileAtomic writes complete json content", async () => {
    const root = createTempDir();
    const target = path.join(root, "data", "config.json");
    await writeJsonFileAtomic(target, { enabled: true, count: 2 });
    const raw = await fs.promises.readFile(target, "utf8");
    assert.deepEqual(JSON.parse(raw), { enabled: true, count: 2 });
  });

  await runTest("migrateLegacyDataFile moves legacy json into data directory", async () => {
    const root = createTempDir();
    const legacy = path.join(root, "scheduled-tasks.json");
    const current = path.join(root, "data", "scheduled-tasks.json");
    await fs.promises.writeFile(legacy, JSON.stringify([{ id: "task-1" }], null, 2), "utf8");

    await migrateLegacyDataFile({
      currentPath: current,
      legacyPath: legacy,
      fallbackValue: [],
    });

    const migrated = JSON.parse(await fs.promises.readFile(current, "utf8"));
    assert.deepEqual(migrated, [{ id: "task-1" }]);
    await assert.rejects(fs.promises.access(legacy));
  });

  await runTest("readRequestBody rejects oversized payloads", async () => {
    const req = Readable.from([Buffer.from("12345"), Buffer.from("67890")]);
    req.headers = {};
    req.method = "POST";

    await assert.rejects(readRequestBody(req, { limitBytes: 8 }), /Request body too large/);
  });

  await runTest("createStaticPathGuard only allows explicit public paths", async () => {
    const isPublicStaticPath = createStaticPathGuard("C:\\workspace", {
      exactPaths: ["/", "/index.html", "/app.js"],
    });

    assert.equal(isPublicStaticPath("/"), true);
    assert.equal(isPublicStaticPath("/app.js"), true);
    assert.equal(isPublicStaticPath("/qq-bot-config.json"), false);
    assert.equal(isPublicStaticPath("/data/scheduled-tasks.json"), false);
  });

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
