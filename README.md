# 文远的智能聊天实验室

一个面向本地模型的轻量工作台，提供：

- Web 聊天
- 会话历史与恢复
- 人设与技能管理
- QQ 推送与 QQ 机器人
- 定时任务
- 工作区文件与工具调用
- 脚本型技能执行器

界面为亮色简洁风格，主页面聚焦聊天，配置集中在右上角“设置”面板中。

## 启动

### 方式一：推荐

直接运行：

```powershell
scripts\start-local-ai-chat.bat
```

或双击：

- `scripts/start-local-ai-chat.bat`
- `scripts/start-local-ai-chat.vbs`

这两个入口都会同时启动：

- `server.js`
- `scripts/skill-runner.ps1`

默认地址：

`http://127.0.0.1:8000`

### 方式二：手动启动

```powershell
node server.js
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/skill-runner.ps1
```

说明：

- 普通聊天只依赖 `server.js`
- 脚本型技能需要 `skill-runner.ps1`

## 环境要求

- Node.js
- 本地模型服务，默认代理目标：`http://127.0.0.1:1234`
- Windows PowerShell

项目依赖：

- `playwright`

安装依赖：

```powershell
npm install
```

## 常用命令

```powershell
npm start
npm run skill-runner
npm test
```

## 目录结构

```text
AI-web/
├─ public/                 前端页面与样式
├─ server/                 服务端模块
├─ scripts/                启动脚本与技能执行器
├─ data/                   运行数据
├─ skills/                 工作区技能
├─ logs/                   运行日志
├─ tests/                  本地验证脚本
├─ server.js               服务启动入口
├─ package.json
└─ README.md
```

### `data/` 说明

主要运行数据位于：

- `data/personas/`：本地人设模板
- `data/scheduled-tasks.json`：定时任务
- `data/qq-bot-config.json`：QQ 配置
- `data/qq-bot-sessions.json`：QQ 会话
- `data/skill-runner-config.json`：技能执行器配置

如果根目录下还存在旧版 JSON，服务启动时会自动迁移到 `data/`。

## 当前主要能力

### 1. 聊天与会话

- 左侧显示聊天记录，主区域专注聊天
- 支持新建、删除、清空、重命名会话
- 会话自动保存并可恢复
- 刷新浏览器后恢复当前会话
- 对话区顶部显示当前模型、人设、技能
- AI 回复支持打字效果
- 头像与气泡顶部对齐

### 2. 模型连接

- 通过同源代理访问本地模型服务
- 默认聊天接口：`/api/v1/chat/completions`
- 默认模型列表接口：`/api/v1/models`
- 支持按模型分别保存上下文上限
- 顶部显示上下文、Prompt、Total、速率等指标

### 3. 人设

- 支持内置模板和本地模板
- 本地模板保存为 `.md` 文件到 `data/personas/`
- 支持保存模板、删除本地模板
- 刷新后会恢复已选模板
- Web 聊天人设与 QQ 人设相互独立

### 4. 技能

- 读取工作区技能与 Codex 技能
- 技能读取以 `SKILL.md` 为主
- 支持同时启用多个技能
- 支持单个移除启用与整体清空
- 技能上下文已做轻量化：
  - 常驻摘要
  - 重点技能节选
  - 不再把所有完整 `SKILL.md` 每轮都塞进上下文
- 支持上传 ZIP 安装技能
- 支持通过下载链接安装 ZIP 技能
- 安装后自动刷新技能列表

### 5. 脚本型技能

- 支持 `run_workspace_skill`
- 通过 `skill-runner.ps1` 轮询并执行任务
- 适合 `run-with-notify.js` 这类本地自动化技能
- 运行日志见 `logs/skill-runner.log`

说明：

- 脚本型技能是否能真正执行，取决于当前 Windows 用户会话权限
- 浏览器自动化类技能通常需要在正常桌面用户会话下运行

### 6. QQ 推送与 QQ 机器人

- 支持 OneBot / NapCat HTTP 桥接
- 设置面板中直接显示当前 `Webhook` 地址
- 支持公共配置与对象配置分层
- 对象键按 `private:QQ号` / `group:群号` 保存
- 每个 QQ / 群号都可以有独立配置：
  - 模型
  - QQ 人设模板
  - 专属人设
  - QQ 专属技能
  - 权限规则
  - 文件共享目录
  - 工具权限
- QQ 子模块支持展开/收起，并记住状态

### 7. QQ 工具权限

QQ 机器人支持单独的工具权限控制，分为：

- 公共工具权限
- 对象专属工具权限

当前可控范围包括：

- 读取目录与文件
- 写入 / 删除文件
- 执行命令
- 执行脚本型技能
- 向 QQ 发送白名单目录文件

默认策略更保守：

- 读默认较宽
- 写、命令、脚本执行默认关闭

### 8. QQ 文件发送

支持将白名单目录中的文件发送到 QQ：

- 私聊：发送给指定 QQ
- 群聊：发送到指定群

当前支持两层目录白名单：

- 公共 `QQ 文件共享目录`
- 对象专属 `QQ 文件共享目录`

目录要求：

- 必须在当前工作区内
- 不允许路径穿透

### 9. 定时任务

- 创建、编辑、删除、启停、立即执行
- 使用 Cron 表达式
- 定时结果可推送到当前聊天会话
- 也可按 QQ 配置自动推送到 QQ

### 10. 工具调用

Web 聊天当前支持的真实工具包括：

- `list_dir`
- `read_file`
- `write_file`
- `delete_file`
- `get_weather`
- `search_clawhub_skills`
- `install_clawhub_skill`
- `run_workspace_skill`
- `run_shell_command`
- `run_cli_command`
- `send_qq_message`
- `send_qq_file`
- 定时任务相关工具

命令调用带有审计日志：

- `logs/command-audit.log`

## 服务端模块

当前服务端已拆分为：

- `server/server-utils.js`：通用工具
- `server/server-tool-dispatcher.js`：工具分发
- `server/server-scheduler.js`：定时任务
- `server/server-task-model.js`：任务模型调用
- `server/server-qq.js`：QQ 相关能力
- `server/server-personas.js`：人设模板

## 日志

常见日志文件：

- `logs/server.log`：启动日志
- `logs/server-debug.log`：调试日志
- `logs/skill-runner.log`：技能执行器日志
- `logs/command-audit.log`：命令执行审计日志

## 测试

运行：

```powershell
npm test
```

## 使用建议

### 修改前端后

改动以下文件后，一般不需要重启服务，只需要强刷浏览器：

- `public/index.html`
- `public/styles.css`
- `public/app.js`

推荐：

```text
Ctrl + F5
```

### 修改服务端后

改动以下文件后，需要重启 `node server.js`：

- `server.js`
- `server/*.js`

如果涉及脚本型技能执行链，建议同时重启：

- `scripts/skill-runner.ps1`

### QQ 不回复时优先检查

- `Webhook` 是否配置到：`http://127.0.0.1:8000/qq/webhook`
- `server.js` 是否已重启
- 当前对象是否配置了模型
- 当前对象是否开启了对应工具权限
- 群聊时如果开启了“仅 @ 机器人回复”，是否真的有 `@`

### 脚本型技能不工作时优先检查

- `skill-runner.ps1` 是否在运行
- `logs/skill-runner.log` 是否有任务记录
- 当前运行身份是否为正常桌面用户
- Playwright / 浏览器运行时是否可用

## 当前约束

- 默认依赖本地模型服务运行在 `http://127.0.0.1:1234`
- 某些功能的生效依赖浏览器强刷或服务重启
- 脚本型技能和浏览器自动化能力受本机权限环境影响较大

## 备注

这个项目现在的定位已经不是单纯聊天页，而是一个本地 AI 工作台：

- 主页面专注聊天
- 配置集中到设置面板
- Web 聊天、QQ 机器人、定时任务、脚本技能都可以在一个工作区内协同运行
