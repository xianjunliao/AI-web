# AI-web Scheduler Bridge for life - 2026-05-04

This note records the AI-web side of the scheduled-task integration used by life.

## Scope

- AI-web remains the owner of scheduled-task storage, Cron validation, next-run calculation, execution state, and run-now behavior.
- life provides the user-facing scheduled-task page and writes scheduler requests into the MySQL bridge queue.
- life handles manager-only UI and permission checks before write requests are queued.
- AI-web consumes queued scheduler requests, forwards them to its local scheduler endpoints, and writes the response back to MySQL.

## MySQL Bridge Flow

Production scheduler traffic uses the existing `ai_web_novel_jobs` queue as a generic HTTP-forwarding queue:

1. life receives `/api/ai-web-scheduler/**`.
2. life inserts an `ai_web_novel_jobs` row with `path` set to one of the scheduler endpoints below.
3. AI-web's MySQL novel/job worker claims the row.
4. AI-web forwards the request to its local scheduler endpoint.
5. AI-web writes the JSON response, status, and any error text back to the same job row.
6. life polls the row until it is `done` or `error`, then returns the result to the browser.

Scheduler paths forwarded through the queue:

- `GET /scheduler/tasks`
- `POST /scheduler/tasks`
- `PUT /scheduler/tasks/{taskId}`
- `DELETE /scheduler/tasks/{taskId}`
- `POST /scheduler/tasks/{taskId}/run`

AI-web must allow `/scheduler/tasks/**` in `callLocalNovelEndpoint`; otherwise queued scheduler jobs fail with an unsupported bridge path error.

## Payload Shape

The scheduler task payload keeps the AI-web format:

- `name`
- `prompt`
- `scheduleType`
- `cronExpression`
- `enabled`
- `qqPushEnabled`
- `qqTargetType`
- `qqTargetId`
- `creatorType`
- `creatorId`

## Operational Notes

- Keep AI-web running with MySQL storage enabled so the worker can consume `ai_web_novel_jobs`.
- life no longer needs direct HTTP access to AI-web for scheduler operations in production.
- The production bridge is configured with `ai-web.scheduler-bridge.enabled/source/timeout-ms/poll-ms`.
- Restart AI-web after scheduler changes so in-memory timers and persisted task state are consistent.
- Restart the AI-web worker after deploying bridge-path changes; old workers only support `/novels/**`.
- Verify task execution with a harmless test prompt before relying on production reminders.

## 2026-05-05 Updates

- Scheduled task model calls now use a longer default timeout of 180 seconds.
- The timeout can be overridden with `SCHEDULED_TASK_MODEL_TIMEOUT_MS`.
- Run-now requests can pass a per-request timeout; the scheduler forwards it into task execution.
- QQ bridge push calls now use a 120 second default timeout, configurable with `QQ_BRIDGE_TIMEOUT_MS`.
- Generic outbound HTTP timeout was raised from 20 seconds to 120 seconds to avoid premature bridge failures.
- Assistant tool-call history now preserves `reasoning_content`, which fixes thinking-mode model errors that require reasoning content to be passed back.
- Scheduler task payloads preserve `signMan` and `lifeBaseUrl`, allowing life-created tasks to target the correct signer and deployment origin.
- AI-web can execute Moyu sign start/stop scheduled tasks directly when the task prompt resolves to a sign command.

## Moyu Sign Command Tasks

Natural-language tasks such as "每天 8 点启动签到" are normalized by life and stored as an AI-web scheduler task. During execution, AI-web detects sign start/stop commands and calls life:

```text
POST {lifeBaseUrl}/api/sign/updateRunStatus
```

Request body:

```json
{
  "signMan": "文远",
  "runStatus": "运行中"
}
```

Configuration:

- `LIFE_BASE_URL` or `LIFE_SIGN_BASE_URL`: fallback life origin, default `http://127.0.0.1:8007`.
- `LIFE_SIGN_TIMEOUT_MS`: timeout for the sign status update request, default 30000.
- `SCHEDULED_TASK_MODEL_TIMEOUT_MS`: model timeout for normal AI scheduled tasks, default 180000.
- `QQ_BRIDGE_TIMEOUT_MS`: QQ push timeout, default 120000.

## Verification

```bash
node --check server/server-scheduler.js
node --check server.js
npm test
```
