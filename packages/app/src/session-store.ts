import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatMessage, ChatUsage } from "@zer-agent/llm-core";

export type SessionMetrics = {
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type StoredSession = {
  id: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  metrics: SessionMetrics;
};

export class SessionStore {
  constructor(private readonly sessionDir: string) {}

  create(model: string, cwd: string): StoredSession {
    mkdirSync(this.sessionDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const session: StoredSession = {
      id: crypto.randomUUID(),
      model,
      cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
      metrics: {
        turnCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    };
    this.save(session);
    return session;
  }

  load(sessionId: string): StoredSession {
    const path = this.getPath(sessionId);
    if (!existsSync(path)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return this.normalizeSession(JSON.parse(readFileSync(path, "utf8")) as Partial<StoredSession>);
  }

  save(session: StoredSession): void {
    mkdirSync(this.sessionDir, { recursive: true });
    session.updatedAt = new Date().toISOString();
    writeFileSync(this.getPath(session.id), JSON.stringify(session, null, 2));
  }

  list(): StoredSession[] {
    if (!existsSync(this.sessionDir)) {
      return [];
    }

    return readdirSync(this.sessionDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => this.load(entry.replace(/\.json$/, "")))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  findLatestForCwd(cwd: string): StoredSession | undefined {
    const matches = this.list().filter((session) => session.cwd === cwd);
    return matches.find((session) => session.messages.length > 0) ?? matches[0];
  }

  recordTurn(session: StoredSession, usage?: ChatUsage): StoredSession {
    session.metrics.turnCount += 1;
    session.metrics.inputTokens += usage?.inputTokens ?? 0;
    session.metrics.outputTokens += usage?.outputTokens ?? 0;
    session.metrics.totalTokens += usage?.totalTokens ?? 0;
    this.save(session);
    return session;
  }

  getUserHistory(session: StoredSession, limit = 100): string[] {
    const history = session.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content.trim())
      .filter(Boolean);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (let index = history.length - 1; index >= 0 && deduped.length < limit; index -= 1) {
      const entry = history[index] ?? "";
      if (!seen.has(entry)) {
        deduped.push(entry);
        seen.add(entry);
      }
    }

    return deduped;
  }

  private getPath(sessionId: string): string {
    return resolve(this.sessionDir, `${sessionId}.json`);
  }

  private normalizeSession(session: Partial<StoredSession>): StoredSession {
    const timestamp = new Date().toISOString();
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const derivedTurnCount = messages.filter((message) => message.role === "user").length;
    return {
      id: session.id ?? crypto.randomUUID(),
      model: session.model ?? "deepseek-v4-flash",
      cwd: session.cwd ?? process.cwd(),
      createdAt: session.createdAt ?? timestamp,
      updatedAt: session.updatedAt ?? timestamp,
      messages,
      metrics: {
        turnCount: session.metrics?.turnCount ?? derivedTurnCount,
        inputTokens: session.metrics?.inputTokens ?? 0,
        outputTokens: session.metrics?.outputTokens ?? 0,
        totalTokens: session.metrics?.totalTokens ?? 0
      }
    };
  }
}
