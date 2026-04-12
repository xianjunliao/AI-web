const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER_ORIGIN = process.env.SKILL_RUNNER_SERVER || "http://127.0.0.1:8000";
const POLL_INTERVAL_MS = 1500;
const SKILL_RUN_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function detectMissingRuntimeIssue(text = "") {
  if (/Cannot find module ['"]playwright['"]/i.test(text)) {
    return "missing-playwright-package";
  }
  if (/Executable doesn't exist/i.test(text) || /Please run the following command to download new browsers/i.test(text)) {
    return "missing-playwright-browser";
  }
  return "";
}

function runCommand(command, args, { cwd = ROOT, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Command timed out: ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const error = new Error(stderr.trim() || stdout.trim() || `Command failed with code ${code}`);
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        error.exitCode = code;
        reject(error);
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
    });
  });
}

async function executeWorkspaceSkill(job) {
  const { skillName, username, headless, notify } = job.payload || {};
  const skillDir = path.join(ROOT, "skills", skillName);
  const candidates = ["run-with-notify.js", "run.js", "index.js"];
  const entryPath = candidates.map((name) => path.join(skillDir, name)).find((candidate) => require("fs").existsSync(candidate));

  if (!entryPath) {
    throw new Error("No supported skill entry script found");
  }

  const cliArgs = [path.relative(ROOT, entryPath).replace(/\\/g, "/")];
  if (username) cliArgs.push(`--username=${username}`);
  if (headless === true) cliArgs.push("--headless");
  if (headless === false) cliArgs.push("--no-headless");
  if (notify === false) cliArgs.push("--no-notify");

  const runtimePrepared = [];

  async function runOnce() {
    return await runCommand(process.execPath, cliArgs, {
      cwd: ROOT,
      timeoutMs: SKILL_RUN_TIMEOUT_MS,
    });
  }

  try {
    const result = await runOnce();
    return {
      skillName,
      entry: path.relative(ROOT, entryPath).replace(/\\/g, "/"),
      args: cliArgs.slice(1),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      runtimePrepared,
    };
  } catch (error) {
    const combinedText = `${error.message || ""}\n${error.stderr || ""}\n${error.stdout || ""}`;
    const missingRuntimeIssue = detectMissingRuntimeIssue(combinedText);
    if (!missingRuntimeIssue) {
      throw error;
    }

    if (missingRuntimeIssue === "missing-playwright-package") {
      await runCommand("npm.cmd", ["install", "playwright"], { cwd: ROOT });
      runtimePrepared.push("playwright package");
    }
    if (missingRuntimeIssue === "missing-playwright-package" || missingRuntimeIssue === "missing-playwright-browser") {
      await runCommand("npx.cmd", ["playwright", "install", "chromium"], { cwd: ROOT });
      runtimePrepared.push("playwright chromium");
    }

    const retried = await runOnce();
    return {
      skillName,
      entry: path.relative(ROOT, entryPath).replace(/\\/g, "/"),
      args: cliArgs.slice(1),
      exitCode: retried.exitCode,
      stdout: retried.stdout,
      stderr: retried.stderr,
      runtimePrepared,
    };
  }
}

async function reportResult(jobId, payload) {
  await requestJson(`${SERVER_ORIGIN}/skill-runner/jobs/${encodeURIComponent(jobId)}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function main() {
  console.log(`Skill runner started: ${SERVER_ORIGIN}`);
  while (true) {
    try {
      const response = await requestJson(`${SERVER_ORIGIN}/skill-runner/jobs/next`);
      const job = response.job;
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      try {
        const result = await executeWorkspaceSkill(job);
        await reportResult(job.id, { ok: true, result });
      } catch (error) {
        await reportResult(job.id, {
          ok: false,
          error: error.message || "Skill runner execution failed",
          result: {
            stdout: error.stdout || "",
            stderr: error.stderr || "",
            exitCode: error.exitCode || null,
          },
        });
      }
    } catch (error) {
      console.log(`Skill runner idle/retry: ${error.message}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch((error) => {
  console.error("Skill runner fatal error:", error);
  process.exit(1);
});
