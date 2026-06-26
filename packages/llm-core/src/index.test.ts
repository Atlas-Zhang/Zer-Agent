import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekProvider } from "./index.js";

test("DeepSeek provider normalizes tool calls", async () => {
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "read_file",
                  arguments: "{\"path\":\"README.md\"}"
                }
              }
            ]
          }
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  const response = await provider.generate({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "read the readme" }]
  });

  assert.equal(response.toolCalls?.[0]?.name, "read_file");
  assert.equal(response.toolCalls?.[0]?.arguments.path, "README.md");
  assert.equal(response.usage?.totalTokens, 12);
});

test("DeepSeek provider preserves assistant tool call structure in follow-up requests", async () => {
  const capturedBodies: string[] = [];
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      capturedBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "done"
            }
          }
        ]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await provider.generate({
    model: "deepseek-v4-flash",
    messages: [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "weather",
            arguments: { location: "Wuxi, China" }
          }
        ]
      },
      {
        role: "tool",
        toolCallId: "call_1",
        content: "Weather for Wuxi"
      }
    ]
  });

  const request = JSON.parse(capturedBodies[0] ?? "{}") as {
    thinking?: { type?: string };
    messages?: Array<{ tool_calls?: Array<{ function?: { name?: string } }> }>;
  };
  assert.equal(request.thinking?.type, "disabled");
  assert.equal(request.messages?.[0]?.tool_calls?.[0]?.function?.name, "weather");
});
