# 文远的智能实验室（AI-web）

一个面向本地模型的 Node.js Web 工作台，当前包含两条主线功能：
- 聊天工作台
- 小说项目工坊

默认访问地址：
- Web：`http://127.0.0.1:8000`
- 本地模型接口：`http://127.0.0.1:1234`
- QQ Webhook：`http://127.0.0.1:8000/qq/webhook`

## 功能概览

### 1. 聊天工作台
- 本地聊天界面
- 会话历史管理
- 文件上传
- 头像与背景图配置
- HTML 代码块预览
- 上下文 / Prompt / 速率等运行指标展示
- 同源 `/api/*` 代理访问模型接口

### 2. 模型连接配置
- 配置接口地址、聊天路径、上下文上限
- 测试连接
- 读取模型列表
- 切换当前模型
- 切换本地模型或远程 OpenAI 兼容接口

### 3. Persona / 人设管理
- 读取 `data/personas/` 下的 Markdown 人设
- 保存、编辑、删除人设
- 在聊天配置与 QQ 配置中应用人设

### 4. 定时任务
- 创建、编辑、删除、立即执行任务
- 支持 cron 表达式
- 保存任务结果
- 推送任务结果到 QQ

### 5. QQ 机器人
- QQ webhook 接入
- 私聊 / 群聊对象配置
- 默认推送目标配置
- 模型、人设、工具权限配置
- QQ 侧直接触发部分管理操作

### 6. 工具调用
当前后端工具分发器支持：
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

### 7. 小说项目工坊
入口：
- 聊天页右上角“小说项目”
- `http://127.0.0.1:8000/novels.html`

当前支持：
- 小说项目 CRUD
- 多本小说独立目录保存
- 题材 / 主题 / 梗概 / 主角等基础信息生成设定
- 每章目标字数配置
- 设定 Markdown 保存
- 设定项单独生成与整体生成
- 根据已写正文整理设定
- 素材库管理（人物对话、心理描写、环境描写、修真素材、能力等级、自定义）
- 素材库 AI 整理与生成
- 生成下一章草稿（自动挂载素材库内容）
- 手写章节 AI 润色（保留剧情骨架，增强表现力）
- 阅读器中查看章节正文、字数与上下章切换
- 重生成当前待审草稿
- 删除指定章节并回退写作进度
- 批量连续写作
- 章节摘要与状态快照
- 中文字符数统计
- 草稿章节与正式章节分离存储
- QQ 检阅与通过 / 退回重写

#### QQ 可用小说指令
- `-n 小说列表`
- `-n 查看小说 <项目名>`
- `-n 生成 <项目名> 下一章`
- `-n 查看 <项目名> 第N章摘要`
- `-n 查看 <项目名> 第N章正文`
- `-n 通过 <项目名> 第N章`
- `-n 退回 <项目名> 第N章：意见`

## 运行环境

- Windows 10 / 11
- Node.js 20+
- Windows PowerShell 5.1+ 或 PowerShell 7+
- 本地 OpenAI 兼容模型接口
- QQ 机器人场景下的 OneBot / NapCat HTTP 桥

## 安装与启动

### 安装
```powershell
git clone <你的仓库地址>
cd AI-web
npm install
```

### 启动
```powershell
npm start
```

或直接执行：
```powershell
node server.js
```

也可使用脚本：
```powershell
scripts\start-local-ai-chat.bat
```

## 远程 OpenAI 兼容接口

页面连接配置中可填写：
- 启用远程 API
- 远程接口地址
- 远程聊天路径
- 远程模型列表路径
- 远程 API Key

可接入：
- DeepSeek
- 其他兼容 `/v1/chat/completions` 与 `/v1/models` 的服务

## 项目结构

```text
AI-web/
├─ public/                    前端页面与静态资源
├─ server/                    服务端模块
├─ scripts/                   启动脚本
├─ data/                      运行数据与配置
├─ logs/                      日志
├─ tests/                     本地测试
├─ docs/                      项目文档
├─ server.js                  主入口
├─ package.json               NPM 配置
└─ README.md
```

### public/
- `index.html`：聊天主界面
- `app.js`：聊天页前端逻辑
- `styles.css`：聊天页样式
- `novels.html`：小说项目页
- `novels.js`：小说项目页逻辑
- `novels.css`：小说项目页样式
- `assets/`：静态资源

### server/
- `server-bootstrap.js`：启动与数据初始化
- `server-cleanup.js`：启动清理
- `server-connection-config.js`：共享连接配置
- `server-http.js`：静态资源服务与 API 代理
- `server-live-web-search.js`：实时联网搜索
- `server-mysql-storage.js`：MySQL 持久化存储、任务队列与作业 Worker
- `server-novel-projects.js`：小说项目、设定、素材库、章节、润色、QQ 审阅
- `server-personas.js`：人设管理
- `server-qq.js`：QQ 机器人能力
- `server-schedule-intent.js`：定时任务意图识别
- `server-scheduler.js`：定时任务调度
- `server-task-model.js`：任务模型调用
- `server-tool-dispatcher.js`：工具分发
- `server-utils.js`：通用工具函数与原子文件写入

## 数据目录

### data/
- `data/personas/`：本地人设 Markdown
- `data/connection-config.json`：连接配置
- `data/qq-bot-config.json`：QQ 机器人配置
- `data/qq-bot-sessions.json`：QQ 会话数据
- `data/scheduled-tasks.json`：定时任务数据
- `data/novels/`：小说项目目录

### data/novels/
```text
data/novels/<projectId>/
├─ project.json
├─ state.json
├─ review.json
├─ settings/
├─ materials/
├─ chapters/
├─ drafts/
├─ summaries/
├─ snapshots/
└─ logs/
```

## 测试

运行：
```powershell
npm test
```

语法检查：
```powershell
node --check server.js
```
