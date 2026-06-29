import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

export type AppConfig = {
  provider: ProviderId;
  model: string;
  models: ModelConfig[];
  sessionDir: string;
  logDir: string;
  maxIterations: number;
  compactMaxMessages: number;
  compactMaxChars: number;
  permissionDefault: PermissionDecision;
  systemPrompt: string;
  deepSeekBaseUrl: string;
  openAIBaseUrl: string;
  shellContext: string;
  searchProvider: "tavily";
  newsProvider: "gnews";
  tavilyApiKey?: string;
  gnewsApiKey?: string;
  openAIApiKey?: string;
};

export type ProviderId = "deepseek" | "openai-compatible";
export type PermissionDecision = "allow" | "ask" | "deny";
export type ModelConfig = {
  id: string;
  provider: ProviderId;
  label?: string;
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

  const provider = readProviderId(process.env.ZER_AGENT_PROVIDER ?? fileConfig.provider);
  const model = process.env.ZER_AGENT_MODEL ?? fileConfig.model ?? "deepseek-v4-flash";

  return {
    provider,
    model,
    models: readModelConfigs(fileConfig.models, provider, model),
    sessionDir: resolve(cwd, process.env.ZER_AGENT_SESSION_DIR ?? fileConfig.sessionDir ?? ".zer-agent/sessions"),
    logDir: resolve(cwd, process.env.ZER_AGENT_LOG_DIR ?? fileConfig.logDir ?? ".zer-agent/logs"),
    maxIterations: readPositiveInteger(process.env.ZER_AGENT_MAX_ITERATIONS) ?? fileConfig.maxIterations ?? 8,
    compactMaxMessages: readPositiveInteger(process.env.ZER_AGENT_COMPACT_MAX_MESSAGES) ?? fileConfig.compactMaxMessages ?? 80,
    compactMaxChars: readPositiveInteger(process.env.ZER_AGENT_COMPACT_MAX_CHARS) ?? fileConfig.compactMaxChars ?? 120000,
    permissionDefault: readPermissionDecision(process.env.ZER_AGENT_PERMISSION_DEFAULT ?? fileConfig.permissionDefault),
    systemPrompt: process.env.ZER_AGENT_SYSTEM_PROMPT ?? fileConfig.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    deepSeekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? fileConfig.deepSeekBaseUrl ?? "https://api.deepseek.com",
    openAIBaseUrl: process.env.OPENAI_BASE_URL ?? fileConfig.openAIBaseUrl ?? "https://api.openai.com/v1",
    shellContext: fileConfig.shellContext ?? DEFAULT_SHELL_CONTEXT,
    searchProvider: "tavily",
    newsProvider: "gnews",
    tavilyApiKey: readOptionalEnv("TAVILY_API_KEY"),
    gnewsApiKey: readOptionalEnv("GNEWS_API_KEY"),
    openAIApiKey: readOptionalEnv("OPENAI_API_KEY")
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

export function readProviderApiKey(config: AppConfig): string {
  if (config.provider === "openai-compatible") {
    if (!config.openAIApiKey) {
      throw new Error("Missing OPENAI_API_KEY. Set it in .env or the process environment.");
    }

    return config.openAIApiKey;
  }

  return readDeepSeekApiKey();
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

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function readProviderId(value: string | undefined): ProviderId {
  if (value === "openai-compatible" || value === "deepseek") {
    return value;
  }

  return "deepseek";
}

function readModelConfigs(value: unknown, provider: ProviderId, model: string): ModelConfig[] {
  const defaults: ModelConfig[] = [
    { id: "deepseek-v4-flash", provider: "deepseek", label: "DeepSeek V4 Flash" },
    { id: "deepseek-chat", provider: "deepseek", label: "DeepSeek Chat" },
    { id: "gpt-4.1-mini", provider: "openai-compatible", label: "OpenAI-compatible GPT-4.1 Mini" }
  ];
  const configured = Array.isArray(value)
    ? value
        .map((entry): ModelConfig | undefined => {
          if (!entry || typeof entry !== "object") {
            return undefined;
          }
          const candidate = entry as Partial<ModelConfig>;
          const candidateProvider = readProviderId(candidate.provider);
          return typeof candidate.id === "string" && candidate.id.trim()
            ? { id: candidate.id.trim(), provider: candidateProvider, label: candidate.label }
            : undefined;
        })
        .filter((entry): entry is ModelConfig => Boolean(entry))
    : [];

  const selectedModel = defaults.some((entry) => entry.id === model)
    || configured.some((entry) => entry.id === model)
    ? []
    : [{ id: model, provider, label: "Current model" }];

  const deduped = new Map<string, ModelConfig>();
  for (const entry of [...defaults, ...configured, ...selectedModel]) {
    deduped.set(`${entry.provider}:${entry.id}`, entry);
  }

  return [...deduped.values()];
}

function readPermissionDecision(value: string | undefined): PermissionDecision {
  if (value === "allow" || value === "ask" || value === "deny") {
    return value;
  }

  return "ask";
}
