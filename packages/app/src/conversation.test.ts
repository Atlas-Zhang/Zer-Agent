import assert from "node:assert/strict";
import test from "node:test";
import { getFinalAssistantMessage, repairConversationHistory } from "./conversation.js";

test("getFinalAssistantMessage returns the last non-empty assistant message", () => {
  const message = getFinalAssistantMessage([
    { role: "user", content: "hello" },
    { role: "assistant", content: "" },
    { role: "tool", content: "tool result", toolCallId: "call_1" },
    { role: "assistant", content: "Final answer" }
  ]);

  assert.equal(message?.content, "Final answer");
});

test("repairConversationHistory removes dangling assistant tool-call tails", () => {
  const repaired = repairConversationHistory([
    { role: "user", content: "find scores" },
    {
      role: "assistant",
      content: "Searching...",
      toolCalls: [
        { id: "call_1", name: "web_search", arguments: { query: "scores" } }
      ]
    },
    { role: "tool", content: "result", toolCallId: "call_1", name: "web_search" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "call_2", name: "web_search", arguments: { query: "more scores" } }
      ]
    }
  ]);

  assert.equal(repaired.length, 3);
  assert.equal(repaired.at(-1)?.role, "tool");
});

test("repairConversationHistory strips empty assistant tool call arrays", () => {
  const repaired = repairConversationHistory([
    { role: "user", content: "hello" },
    { role: "assistant", content: "No tools needed.", toolCalls: [] }
  ]);

  assert.deepEqual(repaired, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "No tools needed." }
  ]);
});
