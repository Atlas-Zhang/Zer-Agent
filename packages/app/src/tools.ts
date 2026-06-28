import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentTool } from "@zer-agent/agent-core";
import ts from "typescript";
import type { AppConfig } from "./config.js";
import { lookupWeather, searchGNews, searchTavily } from "./external-services.js";

const execFileAsync = promisify(execFile);
const PROTECTED_PATH_SEGMENTS = [".env", ".git", "node_modules"];

type ToolContext = {
  cwd: string;
  config: AppConfig;
  fetchImpl?: typeof fetch;
  getAbortSignal?: () => AbortSignal | undefined;
};

export function createBuiltInTools(context: ToolContext): AgentTool[] {
  const tools: AgentTool[] = [
    {
      name: "list_files",
      description: "List files and directories under a relative path.",
      permissionCategory: "read",
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
      permissionCategory: "read",
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
      permissionCategory: "write",
      mutatesFileSystem: true,
      input: objectSchema({
        path: stringSchema("Relative file path."),
        oldText: stringSchema("Exact existing text to replace."),
        newText: stringSchema("Replacement text.")
      }, ["path", "oldText", "newText"]),
      async preview(args) {
        const targetPath = resolveSafePath(context.cwd, toStringArg(args.path));
        const oldText = toStringArg(args.oldText);
        const newText = toStringArg(args.newText);
        const current = readFileSync(targetPath, "utf8");

        if (!current.includes(oldText)) {
          throw new Error("oldText was not found in the target file.");
        }

        const updated = current.replace(oldText, newText);
        return {
          content: createUnifiedDiff(targetPath, current, updated),
          details: {
            path: targetPath,
            operation: "replace",
            existedBefore: true,
            before: current,
            after: updated
          }
        };
      },
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
          content: `Edited ${targetPath}\n\n${createUnifiedDiff(targetPath, current, updated)}`,
          details: {
            path: targetPath,
            operation: "replace",
            existedBefore: true,
            before: current,
            after: updated
          }
        };
      }
    },
    {
      name: "write_file",
      description: "Write a UTF-8 text file, creating parent directories as needed.",
      permissionCategory: "write",
      mutatesFileSystem: true,
      input: objectSchema({
        path: stringSchema("Relative file path."),
        content: stringSchema("Full file content.")
      }, ["path", "content"]),
      async preview(args) {
        const targetPath = resolveSafePath(context.cwd, toStringArg(args.path));
        const existedBefore = existsSync(targetPath);
        const before = existedBefore ? readFileSync(targetPath, "utf8") : "";
        const after = toStringArg(args.content);
        return {
          content: createUnifiedDiff(targetPath, before, after),
          details: {
            path: targetPath,
            operation: "write",
            existedBefore,
            before,
            after
          }
        };
      },
      async execute(args) {
        const targetPath = resolveSafePath(context.cwd, toStringArg(args.path));
        const existedBefore = existsSync(targetPath);
        const before = existedBefore ? readFileSync(targetPath, "utf8") : "";
        const after = toStringArg(args.content);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, after, "utf8");
        return {
          content: `Wrote ${targetPath}\n\n${createUnifiedDiff(targetPath, before, after)}`,
          details: {
            path: targetPath,
            operation: "write",
            existedBefore,
            before,
            after
          }
        };
      }
    },
    {
      name: "search_text",
      description: "Search file contents using ripgrep from the project root.",
      permissionCategory: "read",
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
        ], 30000, undefined, context.getAbortSignal?.());

        return { content: stdout || stderr || "(no matches)" };
      }
    },
    {
      name: "list_symbols",
      description: "List top-level TypeScript symbols in a source file.",
      permissionCategory: "read",
      input: objectSchema({
        path: stringSchema("Relative TypeScript file path.")
      }, ["path"]),
      async execute(args) {
        const targetPath = resolve(context.cwd, toStringArg(args.path));
        const symbols = listTypeScriptSymbols(targetPath);
        return { content: symbols.length ? symbols.join("\n") : "(no symbols)" };
      }
    },
    {
      name: "find_symbol",
      description: "Find TypeScript symbol declarations by name across the project.",
      permissionCategory: "read",
      input: objectSchema({
        name: stringSchema("Symbol name to find.")
      }, ["name"]),
      async execute(args) {
        const name = toStringArg(args.name);
        const matches = findTypeScriptSymbols(context.cwd, name);
        return { content: matches.length ? matches.join("\n") : `(no symbol declarations found for ${name})` };
      }
    },
    {
      name: "find_references",
      description: "Find textual references to a TypeScript symbol across project source files.",
      permissionCategory: "read",
      input: objectSchema({
        name: stringSchema("Symbol name to find references for.")
      }, ["name"]),
      async execute(args) {
        const name = toStringArg(args.name);
        const matches = findTypeScriptReferences(context.cwd, name);
        return { content: matches.length ? matches.join("\n") : `(no references found for ${name})` };
      }
    },
    {
      name: "run_shell",
      description: "Run a shell command inside the project directory.",
      permissionCategory: "shell",
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

        const { stdout, stderr } = await runProcess(shell, shellArgs, timeoutMs, context.cwd, context.getAbortSignal?.());
        return { content: [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)" };
      }
    },
    {
      name: "git_status",
      description: "Show concise git status for the project.",
      permissionCategory: "git",
      input: objectSchema({}, []),
      async execute() {
        const { stdout } = await runProcess("git", ["status", "--short"], 30000, context.cwd, context.getAbortSignal?.());
        return { content: stdout || "(clean)" };
      }
    },
    {
      name: "git_diff",
      description: "Show git diff for the current project.",
      permissionCategory: "git",
      input: objectSchema({}, []),
      async execute() {
        const { stdout } = await runProcess("git", ["diff", "--stat"], 30000, context.cwd, context.getAbortSignal?.());
        return { content: stdout || "(no diff)" };
      }
    }
  ];

  if (context.config.tavilyApiKey) {
    tools.push({
      name: "web_search",
      description: "Search the public web and return cited results.",
      permissionCategory: "network",
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
          createAbortableFetch(context.fetchImpl ?? fetch, context.getAbortSignal?.())
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
    permissionCategory: "network",
    input: objectSchema({
      location: stringSchema("City, region, or place name.")
    }, ["location"]),
    async execute(args) {
      const result = await lookupWeather(toStringArg(args.location), createAbortableFetch(context.fetchImpl ?? fetch, context.getAbortSignal?.()));
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
      permissionCategory: "network",
      input: objectSchema({
        query: stringSchema("News search query."),
        maxResults: numberSchema("Optional maximum number of articles.")
      }, ["query"]),
      async execute(args) {
        const result = await searchGNews(
          context.config.gnewsApiKey!,
          toStringArg(args.query),
          normalizeMaxResults(args.maxResults),
          createAbortableFetch(context.fetchImpl ?? fetch, context.getAbortSignal?.())
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
  lines.push("For TypeScript code navigation, prefer list_symbols, find_symbol, and find_references before broad text search.");
  return lines.join("\n");
}

export const internalForTesting = {
  normalizeWindowsCommand,
  assertSafeShellCommand,
  resolveSafePath,
  createUnifiedDiff,
  listTypeScriptSymbols,
  findTypeScriptSymbols,
  findTypeScriptReferences,
  describeAvailableTools
};

async function runProcess(command: string, args: string[], timeout = 30000, cwd?: string, signal?: AbortSignal) {
  return execFileAsync(command, args, {
    timeout,
    cwd,
    signal,
    maxBuffer: 1024 * 1024
  });
}

function createAbortableFetch(fetchImpl: typeof fetch, signal?: AbortSignal): typeof fetch {
  if (!signal) {
    return fetchImpl;
  }

  return (input, init) => fetchImpl(input, { ...init, signal });
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

function listTypeScriptSymbols(filePath: string): string[] {
  const source = ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);
  const symbols: string[] = [];

  for (const statement of source.statements) {
    const symbol = describeSymbol(statement, source);
    if (symbol) {
      symbols.push(symbol);
    }
  }

  return symbols;
}

function findTypeScriptSymbols(cwd: string, name: string): string[] {
  const matches: string[] = [];
  for (const filePath of listTypeScriptFiles(cwd)) {
    for (const symbol of listTypeScriptSymbols(filePath)) {
      if (symbol.includes(` ${name} `) || symbol.endsWith(` ${name}`) || symbol.includes(` ${name}(`)) {
        matches.push(`${filePath}: ${symbol}`);
      }
    }
  }

  return matches;
}

function findTypeScriptReferences(cwd: string, name: string): string[] {
  const matches: string[] = [];
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  for (const filePath of listTypeScriptFiles(cwd)) {
    const lines = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (pattern.test(line)) {
        matches.push(`${filePath}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  return matches;
}

function listTypeScriptFiles(cwd: string): string[] {
  const output: string[] = [];
  visitDirectory(cwd, output);
  return output;
}

function visitDirectory(directory: string, output: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") {
      continue;
    }

    const fullPath = resolve(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      visitDirectory(fullPath, output);
      continue;
    }

    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      output.push(fullPath);
    }
  }
}

function describeSymbol(node: ts.Statement, source: ts.SourceFile): string | undefined {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  if (ts.isFunctionDeclaration(node) && node.name) {
    return `function ${node.name.text} line ${line}`;
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return `class ${node.name.text} line ${line}`;
  }
  if (ts.isInterfaceDeclaration(node)) {
    return `interface ${node.name.text} line ${line}`;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return `type ${node.name.text} line ${line}`;
  }
  if (ts.isEnumDeclaration(node)) {
    return `enum ${node.name.text} line ${line}`;
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .map((declaration) => ts.isIdentifier(declaration.name) ? `const ${declaration.name.text} line ${line}` : undefined)
      .filter((value): value is string => Boolean(value))
      .join("\n") || undefined;
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createUnifiedDiff(path: string, before: string, after: string): string {
  if (before === after) {
    return `(no changes for ${path})`;
  }

  const beforeLines = before.replace(/\r\n/g, "\n").split("\n");
  const afterLines = after.replace(/\r\n/g, "\n").split("\n");
  const lines = [`--- ${path}`, `+++ ${path}`];
  const maxLength = Math.max(beforeLines.length, afterLines.length);

  for (let index = 0; index < maxLength; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      if (beforeLine !== undefined) {
        lines.push(` ${beforeLine}`);
      }
      continue;
    }
    if (beforeLine !== undefined) {
      lines.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      lines.push(`+${afterLine}`);
    }
  }

  return lines.join("\n");
}
