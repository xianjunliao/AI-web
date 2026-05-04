# AI-web Scheduler Bridge for life - 2026-05-04

This note records the AI-web side of the scheduled-task integration used by life.

## Scope

- AI-web remains the owner of scheduled-task storage, Cron validation, next-run calculation, execution state, and run-now behavior.
- life provides the user-facing scheduled-task page and proxies requests to AI-web.
- life handles manager-only UI and HTTP protection before write requests reach AI-web.

## Endpoints Used By life

life maps its `/api/ai-web-scheduler/**` routes to these AI-web scheduler endpoints:

- `GET /scheduler/tasks`
- `POST /scheduler/tasks`
- `PUT /scheduler/tasks/{taskId}`
- `DELETE /scheduler/tasks/{taskId}`
- `POST /scheduler/tasks/{taskId}/run`

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

- Keep the AI-web HTTP server reachable from life through `ai-web.scheduler-bridge.base-url`.
- life defaults this URL to `http://127.0.0.1:8000`.
- Restart AI-web after scheduler changes so in-memory timers and persisted task state are consistent.
- Verify task execution with a harmless test prompt before relying on production reminders.

## Verification

```bash
node --check server/server-scheduler.js
node --check server.js
```
