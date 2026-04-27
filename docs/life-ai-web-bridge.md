# AI-web 与 life 项目 MySQL 中转说明

本文档记录 AI-web 本地服务与 life 网站项目之间的 MySQL 中转方案。当前设计不修改业务已有表，只新增 `ai_web_*` 表。

## 项目职责

- AI-web：运行在本机，负责连接本地模型、工具能力、小说项目接口，并轮询 MySQL 中的任务表。
- life：运行在网站服务器，无法直接访问本机模型时，通过 MySQL 写入任务并等待 AI-web 回写结果。
- MySQL：只作为中转层和可选持久化层，不承载本地小说项目正文数据。小说项目数据仍由 AI-web 本地服务维护。

## 当前支持能力

- 聊天记录同步：AI-web 前端可将聊天记录同步到 `ai_web_chat_records`。
- 配置同步：AI-web 前端配置保存到 `ai_web_configs`。
- 聊天桥接：life 写入 `ai_web_chat_jobs`，AI-web 处理后回写答案。
- 模型列表：AI-web 定时同步模型列表到 `ai_web_configs` 的 `available-models`，life 通过接口读取。
- 工具能力：聊天桥接会携带 `toolsEnabled: true`，可复用 AI-web 已有网络搜索、天气查询、定时任务等工具处理逻辑。
- 小说桥接：life 的 `/novels/**` 请求写入 `ai_web_novel_jobs`，AI-web 调用本地小说接口处理后回写结果。
- 小说页面：life 静态资源目录下提供桌面端 `/lxj/novels.html` 和移动端 `/lxj/novels-mobile.html`。

## 数据流

### 聊天

1. life 接收 `/api/ask` 等聊天请求。
2. life 插入一条 `ai_web_chat_jobs`，状态为 `pending`。
3. AI-web Worker 轮询任务，将状态改为 `processing`。
4. AI-web 调用本地模型和工具能力。
5. AI-web 回写 `response_json`、`assistant_text`、`status_code`，并将状态改为 `done` 或 `error`。
6. life 轮询同一条任务并返回结果给网站前端。

### 小说项目

1. life 接收 `/novels/projects`、`/novels/projects/{id}`、`/novels/infer-project` 等请求。
2. life 插入一条 `ai_web_novel_jobs`，包含 HTTP method、path、request_json。
3. AI-web Worker 取出任务，转发到本机 AI-web 的小说接口。
4. AI-web 回写 `response_text`、`content_type`、`status_code`。
5. life 将回写内容原样返回给网页。

## 建表

完整 SQL 在本项目：

- `docs/mysql-bridge-schema.sql`

执行方式示例：

```bash
mysql -h <host> -P 3306 -u <user> -p <database> < docs/mysql-bridge-schema.sql
```

也可以使用 AI-web 脚本创建基础表：

```bash
MYSQL_HOST=<host> MYSQL_PORT=3306 MYSQL_DATABASE=<database> MYSQL_USER=<user> MYSQL_PASSWORD=<password> node scripts/create-ai-web-tables.js
node scripts/ensure-novel-jobs-table.js
```

## 表说明

| 表名 | 用途 |
| --- | --- |
| `ai_web_chat_records` | AI-web 聊天会话记录。 |
| `ai_web_configs` | AI-web 配置、模型列表等键值配置。 |
| `ai_web_state_store` | 预留状态存储表。 |
| `ai_web_storage_events` | 存储同步事件日志。 |
| `ai_web_chat_request_logs` | AI-web 本地聊天接口请求日志。 |
| `ai_web_chat_jobs` | life 到 AI-web 的聊天任务队列。 |
| `ai_web_novel_jobs` | life 到 AI-web 的小说接口任务队列。 |

## AI-web 配置

AI-web 的 MySQL 配置文件位于：

```text
data/mysql-config.json
```

示例结构：

```json
{
  "enabled": true,
  "host": "<host>",
  "port": 3306,
  "database": "<database>",
  "user": "<user>",
  "password": "<password>",
  "connectionLimit": 5,
  "connectTimeout": 10000
}
```

启动 AI-web 后会自动：

- 初始化 MySQL 连接池。
- 启动聊天任务 Worker。
- 启动小说任务 Worker。
- 定时同步可用模型列表。

## life 配置

life 使用自身 Spring Boot 数据源连接同一个 MySQL。桥接相关配置项：

```yaml
ai-web:
  chat-bridge:
    enabled: true
    model: ""
    models: ""
    source: life-web
    timeout-ms: 120000
    poll-ms: 1000
  novel-bridge:
    enabled: true
    source: life-web
    timeout-ms: 1800000
    poll-ms: 1000
```

## 使用注意

- 不使用 MySQL 中转时，AI-web 本地聊天、工具、小说项目仍可正常使用。
- life 的 AI 聊天和小说桥接依赖 `ai_web_chat_jobs`、`ai_web_novel_jobs` 以及 AI-web Worker 在线。
- `status` 常见值：`pending`、`processing`、`done`、`error`。
- `created_at`、`updated_at`、`completed_at` 均为毫秒时间戳。
- 生产环境建议限制 MySQL 账号权限到当前库，并只授予 `ai_web_*` 表所需的 `SELECT/INSERT/UPDATE` 权限。
