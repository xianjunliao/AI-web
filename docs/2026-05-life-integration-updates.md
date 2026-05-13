# Life Integration Updates - 2026-05

This note records the AI-web side of the recent life integration work.

## Scope

- Shared model connection configuration can be synchronized between life and AI-web.
- The MySQL bridge can carry connection configuration from life chat jobs into AI-web for a single request without mutating AI-web's global connection config.
- Remote and local model list behavior is unified so life can query the correct model list when the remote API flag changes.
- Novel generation falls back to the shared connection model when a novel project does not define its own model.
- Novel projects can explicitly route model calls to local mode with `localOnly` or `modelRoute: "local"`.
- Bridge chat calls avoid tool rounds unless a request actually needs web search, weather, or scheduler tools.
- Novel generation from life snapshots now returns direct chapter payloads while avoiding local artifact writes for temporary snapshot projects.
- MySQL-backed `generate-next` jobs can pre-pull the latest life project state into AI-web before running generation.

## Main Files

- `server.js`
  - Scopes `connectionConfig` from bridge requests and chat jobs to the current request.
  - Adds `/connection-config/sync`.
  - Uses shared model configuration as a fallback for novel text generation.
  - Limits bridge chat tool rounds when tools are not needed.
  - Syncs remote/current and local model lists to separate MySQL config keys.
  - Pre-syncs life novel projects from MySQL before bridge generation.

- `server/server-connection-config.js`
  - Supports persistence through the MySQL storage layer.
  - Keeps local JSON config and MySQL config in sync.
  - Enables remote API mode only when the required remote base URL, paths, and API key are present.

- `server/server-mysql-storage.js`
  - Exposes storage config helpers used by connection sync.

- `server/server-novel-projects.js`
  - Accepts shared connection configuration fallback for project model resolution.
  - Supports per-project local/remote routing.
  - Runs setting generation concurrently with `NOVEL_SETTING_CONCURRENCY`.
  - Adds chapter-mode planning, draft review, optional rewrite, optional condense, and richer chapter response payloads.

- `server/server-novel-sync.js`
  - Can pull a project snapshot directly from MySQL tables before generation.
  - Clears stale local chapter and draft Markdown files before applying a pulled snapshot.

## Operational Notes

- Keep AI-web running when life uses the MySQL bridge; workers must be online to consume chat and novel jobs.
- If life sends a remote API configuration, AI-web uses it only for that request unless `/connection-config/sync` is called.
- If no model is provided by a novel project, AI-web tries the shared connection model before returning a configuration error.
- Tool-enabled chat remains available, but normal chat requests now use fewer tool/model rounds.
- Snapshot-based novel calls should include `lifeProjectSnapshot` when life wants generation without modifying AI-web's local project artifacts.

## Verification

Recommended checks before release:

```bash
node --check server.js
node --check server/server-connection-config.js
node --check server/server-http.js
node --check server/server-mysql-storage.js
node --check server/server-novel-projects.js
node --check server/server-novel-sync.js
npm test
```
