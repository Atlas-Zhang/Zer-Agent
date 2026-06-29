import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionStore } from "./session-store.js";

test("session store creates, saves, loads, and lists sessions", () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-session-"));
  const store = new SessionStore(root);

  try {
    const session = store.create("deepseek-v4-flash", process.cwd());
    session.messages.push({ role: "user", content: "hello" });
    store.save(session);

    const loaded = store.load(session.id);
    assert.equal(loaded.messages[0]?.content, "hello");

    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, session.id);
    assert.equal(listed[0]?.metrics.turnCount, 0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("session store preserves provider and mode metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-session-"));
  try {
    const store = new SessionStore(root);
    const session = store.create("gpt-4.1-mini", process.cwd(), "openai-compatible", "plan", "allow");
    session.title = "metadata test";
    session.summaries.push({
      id: "summary_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      content: "summary",
      messageCount: 4
    });
    store.save(session);

    const loaded = store.load(session.id);
    assert.equal(loaded.provider, "openai-compatible");
    assert.equal(loaded.mode, "plan");
    assert.equal(loaded.permissionDefault, "allow");
    assert.equal(loaded.title, "metadata test");
    assert.equal(loaded.summaries[0]?.content, "summary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store finds latest session for cwd and returns user history", () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-session-"));
  const store = new SessionStore(root);

  try {
    const first = store.create("deepseek-v4-flash", "D:/repo-a");
    first.messages.push({ role: "user", content: "first prompt" });
    store.save(first);

    const second = store.create("deepseek-v4-flash", "D:/repo-b");
    second.messages.push({ role: "user", content: "weather wuxi" });
    second.messages.push({ role: "assistant", content: "answer" });
    second.messages.push({ role: "user", content: "world cup export" });
    store.recordTurn(second, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });

    const latest = store.findLatestForCwd("D:/repo-b");
    assert.equal(latest?.id, second.id);
    assert.equal(latest?.metrics.totalTokens, 15);

    const history = store.getUserHistory(second);
    assert.deepEqual(history, ["world cup export", "weather wuxi"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
