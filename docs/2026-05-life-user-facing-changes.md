# Life User-Facing Changes - 2026-05

This document summarizes AI-web changes that support the current life web experience.

## Model Configuration

- AI-web can receive model connection settings from life.
- Remote API settings include base URL, chat path, model list path, model name, and API key.
- API key values should be treated as secrets in UI and logs. Masked keys are expected when returning configuration to clients.
- Per-request model connection settings are scoped to that request instead of being saved as the global AI-web connection config.
- life can request local-only routing with `localOnly` or `modelRoute: "local"`; remote and local model lists are stored separately as `available-models` and `available-local-models`.

## Novel Project Bridge

- life desktop and mobile novel pages can use AI-web's local novel project APIs through the bridge.
- Novel requests are forwarded through MySQL jobs when direct access is not available.
- Export and read-only GET-style operations are safe to use without creating or modifying project content.
- Novel setting generation runs independent setting files concurrently; tune with `NOVEL_SETTING_CONCURRENCY`; defaults are `10` for local models and `4` for remote APIs.
- Chapter generation now creates a chapter-mode plan before drafting, reviews the draft for dramatic strength, and may rewrite or lightly condense before returning the final chapter payload.
- Generated, regenerated, polished, and rewritten chapter responses include both top-level content fields and a nested `chapter` payload so life can persist the result directly.
- When life sends a `lifeProjectSnapshot`, AI-web uses a temporary local project for generation and does not write draft/log artifacts back into the normal AI-web project directory.
- For MySQL bridge `generate-next` requests carrying a `lifeProjectId`, AI-web pre-pulls the latest project, settings, materials, and chapters from MySQL before generating.

## Chat Bridge

- life chat requests can use AI-web local tools when the prompt requires them.
- For normal chat, AI-web keeps the bridge call simpler and faster by avoiding unnecessary tool rounds.
- Bridge timeout can be tuned with `BRIDGE_CHAT_TIMEOUT_MS`; the default now follows the 30 minute novel/model timeout.

## Release Notes

- Do not commit local runtime files such as logs or private tool folders.
- Confirm both life and AI-web point at the same MySQL database when bridge mode is enabled.
- Restart AI-web after connection-sync changes so background workers use the new behavior.
