import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

export type AppConfig = {
  model: string;
  sessionDir: string;
  systemPrompt: string;
  deepSeekBaseUrl: string;
};

const DEFAULT_SYSTEM_PROMPT = [
  "You are Zer-Agent, a terminal coding assistant.",
  "Be concise, tool-driven, and explicit about file and shell actions.",
  "Respect AGENTS.md instructions loaded from the current project."
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
    systemPrompt: process.env.ZER_AGENT_SYSTEM_PROMPT ?? fileConfig.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    deepSeekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? fileConfig.deepSeekBaseUrl ?? "https://api.deepseek.com"
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
