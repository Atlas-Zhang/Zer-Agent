import readline from "node:readline/promises";
import type { AgentEvent } from "@zer-agent/agent-core";
import { completeInput, DEFAULT_COMMANDS } from "./commands.js";
import { renderMarkdownToTerminal } from "./markdown.js";
import { bold, colorize, dim } from "./theme.js";

export class TerminalUi {
  private turnActive = false;
  private currentStatus = "thinking";
  private spinnerFrameIndex = 0;
  private spinnerTimer: NodeJS.Timeout | undefined;
  private verbose = false;
  private lastNonTtyStatus = "";

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
    process.stdout.write(`${dim("Commands:")} ${colorize("green", "/help")} ${colorize("green", "/new")} ${colorize("green", "/resume <id>")} ${colorize("green", "/model <name>")} ${colorize("green", "/session")} ${colorize("green", "/tools")} ${colorize("green", "/logs")} ${colorize("green", "/verbose")}\n\n`);
  }

  beginTurn(): void {
    this.turnActive = true;
    this.currentStatus = "thinking";
    this.lastNonTtyStatus = "";
    if (this.verbose) {
      this.info("thinking...");
      return;
    }

    this.startSpinner();
  }

  renderTurnProgress(event: AgentEvent): void {
    if (this.verbose) {
      this.renderVerboseEvent(event);
      return;
    }

    switch (event.type) {
      case "assistant":
        this.currentStatus = "thinking";
        this.renderSpinnerFrame();
        break;
      case "tool-call":
        this.currentStatus = `thinking ${formatToolBadge(event.toolName)}`;
        this.renderSpinnerFrame();
        break;
      case "tool-result":
        this.currentStatus = event.result.isError
          ? `thinking ${formatToolBadge(event.toolName)} failed`
          : `thinking ${formatToolBadge(event.toolName)} ready`;
        this.renderSpinnerFrame();
        break;
      case "error":
        this.currentStatus = "thinking handling error";
        this.renderSpinnerFrame();
        break;
    }
  }

  renderAssistantMessage(message: string): void {
    const width = process.stdout.columns ?? 100;
    const rendered = renderMarkdownToTerminal(message, Math.max(60, width - 4));
    process.stdout.write(`${colorize("cyan", "assistant>")} ${firstRenderedLine(rendered)}\n`);
    const remaining = rendered.split("\n").slice(1).join("\n");
    if (remaining) {
      process.stdout.write(`${remaining}\n`);
    }
  }

  endTurn(): void {
    if (!this.turnActive) {
      return;
    }

    this.stopSpinner();
    this.clearStatusLine();
    this.turnActive = false;
    this.currentStatus = "thinking";
    this.lastNonTtyStatus = "";
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

  toggleVerbose(): boolean {
    const wasActive = this.turnActive;
    this.verbose = !this.verbose;

    if (wasActive) {
      if (this.verbose) {
        this.stopSpinner();
        this.clearStatusLine();
      } else {
        this.startSpinner();
      }
    }

    return this.verbose;
  }

  private renderSpinnerFrame(): void {
    const label = `${SPINNER_FRAMES[this.spinnerFrameIndex % SPINNER_FRAMES.length]} ${this.currentStatus}`;
    if (!process.stdout.isTTY) {
      if (label !== this.lastNonTtyStatus) {
        this.lastNonTtyStatus = label;
        process.stdout.write(`${dim(label)}\n`);
      }
      return;
    }

    this.clearStatusLine();
    process.stdout.write(dim(label));
  }

  private clearStatusLine(): void {
    if (!process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\r\u001b[2K");
  }

  private startSpinner(): void {
    this.stopSpinner();
    this.renderSpinnerFrame();
    if (!process.stdout.isTTY) {
      return;
    }

    this.spinnerTimer = setInterval(() => {
      this.spinnerFrameIndex = (this.spinnerFrameIndex + 1) % SPINNER_FRAMES.length;
      this.renderSpinnerFrame();
    }, 90);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
    this.spinnerFrameIndex = 0;
  }

  private renderVerboseEvent(event: AgentEvent): void {
    switch (event.type) {
      case "assistant":
        if (event.message.content.trim()) {
          process.stdout.write(`${dim("thinking...")}\n`);
        }
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
}

export const internalForTesting = {
  completeInput,
  formatToolBadge,
  renderMarkdownToTerminal
};

const SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;

function formatToolBadge(toolName: string): string {
  return `[${toolName}]`;
}

function firstRenderedLine(rendered: string): string {
  const [firstLine, ...rest] = rendered.split("\n");
  if (rest.length === 0) {
    return firstLine ?? "";
  }
  return firstLine ?? "";
}
