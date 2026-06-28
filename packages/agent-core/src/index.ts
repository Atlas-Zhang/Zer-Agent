import type { ChatMessage, ChatResponse, LlmProvider, ToolSchema } from "@zer-agent/llm-core";

export type ToolCitation = {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  publishedAt?: string;
};

export type ToolResult = {
  content: string;
  details?: Record<string, unknown>;
  citations?: ToolCitation[];
  isError?: boolean;
};

export type ToolPermissionCategory = "read" | "write" | "shell" | "network" | "git";

export type AgentTool = {
  name: string;
  description: string;
  input: Record<string, unknown>;
  permissionCategory?: ToolPermissionCategory;
  mutatesFileSystem?: boolean;
  preview?: (args: Record<string, unknown>) => Promise<ToolResult>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
};

export type AgentEvent =
  | { type: "assistant"; message: ChatMessage; usage?: ChatResponse["usage"] }
  | { type: "tool-call"; toolName: string; args: Record<string, unknown> }
  | { type: "tool-result"; toolName: string; result: ToolResult }
  | { type: "error"; error: Error };

export type RunTurnOptions = {
  provider: LlmProvider;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools: AgentTool[];
  maxIterations?: number;
  onEvent?: (event: AgentEvent) => void;
  authorizeToolCall?: (tool: AgentTool, args: Record<string, unknown>) => Promise<ToolResult | undefined>;
  continueOnUnknownTool?: boolean;
  finalAttemptOnExhaustion?: boolean;
};

export type TurnResult = {
  messages: ChatMessage[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export async function runTurn(options: RunTurnOptions): Promise<TurnResult> {
  const messages = [...options.messages];
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
  const toolSchemas: ToolSchema[] = options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input: tool.input
  }));
  const maxIterations = options.maxIterations ?? 6;
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };

  for (let index = 0; index < maxIterations; index += 1) {
    const response = await options.provider.generate({
      model: options.model,
      messages,
      systemPrompt: options.systemPrompt,
      tools: toolSchemas
    });

    const assistantMessage = response.message;
    messages.push(assistantMessage);
    options.onEvent?.({ type: "assistant", message: assistantMessage, usage: response.usage });
    usage.inputTokens += response.usage?.inputTokens ?? 0;
    usage.outputTokens += response.usage?.outputTokens ?? 0;
    usage.totalTokens += response.usage?.totalTokens ?? 0;

    if (!response.toolCalls?.length) {
      if (assistantMessage.content.trim()) {
        return { messages, usage };
      }

      messages.pop();
      const finalized = await requestFinalAnswer(options, messages, usage, "The previous assistant response was empty.");
      return { messages: finalized.messages, usage: finalized.usage };
    }

    for (const call of response.toolCalls) {
      const tool = toolsByName.get(call.name);
      if (!tool) {
        const error = new Error(`Unknown tool requested: ${call.name}`);
        options.onEvent?.({ type: "error", error });
        if (options.continueOnUnknownTool) {
          messages.push({
            role: "tool",
            name: call.name,
            toolCallId: call.id,
            content: `Tool ${call.name} is unavailable in this session.`
          });
          continue;
        }
        throw error;
      }

      options.onEvent?.({ type: "tool-call", toolName: tool.name, args: call.arguments });
      const authorizationResult = await options.authorizeToolCall?.(tool, call.arguments);
      if (authorizationResult) {
        options.onEvent?.({ type: "tool-result", toolName: tool.name, result: authorizationResult });
        messages.push({
          role: "tool",
          name: tool.name,
          toolCallId: call.id,
          content: authorizationResult.content
        });
        continue;
      }

      const result = await executeToolCall(tool, call.arguments, options.onEvent);
      options.onEvent?.({ type: "tool-result", toolName: tool.name, result });
      messages.push({
        role: "tool",
        name: tool.name,
        toolCallId: call.id,
        content: result.content
      });
    }
  }

  if (options.finalAttemptOnExhaustion ?? true) {
    const finalized = await requestFinalAnswer(
      options,
      messages,
      usage,
      `You have already used up the tool loop budget (${maxIterations} iterations).`
    );
    return { messages: finalized.messages, usage: finalized.usage };
  }

  throw new Error(`Agent exceeded max iterations (${maxIterations}).`);
}

async function requestFinalAnswer(
  options: RunTurnOptions,
  messages: ChatMessage[],
  usage: TurnResult["usage"],
  reason: string
): Promise<TurnResult> {
  const recoveryResponse = await options.provider.generate({
    model: options.model,
    messages: [
      ...messages,
      {
        role: "user",
        content: "Stop using tools now. Write the final answer in normal Markdown using only the tool results already shown above."
      }
    ],
    systemPrompt: [
      options.systemPrompt,
      reason,
      "Do not call any more tools.",
      "Do not emit function calls, tool_calls, DSML/XML tool markup, or JSON tool requests.",
      "Provide the best final answer you can from the information already gathered."
    ].join("\n\n")
  });

  const recoveryMessage = recoveryResponse.toolCalls?.length || !recoveryResponse.message.content.trim()
    ? {
        ...recoveryResponse.message,
        toolCalls: undefined,
        content: recoveryResponse.message.content.trim() || buildFallbackFinalAnswer(messages)
      }
    : recoveryResponse.message;

  messages.push(recoveryMessage);
  options.onEvent?.({ type: "assistant", message: recoveryMessage, usage: recoveryResponse.usage });
  usage.inputTokens += recoveryResponse.usage?.inputTokens ?? 0;
  usage.outputTokens += recoveryResponse.usage?.outputTokens ?? 0;
  usage.totalTokens += recoveryResponse.usage?.totalTokens ?? 0;
  return { messages, usage };
}

function buildFallbackFinalAnswer(messages: ChatMessage[]): string {
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  const currentTurnMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages;
  const toolMessages = currentTurnMessages
    .filter((message) => message.role === "tool" && message.content.trim())
    .slice(-5);

  if (toolMessages.length === 0) {
    return "I couldn't complete more tool steps, and no usable tool results were available for a final answer.";
  }

  const sections = toolMessages.map((message, index) => {
    const title = message.name ? `Result ${index + 1}: ${message.name}` : `Result ${index + 1}`;
    return `### ${title}\n\n${truncateToolContent(message.content.trim())}`;
  });

  return [
    "I couldn't complete additional tool steps, so here is the best answer from the information already gathered.",
    "",
    ...sections
  ].join("\n");
}

function truncateToolContent(content: string): string {
  const maxLength = 3500;
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength).trimEnd()}\n\n[truncated]`;
}

async function executeToolCall(
  tool: AgentTool,
  args: Record<string, unknown>,
  onEvent?: (event: AgentEvent) => void
): Promise<ToolResult> {
  try {
    return await tool.execute(args);
  } catch (error: unknown) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    onEvent?.({ type: "error", error: normalizedError });
    return {
      content: `Tool ${tool.name} failed: ${normalizedError.message}`,
      details: {
        error: normalizedError.message
      },
      isError: true
    };
  }
}
