# 文远的智能实验室（AI-web）

一个面向本地模型的 Node.js Web 工作台，提供聊天界面、连接配置、人设管理、QQ 机器人、定时任务、工具调用以及脚本型 skill-runner 能力。

## 当前定位

当前仓库已经从“单个大文件为主”的形态逐步拆分为前端页面 + 服务端模块的结构，适合作为本地 AI 工作台继续维护和扩展。

默认访问地址：
- Web：`http://127.0.0.1:8000`
- 默认模型代理目标：`http://127.0.0.1:1234`

## 核心功能

### 1. Web 聊天工作台
- 本地聊天界面
- 会话历史管理（新建、删除、清空、重命名/恢复）
- 文件上传
- HTML 代码块预览
- 上下文/Prompt/速率等运行指标展示

### 2. 模型连接配置
- 支持配置接口地址、聊天路径、上下文上限
- 支持测试连接
- 支持读取模型列表并切换模型
- 通过同源 `/api/*` 代理访问本地模型服务

### 3. 人设（Persona）管理
- 从 `data/personas/` 读取本地 Markdown 人设
- 支持保存、编辑、删除人设
- 可在聊天配置中应用人设内容

### 4. 定时任务
- 创建、编辑、删除、立即执行任务
- 支持 cron 表达式
- 支持任务结果持久化
- 支持执行结果推送到 QQ
- 包含任务意图识别与任务模型调用模块

### 5. QQ 机器人
- 支持 QQ webhook 接入
- 支持私聊 / 群聊配置
- 支持默认推送目标、权限、模型、人设等配置
- 可将定时任务结果推送到 QQ

### 6. 工具调用
当前后端工具分发器已支持的主要工具包括：
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

### 7. 脚本型技能执行链路
- 保留 `skill-runner.ps1` 作为脚本型能力执行入口
- `skills/` 目录仍保留历史与本地能力相关内容
- 目前项目重点仍是聊天、QQ、定时任务和工具调用主链路

## 技术栈与运行方式

### 运行环境
- Node.js
- Windows PowerShell
- 本地模型服务（默认按 `http://127.0.0.1:1234` 访问）

### 安装依赖
```powershell
npm install
```

### 常用命令
```powershell
npm start
npm run skill-runner
npm test
```

### 启动方式
#### 方式 1：直接启动
```powershell
node server.js
```

#### 方式 2：使用脚本启动
```powershell
scripts\start-local-ai-chat.bat
```

也可以双击：
- `scripts/start-local-ai-chat.bat`
- `scripts/start-local-ai-chat.vbs`

如果需要脚本型技能执行器，再额外启动：
```powershell
npm run skill-runner
```

## 当前项目结构

```text
AI-web/
├─ public/                    前端页面与静态资源
├─ server/                    服务端模块
├─ scripts/                   启动脚本与辅助脚本
├─ data/                      运行时数据与配置
├─ logs/                      日志与 pid 文件
├─ tests/                     本地测试脚本
├─ docs/                      项目文档
├─ skills/                    本地 skills / 脚本能力
├─ server.js                  主入口
├─ package.json               NPM 配置
└─ README.md
```

### public/
- `index.html`：主界面
- `app.js`：前端交互逻辑
- `styles.css`：页面样式
- `assets/`：静态资源

### server/
当前已拆分出的主要模块：
- `server-bootstrap.js`：启动与数据初始化
- `server-cleanup.js`：启动清理逻辑
- `server-connection-config.js`：共享连接配置
- `server-http.js`：静态资源服务与 API 代理
- `server-live-web-search.js`：实时联网搜索辅助
- `server-personas.js`：人设管理
- `server-qq.js`：QQ 机器人能力
- `server-schedule-intent.js`：定时任务意图识别
- `server-scheduler.js`：定时任务调度
- `server-task-model.js`：任务模型调用
- `server-tool-dispatcher.js`：工具分发
- `server-utils.js`：通用工具函数

### data/
常见运行数据：
- `data/personas/`：本地人设 Markdown 文件
- `data/connection-config.json`：连接配置
- `data/qq-bot-config.json`：QQ 机器人配置
- `data/qq-bot-sessions.json`：QQ 会话数据
- `data/scheduled-tasks.json`：定时任务数据
- `data/skill-runner-config.json`：skill-runner 配置

### tests/
- `tests/run-tests.js`：项目本地测试入口，覆盖部分工具、调度、QQ、启动与意图识别相关能力

## 数据迁移与清理

当前服务端已包含部分启动时清理与迁移能力：
- 清理过期日志
- 清理 `data/*.tmp`
- 清理 `data/temp/`
- 清理浏览器 profile 临时目录
- 清理失效 pid 文件
- 支持部分旧数据文件迁移到 `data/` 目录

常见日志文件：
- `logs/server.log`
- `logs/server-debug.log`
- `logs/command-audit.log`
- `logs/skill-runner.log`

## 测试

运行：
```powershell
npm test
```

如果修改了服务端模块，建议额外执行：
```powershell
node --check server.js
```

## 当前维护说明

### 关于 skills
项目历史上存在过更多 Web 端 skills 管理/安装相关能力；目前仓库中仍保留 `skills/` 目录和 `skill-runner.ps1` 链路，但主维护重点已经收敛到：
- 本地聊天
- 模型连接配置
- QQ 机器人
- 定时任务
- 工具调用

### 关于代码状态
当前项目已经完成一轮服务端模块拆分，但仍然存在一些后续优化空间：
- `server.js` 仍偏大
- `public/app.js` 仍较集中
- `server/server-qq.js` 仍是较大的核心模块

因此更适合采用“边维护边拆分”的方式继续迭代，而不是一次性大重构。

## 本次 README 更新说明

本次 README 按当前仓库实际结构和可见功能重新整理，重点反映：
- `server/` 模块化结构
- 前端设置面板与聊天工作台
- QQ / 定时任务 / 工具调用能力
- `data/`、`logs/`、`tests/` 的当前职责
- 保留但非主线的 `skills` / `skill-runner` 说明
