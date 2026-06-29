import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

test("executeShellCommand runs a direct shell command", async () => {
  const result = await internalForTesting.executeShellCommand(process.cwd(), "node -e \"console.log('shortcut-ok')\"");

  assert.match(result.content, /shortcut-ok/);
});

test("executeShellCommand blocks destructive direct commands", async () => {
  await assert.rejects(
    () => internalForTesting.executeShellCommand(process.cwd(), "git reset --hard"),
    /Blocked potentially destructive shell command/
  );
});

test("createBuiltInTools only registers external search tools when configured", () => {
  const baseConfig: AppConfig = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    models: [{ id: "deepseek-v4-flash", provider: "deepseek" }],
    mcpServers: {},
    sessionDir: "sessions",
    logDir: "logs",
    maxIterations: 8,
    compactMaxMessages: 80,
    compactMaxChars: 120000,
    permissionDefault: "ask",
    systemPrompt: "prompt",
    deepSeekBaseUrl: "https://api.deepseek.com",
    openAIBaseUrl: "https://api.openai.com/v1",
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

test("edit_file preview returns diff without mutating", async () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-tools-"));
  try {
    const target = join(root, "sample.txt");
    writeFileSync(target, "old\n", "utf8");
    const tools = createBuiltInTools({
      cwd: root,
      config: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        models: [{ id: "deepseek-v4-flash", provider: "deepseek" }],
        mcpServers: {},
        sessionDir: "sessions",
        logDir: "logs",
        maxIterations: 8,
        compactMaxMessages: 80,
        compactMaxChars: 120000,
        permissionDefault: "ask",
        systemPrompt: "prompt",
        deepSeekBaseUrl: "https://api.deepseek.com",
        openAIBaseUrl: "https://api.openai.com/v1",
        shellContext: "shell",
        searchProvider: "tavily",
        newsProvider: "gnews"
      }
    });
    const editTool = tools.find((tool) => tool.name === "edit_file");
    const preview = await editTool?.preview?.({ path: "sample.txt", oldText: "old", newText: "new" });

    assert.match(preview?.content ?? "", /-old/);
    assert.match(preview?.content ?? "", /\+new/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("TypeScript symbol tools list declarations and references", async () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-symbols-"));
  try {
    writeFileSync(join(root, "sample.ts"), [
      "export type UserId = string;",
      "export function loadUser(id: UserId) {",
      "  return id;",
      "}",
      "export class UserStore {}"
    ].join("\n"), "utf8");

    const symbols = internalForTesting.listTypeScriptSymbols(join(root, "sample.ts"));
    const declarations = internalForTesting.findTypeScriptSymbols(root, "loadUser");
    const references = internalForTesting.findTypeScriptReferences(root, "UserId");

    assert(symbols.some((symbol) => symbol.includes("type UserId")));
    assert(symbols.some((symbol) => symbol.includes("function loadUser")));
    assert(declarations.some((symbol) => symbol.includes("function loadUser")));
    assert(references.length >= 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
