# 当前项目结构说明

## 项目定位

当前项目是一个本地模型 Web 工作台，包含两条主要功能线：
- 聊天工作台
- 小说项目工坊

配套能力包括：
- 模型连接配置
- Persona / 人设管理
- QQ 机器人接入
- 定时任务
- 工具调用

## 页面与入口

### 聊天工作台
- 页面：`public/index.html`
- 前端逻辑：`public/app.js`
- 页面样式：`public/styles.css`

主要能力：
- 对话与会话历史
- 文件上传
- HTML 预览
- 模型选择
- 人设配置
- QQ 配置
- 定时任务配置

### 小说项目工坊
- 页面：`public/novels.html`
- 前端逻辑：`public/novels.js`
- 页面样式：`public/novels.css`

主要能力：
- 小说项目管理
- 设定生成与整理
- 章节写作与阅读
- 草稿审核
- QQ 审阅指令

## 服务端模块

### 主入口
- `server.js`

负责：
- 启动 HTTP 服务
- 挂载页面与接口
- 组合各服务端模块

### 已拆分模块

- `server/server-bootstrap.js`
  - 启动流程与数据初始化

- `server/server-cleanup.js`
  - 启动时清理日志、临时目录、失效 pid 文件

- `server/server-connection-config.js`
  - 共享连接配置读写

- `server/server-http.js`
  - 静态资源服务
  - `/api/*` 模型代理

- `server/server-live-web-search.js`
  - 实时联网搜索

- `server/server-personas.js`
  - 人设读取、保存、删除

- `server/server-scheduler.js`
  - 定时任务调度与执行

- `server/server-schedule-intent.js`
  - 定时任务意图识别

- `server/server-task-model.js`
  - 任务模型调用

- `server/server-tool-dispatcher.js`
  - 工具分发与执行

- `server/server-qq.js`
  - QQ webhook
  - QQ 对象配置
  - QQ 回复与任务推送

- `server/server-novel-projects.js`
  - 小说项目
  - 设定生成
  - 章节与草稿
  - 审阅与状态管理

- `server/server-utils.js`
  - 通用工具函数
  - 原子文件写入
  - 路径与文件辅助能力

## 工具能力

当前工具分发器支持：
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

## 运行数据

### 主要配置文件
- `data/connection-config.json`
- `data/qq-bot-config.json`
- `data/qq-bot-sessions.json`
- `data/scheduled-tasks.json`

### 人设目录
- `data/personas/`

### 小说项目目录
- `data/novels/`

结构示例：
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

## 测试入口

- `tests/run-tests.js`

覆盖范围包括：
- 工具调用
- 路径与文件安全
- 启动流程
- 代理能力
- QQ 模块
- 定时任务
- 小说项目模块
