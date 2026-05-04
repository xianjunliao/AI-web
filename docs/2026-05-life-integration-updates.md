# Life Integration Updates - 2026-05

This note records the AI-web side of the recent life integration work.

## Scope

- Shared model connection configuration can be synchronized between life and AI-web.
- The MySQL bridge can carry connection configuration from life chat jobs into AI-web before the model call is executed.
- Remote and local model list behavior is unified so life can query the correct model list when the remote API flag changes.
- Novel generation falls back to the shared connection model when a novel project does not define its own model.
- Bridge chat calls avoid tool rounds unless a request actually needs web search, weather, or scheduler tools.

## Main Files

- `server.js`
  - Applies `connectionConfig` from bridge requests and chat jobs.
  - Adds `/connection-config/sync`.
  - Uses shared model configuration as a fallback for novel text generation.
  - Limits bridge chat tool rounds when tools are not needed.

- `server/server-connection-config.js`
  - Supports persistence through the MySQL storage layer.
  - Keeps local JSON config and MySQL config in sync.

- `server/server-mysql-storage.js`
  - Exposes storage config helpers used by connection sync.

- `server/server-novel-projects.js`
  - Accepts shared connection configuration fallback for project model resolution.

## Operational Notes

- Keep AI-web running when life uses the MySQL bridge; workers must be online to consume chat and novel jobs.
- If life sends a remote API configuration, AI-web applies it before processing the request.
- If no model is provided by a novel project, AI-web tries the shared connection model before returning a configuration error.
- Tool-enabled chat remains available, but normal chat requests now use fewer tool/model rounds.

## Verification

Recommended checks before release:

```bash
node --check server.js
node --check server/server-connection-config.js
node --check server/server-http.js
node --check server/server-mysql-storage.js
node --check server/server-novel-projects.js
```
