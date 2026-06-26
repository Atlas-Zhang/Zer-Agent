import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentTool } from "@zer-agent/agent-core";

const execFileAsync = promisify(execFile);

type ToolContext = {
  cwd: string;
};

export function createBuiltInTools(context: ToolContext): AgentTool[] {
  return [
    {
      name: "list_files",
      description: "List files and directories under a relative path.",
      input: objectSchema({
        path: stringSchema("Relative path from the project root.")
      }, ["path"]),
      async execute(args) {
        const targetPath = resolve(context.cwd, toStringArg(args.path, "."));
        const entries = readdirSync(targetPath, { withFileTypes: true })
          .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`)
          .join("\n");
        return { content: entries || "(empty)" };
      }
    },
    {
      name: "read_file",
      description: "Read a UTF-8 text file.",
      input: objectSchema({
        path: stringSchema("Relative file path.")
      }, ["path"]),
      async execute(args) {
        const targetPath = resolve(context.cwd, toStringArg(args.path));
        return { content: readFileSync(targetPath, "utf8") };
      }
    },
    {
      name: "write_file",
      description: "Write a UTF-8 text file, creating parent directories as needed.",
      input: objectSchema({
        path: stringSchema("Relative file path."),
        content: stringSchema("Full file content.")
      }, ["path", "content"]),
      async execute(args) {
        const targetPath = resolve(context.cwd, toStringArg(args.path));
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, toStringArg(args.content), "utf8");
        return { content: `Wrote ${targetPath}` };
      }
    },
    {
      name: "search_text",
      description: "Search file contents using ripgrep from the project root.",
      input: objectSchema({
        query: stringSchema("Plain text or regex pattern.")
      }, ["query"]),
      async execute(args) {
        const query = toStringArg(args.query);
        const { stdout, stderr } = await runProcess("rg", [
          "-n",
          "--hidden",
          "--glob",
          "!node_modules",
          "--glob",
          "!dist",
          query,
          context.cwd
        ]);

        return { content: stdout || stderr || "(no matches)" };
      }
    },
    {
      name: "run_shell",
      description: "Run a shell command inside the project directory.",
      input: objectSchema({
        command: stringSchema("Shell command to execute."),
        timeoutMs: numberSchema("Optional timeout in milliseconds.")
      }, ["command"]),
      async execute(args) {
        const command = toStringArg(args.command);
        const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 30000;
        const normalizedCommand = process.platform === "win32" ? normalizeWindowsCommand(command) : command;
        const shell = process.platform === "win32" ? "powershell.exe" : "sh";
        const shellArgs = process.platform === "win32"
          ? ["-NoProfile", "-Command", normalizedCommand]
          : ["-lc", normalizedCommand];

        const { stdout, stderr } = await runProcess(shell, shellArgs, timeoutMs, context.cwd);
        return { content: [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)" };
      }
    },
    {
      name: "git_status",
      description: "Show concise git status for the project.",
      input: objectSchema({}, []),
      async execute() {
        const { stdout } = await runProcess("git", ["status", "--short"], 30000, context.cwd);
        return { content: stdout || "(clean)" };
      }
    },
    {
      name: "git_diff",
      description: "Show git diff for the current project.",
      input: objectSchema({}, []),
      async execute() {
        const { stdout } = await runProcess("git", ["diff", "--stat"], 30000, context.cwd);
        return { content: stdout || "(no diff)" };
      }
    }
  ];
}

export const internalForTesting = {
  normalizeWindowsCommand
};

async function runProcess(command: string, args: string[], timeout = 30000, cwd?: string) {
  return execFileAsync(command, args, {
    timeout,
    cwd,
    maxBuffer: 1024 * 1024
  });
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function stringSchema(description: string) {
  return { type: "string", description };
}

function numberSchema(description: string) {
  return { type: "number", description };
}

function toStringArg(value: unknown, fallback?: string): string {
  if (typeof value === "string") {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error("Expected string argument.");
}

function normalizeWindowsCommand(command: string): string {
  const trimmed = command.trim();

  const simpleCatHeadMatch = trimmed.match(/^cat\s+([^\s|]+)\s+2>\/dev\/null\s+\|\s+head\s+-([0-9]+)$/);
  if (simpleCatHeadMatch) {
    const [, filePath, lineCount] = simpleCatHeadMatch;
    return `Get-Content -Path '${escapeSingleQuotes(filePath)}' -TotalCount ${lineCount} -ErrorAction SilentlyContinue`;
  }

  const catHeadMatch = trimmed.match(/^cat\s+([^\s|]+)\s+\|\s+head\s+-([0-9]+)$/);
  if (catHeadMatch) {
    const [, filePath, lineCount] = catHeadMatch;
    return `Get-Content -Path '${escapeSingleQuotes(filePath)}' -TotalCount ${lineCount}`;
  }

  if (trimmed.startsWith("cat ")) {
    const filePath = trimmed.slice(4).trim();
    return `Get-Content -Path '${escapeSingleQuotes(filePath)}'`;
  }

  return command;
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "''");
}
