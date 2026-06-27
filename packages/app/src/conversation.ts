import type { ChatMessage } from "@zer-agent/llm-core";

export function getFinalAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content.trim()) {
      return message;
    }
  }

  return undefined;
}

export function repairConversationHistory(messages: ChatMessage[]): ChatMessage[] {
  const repaired: ChatMessage[] = [];
  let pendingStartIndex: number | null = null;
  let pendingToolCalls = new Set<string>();

  for (const rawMessage of messages) {
    const message = normalizeMessage(rawMessage);
    if (message.role === "assistant" && message.toolCalls?.length) {
      rollbackPendingIfNeeded(repaired, pendingStartIndex, pendingToolCalls);
      pendingStartIndex = repaired.length;
      pendingToolCalls = new Set(message.toolCalls.map((call) => call.id));
      repaired.push(message);
      continue;
    }

    if (message.role === "tool") {
      if (message.toolCallId && pendingToolCalls.has(message.toolCallId)) {
        repaired.push(message);
        pendingToolCalls.delete(message.toolCallId);
        if (pendingToolCalls.size === 0) {
          pendingStartIndex = null;
        }
      }
      continue;
    }

    if (pendingToolCalls.size > 0) {
      rollbackPendingIfNeeded(repaired, pendingStartIndex, pendingToolCalls);
      pendingStartIndex = null;
      pendingToolCalls = new Set();
    }

    repaired.push(message);
  }

  if (pendingToolCalls.size > 0) {
    rollbackPendingIfNeeded(repaired, pendingStartIndex, pendingToolCalls);
  }

  return repaired;
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  if (message.toolCalls?.length === 0) {
    const normalizedMessage = { ...message };
    delete normalizedMessage.toolCalls;
    return normalizedMessage;
  }

  return message;
}

function rollbackPendingIfNeeded(
  repaired: ChatMessage[],
  pendingStartIndex: number | null,
  pendingToolCalls: Set<string>
): void {
  if (pendingStartIndex !== null && pendingToolCalls.size > 0) {
    repaired.splice(pendingStartIndex);
  }
}
