import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AppConfig = {
  model: string;
  sessionDir: string;
  systemPrompt: string;
};

const DEFAULT_SYSTEM_PROMPT = [
  "You are Zer-Agent, a terminal coding assistant.",
  "Be concise, tool-driven, and explicit about file and shell actions.",
  "Respect AGENTS.md instructions loaded from the current project."
].join(" ");

export function loadAppConfig(cwd: string): AppConfig {
  const configPath = resolve(cwd, ".zer-agent", "config.json");
  const fileConfig = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8")) as Partial<AppConfig>
    : {};

  return {
    model: process.env.ZER_AGENT_MODEL ?? fileConfig.model ?? "deepseek-v4-flash",
    sessionDir: resolve(cwd, ".zer-agent", "sessions"),
    systemPrompt: fileConfig.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  };
}

export function readDeepSeekApiKey(): string {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY.");
  }

  return apiKey;
}
