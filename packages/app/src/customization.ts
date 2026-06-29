import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type { AppConfig, PermissionDecision } from "./config.js";

export type CustomCommand = {
  name: string;
  description?: string;
  prompt: string;
};

export type AgentProfile = {
  name: string;
  description: string;
  instructions: string;
  mode?: "build" | "plan";
  permissionDefault?: PermissionDecision;
};

export function loadCustomCommands(cwd: string): CustomCommand[] {
  const commandsDir = resolve(cwd, ".zer-agent", "commands");
  if (!existsSync(commandsDir)) {
    return [];
  }

  return readdirSync(commandsDir)
    .filter((entry) => entry.endsWith(".md") || entry.endsWith(".txt"))
    .map((entry): CustomCommand | undefined => {
      const name = basename(entry, extname(entry));
      const prompt = readFileSync(resolve(commandsDir, entry), "utf8").trim();
      if (!prompt) {
        return undefined;
      }
      const command: CustomCommand = { name, prompt };
      const description = firstHeading(prompt);
      if (description) {
        command.description = description;
      }
      return command;
    })
    .filter((entry): entry is CustomCommand => Boolean(entry));
}

export function loadAgentProfiles(cwd: string): AgentProfile[] {
  const agentsDir = resolve(cwd, ".zer-agent", "agents");
  const projectAgents = existsSync(agentsDir)
    ? readdirSync(agentsDir)
        .filter((entry) => entry.endsWith(".md") || entry.endsWith(".txt"))
        .map((entry) => {
          const name = basename(entry, extname(entry));
          const instructions = readFileSync(resolve(agentsDir, entry), "utf8").trim();
          return instructions ? { name, description: firstHeading(instructions) ?? "Project agent", instructions } : undefined;
        })
        .filter((entry): entry is AgentProfile => Boolean(entry))
    : [];

  const profiles = new Map<string, AgentProfile>();
  for (const profile of [...getBuiltInAgentProfiles(), ...projectAgents]) {
    profiles.set(profile.name, profile);
  }
  return [...profiles.values()];
}

export function renderCustomCommand(command: CustomCommand, input: string, cwd: string, sessionId: string): string {
  return command.prompt
    .replaceAll("{input}", input)
    .replaceAll("{cwd}", cwd)
    .replaceAll("{session}", sessionId);
}

export function formatModelCatalog(config: AppConfig, currentModel: string): string {
  return config.models
    .map((entry) => {
      const marker = entry.id === currentModel ? "*" : " ";
      const label = entry.label ? ` - ${entry.label}` : "";
      return `${marker} ${entry.provider}/${entry.id}${label}`;
    })
    .join("\n");
}

function getBuiltInAgentProfiles(): AgentProfile[] {
  return [
    {
      name: "build",
      description: "Default coding agent",
      mode: "build",
      instructions: "Implement requested repository changes. Use tools directly and keep final answers concise."
    },
    {
      name: "plan",
      description: "Read-only planning agent",
      mode: "plan",
      instructions: "Analyze and propose implementation plans only. Do not mutate files or run shell commands."
    },
    {
      name: "review",
      description: "Code review agent",
      mode: "plan",
      instructions: "Review changes for bugs, regressions, missing tests, and risky behavior. Lead with findings ordered by severity."
    },
    {
      name: "debug",
      description: "Debugging agent",
      mode: "build",
      instructions: "Diagnose failures from evidence first. Prefer focused checks, logs, and minimal fixes."
    },
    {
      name: "test",
      description: "Testing agent",
      mode: "build",
      instructions: "Focus on test coverage, failing scenarios, and verification commands."
    },
    {
      name: "docs",
      description: "Documentation agent",
      mode: "build",
      instructions: "Improve user-facing documentation and keep examples accurate."
    }
  ];
}

function firstHeading(content: string): string | undefined {
  const line = content.split(/\r?\n/).find((entry) => entry.trim());
  return line?.replace(/^#+\s*/, "").trim();
}
