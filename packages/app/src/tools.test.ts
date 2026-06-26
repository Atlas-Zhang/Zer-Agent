import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "./config.js";
import { createBuiltInTools, internalForTesting } from "./tools.js";

test("normalizeWindowsCommand rewrites common cat/head pipeline", () => {
  const command = "cat package.json 2>/dev/null | head -40";
  const normalized = internalForTesting.normalizeWindowsCommand(command);

  assert.equal(
    normalized,
    "Get-Content -Path 'package.json' -TotalCount 40 -ErrorAction SilentlyContinue"
  );
});

test("resolveSafePath blocks writes to protected paths", () => {
  assert.throws(
    () => internalForTesting.resolveSafePath("D:/repo", ".env"),
    /Refusing to modify protected path/
  );
});

test("createBuiltInTools only registers external search tools when configured", () => {
  const baseConfig: AppConfig = {
    model: "deepseek-v4-flash",
    sessionDir: "sessions",
    logDir: "logs",
    maxIterations: 8,
    systemPrompt: "prompt",
    deepSeekBaseUrl: "https://api.deepseek.com",
    shellContext: "shell",
    searchProvider: "tavily",
    newsProvider: "gnews"
  };

  const withoutKeys = createBuiltInTools({
    cwd: process.cwd(),
    config: baseConfig
  }).map((tool) => tool.name);
  assert(!withoutKeys.includes("web_search"));
  assert(!withoutKeys.includes("news_search"));
  assert(withoutKeys.includes("weather"));

  const withKeys = createBuiltInTools({
    cwd: process.cwd(),
    config: {
      ...baseConfig,
      tavilyApiKey: "tvly-key",
      gnewsApiKey: "gnews-key"
    }
  }).map((tool) => tool.name);
  assert(withKeys.includes("web_search"));
  assert(withKeys.includes("news_search"));
});

test("describeAvailableTools includes current tool inventory", () => {
  const description = internalForTesting.describeAvailableTools([
    {
      name: "weather",
      description: "Fetch current weather and today's forecast for a location.",
      input: {},
      async execute() {
        return { content: "ok" };
      }
    }
  ]);

  assert.match(description, /Available tools in this session/);
  assert.match(description, /weather/);
});
