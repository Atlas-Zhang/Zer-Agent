# Zer-Agent

Zer-Agent 是一个面向终端的本地代码仓库 Agent。它提供 LLM 驱动的工具调用循环、内置代码工具、持久化会话、搜索/天气/新闻工具，以及接近现代 CLI Agent 的终端交互体验。

## 功能

- 终端代码 Agent，支持交互式输入、实时斜杠命令提示、常驻状态栏。
- 默认支持 DeepSeek，同时支持 OpenAI-compatible 接口。
- 内置文件、文本搜索、Shell、Git 状态/差异、网页搜索、天气、新闻、TypeScript 符号导航工具。
- 风险工具权限控制，默认对文件修改、Shell、网络工具进行确认。
- 文件修改先预览 diff，再执行；支持快照和 `/undo`。
- 持久化会话，并按当前工作目录自动恢复最近会话。
- 支持会话列表、恢复、分叉、导出、导入、删除、压缩、清空、查看状态。
- 支持 plan/build 两种模式。plan 模式用于只读规划。
- 长上下文会话支持压缩总结。
- 任务运行中可按 `Esc` 中断；会保存部分上下文，之后可以继续。
- 自动加载项目中的 `AGENTS.md` 指令。
- 运行日志默认写入 `.zer-agent/logs`。

## 环境要求

- Node.js 22 或更高版本
- npm
- DeepSeek API Key，或者 OpenAI-compatible API Key 和接口地址

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

输入 `/` 会实时显示命令提示。常用命令：

```text
/help
/session
/sessions
/resume <session-id>
/new
/model <model-name>
/provider deepseek
/provider openai-compatible
/mode plan
/mode build
/tools
/permissions
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

## 模式

- `build`：默认模式。Agent 可以使用全部可用工具，但会受到权限策略限制。
- `plan`：只读规划模式。不会向 Agent 暴露文件修改和 Shell 工具。

切换模式：

```text
/mode plan
/mode build
```

## 权限策略

读取类和 Git 状态类工具会自动执行。风险工具由 `ZER_AGENT_PERMISSION_DEFAULT` 控制：

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
