import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatMessage } from "@zer-agent/llm-core";

export type StoredSession = {
  id: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
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
      messages: []
    };
    this.save(session);
    return session;
  }

  load(sessionId: string): StoredSession {
    const path = this.getPath(sessionId);
    if (!existsSync(path)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return JSON.parse(readFileSync(path, "utf8")) as StoredSession;
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

  private getPath(sessionId: string): string {
    return resolve(this.sessionDir, `${sessionId}.json`);
  }
}
