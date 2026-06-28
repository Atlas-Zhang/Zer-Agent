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

test("runTurn records authorization denial as a tool result", async () => {
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
              name: "write_file",
              arguments: { path: "a.txt", content: "x" }
            }
          ]
        };
      }

      return {
        message: { role: "assistant", content: "I could not write the file." }
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "write a file" }],
    tools: [
      {
        name: "write_file",
        description: "Write file",
        input: {},
        permissionCategory: "write",
        mutatesFileSystem: true,
        async execute() {
          return { content: "wrote" };
        }
      }
    ],
    authorizeToolCall: async () => ({ content: "Permission denied.", isError: true }),
    maxIterations: 2
  });

  assert.match(result.messages.at(-2)?.content ?? "", /Permission denied/);
  assert.equal(result.messages.at(-1)?.content, "I could not write the file.");
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
  assert.match(result.messages.at(-1)?.content ?? "", /best answer from the information/i);
  assert.match(result.messages.at(-1)?.content ?? "", /read a/i);
});

test("runTurn asks recovery responses to answer without tools", async () => {
  let calls = 0;
  const provider: LlmProvider = {
    name: "stub",
    async generate(options) {
      calls += 1;
      if (calls === 1) {
        return {
          message: { role: "assistant", content: "" },
          toolCalls: [
            {
              id: "call_1",
              name: "web_search",
              arguments: { query: "latest news" }
            }
          ]
        };
      }

      assert.match(options.systemPrompt ?? "", /Do not emit function calls/);
      assert.equal(options.messages.at(-1)?.role, "user");
      assert.match(options.messages.at(-1)?.content ?? "", /Write the final answer/);
      return {
        message: { role: "assistant", content: "" },
        toolCalls: [
          {
            id: "call_2",
            name: "web_search",
            arguments: { query: "more news" }
          }
        ]
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "latest news" }],
    tools: [
      {
        name: "web_search",
        description: "Search web",
        input: {},
        async execute() {
          return { content: "Headline: Major policy update. Key point: markets reacted." };
        }
      }
    ],
    maxIterations: 1
  });

  assert.equal(result.messages.at(-1)?.toolCalls, undefined);
  assert.match(result.messages.at(-1)?.content ?? "", /Major policy update/);
  assert.match(result.messages.at(-1)?.content ?? "", /Key point/);
});

test("runTurn forces a final answer when the provider returns an empty no-tool assistant message", async () => {
  let calls = 0;
  const provider: LlmProvider = {
    name: "stub",
    async generate(options) {
      calls += 1;
      if (calls === 1) {
        return {
          message: { role: "assistant", content: "" }
        };
      }

      assert.equal(options.tools, undefined);
      assert.match(options.systemPrompt ?? "", /previous assistant response was empty/i);
      return {
        message: { role: "assistant", content: "Completed final answer." }
      };
    }
  };

  const result = await runTurn({
    provider,
    model: "stub-model",
    systemPrompt: "test",
    messages: [{ role: "user", content: "finish task" }],
    tools: []
  });

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages.at(-1)?.content, "Completed final answer.");
});
