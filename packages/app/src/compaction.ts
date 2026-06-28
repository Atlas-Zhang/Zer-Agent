import type { LlmProvider } from "@zer-agent/llm-core";
import type { AppConfig } from "./config.js";
import type { StoredSession } from "./session-store.js";

export type CompactionResult = {
  compacted: boolean;
  reason: string;
};

const RECENT_MESSAGES_TO_KEEP = 20;

export async function compactSessionIfNeeded(
  session: StoredSession,
  provider: LlmProvider,
  model: string,
  config: AppConfig,
  force = false
): Promise<CompactionResult> {
  const charCount = session.messages.reduce((total, message) => total + message.content.length, 0);
  const shouldCompact = force || session.messages.length > config.compactMaxMessages || charCount > config.compactMaxChars;
  if (!shouldCompact) {
    return { compacted: false, reason: "below threshold" };
  }

  if (session.messages.length <= RECENT_MESSAGES_TO_KEEP) {
    return { compacted: false, reason: "not enough history" };
  }

  const olderMessages = session.messages.slice(0, -RECENT_MESSAGES_TO_KEEP);
  const recentMessages = session.messages.slice(-RECENT_MESSAGES_TO_KEEP);
  const response = await provider.generate({
    model,
    messages: [
      {
        role: "user",
        content: [
          "Summarize this Zer-Agent session history for future continuation.",
          "Capture user goals, important decisions, files touched, tool results, unresolved issues, and constraints.",
          "Be concise but specific.",
          "",
          renderMessagesForSummary(olderMessages)
        ].join("\n")
      }
    ],
    systemPrompt: "You summarize coding-agent transcripts. Do not call tools."
  });

  const content = response.message.content.trim();
  if (!content) {
    return { compacted: false, reason: "provider returned empty summary" };
  }

  session.summaries.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    content,
    messageCount: olderMessages.length
  });
  session.messages = recentMessages;
  return { compacted: true, reason: `summarized ${olderMessages.length} older messages` };
}

export function formatSessionSummaries(session: StoredSession): string {
  if (session.summaries.length === 0) {
    return "";
  }

  return [
    "Prior compacted session summaries:",
    ...session.summaries.map((summary, index) => `Summary ${index + 1} (${summary.messageCount} messages):\n${summary.content}`)
  ].join("\n\n");
}

function renderMessagesForSummary(messages: StoredSession["messages"]): string {
  return messages
    .map((message) => `${message.role}${message.name ? `:${message.name}` : ""}> ${message.content}`)
    .join("\n\n");
}
