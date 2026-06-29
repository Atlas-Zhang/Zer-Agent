# Zer-Agent

Zer-Agent is a terminal-first coding agent for local repository work. It combines an LLM-driven agent loop, built-in coding tools, persistent sessions, search/weather/news utilities, and a compact terminal UI inspired by modern CLI agents.

## Features

- Terminal coding agent with interactive prompt, live slash-command suggestions, and a persistent status line.
- DeepSeek provider by default, plus OpenAI-compatible provider support.
- Built-in tools for files, text search, shell commands, git status/diff, web search, weather, news, and TypeScript symbol navigation.
- Permission controls for risky tools, with ask-by-default behavior for file mutation, shell, and network tools.
- Preview-first file mutation with diffs, snapshots, and `/undo`.
- Persistent sessions with auto-resume by working directory.
- Session commands for list, resume, fork, export, import, delete, compact, clear, and status.
- Plan/build modes. Plan mode keeps the agent read-only for implementation planning.
- Context compaction for long sessions.
- Esc interruption during a running turn. Partial context is saved so you can continue later.
- Direct shell shortcut with `!<command>` inside the chat session.
- Project instructions loaded from `AGENTS.md`.
- Structured JSONL runtime logs under `.zer-agent/logs`, including user input, command/session changes, LLM request/response records, tool events, and token metrics.

## Requirements

- Node.js 22 or newer
- npm
- A DeepSeek API key, or an OpenAI-compatible API key and endpoint

## Setup

Install dependencies:

```powershell
npm install
```

Create local environment config:

```powershell
Copy-Item .env.example .env
```

Set at least one provider credential in `.env`:

```env
ZER_AGENT_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key
ZER_AGENT_MODEL=deepseek-v4-flash
```

For an OpenAI-compatible endpoint:

```env
ZER_AGENT_PROVIDER=openai-compatible
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
ZER_AGENT_MODEL=gpt-4.1-mini
```

Optional search/news tools:

```env
TAVILY_API_KEY=your_tavily_key
GNEWS_API_KEY=your_gnews_key
```

Build the project:

```powershell
npm run build
```

Start Zer-Agent:

```powershell
npm start
```

## Basic Usage

Type a normal request:

```text
Refactor the config loader and run the tests.
```

Run a terminal command directly from the chat session by prefixing it with `!`:

```text
!git status --short
!npm test
```

Type `/` to see live command suggestions. Common commands:

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

During a running task, press `Esc` to interrupt. Zer-Agent saves partial context and you can send a follow-up such as:

```text
continue from where you stopped
```

Use `/clear` to clear the current session context without deleting the session file.

Direct `!` commands run from the current project folder. Zer-Agent applies the same destructive-command guard used by the `run_shell` tool and stores the command output in the current session context.

## Logs

Use `/logs` to print the active log file path. Logs are JSONL records under `.zer-agent/logs`.

Zer-Agent records app startup, every user input, slash commands, session changes, mode/model/provider changes, shell shortcuts, tool events, LLM provider requests and responses, failures, and per-turn token usage. Successful turns also write cumulative session token metrics.

## Modes

- `build`: normal mode. The agent can use all available tools, subject to permission policy.
- `plan`: read-only planning mode. File mutation and shell tools are not exposed to the agent.

Switch modes:

```text
/mode plan
/mode build
```

## Permission Policy

Read and git status tools run automatically. Risky tools are controlled by `ZER_AGENT_PERMISSION_DEFAULT`:

```env
ZER_AGENT_PERMISSION_DEFAULT=ask
```

Supported values:

- `ask`: prompt before risky tools
- `allow`: allow risky tools automatically
- `deny`: block risky tools

## Development

Run checks:

```powershell
npm run build
npm test
```

Install git hooks:

```powershell
npm run install:hooks
```

Package layout:

- `packages/llm-core`: provider abstractions and provider implementations
- `packages/agent-core`: agent loop, tool contracts, and events
- `packages/tui`: terminal rendering and input UI
- `packages/app`: CLI wiring, sessions, config, tools, logs
