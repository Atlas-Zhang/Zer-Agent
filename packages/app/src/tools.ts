import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentTool } from "@zer-agent/agent-core";
import type { AppConfig } from "./config.js";
import { lookupWeather, searchGNews, searchTavily } from "./external-services.js";

const execFileAsync = promisify(execFile);
const PROTECTED_PATH_SEGMENTS = [".env", ".git", "node_modules"];

type ToolContext = {
  cwd: string;
  config: AppConfig;
  fetchImpl?: typeof fetch;
};

export function createBuiltInTools(context: ToolContext): AgentTool[] {
  const tools: AgentTool[] = [
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
      name: "edit_file",
      description: "Apply a targeted string replacement within a UTF-8 text file.",
      input: objectSchema({
        path: stringSchema("Relative file path."),
        oldText: stringSchema("Exact existing text to replace."),
        newText: stringSchema("Replacement text.")
      }, ["path", "oldText", "newText"]),
      async execute(args) {
        const targetPath = resolveSafePath(context.cwd, toStringArg(args.path));
        const oldText = toStringArg(args.oldText);
        const newText = toStringArg(args.newText);
        const current = readFileSync(targetPath, "utf8");

        if (!current.includes(oldText)) {
          throw new Error("oldText was not found in the target file.");
        }

        const updated = current.replace(oldText, newText);
        writeFileSync(targetPath, updated, "utf8");
        return {
          content: `Edited ${targetPath}`,
          details: {
            path: targetPath,
            operation: "replace"
          }
        };
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
        const targetPath = resolveSafePath(context.cwd, toStringArg(args.path));
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, toStringArg(args.content), "utf8");
        return {
          content: `Wrote ${targetPath}`,
          details: {
            path: targetPath,
            operation: "write"
          }
        };
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
        assertSafeShellCommand(command);
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

  if (context.config.tavilyApiKey) {
    tools.push({
      name: "web_search",
      description: "Search the public web and return cited results.",
      input: objectSchema({
        query: stringSchema("Search query."),
        maxResults: numberSchema("Optional maximum number of results.")
      }, ["query"]),
      async execute(args) {
        const query = toStringArg(args.query);
        const maxResults = normalizeMaxResults(args.maxResults);
        const result = await searchTavily(
          context.config.tavilyApiKey!,
          query,
          maxResults,
          context.fetchImpl ?? fetch
        );

        return {
          content: result.summary,
          citations: result.citations,
          details: result.details
        };
      }
    });
  }

  tools.push({
    name: "weather",
    description: "Fetch current weather and today's forecast for a location.",
    input: objectSchema({
      location: stringSchema("City, region, or place name.")
    }, ["location"]),
    async execute(args) {
      const result = await lookupWeather(toStringArg(args.location), context.fetchImpl ?? fetch);
      return {
        content: result.summary,
        details: result.details
      };
    }
  });

  if (context.config.gnewsApiKey) {
    tools.push({
      name: "news_search",
      description: "Search recent news articles and return cited results.",
      input: objectSchema({
        query: stringSchema("News search query."),
        maxResults: numberSchema("Optional maximum number of articles.")
      }, ["query"]),
      async execute(args) {
        const result = await searchGNews(
          context.config.gnewsApiKey!,
          toStringArg(args.query),
          normalizeMaxResults(args.maxResults),
          context.fetchImpl ?? fetch
        );
        return {
          content: result.summary,
          citations: result.citations,
          details: result.details
        };
      }
    });
  }

  return tools;
}

export function describeAvailableTools(tools: AgentTool[]): string {
  const lines = [
    "Available tools in this session:"
  ];

  for (const tool of tools) {
    lines.push(`- ${tool.name}: ${tool.description}`);
  }

  lines.push("If a tool is listed here, use it when appropriate instead of claiming it is unavailable.");
  return lines.join("\n");
}

export const internalForTesting = {
  normalizeWindowsCommand,
  assertSafeShellCommand,
  resolveSafePath,
  describeAvailableTools
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

function normalizeMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }

  return Math.max(1, Math.min(10, Math.trunc(value)));
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

function resolveSafePath(cwd: string, relativePath: string): string {
  const targetPath = resolve(cwd, relativePath);
  const relativeTarget = targetPath.slice(cwd.length).replace(/\\/g, "/").toLowerCase();

  for (const segment of PROTECTED_PATH_SEGMENTS) {
    const lowered = segment.toLowerCase();
    if (relativeTarget === `/${lowered}` || relativeTarget.startsWith(`/${lowered}/`) || relativeTarget.includes(`/${lowered}.`)) {
      throw new Error(`Refusing to modify protected path: ${relativePath}`);
    }
  }

  return targetPath;
}

function assertSafeShellCommand(command: string): void {
  const trimmed = command.trim().toLowerCase();
  const blockedPatterns = [
    /\brm\s+-rf\b/,
    /\bdel\s+\/f\b/,
    /\brd\s+\/s\b/,
    /\bremove-item\b.+\brecurse\b/,
    /\bgit\s+reset\s+--hard\b/
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error("Blocked potentially destructive shell command.");
    }
  }
}
