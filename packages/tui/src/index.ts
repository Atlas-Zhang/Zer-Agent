import readline from "node:readline/promises";
import type { AgentEvent } from "@zer-agent/agent-core";
import { completeInput, DEFAULT_COMMANDS } from "./commands.js";
import { bold, colorize, dim } from "./theme.js";

export class TerminalUi {
  private readonly rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => completeInput(line, DEFAULT_COMMANDS)
  });

  async prompt(label = "you> "): Promise<string> {
    return this.rl.question(colorize("blue", label));
  }

  renderBanner(sessionId: string, model: string): void {
    process.stdout.write(`${bold(colorize("cyan", "Zer-Agent"))} ${dim(`| session=${sessionId} | model=${model}`)}\n`);
    process.stdout.write(`${dim("Commands:")} ${colorize("green", "/help")} ${colorize("green", "/new")} ${colorize("green", "/resume <id>")} ${colorize("green", "/model <name>")} ${colorize("green", "/session")} ${colorize("green", "/tools")}\n\n`);
  }

  renderEvent(event: AgentEvent): void {
    switch (event.type) {
      case "assistant":
        process.stdout.write(`${colorize("cyan", "assistant>")} ${event.message.content}\n`);
        break;
      case "tool-call":
        process.stdout.write(`${colorize("magenta", "tool>")} ${bold(event.toolName)} ${dim(JSON.stringify(event.args))}\n`);
        break;
      case "tool-result":
        process.stdout.write(`${colorize(event.result.isError ? "red" : "green", "tool-result>")} ${bold(event.toolName)}${event.result.isError ? colorize("red", " [error]") : ""}\n${event.result.content}\n`);
        if (event.result.citations?.length) {
          process.stdout.write(`${colorize("yellow", "citations>")}\n`);
          for (const citation of event.result.citations) {
            process.stdout.write(`${dim("-")} ${citation.title}: ${colorize("blue", citation.url)}\n`);
          }
        }
        break;
      case "error":
        process.stderr.write(`${colorize("red", "error>")} ${event.error.message}\n`);
        break;
    }
  }

  info(message: string): void {
    process.stdout.write(`${dim(message)}\n`);
  }

  warn(message: string): void {
    process.stdout.write(`${colorize("yellow", "warn>")} ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`${colorize("red", "error>")} ${message}\n`);
  }

  close(): void {
    this.rl.close();
  }
}

export const internalForTesting = {
  completeInput
};
