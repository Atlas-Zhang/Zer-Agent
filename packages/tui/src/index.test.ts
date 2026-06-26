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

test("formatToolBadge wraps the tool name in brackets", () => {
  assert.equal(internalForTesting.formatToolBadge("weather"), "[weather]");
});
