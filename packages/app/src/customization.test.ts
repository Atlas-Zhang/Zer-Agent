import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatModelCatalog,
  loadAgentProfiles,
  loadCustomCommands,
  renderCustomCommand
} from "./customization.js";

test("custom commands load from project markdown files and render variables", () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-custom-"));
  try {
    mkdirSync(join(root, ".zer-agent", "commands"), { recursive: true });
    writeFileSync(join(root, ".zer-agent", "commands", "fix.md"), "# Fix\n\nFix this: {input}\nProject: {cwd}\nSession: {session}", "utf8");

    const commands = loadCustomCommands(root);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.name, "fix");
    assert.equal(commands[0]?.description, "Fix");
    assert.match(renderCustomCommand(commands[0]!, "bug", root, "session_1"), /Fix this: bug/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent profiles include built-ins and project overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-agent-"));
  try {
    mkdirSync(join(root, ".zer-agent", "agents"), { recursive: true });
    writeFileSync(join(root, ".zer-agent", "agents", "review.md"), "# Team review\n\nUse team review rules.", "utf8");

    const profiles = loadAgentProfiles(root);
    assert(profiles.some((profile) => profile.name === "build"));
    assert.equal(profiles.find((profile) => profile.name === "review")?.description, "Team review");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatModelCatalog marks the active model", () => {
  const output = formatModelCatalog({
    provider: "deepseek",
    model: "deepseek-chat",
    models: [{ id: "deepseek-chat", provider: "deepseek", label: "Chat" }],
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
  }, "deepseek-chat");

  assert.match(output, /^\* deepseek\/deepseek-chat/m);
});
