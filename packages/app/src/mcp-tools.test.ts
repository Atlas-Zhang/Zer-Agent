import assert from "node:assert/strict";
import test from "node:test";
import { createMcpRuntime, formatMcpStatus } from "./mcp-tools.js";

test("createMcpRuntime returns no tools when no servers are configured", async () => {
  const runtime = await createMcpRuntime({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    models: [{ id: "deepseek-v4-flash", provider: "deepseek" }],
    mcpServers: {},
    sessionDir: ".zer-agent/sessions",
    logDir: ".zer-agent/logs",
    maxIterations: 8,
    compactMaxMessages: 80,
    compactMaxChars: 120000,
    permissionDefault: "ask",
    systemPrompt: "",
    deepSeekBaseUrl: "",
    openAIBaseUrl: "",
    shellContext: "",
    searchProvider: "tavily",
    newsProvider: "gnews"
  }, process.cwd());

  assert.equal(runtime.tools.length, 0);
  assert.equal(formatMcpStatus(runtime.statuses), "No MCP servers configured.");
  await runtime.close();
});

test("formatMcpStatus renders connected and failed servers", () => {
  assert.equal(formatMcpStatus([
    { name: "fs", command: "node", toolCount: 2 },
    { name: "bad", command: "missing", toolCount: 0, error: "spawn failed" }
  ]), [
    "fs: connected (2 tools)",
    "bad: failed (spawn failed)"
  ].join("\n"));
});
