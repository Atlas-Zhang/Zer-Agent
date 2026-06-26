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
