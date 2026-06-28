import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekProvider, OpenAICompatibleProvider } from "./index.js";

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

test("DeepSeek provider omits empty assistant tool call arrays", async () => {
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

  const response = await provider.generate({
    model: "deepseek-v4-flash",
    messages: [
      {
        role: "assistant",
        content: "previous reply",
        toolCalls: []
      }
    ]
  });

  const request = JSON.parse(capturedBodies[0] ?? "{}") as {
    messages?: Array<{ tool_calls?: unknown }>;
  };
  assert.equal(request.messages?.[0]?.tool_calls, undefined);
  assert.equal(response.toolCalls, undefined);
  assert.equal(response.message.toolCalls, undefined);
});

test("DeepSeek provider infers DSML tool calls from assistant content", async () => {
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: [
              "Now I'm getting conflicting group data. Let me try another source.",
              "",
              "<｜｜DSML｜｜tool_calls>",
              "<｜｜DSML｜｜invoke name=\"web_search\">",
              "<｜｜DSML｜｜parameter name=\"query\" string=\"true\">world cup 2026 standings</｜｜DSML｜｜parameter>",
              "<｜｜DSML｜｜parameter name=\"maxResults\" string=\"false\">3</｜｜DSML｜｜parameter>",
              "</｜｜DSML｜｜invoke>",
              "</｜｜DSML｜｜tool_calls>"
            ].join("\n")
          }
        }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  const response = await provider.generate({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "find standings" }]
  });

  assert.equal(response.toolCalls?.[0]?.name, "web_search");
  assert.equal(response.toolCalls?.[0]?.arguments.query, "world cup 2026 standings");
  assert.equal(response.toolCalls?.[0]?.arguments.maxResults, 3);
  assert.doesNotMatch(response.message.content, /DSML/);
  assert.match(response.message.content, /conflicting group data/);
});

test("DeepSeek provider infers mangled DSML tool calls from assistant content", async () => {
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: [
              "Need a better source.",
              "",
              "<??DSML??tool_calls>",
              "<??DSML??invoke name=\"web_search\">",
              "<??DSML??parameter name=\"query\" string=\"true\">world cup 2026 standings</??DSML??parameter>",
              "<??DSML??parameter name=\"maxResults\" string=\"false\">3</??DSML??parameter>",
              "</??DSML??invoke>",
              "</??DSML??tool_calls>"
            ].join("\n")
          }
        }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  const response = await provider.generate({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "find standings" }]
  });

  assert.equal(response.toolCalls?.[0]?.name, "web_search");
  assert.equal(response.toolCalls?.[0]?.arguments.maxResults, 3);
  assert.equal(response.message.content, "Need a better source.");
});

test("OpenAI-compatible provider serializes tool calls", async () => {
  const capturedBodies: string[] = [];
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://api.example.com/v1",
    defaultModel: "test-model",
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
        ],
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const response = await provider.generate({
    model: "test-model",
    messages: [{ role: "user", content: "weather" }],
    tools: [
      {
        name: "weather",
        description: "Weather",
        input: { type: "object", properties: {} }
      }
    ]
  });

  const request = JSON.parse(capturedBodies[0] ?? "{}") as {
    model?: string;
    tools?: Array<{ function?: { name?: string } }>;
    thinking?: unknown;
  };
  assert.equal(request.model, "test-model");
  assert.equal(request.tools?.[0]?.function?.name, "weather");
  assert.equal(request.thinking, undefined);
  assert.equal(response.usage?.totalTokens, 5);
});
