import * as readline from "node:readline";
import readlinePromises from "node:readline/promises";
import type { AgentEvent } from "@zer-agent/agent-core";
import { completeInput, DEFAULT_COMMANDS } from "./commands.js";
import { renderMarkdownToTerminal } from "./markdown.js";
import { bold, colorize, dim, stripAnsi } from "./theme.js";

export type PromptStatus = {
  sessionId: string;
  provider: string;
  model: string;
  mode: string;
  cwd: string;
  title?: string;
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
  private historyEntries: string[] = [];
  private interruptHandler: ((chunk: Buffer) => void) | undefined;

  private readonly rl = readlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => completeInput(line, DEFAULT_COMMANDS)
  });

  async prompt(label = "you> "): Promise<string> {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      return this.promptInteractive(label);
    }

    this.renderPromptStatus();
    return this.rl.question(colorize("blue", label));
  }

  async confirm(message: string): Promise<boolean> {
    this.endTurn();
    const answer = (await this.rl.question(`${colorize("yellow", "approve?")} ${message} ${dim("[y/N]")} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  setHistory(entries: string[]): void {
    this.historyEntries = entries;
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
    process.stdout.write(renderStatusLine(status, process.stdout.columns ?? 100, session));
    process.stdout.write("\n");
  }

  private promptInteractive(label: string): Promise<string> {
    const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    const output = process.stdout;
    const promptLabel = colorize("blue", label);
    let value = "";
    let cursor = 0;
    let historyIndex = -1;
    let draft = "";

    this.rl.pause();
    readline.emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();

    return new Promise((resolve) => {
      const render = () => {
        renderPromptBlock(promptLabel, value, cursor, this.promptStatus);
      };

      const cleanup = () => {
        input.off("keypress", onKeypress);
        input.setRawMode?.(false);
        this.rl.resume();
      };

      const finish = (line: string) => {
        cleanup();
        readline.cursorTo(output, 0);
        readline.clearLine(output, 0);
        output.write(`${promptLabel}${line}\n`);
        readline.clearLine(output, 0);
        output.write("\n");
        readline.clearLine(output, 0);
        output.write("\n");
        resolve(line);
      };

      const onKeypress = (chunk: string, key: readline.Key) => {
        if (key.ctrl && key.name === "c") {
          finish("/exit");
          return;
        }

        switch (key.name) {
          case "return":
          case "enter":
            finish(value);
            return;
          case "backspace":
            if (cursor > 0) {
              value = `${value.slice(0, cursor - 1)}${value.slice(cursor)}`;
              cursor -= 1;
            }
            break;
          case "delete":
            if (cursor < value.length) {
              value = `${value.slice(0, cursor)}${value.slice(cursor + 1)}`;
            }
            break;
          case "left":
            cursor = Math.max(0, cursor - 1);
            break;
          case "right":
            cursor = Math.min(value.length, cursor + 1);
            break;
          case "home":
            cursor = 0;
            break;
          case "end":
            cursor = value.length;
            break;
          case "up":
            if (this.historyEntries.length > 0) {
              if (historyIndex === -1) {
                draft = value;
              }
              historyIndex = Math.min(this.historyEntries.length - 1, historyIndex + 1);
              value = this.historyEntries[historyIndex] ?? value;
              cursor = value.length;
            }
            break;
          case "down":
            if (historyIndex > 0) {
              historyIndex -= 1;
              value = this.historyEntries[historyIndex] ?? value;
            } else if (historyIndex === 0) {
              historyIndex = -1;
              value = draft;
            }
            cursor = value.length;
            break;
          case "tab": {
            const [hits] = completeInput(value, DEFAULT_COMMANDS);
            if (hits.length === 1) {
              value = hits[0] ?? value;
              cursor = value.length;
            }
            break;
          }
          default:
            if (chunk && !key.ctrl && !key.meta && chunk >= " ") {
              value = `${value.slice(0, cursor)}${chunk}${value.slice(cursor)}`;
              cursor += chunk.length;
              historyIndex = -1;
            }
            break;
        }

        render();
      };

      input.on("keypress", onKeypress);
      render();
    });
  }
}

export const internalForTesting = {
  completeInput,
  formatToolBadge,
  compactPath,
  renderCompletionLine,
  renderStatusLine,
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

function renderPromptBlock(promptLabel: string, value: string, cursor: number, status: PromptStatus | undefined): void {
  const output = process.stdout;
  const promptLength = stripAnsi(promptLabel).length;
  readline.cursorTo(output, 0);
  readline.clearLine(output, 0);
  output.write(`${promptLabel}${value}`);
  output.write("\n");
  readline.clearLine(output, 0);
  output.write(renderCompletionLine(value, process.stdout.columns ?? 100));
  output.write("\n");
  readline.clearLine(output, 0);
  if (status) {
    output.write(renderStatusLine(status, process.stdout.columns ?? 100, status.sessionId.slice(0, 8)));
  }
  readline.moveCursor(output, 0, -2);
  readline.cursorTo(output, promptLength + cursor);
}

function renderCompletionLine(value: string, width: number): string {
  if (!value.startsWith("/")) {
    return dim("Type / for commands");
  }

  const [hits] = completeInput(value, DEFAULT_COMMANDS);
  if (hits.length === 0) {
    return dim("No command matches");
  }

  const rendered = hits.slice(0, 8).join("  ");
  const suffix = hits.length > 8 ? `  +${hits.length - 8} more` : "";
  return dim(`Commands: ${truncateLine(rendered + suffix, width)}`);
}

function renderStatusLine(status: PromptStatus, width: number, session = status.sessionId.slice(0, 8)): string {
  const cwd = compactPath(status.cwd, width);
  const title = status.title ? ` | ${truncateLine(status.title, 28)}` : "";
  return [
    colorize("yellow", status.model),
    dim(status.mode),
    colorize("green", cwd),
    dim(`session=${session}`),
    dim(`tokens=${status.tokens}`),
    dim(`turns=${status.turns}${title}`)
  ].join("  ");
}

function truncateLine(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  return `${value.slice(0, Math.max(0, width - 3))}...`;
}
