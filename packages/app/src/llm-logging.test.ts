import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LlmProvider } from "@zer-agent/llm-core";
import { AppLogger } from "./logger.js";
import { createLoggedProvider } from "./llm-logging.js";

test("createLoggedProvider logs request and response records", async () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-llm-log-"));
  try {
    const logger = new AppLogger(root);
    const provider: LlmProvider = {
      name: "stub",
      async generate() {
        return {
          message: { role: "assistant", content: "done" },
          usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
          finishReason: "stop"
        };
      }
    };
    const logged = createLoggedProvider(provider, logger, () => ({
      sessionId: "session_1",
      providerId: "stub",
      cwd: "D:/repo"
    }));

    await logged.generate({
      model: "model",
      systemPrompt: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "read_file", description: "Read", input: {} }]
    });

    await logger.flush();
    const lines = readFileSync(logger.getCurrentLogPath(), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(lines[0]?.event, "llm.request");
    assert.equal(lines[0]?.lastUserInput, "hello");
    assert.equal(lines[1]?.event, "llm.response");
    assert.deepEqual(lines[1]?.usage, { inputTokens: 3, outputTokens: 4, totalTokens: 7 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
