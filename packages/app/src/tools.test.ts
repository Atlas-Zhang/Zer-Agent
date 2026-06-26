import assert from "node:assert/strict";
import test from "node:test";
import { internalForTesting } from "./tools.js";

test("normalizeWindowsCommand rewrites common cat/head pipeline", () => {
  const command = "cat package.json 2>/dev/null | head -40";
  const normalized = internalForTesting.normalizeWindowsCommand(command);

  assert.equal(
    normalized,
    "Get-Content -Path 'package.json' -TotalCount 40 -ErrorAction SilentlyContinue"
  );
});
