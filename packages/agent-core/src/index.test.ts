import assert from "node:assert/strict";
import test from "node:test";
import type { LlmProvider } from "@zer-agent/llm-core";
import { runTurn } from "./index.js";

test("runTurn executes requested tool calls and appends tool results", async () => {
  let calls = 0;
  const provider: LlmProvider = {
    name: "stub",
    async generate() {
      calls += 1;
      if (calls === 1) {
        return {
          message: { role: "assistant", content: "" },
          toolCalls: [
            {
              id: "call_1",
              name: "read_file",
              arguments: { path: "README.md" }
            }
          ]
        };
      }

      return {
        message: { role: "assistant", content: "Done." }
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "read the readme" }],
    tools: [
      {
        name: "read_file",
        description: "Read file",
        input: {},
        async execute(args) {
          return { content: `read ${String(args.path)}` };
        }
      }
    ]
  });

  assert.equal(result.messages.at(-1)?.content, "Done.");
  assert.equal(result.messages.at(-2)?.role, "tool");
});
