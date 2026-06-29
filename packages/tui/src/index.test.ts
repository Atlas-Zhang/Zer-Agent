import assert from "node:assert/strict";
import test from "node:test";
import { internalForTesting } from "./index.js";

test("completeInput suggests slash commands by prefix", () => {
  const [hits] = internalForTesting.completeInput("/mo", ["/help", "/model", "/new"]);
  assert.deepEqual(hits, ["/model"]);
});

test("completeInput includes clear command", () => {
  const [hits] = internalForTesting.completeInput("/cl", ["/help", "/clear", "/compact"]);
  assert.deepEqual(hits, ["/clear"]);
});

test("completeInput ignores non-command input", () => {
  const [hits] = internalForTesting.completeInput("hello", ["/help"]);
  assert.deepEqual(hits, []);
});

test("completeInput suggests command arguments", () => {
  const [modeHits] = internalForTesting.completeInput("/mode p", ["/mode"]);
  const [providerHits] = internalForTesting.completeInput("/provider open", ["/provider"]);
  const [permissionHits] = internalForTesting.completeInput("/permissions a", ["/permissions"]);
  const [agentHits] = internalForTesting.completeInput("/agent re", ["/agent"]);

  assert.deepEqual(modeHits, ["/mode plan"]);
  assert.deepEqual(providerHits, ["/provider openai-compatible"]);
  assert.deepEqual(permissionHits, ["/permissions ask", "/permissions allow"]);
  assert.deepEqual(agentHits, ["/agent review"]);
});

test("formatToolBadge wraps the tool name in brackets", () => {
  assert.equal(internalForTesting.formatToolBadge("weather"), "[weather]");
});

test("compactPath shortens long paths", () => {
  const compacted = internalForTesting.compactPath("D:/very/long/path/to/a/project/root", 40);

  assert(compacted.startsWith("..."));
  assert(compacted.length <= 24);
});

test("renderCompletionLine shows slash command matches without tab", () => {
  const rendered = internalForTesting.renderCompletionLine("/mo", 120);

  assert.match(rendered, /Commands:/);
  assert.match(rendered, /\/model/);
  assert.match(rendered, /\/mode/);
});

test("renderStatusLine includes model path session and topic", () => {
  const rendered = internalForTesting.renderStatusLine({
    sessionId: "12345678-1234",
    provider: "deepseek",
    model: "gpt-5.5 medium",
    mode: "build",
    cwd: "D:/Coding/GithubPersonal/Zer-Agent",
    title: "current work topic",
    turns: 2,
    tokens: 42
  }, 120);

  assert.match(rendered, /gpt-5\.5 medium/);
  assert.match(rendered, /D:\/Coding\/GithubPersonal\/Zer-Agent/);
  assert.match(rendered, /session=12345678/);
  assert.match(rendered, /tokens=42/);
  assert.match(rendered, /current work topic/);
});
