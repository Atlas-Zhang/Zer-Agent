export const DEFAULT_COMMANDS = [
  "/help",
  "/new",
  "/resume",
  "/sessions",
  "/model",
  "/provider",
  "/mode",
  "/compact",
  "/clear",
  "/session",
  "/tools",
  "/logs",
  "/permissions",
  "/undo",
  "/fork",
  "/delete",
  "/export",
  "/import",
  "/verbose",
  "/quit",
  "/exit"
] as const;

const DEFAULT_COMMAND_ARGUMENTS: Record<string, string[]> = {
  "/mode": ["plan", "build"],
  "/provider": ["deepseek", "openai-compatible"],
  "/verbose": [],
  "/quit": [],
  "/exit": []
};

export function completeInput(line: string, commands: readonly string[]): [string[], string] {
  if (!line.startsWith("/")) {
    return [[], line];
  }

  const commandArgumentMatch = line.match(/^(\/\S+)\s+(\S*)$/);
  if (commandArgumentMatch) {
    const [, command, argumentPrefix = ""] = commandArgumentMatch;
    const argumentOptions = DEFAULT_COMMAND_ARGUMENTS[command ?? ""] ?? [];
    const hits = argumentOptions
      .filter((argument) => argument.startsWith(argumentPrefix))
      .map((argument) => `${command} ${argument}`);
    return [hits, line];
  }

  const hits = commands.filter((command) => command.startsWith(line));
  return [hits.length > 0 ? hits : [...commands], line];
}
