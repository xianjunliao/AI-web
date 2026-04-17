# 文远的智能实验室（AI-web）

一个面向本地模型的 Node.js Web 工作台，当前主要提供：
- Web 聊天工作台
- 模型连接配置
- Persona / 人设管理
- QQ 机器人接入
- 定时任务与自动化工具调用
- 独立的小说项目工坊（Novel Projects）
- 脚本型 skill-runner 链路

## 当前定位

本仓库已经从早期的“单入口大文件”逐步演进为：
- 前端页面层
- 服务端模块层
- 运行数据目录
- 独立功能子系统

目前最核心的两条产品主线是：
1. **聊天工作台**：用于本地模型日常对话、工具调用、QQ 与定时任务配置
2. **小说项目工坊**：用于多小说项目管理、设定生成、章节写作、进度保存与 QQ 审阅

默认访问地址：
- Web：`http://127.0.0.1:8000`
- 默认模型代理目标：`http://127.0.0.1:1234`
- QQ Webhook：`http://127.0.0.1:8000/qq/webhook`

---

## 核心功能

### 1. Web 聊天工作台
- 本地聊天界面
- 会话历史管理（新建、删除、清空、恢复）
- 文件上传
- HTML 代码块预览
- 上下文 / Prompt / 速率等运行指标展示
- 同源代理调用本地模型接口

### 2. 模型连接配置
- 支持配置接口地址、聊天路径、上下文上限
- 支持测试连接
- 支持读取模型列表并切换模型
- 通过同源 `/api/*` 代理访问本地模型服务
- 默认保持本地模型优先
- 可选启用远程 OpenAI 兼容接口（如 DeepSeek），由服务端代理统一转发并注入 API Key

### 3. Persona / 人设管理
- 从 `data/personas/` 读取本地 Markdown 人设
- 支持保存、编辑、删除人设
- 可在聊天配置与 QQ 配置中应用人设内容

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
- 支持定时任务结果推送
- 支持通过 QQ 直接触发部分管理能力

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

### 7. 小说项目工坊（Novel Projects）
这是当前新增的独立功能子系统，入口位于聊天页右上角 **“小说项目”** 按钮，也可以直接访问：
- `http://127.0.0.1:8000/novels.html`

当前已支持：
- 小说项目 CRUD
- 多本小说独立项目目录保存
- 基于题材 / 主题 / 梗概 / 主角等基础信息自动生成设定
- 支持配置每章目标字数，并写入设定与生成提示词
- 设定文件独立保存为 Markdown
- 可基于已写正文重新整理 / 回填设定
- 生成下一章草稿
- 支持在阅读器中查看章节正文、字数与上下章切换
- 支持重生成当前待审草稿
- 支持删除指定章节并自动回退写作进度
- 批量连续写作 / 批量出章
- 章节摘要与状态快照生成
- 章节中文字符数统计
- 草稿章节与正式章节分离存储
- 写作进度保存
- QQ 检阅与通过 / 退回重写

#### QQ 可用的小说指令
可在已接入的 QQ 目标中使用：
- `-n 小说列表`
- `-n 查看小说 <项目名>`
- `-n 生成 <项目名> 下一章`
- `-n 查看 <项目名> 第N章摘要`
- `-n 查看 <项目名> 第N章正文`
- `-n 通过 <项目名> 第N章`
- `-n 退回 <项目名> 第N章：意见`

### 8. 脚本型技能执行链路
- 保留 `skill-runner.ps1` 作为脚本型能力执行入口
- `skills/` 目录仍保留历史与本地能力相关内容
- 当前项目重点仍是聊天、QQ、定时任务、工具调用和小说项目主链路

---

## 技术栈与运行方式

### 运行环境
- Windows 10 / 11
- Node.js 20+（本机当前已用 Node.js 22 验证）
- Windows PowerShell 5.1+ 或 PowerShell 7+
- 本地模型服务（默认按 `http://127.0.0.1:1234` 访问，例如 LM Studio）
- 如需 QQ 机器人，还需要本地 OneBot / NapCat 兼容 HTTP 桥

### 零密钥安装说明
本项目默认面向 **本地模型 / 本地服务** 使用，按默认链路启动时：
- **不需要 OpenAI Key**
- **不需要云端 API Key**
- **不需要额外数据库**

只要本机具备以下条件即可直接跑起来：
1. 安装 Node.js
2. `npm install`
3. 准备一个本地 OpenAI 兼容模型接口（默认 `http://127.0.0.1:1234`）
4. 执行 `npm start`

可选组件：
- 需要 QQ 机器人时，再安装 / 启动 NapCat 或其他 OneBot HTTP 桥
- 需要浏览器自动化能力时，再额外安装 Playwright 运行环境

### 首次安装
```powershell
git clone <你的仓库地址>
cd AI-web
npm install
```

### 本地模型准备
推荐直接使用本地 OpenAI 兼容接口，例如：
- LM Studio
- 其他提供 `/v1/chat/completions` 兼容接口的本地模型服务

如果模型地址不是默认值，可在页面配置中修改连接地址。

### 可选：接入远程 OpenAI 兼容 API
项目默认仍以**本地模型**为主；如需临时切换到远程模型，可在“连接配置”中填写：
- 启用远程 API
- 远程接口地址
- 远程聊天路径
- 远程模型列表路径
- 远程 API Key

适用场景：
- DeepSeek
- 其他兼容 `/v1/chat/completions` 与 `/v1/models` 的远程服务

建议使用方式：
- 页面里的“接口地址”继续留空，走当前站点的同源 `/api/*` 代理
- 通过服务端代理转发到远程模型，避免前端直接暴露 Key
- 不启用远程 API 时，系统仍按本地模型配置运行，不影响当前本地工作流

#### DeepSeek 示例
如需接入 DeepSeek，可按下面填写：
- 启用远程 API：`开启`
- 远程接口地址：`https://api.deepseek.com`
- 远程聊天路径：`/v1/chat/completions`
- 远程模型列表路径：`/v1/models`
- 远程 API Key：填写你的 DeepSeek Key

推荐操作顺序：
1. 保持“接口地址”为空
2. 打开“启用远程 API”
3. 填写 DeepSeek 的地址和 Key
4. 点击“读取模型”
5. 选择远程模型

如果后续要切回本地模型，只需要：
1. 关闭“启用远程 API”
2. 重新读取本地模型列表
3. 选择本地模型

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

---

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
- `index.html`：聊天主界面
- `app.js`：聊天页前端逻辑
- `styles.css`：聊天页样式
- `novels.html`：小说项目工坊页面
- `novels.js`：小说项目页逻辑
- `novels.css`：小说项目页样式
- `assets/`：静态资源

### server/
当前已拆分出的主要模块：
- `server-bootstrap.js`：启动与数据初始化
- `server-cleanup.js`：启动清理逻辑
- `server-connection-config.js`：共享连接配置
- `server-http.js`：静态资源服务与 API 代理
- `server-live-web-search.js`：实时联网搜索辅助
- `server-novel-projects.js`：小说项目、设定、章节、QQ 审阅主模块
- `server-personas.js`：人设管理
- `server-qq.js`：QQ 机器人能力
- `server-schedule-intent.js`：定时任务意图识别
- `server-scheduler.js`：定时任务调度
- `server-task-model.js`：任务模型调用
- `server-tool-dispatcher.js`：工具分发
- `server-utils.js`：通用工具函数与原子文件写入

### data/
常见运行数据：
- `data/personas/`：本地人设 Markdown 文件
- `data/connection-config.json`：连接配置
- `data/qq-bot-config.json`：QQ 机器人配置
- `data/qq-bot-sessions.json`：QQ 会话数据
- `data/scheduled-tasks.json`：定时任务数据
- `data/skill-runner-config.json`：skill-runner 配置
- `data/novels/`：小说项目目录

> 说明：`logs/`、`data/temp/`、`data/novels/`、浏览器 profile、个人临时 persona、`.history/` 等均属于本地运行数据或历史文件，不建议提交到 git。

### data/novels/
每本小说会独立保存为一个项目目录，例如：
```text
data/novels/<projectId>/
├─ project.json
├─ state.json
├─ review.json
├─ settings/
├─ chapters/
├─ drafts/
├─ summaries/
├─ snapshots/
└─ logs/
```

### tests/
- `tests/run-tests.js`：项目本地测试入口，覆盖工具、调度、QQ、启动、意图识别，以及小说模块的项目 CRUD、设定生成 / 回填、章节生成 / 重生成 / 删除回退、字数统计与页面交互流程

---

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

---

## 测试

运行：
```powershell
npm test
```

如果修改了服务端模块，建议额外执行：
```powershell
node --check server.js
```

---

## 当前维护说明

### 关于小说项目功能
小说项目模块当前采取 **与聊天功能解耦** 的设计：
- 前端是独立页面 `novels.html`
- 后端是独立路由 `/novels/...`
- QQ 通过额外命令钩子接入小说项目能力
- 不影响原有聊天、工具、定时任务主链路

### 关于 skills
项目历史上存在过更多 Web 端 skills 管理 / 安装相关能力；目前仓库中仍保留 `skills/` 目录和 `skill-runner.ps1` 链路，但主维护重点已经收敛到：
- 本地聊天
- 模型连接配置
- QQ 机器人
- 定时任务
- 工具调用
- 小说项目工坊

### 关于代码状态
当前项目已经完成一轮服务端模块拆分，并新增了小说项目子系统，但仍然存在一些后续优化空间：
- `server.js` 仍偏大
- `public/app.js` 仍较集中
- `server/server-qq.js` 仍是较大的核心模块
- 小说模块目前是单文件主实现，后续还可继续拆细

因此仍适合采用“边维护边拆分”的方式继续迭代，而不是一次性大重构。

---

## 本次说明更新

本次 README 更新重点反映：
- 新增小说项目工坊功能与入口
- 小说项目的数据落盘结构
- 小说项目页面与服务端模块位置
- QQ 小说检阅指令
- 当前项目双主线：聊天工作台 + 小说项目工坊
