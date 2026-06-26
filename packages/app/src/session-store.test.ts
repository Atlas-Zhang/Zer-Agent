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
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
