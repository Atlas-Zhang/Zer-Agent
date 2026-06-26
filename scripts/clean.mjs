import { rmSync } from "node:fs";
import { resolve } from "node:path";

for (const path of ["packages/llm-core/dist", "packages/agent-core/dist", "packages/tui/dist", "packages/app/dist"]) {
  rmSync(resolve(path), { force: true, recursive: true });
}
