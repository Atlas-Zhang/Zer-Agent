export const DEFAULT_COMMANDS = [
  "/help",
  "/new",
  "/resume",
  "/model",
  "/session",
  "/tools",
  "/quit",
  "/exit"
] as const;

export function completeInput(line: string, commands: readonly string[]): [string[], string] {
  if (!line.startsWith("/")) {
    return [[], line];
  }

  const hits = commands.filter((command) => command.startsWith(line));
  return [hits.length > 0 ? hits : [...commands], line];
}
