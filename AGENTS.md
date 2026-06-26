# Zer-Agent Operating Contract

## Purpose
- Build a terminal-first coding agent inspired by Pi, with DeepSeek required in the MVP.
- Preserve a clear package split between provider runtime, agent runtime, TUI, and app shell.

## Package Boundaries
- `packages/llm-core`: provider abstractions and provider implementations.
- `packages/agent-core`: agent loop, tool contracts, event model, and session-neutral orchestration.
- `packages/tui`: terminal rendering and user interaction shell.
- `packages/app`: CLI wiring, session persistence, project config, built-in tools.

## Implementation Rules
- Prefer small, auditable edits over large rewrites.
- Keep tool contracts typed and validated at the package boundary.
- Default to ASCII in source files.
- Do not use `git add .` or `git add -A`; stage explicit paths only.

## Checkpoint Hook Requirement
- After every code mutation batch, run explicit Git persistence commands before doing more implementation work.
- Required sequence:
  1. `git add <explicit paths>`
  2. `git commit -m "<focused message>"`
- Every commit must represent one coherent implementation step.
- If the worktree is dirty from a previous step, checkpoint it before starting the next step.
- Install repository hooks with `npm run install:hooks`.

## Validation
- Run `npm run build` after structural TypeScript changes.
- Run `npm test` for behavior changes once the build succeeds.
- After each feature implementation, verify the feature directly with at least one focused functional check in addition to build/test success.
- Do not consider a feature complete until its user-visible behavior has been exercised and confirmed.

## Runtime Configuration
- Keep non-secret defaults documented in `.env`.
- Put machine- or developer-specific overrides in `.env.local`.
- Required secret for hosted inference: `DEEPSEEK_API_KEY`.
- Optional search/news secrets:
  - `TAVILY_API_KEY` enables `web_search`
  - `GNEWS_API_KEY` enables `news_search`
- `weather` uses Open-Meteo and does not require an API key for evaluation.
