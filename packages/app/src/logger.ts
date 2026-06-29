import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

export type LogLevel = "info" | "warn" | "error";

export class AppLogger {
  private queue: Array<{ path: string; line: string }> = [];
  private drainPromise: Promise<void> | undefined;

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

  async flush(): Promise<void> {
    while (this.drainPromise) {
      await this.drainPromise;
    }
  }

  private write(level: LogLevel, event: string, data: Record<string, unknown>): void {
    const record = safeStringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data
    });
    this.queue.push({
      path: this.getCurrentLogPath(),
      line: `${record}\n`
    });
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainPromise) {
      return;
    }

    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = undefined;
      if (this.queue.length > 0) {
        this.scheduleDrain();
      }
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) {
        continue;
      }

      try {
        await appendFile(entry.path, entry.line, "utf8");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`zer-agent log write failed: ${message}\n`);
      }
    }
  }
}

function safeStringify(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "logger.serialize_failure",
      error: message
    });
  }
}
