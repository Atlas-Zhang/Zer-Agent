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
