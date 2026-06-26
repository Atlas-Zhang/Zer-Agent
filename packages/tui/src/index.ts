import readline from "node:readline/promises";
import type { AgentEvent } from "@zer-agent/agent-core";
import { completeInput, DEFAULT_COMMANDS } from "./commands.js";
import { bold, colorize, dim } from "./theme.js";

export class TerminalUi {
  private turnActive = false;
  private currentStatus = "";

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
    process.stdout.write(`${dim("Commands:")} ${colorize("green", "/help")} ${colorize("green", "/new")} ${colorize("green", "/resume <id>")} ${colorize("green", "/model <name>")} ${colorize("green", "/session")} ${colorize("green", "/tools")} ${colorize("green", "/logs")}\n\n`);
  }

  beginTurn(): void {
    this.turnActive = true;
    this.updateTurnStatus("thinking...");
  }

  renderTurnProgress(event: AgentEvent): void {
    switch (event.type) {
      case "assistant":
        if (event.message.content.trim()) {
          this.updateTurnStatus("thinking...");
        }
        break;
      case "tool-call":
        this.updateTurnStatus(`thinking... using ${event.toolName}`);
        break;
      case "tool-result":
        this.updateTurnStatus(
          event.result.isError
            ? `thinking... ${event.toolName} failed`
            : `thinking... processed ${event.toolName}`
        );
        break;
      case "error":
        this.updateTurnStatus(`thinking... handling error`);
        break;
    }
  }

  renderAssistantMessage(message: string): void {
    process.stdout.write(`${colorize("cyan", "assistant>")} ${message}\n`);
  }

  endTurn(): void {
    if (!this.turnActive) {
      return;
    }

    this.clearStatusLine();
    this.turnActive = false;
    this.currentStatus = "";
  }

  info(message: string): void {
    this.endTurn();
    process.stdout.write(`${dim(message)}\n`);
  }

  warn(message: string): void {
    this.endTurn();
    process.stdout.write(`${colorize("yellow", "warn>")} ${message}\n`);
  }

  error(message: string): void {
    this.endTurn();
    process.stderr.write(`${colorize("red", "error>")} ${message}\n`);
  }

  close(): void {
    this.endTurn();
    this.rl.close();
  }

  private updateTurnStatus(message: string): void {
    this.currentStatus = message;
    if (!process.stdout.isTTY) {
      process.stdout.write(`${dim(message)}\n`);
      return;
    }

    this.clearStatusLine();
    process.stdout.write(dim(message));
  }

  private clearStatusLine(): void {
    if (!process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\r\u001b[2K");
  }
}

export const internalForTesting = {
  completeInput
};
