import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

export type AppConfig = {
  model: string;
  sessionDir: string;
  logDir: string;
  systemPrompt: string;
  deepSeekBaseUrl: string;
  shellContext: string;
  searchProvider: "tavily";
  newsProvider: "gnews";
  tavilyApiKey?: string;
  gnewsApiKey?: string;
};

const DEFAULT_SYSTEM_PROMPT = [
  "You are Zer-Agent, a terminal coding assistant.",
  "Be concise, tool-driven, and explicit about file and shell actions.",
  "Respect AGENTS.md instructions loaded from the current project."
].join(" ");

const DEFAULT_SHELL_CONTEXT = process.platform === "win32"
  ? [
      "Runtime shell: Windows PowerShell.",
      "Prefer built-in tools like read_file, list_files, and search_text for repository inspection.",
      "If you use run_shell, write PowerShell syntax rather than bash syntax.",
      "Do not use bash redirection such as 2>/dev/null, pipes to head, or utilities like cat unless you first verify they exist in this shell."
    ].join(" ")
  : [
      "Runtime shell: POSIX sh.",
      "Prefer built-in tools like read_file, list_files, and search_text for repository inspection."
    ].join(" ");

let envLoaded = false;

export function loadAppConfig(cwd: string): AppConfig {
  ensureEnvLoaded(cwd);
  const configPath = resolve(cwd, ".zer-agent", "config.json");
  const fileConfig = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8")) as Partial<AppConfig>
    : {};

  return {
    model: process.env.ZER_AGENT_MODEL ?? fileConfig.model ?? "deepseek-v4-flash",
    sessionDir: resolve(cwd, process.env.ZER_AGENT_SESSION_DIR ?? fileConfig.sessionDir ?? ".zer-agent/sessions"),
    logDir: resolve(cwd, process.env.ZER_AGENT_LOG_DIR ?? fileConfig.logDir ?? ".zer-agent/logs"),
    systemPrompt: process.env.ZER_AGENT_SYSTEM_PROMPT ?? fileConfig.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    deepSeekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? fileConfig.deepSeekBaseUrl ?? "https://api.deepseek.com",
    shellContext: fileConfig.shellContext ?? DEFAULT_SHELL_CONTEXT,
    searchProvider: "tavily",
    newsProvider: "gnews",
    tavilyApiKey: readOptionalEnv("TAVILY_API_KEY"),
    gnewsApiKey: readOptionalEnv("GNEWS_API_KEY")
  };
}

export function readDeepSeekApiKey(): string {
  ensureEnvLoaded(process.cwd());
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY. Set it in .env or the process environment.");
  }

  return apiKey;
}

function ensureEnvLoaded(cwd: string): void {
  if (envLoaded) {
    return;
  }

  loadDotEnv({ path: resolve(cwd, ".env") });
  loadDotEnv({ path: resolve(cwd, ".env.local"), override: true });
  envLoaded = true;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
