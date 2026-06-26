import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function loadAgentsInstructions(startDir: string): string {
  let current = resolve(startDir);

  while (true) {
    const candidate = join(current, "AGENTS.md");
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }

    const parent = dirname(current);
    if (parent === current) {
      return "";
    }

    current = parent;
  }
}
