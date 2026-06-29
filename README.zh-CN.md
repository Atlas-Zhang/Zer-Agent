# Zer-Agent

Zer-Agent 是一个面向终端的本地代码仓库 Agent。它提供 LLM 驱动的工具调用循环、内置代码工具、持久化会话、搜索/天气/新闻工具，以及接近现代 CLI Agent 的终端交互体验。

## 功能

- 终端代码 Agent，支持交互式输入、实时斜杠命令提示、常驻状态栏。
- 默认支持 DeepSeek，同时支持 OpenAI-compatible 接口。
- 内置文件、文本搜索、Shell、Git 状态/差异、网页搜索、天气、新闻、TypeScript 符号导航工具。
- 支持在会话中直接使用 `!<command>` 运行终端命令。
- 风险工具权限控制，默认对文件修改、Shell、网络工具进行确认。
- 文件修改先预览 diff，再执行；支持快照和 `/undo`。
- 持久化会话，并按当前工作目录自动恢复最近会话。
- 支持会话列表、恢复、分叉、导出、导入、删除、压缩、清空、查看状态。
- 支持 `.zer-agent/commands` 自定义项目命令，以及 `.zer-agent/agents` 可切换 Agent Profile。
- 支持 `/models` 查看模型目录。
- 支持 plan/build 两种模式。plan 模式用于只读规划。
- 长上下文会话支持压缩总结。
- 任务运行中可按 `Esc` 中断；会保存部分上下文，之后可以继续。
- 自动加载项目中的 `AGENTS.md` 指令。
- 结构化 JSONL 运行日志默认写入 `.zer-agent/logs`，覆盖用户输入、命令/会话变更、LLM 请求/响应、工具事件和 token 指标。

## 环境要求

- Node.js 22 或更高版本
- npm
- DeepSeek API Key，或 OpenAI-compatible API Key 和接口地址

## 安装与启动

安装依赖：

```powershell
npm install
```

创建本地环境配置：

```powershell
Copy-Item .env.example .env
```

在 `.env` 中至少配置一个模型服务：

```env
ZER_AGENT_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key
ZER_AGENT_MODEL=deepseek-v4-flash
```

如果使用 OpenAI-compatible 接口：

```env
ZER_AGENT_PROVIDER=openai-compatible
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
ZER_AGENT_MODEL=gpt-4.1-mini
```

可选搜索和新闻工具：

```env
TAVILY_API_KEY=your_tavily_key
GNEWS_API_KEY=your_gnews_key
```

构建项目：

```powershell
npm run build
```

启动 Zer-Agent：

```powershell
npm start
```

## 基本使用

直接输入自然语言请求：

```text
重构配置加载逻辑，并运行测试。
```

在会话中直接运行终端命令，在输入前加 `!`：

```text
!git status --short
!npm test
```

输入 `/` 会实时显示命令提示。常用命令：

```text
/help
/session
/sessions
/resume <session-id>
/new
/model <model-name>
/models
/provider deepseek
/provider openai-compatible
/agent [name]
/run <custom-command> [input]
/diff
/review
/mode plan
/mode build
/tools
/permissions [ask|allow|deny]
/compact
/clear
/undo
/logs
/verbose
/quit
```

任务运行时按 `Esc` 可中断。Zer-Agent 会保存部分上下文，之后可以继续输入：

```text
从刚才停止的位置继续
```

使用 `/clear` 可以清空当前会话上下文，但不会删除会话文件。

`!` 命令会在当前项目目录中执行。Zer-Agent 会使用与 `run_shell` 工具相同的高风险命令阻断规则，并将命令输出保存到当前会话上下文。

## 自定义能力

可以在 `.zer-agent/commands` 下添加 Markdown 文件作为自定义 Prompt 命令。例如 `.zer-agent/commands/fix.md` 会注册为 `/fix <input>` 和 `/run fix <input>`。模板中可以使用 `{input}`、`{cwd}`、`{session}`。

可以在 `.zer-agent/agents` 下添加项目 Agent Profile。使用 `/agent` 查看可用 Profile，使用 `/agent <name>` 切换。内置 Profile 包括 `build`、`plan`、`review`、`debug`、`test`、`docs`。

使用 `/models` 查看已配置模型。可以在 `.zer-agent/config.json` 中通过 `models` 数组添加模型，例如 `{ "id": "...", "provider": "deepseek" }` 或 `{ "id": "...", "provider": "openai-compatible" }`。

使用 `/diff` 查看当前工作区 diff，使用 `/review` 让当前模型审查该 diff。

## 日志

使用 `/logs` 可以查看当前日志文件路径。日志是 JSONL 格式，默认位于 `.zer-agent/logs`。

Zer-Agent 会记录应用启动、每次用户输入、斜杠命令、会话变更、模式/模型/provider 变更、Shell 快捷命令、工具事件、LLM provider 请求与响应、失败信息，以及每轮 token 用量。成功的对话轮次还会记录累计的会话 token 指标。

日志写入会先进入队列，再异步刷盘，避免审计日志阻塞主 Agent 循环。Zer-Agent 在正常退出时会 flush 尚未写入的日志记录。

## 模式

- `build`：默认模式。Agent 可以使用全部可用工具，但会受到权限策略限制。
- `plan`：只读规划模式。不会向 Agent 暴露文件修改和 Shell 工具。

切换模式：

```text
/mode plan
/mode build
```

## 权限策略

读取类和 Git 状态类工具会自动执行。风险工具使用当前会话的默认权限。可以在聊天会话中直接切换：

```text
/permissions ask
/permissions allow
/permissions deny
```

不带参数时，`/permissions` 会显示当前会话默认值和配置默认值。配置默认值来自 `ZER_AGENT_PERMISSION_DEFAULT`：

```env
ZER_AGENT_PERMISSION_DEFAULT=ask
```

支持的值：

- `ask`：执行风险工具前询问
- `allow`：自动允许风险工具
- `deny`：阻止风险工具

## 开发

运行检查：

```powershell
npm run build
npm test
```

安装 Git hooks：

```powershell
npm run install:hooks
```

包结构：

- `packages/llm-core`：Provider 抽象和实现
- `packages/agent-core`：Agent 循环、工具契约和事件
- `packages/tui`：终端渲染和输入 UI
- `packages/app`：CLI 组装、会话、配置、工具、日志
