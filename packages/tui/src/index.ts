import readline from "node:readline/promises";
import type { AgentEvent } from "@zer-agent/agent-core";

export class TerminalUi {
  private readonly rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  async prompt(label = "you> "): Promise<string> {
    return this.rl.question(label);
  }

  renderBanner(sessionId: string, model: string): void {
    process.stdout.write(`Zer-Agent | session=${sessionId} | model=${model}\n`);
    process.stdout.write("Commands: /help /new /resume <id> /model <name> /session\n\n");
  }

  renderEvent(event: AgentEvent): void {
    switch (event.type) {
      case "assistant":
        process.stdout.write(`assistant> ${event.message.content}\n`);
        break;
      case "tool-call":
        process.stdout.write(`tool> ${event.toolName} ${JSON.stringify(event.args)}\n`);
        break;
      case "tool-result":
        process.stdout.write(`tool-result> ${event.toolName}\n${event.result.content}\n`);
        break;
      case "error":
        process.stderr.write(`error> ${event.error.message}\n`);
        break;
    }
  }

  info(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  close(): void {
    this.rl.close();
  }
}
