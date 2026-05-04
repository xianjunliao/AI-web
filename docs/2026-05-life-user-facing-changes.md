# Life User-Facing Changes - 2026-05

This document summarizes AI-web changes that support the current life web experience.

## Model Configuration

- AI-web can receive model connection settings from life.
- Remote API settings include base URL, chat path, model list path, model name, and API key.
- API key values should be treated as secrets in UI and logs. Masked keys are expected when returning configuration to clients.

## Novel Project Bridge

- life desktop and mobile novel pages can use AI-web's local novel project APIs through the bridge.
- Novel requests are forwarded through MySQL jobs when direct access is not available.
- Export and read-only GET-style operations are safe to use without creating or modifying project content.

## Chat Bridge

- life chat requests can use AI-web local tools when the prompt requires them.
- For normal chat, AI-web keeps the bridge call simpler and faster by avoiding unnecessary tool rounds.
- Bridge timeout can be tuned with `BRIDGE_CHAT_TIMEOUT_MS`.

## Release Notes

- Do not commit local runtime files such as logs or private tool folders.
- Confirm both life and AI-web point at the same MySQL database when bridge mode is enabled.
- Restart AI-web after connection-sync changes so background workers use the new behavior.
