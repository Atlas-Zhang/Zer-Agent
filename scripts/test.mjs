import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve("packages");
const testFiles = [];

for (const packageName of readdirSync(root)) {
  const distDir = join(root, packageName, "dist");
  collectTests(distDir, testFiles);
}

if (testFiles.length === 0) {
  console.error("No compiled test files found under packages/*/dist.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);

function collectTests(dir, output) {
  let entries;

  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      collectTests(fullPath, output);
      continue;
    }

    if (entry.endsWith(".test.js")) {
      output.push(fullPath);
    }
  }
}
