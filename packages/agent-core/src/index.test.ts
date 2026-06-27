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
  assert.equal(result.usage.totalTokens, 0);
});

test("runTurn converts tool failures into tool results instead of throwing", async () => {
  let calls = 0;
  const provider: LlmProvider = {
    name: "stub",
    async generate() {
      calls += 1;
      if (calls > 1) {
        return {
          message: { role: "assistant", content: "Recovered." }
        };
      }

      return {
        message: { role: "assistant", content: "" },
        toolCalls: [
          {
            id: "call_1",
            name: "read_file",
            arguments: { path: "missing.txt" }
          }
        ]
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "read the file" }],
    tools: [
      {
        name: "read_file",
        description: "Read file",
        input: {},
        async execute() {
          throw new Error("boom");
        }
      }
    ],
    maxIterations: 2
  });

  assert.equal(result.messages.at(-1)?.content, "Recovered.");
  assert.match(result.messages.at(-2)?.content ?? "", /Tool read_file failed: boom/);
});

test("runTurn can continue after unknown tool requests when configured", async () => {
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
              name: "missing_tool",
              arguments: {}
            }
          ]
        };
      }

      return {
        message: { role: "assistant", content: "Fallback answer." }
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "do the thing" }],
    tools: [],
    maxIterations: 2,
    continueOnUnknownTool: true
  });

  assert.equal(result.messages.at(-1)?.content, "Fallback answer.");
  assert.match(result.messages.at(-2)?.content ?? "", /unavailable in this session/);
});

test("runTurn makes a final no-tool attempt after iteration exhaustion", async () => {
  let calls = 0;
  const provider: LlmProvider = {
    name: "stub",
    async generate(options) {
      calls += 1;
      if (calls <= 2) {
        return {
          message: { role: "assistant", content: "" },
          toolCalls: [
            {
              id: `call_${calls}`,
              name: "read_file",
              arguments: { path: `file-${calls}.txt` }
            }
          ]
        };
      }

      assert.equal(options.tools, undefined);
      assert.match(options.systemPrompt ?? "", /Do not call any more tools/);
      return {
        message: { role: "assistant", content: "Best effort final answer." }
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "do the thing" }],
    tools: [
      {
        name: "read_file",
        description: "Read file",
        input: {},
        async execute(args) {
          return { content: `read ${String(args.path)}` };
        }
      }
    ],
    maxIterations: 2
  });

  assert.equal(result.messages.at(-1)?.content, "Best effort final answer.");
});

test("runTurn strips tool calls from the final recovery attempt", async () => {
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
              arguments: { path: "a.txt" }
            }
          ]
        };
      }

      return {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_2",
              name: "read_file",
              arguments: { path: "b.txt" }
            }
          ]
        },
        toolCalls: [
          {
            id: "call_2",
            name: "read_file",
            arguments: { path: "b.txt" }
          }
        ]
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "do the thing" }],
    tools: [
      {
        name: "read_file",
        description: "Read file",
        input: {},
        async execute() {
          return { content: "read a" };
        }
      }
    ],
    maxIterations: 1
  });

  assert.equal(result.messages.at(-1)?.toolCalls, undefined);
  assert.match(result.messages.at(-1)?.content ?? "", /best answer available so far/i);
});
