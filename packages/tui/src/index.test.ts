import assert from "node:assert/strict";
import test from "node:test";
import { internalForTesting } from "./index.js";

test("completeInput suggests slash commands by prefix", () => {
  const [hits] = internalForTesting.completeInput("/mo", ["/help", "/model", "/new"]);
  assert.deepEqual(hits, ["/model"]);
});

test("completeInput ignores non-command input", () => {
  const [hits] = internalForTesting.completeInput("hello", ["/help"]);
  assert.deepEqual(hits, []);
});

test("completeInput suggests command arguments", () => {
  const [modeHits] = internalForTesting.completeInput("/mode p", ["/mode"]);
  const [providerHits] = internalForTesting.completeInput("/provider open", ["/provider"]);

  assert.deepEqual(modeHits, ["/mode plan"]);
  assert.deepEqual(providerHits, ["/provider openai-compatible"]);
});

test("formatToolBadge wraps the tool name in brackets", () => {
  assert.equal(internalForTesting.formatToolBadge("weather"), "[weather]");
});

test("compactPath shortens long paths", () => {
  const compacted = internalForTesting.compactPath("D:/very/long/path/to/a/project/root", 40);

  assert(compacted.startsWith("..."));
  assert(compacted.length <= 24);
});
