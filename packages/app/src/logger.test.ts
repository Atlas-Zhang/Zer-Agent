import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppLogger } from "./logger.js";

test("AppLogger writes queued records after flush", async () => {
  const root = mkdtempSync(join(tmpdir(), "zer-agent-log-"));
  try {
    const logger = new AppLogger(root);

    logger.info("test.one", { value: 1 });
    logger.warn("test.two", { value: 2 });
    await logger.flush();

    assert.equal(existsSync(logger.getCurrentLogPath()), true);
    const records = readFileSync(logger.getCurrentLogPath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    assert.equal(records.length, 2);
    assert.equal(records[0]?.event, "test.one");
    assert.equal(records[1]?.event, "test.two");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
