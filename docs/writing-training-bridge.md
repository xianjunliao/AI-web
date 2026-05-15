# Writing Training Bridge

AI-web now exposes a writing-training workspace parallel to `/novels`.
Life can mount it as a top-level feature and forward requests through the existing MySQL job bridge.

All writing-training resources are owner-scoped. Every request must include one of:

- `ownerKey`
- `lifeOwnerKey`
- `ownerId`
- `lifeOwnerId`

For `GET` requests, pass it as a query parameter. For `POST` and `PUT`, pass it in the JSON body. Optional display metadata can use `ownerLevel` / `lifeOwnerLevel` and `ownerName` / `lifeOwnerName`.

## Storage

AI-web stores local artifacts under:

```text
data/writing/
  plans/
  checkins/
  books/
```

For the first version, life can reuse `ai_web_novel_jobs` for `/writing/**` requests. The AI-web worker accepts these paths and forwards them to the local writing module.

When AI-web MySQL storage is enabled, plans and check-ins are persisted to:

- `ai_web_writing_plans`
- `ai_web_writing_checkins`

Existing local plan/check-in JSON files are migrated into MySQL on first table initialization. Book deconstruction artifacts still use local files under `data/writing/books/`.

Model-backed check-in creation and review can also write bridge stream events into `ai_web_chat_events` when the proxied request carries `x-request-id`. Event types are:

- `status`
- `delta`
- `done`
- `error`

## Plan APIs

- `GET /writing/plans`
- `POST /writing/plans`
- `GET /writing/plans/{planId}`
- `PUT /writing/plans/{planId}`
- `DELETE /writing/plans/{planId}`

Create payload example:

```json
{
  "title": "30天人物描写训练",
  "goal": "每天写一个有明确动机的人物片段",
  "schedule": "daily",
  "targetWords": 800,
  "practiceTypes": ["人物对白", "场景描写", "小故事"],
  "model": "",
  "ownerKey": "life-user-1"
}
```

## Check-in APIs

- `GET /writing/plans/{planId}/checkins`
- `POST /writing/plans/{planId}/checkins`
- `GET /writing/checkins/{checkinId}`
- `DELETE /writing/checkins/{checkinId}`
- `POST /writing/checkins/{checkinId}/review`
- `POST /writing/checkins/{checkinId}/polish`
- `POST /writing/plans/{planId}/weekly-review`
- `POST /writing/plans/{planId}/prompts`

Check-in creation can immediately run an AI review unless `review: false` is passed.

```json
{
  "title": "第1天：克制的人物",
  "exerciseType": "人物片段",
  "prompt": "写一个不愿承认自己害怕失去的人",
  "content": "这里是用户练笔正文...",
  "ownerKey": "life-user-1"
}
```

Review output focuses on craft improvement instead of replacing the user's writing:

- strengths
- concrete problems
- sentence/paragraph examples
- AI-ish writing signals
- local polish sample
- next exercise

`POST /writing/plans/{planId}/prompts` returns up to five concrete practice suggestions. It uses the plan and recent check-ins when model generation is available, and falls back to built-in suggestions if model generation fails.

## Book Deconstruction APIs

- `GET /writing/books`
- `POST /writing/books`
- `GET /writing/books/{bookId}`
- `GET /writing/books/{bookId}/chunks/{chunkNo}`
- `POST /writing/books/{bookId}/analyze`
- `POST /writing/books/{bookId}/synthesize`

Book ingestion accepts JSON text content:

```json
{
  "title": "某长篇小说拆书",
  "sourceName": "novel.txt",
  "content": "完整txt内容...",
  "chunkSize": 12000,
  "ownerKey": "life-user-1"
}
```

Large books are split into chunk files. A 300k-2m Chinese-character TXT should be processed by repeatedly calling:

```json
{
  "maxChunks": 3
}
```

on `/writing/books/{bookId}/analyze` until `book.analyzedChunks >= book.chunkCount`.
Keep `maxChunks` small for interactive use; use larger values only for background jobs.

After chunks are analyzed, call `/writing/books/{bookId}/synthesize` to generate outputs aligned with AI-web novel project settings:

- `world`
- `characters`
- `factions`
- `power-system`
- `outline`
- `volume-plan`
- `chapter-plan`
- `style-guide`

Optional payload:

```json
{
  "targets": ["world", "characters", "outline", "chapter-plan"]
}
```

## Model Routing

Writing endpoints accept the same model routing fields used by the bridge:

- `model`
- `connectionConfig`
- `modelRoute` or `modelProvider`
- `localOnly`

If a request omits routing fields, AI-web falls back to the plan model and then the shared model configuration.

## Notes

- The first version uses JSON upload. If life needs browser file upload for very large TXT files, life should read the file client-side or server-side and write the content into the bridge request, or add a dedicated upload endpoint on the life side.
- AI-web caps one request body at 128 MB for writing endpoints.
- Deconstruction is resumable because chunk extracts are saved under `data/writing/books/{bookId}/extracts/`.
- `maxChunks` is capped at 10 per analyze call on the AI-web side.
