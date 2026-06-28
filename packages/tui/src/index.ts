import readline from "node:readline/promises";
import type { AgentEvent } from "@zer-agent/agent-core";
import { completeInput, DEFAULT_COMMANDS } from "./commands.js";
import { renderMarkdownToTerminal } from "./markdown.js";
import { bold, colorize, dim } from "./theme.js";

export type PromptStatus = {
  sessionId: string;
  provider: string;
  model: string;
  mode: string;
  cwd: string;
  turns: number;
  tokens: number;
};

export class TerminalUi {
  private turnActive = false;
  private currentStatus = "thinking";
  private spinnerFrameIndex = 0;
  private spinnerTimer: NodeJS.Timeout | undefined;
  private verbose = false;
  private lastNonTtyStatus = "";
  private promptStatus: PromptStatus | undefined;
  private interruptHandler: ((chunk: Buffer) => void) | undefined;

  private readonly rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => completeInput(line, DEFAULT_COMMANDS)
  });

  async prompt(label = "you> "): Promise<string> {
    this.renderPromptStatus();
    return this.rl.question(colorize("blue", label));
  }

  async confirm(message: string): Promise<boolean> {
    this.endTurn();
    const answer = (await this.rl.question(`${colorize("yellow", "approve?")} ${message} ${dim("[y/N]")} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  setHistory(entries: string[]): void {
    const history = [...entries].reverse();
    const target = this.rl as readline.Interface & { history?: string[] };
    target.history = history;
  }

  setPromptStatus(status: PromptStatus): void {
    this.promptStatus = status;
  }

  renderBanner(sessionId: string, model: string, status?: string): void {
    process.stdout.write(`${bold(colorize("cyan", "Zer-Agent"))} ${dim(`| session=${sessionId} | model=${model}${status ? ` | ${status}` : ""}`)}\n`);
    process.stdout.write(`${dim("Commands:")} ${colorize("green", "/help")} ${colorize("green", "/sessions")} ${colorize("green", "/resume <id>")} ${colorize("green", "/model <name>")} ${colorize("green", "/provider <id>")} ${colorize("green", "/mode <plan|build>")} ${colorize("green", "/tools")} ${colorize("green", "/verbose")} ${dim("| Tab completes commands")}\n\n`);
  }

  beginTurn(onInterrupt?: () => void): void {
    this.turnActive = true;
    this.currentStatus = "thinking";
    this.lastNonTtyStatus = "";
    this.startInterruptWatcher(onInterrupt);
    if (this.verbose) {
      process.stdout.write(`${dim("thinking...")}\n`);
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
    this.stopInterruptWatcher();
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

  private startInterruptWatcher(onInterrupt?: () => void): void {
    this.stopInterruptWatcher();
    if (!onInterrupt || !process.stdin.isTTY) {
      return;
    }

    const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    input.setRawMode?.(true);
    input.resume();
    this.interruptHandler = (chunk: Buffer) => {
      if (chunk.toString("utf8") === "\u001b") {
        onInterrupt();
      }
    };
    input.on("data", this.interruptHandler);
  }

  private stopInterruptWatcher(): void {
    if (!this.interruptHandler) {
      return;
    }

    process.stdin.off("data", this.interruptHandler);
    this.interruptHandler = undefined;
    const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    input.setRawMode?.(false);
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

  private renderPromptStatus(): void {
    if (!this.promptStatus) {
      return;
    }

    const status = this.promptStatus;
    const session = status.sessionId.slice(0, 8);
    const cwd = compactPath(status.cwd, process.stdout.columns ?? 100);
    process.stdout.write(dim(`${cwd} | ${status.provider}/${status.model} | ${status.mode} | session=${session} | turns=${status.turns} | tokens=${status.tokens}`));
    process.stdout.write("\n");
  }
}

export const internalForTesting = {
  completeInput,
  formatToolBadge,
  compactPath,
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

function compactPath(path: string, width: number): string {
  const maxLength = Math.max(24, Math.min(60, Math.floor(width * 0.45)));
  if (path.length <= maxLength) {
    return path;
  }

  return `...${path.slice(-(maxLength - 3))}`;
}
