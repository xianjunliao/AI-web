# AI-web

本项目是一个本地运行的 Node.js Web 工作台，面向本地或远程 OpenAI 兼容模型，提供聊天、工具调用、QQ 机器人、定时任务和小说项目创作管理能力。

默认访问地址：

- Web 工作台：`http://127.0.0.1:8000`
- QQ Webhook：`http://127.0.0.1:8000/qq/webhook`
- 默认本地模型接口：`http://127.0.0.1:1234`

## 功能概览

### 聊天工作台

- 本地聊天界面和会话历史管理。
- 支持文件上传、头像、背景图、运行指标展示。
- 支持 HTML 代码块预览。
- 通过同源 `/api/*` 代理访问 OpenAI 兼容接口。
- 可配置上下文、Prompt、模型和接口地址。

### 模型连接配置

- 支持本地模型接口和远程 OpenAI 兼容接口。
- 可配置聊天路径、模型列表路径、上下文上限和 API Key。
- 支持连接测试、模型列表读取和当前模型切换。

### Persona 人设管理

- 人设以 Markdown 文件保存到 `data/personas/`。
- 支持读取、保存、编辑、删除。
- 可在 Web 聊天和 QQ 机器人配置中应用。

### 工具调用

后端工具分发器当前支持：

- `list_dir`
- `read_file`
- `write_file`
- `delete_file`
- `get_weather`
- `web_search`
- `run_shell_command`
- `run_cli_command`
- `list_scheduled_tasks`
- `create_scheduled_task`
- `update_scheduled_task`
- `delete_scheduled_task`
- `run_scheduled_task`
- `send_qq_message`

### 定时任务

- 支持创建、编辑、删除和立即执行任务。
- 支持 cron 表达式。
- 支持保存执行结果。
- 支持将任务结果推送到 QQ。
- 包含自然语言定时任务意图识别逻辑。

### QQ 机器人

- 提供 OneBot / NapCat 等 HTTP 场景下的 webhook 接入。
- 支持私聊和群聊对象配置。
- 支持默认推送目标配置。
- 支持为 QQ 会话配置模型、人设和工具权限。
- 支持部分管理命令和小说项目命令。

### 小说项目工坊

入口：

- Web 页面右上角“小说项目”
- `http://127.0.0.1:8000/novels.html`

当前能力：

- 小说项目 CRUD。
- 每本小说独立目录保存。
- 题材、主题、梗概、主角等基础信息生成。
- 世界观、角色、剧情、章节规划、风格等设定项生成与保存。
- 根据已写正文整理设定。
- 素材库管理和 AI 整理。
- 生成下一章草稿，自动挂载素材库内容。
- 手写章节 AI 润色。
- 阅读器中查看章节正文、摘要、字数和上下章。
- 重生成当前待审草稿。
- 删除指定章节并回退写作进度。
- 批量连续写作。
- 章节摘要和状态快照。
- 草稿章节与正式章节分离保存。
- QQ 检阅、通过和退回重写。

常用 QQ 小说命令：

```text
-n 小说列表
-n 查看小说 <项目名>
-n 生成 <项目名> 下一章
-n 查看 <项目名> 第N章摘要
-n 查看 <项目名> 第N章正文
-n 通过 <项目名> 第N章
-n 退回 <项目名> 第N章：意见
```

### MySQL 与云端同步

- `server/server-mysql-storage.js` 提供 MySQL 持久化、任务队列和 Worker 能力。
- `server/server-novel-sync.js` 提供小说项目云端同步相关逻辑。
- `scripts/create-ai-web-tables.js` 和 `scripts/ensure-novel-jobs-table.js` 可用于初始化或补齐相关表结构。
- `docs/mysql-bridge-schema.sql` 包含桥接表结构参考。

## 运行环境

- Windows 10 / 11
- Node.js 20+
- Windows PowerShell 5.1+ 或 PowerShell 7+
- 本地或远程 OpenAI 兼容模型接口
- 可选：MySQL
- 可选：OneBot / NapCat HTTP QQ 机器人环境

## 安装与启动

安装依赖：

```powershell
npm install
```

启动服务：

```powershell
npm start
```

等价命令：

```powershell
node server.js
```

也可以使用本地启动脚本：

```powershell
scripts\start-local-ai-chat.bat
```

## 配置与数据

运行期配置和数据主要保存在 `data/` 下。该目录已在 `.gitignore` 中忽略，避免把本地会话、小说正文、任务记录和敏感配置提交到仓库。

常见文件：

- `data/personas/`：本地人设 Markdown。
- `data/connection-config.json`：模型连接配置。
- `data/qq-bot-config.json`：QQ 机器人配置。
- `data/qq-bot-sessions.json`：QQ 会话数据。
- `data/scheduled-tasks.json`：定时任务数据。
- `data/novels/`：小说项目目录。

注意：不要把真实 API Key、QQ Token、数据库密码或个人聊天数据提交到仓库。若历史配置中已经写入明文密钥，建议轮换密钥并迁移到环境变量或仅本地保存的配置文件。

## 项目结构

```text
AI-web/
├── public/                    前端页面与静态资源
├── server/                    服务端模块
├── scripts/                   启动和初始化脚本
├── data/                      运行数据与本地配置，默认不提交
├── logs/                      运行日志，默认不提交
├── tests/                     本地测试
├── docs/                      项目文档和数据库结构参考
├── server.js                  主入口
├── package.json               NPM 配置
└── README.md
```

### public/

- `index.html`：聊天主界面。
- `app.js`：聊天页前端逻辑。
- `styles.css`：聊天页样式。
- `novels.html`：小说项目页。
- `novels.js`：小说项目页前端逻辑。
- `novels.css`：小说项目页样式。
- `assets/`：静态资源。

### server/

- `server-bootstrap.js`：启动和数据初始化。
- `server-cleanup.js`：启动清理。
- `server-connection-config.js`：共享连接配置。
- `server-http.js`：静态资源服务和 API 代理。
- `server-live-web-search.js`：实时联网搜索。
- `server-mysql-storage.js`：MySQL 持久化、任务队列和 Worker。
- `server-novel-projects.js`：小说项目、设定、素材库、章节、润色和 QQ 审阅。
- `server-novel-sync.js`：小说项目云端同步。
- `server-personas.js`：人设管理。
- `server-qq.js`：QQ 机器人能力。
- `server-schedule-intent.js`：定时任务意图识别。
- `server-scheduler.js`：定时任务调度。
- `server-task-model.js`：任务模型调用。
- `server-tool-dispatcher.js`：工具分发。
- `server-utils.js`：通用工具函数和原子文件写入。

## 小说项目目录

每个小说项目保存在 `data/novels/<projectId>/`：

```text
data/novels/<projectId>/
├── project.json
├── state.json
├── review.json
├── settings/
├── materials/
├── chapters/
├── drafts/
├── summaries/
├── snapshots/
└── logs/
```

## 测试

运行完整测试：

```powershell
npm test
```

语法检查：

```powershell
node --check server.js
```

当前已知情况：`server.js` 语法检查通过；完整测试中仍存在若干失败，主要集中在中文文本预期、QQ 管理命令旁路、联网搜索旁路、定时任务自然语言处理和小说模块断言。
