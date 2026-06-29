import type { ChatMessage, ChatResponse, GenerateOptions, LlmProvider } from "@zer-agent/llm-core";
import type { AppLogger } from "./logger.js";

export type LlmLogContext = {
  sessionId: string;
  providerId: string;
  cwd: string;
};

export function createLoggedProvider(
  provider: LlmProvider,
  logger: AppLogger,
  getContext: () => LlmLogContext
): LlmProvider {
  return {
    name: provider.name,
    async generate(options: GenerateOptions): Promise<ChatResponse> {
      const context = getContext();
      const startedAt = Date.now();
      logger.info("llm.request", {
        ...context,
        model: options.model,
        messageCount: options.messages.length,
        toolNames: options.tools?.map((tool) => tool.name) ?? [],
        lastUserInput: getLastUserInput(options.messages),
        request: {
          systemPrompt: options.systemPrompt,
          messages: options.messages.map(serializeMessageForLog),
          tools: options.tools ?? [],
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          reasoningEffort: options.reasoningEffort
        }
      });

      try {
        const response = await provider.generate(options);
        logger.info("llm.response", {
          ...context,
          model: options.model,
          durationMs: Date.now() - startedAt,
          finishReason: response.finishReason,
          usage: response.usage,
          toolCalls: response.toolCalls,
          response: {
            message: serializeMessageForLog(response.message)
          }
        });
        return response;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("llm.failure", {
          ...context,
          model: options.model,
          durationMs: Date.now() - startedAt,
          error: message
        });
        throw error;
      }
    },
    stream: provider.stream?.bind(provider)
  };
}

function getLastUserInput(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.content;
    }
  }

  return undefined;
}

function serializeMessageForLog(message: ChatMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    name: message.name,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls,
    reasoningContent: message.reasoningContent
  };
}
