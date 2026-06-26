import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type LogLevel = "info" | "warn" | "error";

export class AppLogger {
  constructor(private readonly logDir: string) {
    mkdirSync(logDir, { recursive: true });
  }

  info(event: string, data: Record<string, unknown> = {}): void {
    this.write("info", event, data);
  }

  warn(event: string, data: Record<string, unknown> = {}): void {
    this.write("warn", event, data);
  }

  error(event: string, data: Record<string, unknown> = {}): void {
    this.write("error", event, data);
  }

  getCurrentLogPath(): string {
    return resolve(this.logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  }

  private write(level: LogLevel, event: string, data: Record<string, unknown>): void {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data
    });
    appendFileSync(this.getCurrentLogPath(), `${record}\n`, "utf8");
  }
}
