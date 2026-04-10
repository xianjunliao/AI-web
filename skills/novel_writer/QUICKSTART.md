# novel_writer 快速上手

这份文档帮助你在几分钟内用 AI 智能体开始使用 `novel_writer` skill。

## 这个 skill 能做什么

`novel_writer` 适合处理以下任务：

- 生成世界观设定
- 生成人物设定
- 生成故事总纲和章节大纲
- 写小说正文
- 续写下一章
- 润色已有文本
- 检查人物、时间线和设定的连贯性
- 保存章节到本地 Markdown
- 更新章节索引和小说记忆

## 最简单的触发方式

直接在提示词开头写：

```text
请使用 novel_writer skill
```

这样 AI 智能体更容易稳定调用这个 skill。

## 最常用的 3 种用法

### 1. 只做设定

```text
请使用 novel_writer skill 帮我做小说设定。

任务类型：世界观设定 + 人物设定 + 故事总纲
项目名：my_novel
题材：赛博朋克悬疑
我的想法：城市由 AI 深度治理，主角在调查家人旧案时发现官方记忆被篡改
输出要求：直接输出结果
```

### 2. 写一章正文并保存到本地

```text
请使用 novel_writer skill 写第 1 章，并保存到本地。

任务类型：写正文
项目名：my_novel
题材：近未来都市悬疑
章节编号：01
章节标题：雨夜缺口
章节目标：主角第一次拿到异常证据
字数要求：2500 字
输出要求：请严格按 novel_writer skill 的 JSON 结构输出，不要附加说明
是否保存到本地：是
```

### 3. 只细化章节详细大纲

```text
请使用 novel_writer skill 在现有项目基础上完善章节详细大纲。

任务类型：章节大纲
项目名：my_novel
已有设定：直接读取当前项目里的世界观、人物设定、总纲、分卷规划和写作记忆
本次任务范围：细化第一卷详细大纲
要求：只补充和细化章节大纲，不要重写世界观、人物设定、总纲、分卷规划和既定名字
输出要求：直接输出结果
```

## 想保存到本地时要注意

本 skill 里的写作模板默认按“保存到本地”设计。为了稳定触发落盘，最好在提示词里明确写这两句：

```text
请严格按 novel_writer skill 的 JSON 结构输出
是否保存到本地：是
```

原因是这个 skill 的保存脚本依赖这些字段：

- `filename`
- `title`
- `summary`
- `content`
- `memory_update`

其中：

- `title` 负责章节标题与索引展示
- `content` 只放正文内容本体，不要再把 `# 第1章...` 这样的标题写进去

## 推荐你每次至少提供这些信息

- 项目名
- 题材
- 当前任务类型
- 如果是写正文：章节编号、章节标题、章节目标
- 如果是续写：前文摘要
- 如果是保存：明确要求 JSON 输出和本地保存

## 不知道怎么写提示词时

直接打开这个文件：

- [PROMPT_TEMPLATE.md](c:/Users/Admin/.openclaw/writing/skills/novel_writer/PROMPT_TEMPLATE.md)

里面已经准备好了更短、更适合日常使用的模板。

如果你要写 10 万字以上长篇，请再看：

- [LONG_NOVEL_TEMPLATE.md](c:/Users/Admin/.openclaw/writing/skills/novel_writer/LONG_NOVEL_TEMPLATE.md)

## 这个 skill 目录里最重要的文件

- [SKILL.md](c:/Users/Admin/.openclaw/writing/skills/novel_writer/SKILL.md)
  这是 skill 的主说明和工作流

- [PROMPT_TEMPLATE.md](c:/Users/Admin/.openclaw/writing/skills/novel_writer/PROMPT_TEMPLATE.md)
  这是你平时直接复制的高频模板集合，包含超短版和标准版

- [LONG_NOVEL_TEMPLATE.md](c:/Users/Admin/.openclaw/writing/skills/novel_writer/LONG_NOVEL_TEMPLATE.md)
  这是长篇小说的分阶段模板

- [scripts/save_novel.py](c:/Users/Admin/.openclaw/writing/skills/novel_writer/scripts/save_novel.py)
  这是负责保存章节、生成索引、更新记忆的脚本

- [memory/novel_memory.md](c:/Users/Admin/.openclaw/writing/skills/novel_writer/memory/novel_memory.md)
  这是小说记忆模板

## 一句话记忆版

想让它稳定工作，就记住这句：

```text
请使用 novel_writer skill + 说清任务类型 + 说清章节信息 + 写作时默认保存到本地并要求 JSON 输出
```
