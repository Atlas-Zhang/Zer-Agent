import assert from "node:assert/strict";
import test from "node:test";
import { getFinalAssistantMessage } from "./conversation.js";

test("getFinalAssistantMessage returns the last non-empty assistant message", () => {
  const message = getFinalAssistantMessage([
    { role: "user", content: "hello" },
    { role: "assistant", content: "" },
    { role: "tool", content: "tool result", toolCallId: "call_1" },
    { role: "assistant", content: "Final answer" }
  ]);

  assert.equal(message?.content, "Final answer");
});
