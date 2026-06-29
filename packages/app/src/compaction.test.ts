import assert from "node:assert/strict";
import test from "node:test";
import type { LlmProvider } from "@zer-agent/llm-core";
import { compactSessionIfNeeded, formatSessionSummaries } from "./compaction.js";
import type { AppConfig } from "./config.js";
import { SessionStore } from "./session-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("compactSessionIfNeeded summarizes older messages and keeps recent messages", async () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-compact-"));
  try {
    const store = new SessionStore(root);
    const session = store.create("model", process.cwd());
    for (let index = 0; index < 25; index += 1) {
      session.messages.push({ role: "user", content: `message ${index}` });
    }
    const provider: LlmProvider = {
      name: "stub",
      async generate() {
        return { message: { role: "assistant", content: "Older history summary." } };
      }
    };
    const config: AppConfig = {
      provider: "deepseek",
      model: "model",
      models: [{ id: "model", provider: "deepseek" }],
      sessionDir: root,
      logDir: root,
      maxIterations: 8,
      compactMaxMessages: 10,
      compactMaxChars: 100000,
      permissionDefault: "ask",
      systemPrompt: "prompt",
      deepSeekBaseUrl: "https://api.deepseek.com",
      openAIBaseUrl: "https://api.openai.com/v1",
      shellContext: "shell",
      searchProvider: "tavily",
      newsProvider: "gnews"
    };

    const result = await compactSessionIfNeeded(session, provider, "model", config);

    assert.equal(result.compacted, true);
    assert.equal(session.messages.length, 20);
    assert.equal(session.summaries[0]?.content, "Older history summary.");
    assert.match(formatSessionSummaries(session), /Older history summary/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
