export type ToolSchema = {
  name: string;
  description: string;
  input: Record<string, unknown>;
};

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
  reasoningContent?: string;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ChatResponse = {
  message: ChatMessage;
  toolCalls?: ToolCallRequest[];
  usage?: ChatUsage;
  finishReason?: string;
};

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "tool-call"; call: ToolCallRequest }
  | { type: "done"; response: ChatResponse };

export type GenerateOptions = {
  messages: ChatMessage[];
  tools?: ToolSchema[];
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
};

export interface LlmProvider {
  readonly name: string;
  generate(options: GenerateOptions): Promise<ChatResponse>;
  stream?(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

export type DeepSeekProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  defaultModel?: string;
};

type DeepSeekMessage = {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  reasoning_content?: string;
};

type DeepSeekTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export class DeepSeekProvider implements LlmProvider {
  readonly name = "deepseek";
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultModel = options.defaultModel ?? "deepseek-v4-flash";
  }

  async generate(options: GenerateOptions): Promise<ChatResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages: this.toWireMessages(options.messages, options.systemPrompt),
        tools: options.tools?.map((tool) => this.toWireTool(tool)),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        reasoning_effort: options.reasoningEffort,
        thinking: { type: "disabled" },
        stream: false
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`DeepSeek request failed: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`);
    }

    const payload = await response.json() as {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          role?: ChatRole;
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{
            id?: string;
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = payload.choices?.[0];
    const message = choice?.message;

    return {
      message: {
        role: message?.role ?? "assistant",
        content: message?.content ?? "",
        toolCalls: message?.tool_calls?.map((call, index) => ({
          id: call.id ?? `tool_call_${index}`,
          name: call.function?.name ?? "unknown",
          arguments: safeJsonParse(call.function?.arguments)
        })),
        reasoningContent: message?.reasoning_content
      },
      toolCalls: message?.tool_calls?.map((call, index) => ({
        id: call.id ?? `tool_call_${index}`,
        name: call.function?.name ?? "unknown",
        arguments: safeJsonParse(call.function?.arguments)
      })),
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        totalTokens: payload.usage?.total_tokens
      },
      finishReason: choice?.finish_reason
    };
  }

  private toWireMessages(messages: ChatMessage[], systemPrompt?: string): DeepSeekMessage[] {
    const wireMessages = messages.map((message) => ({
      role: message.role,
      content: message.content,
      name: message.name,
      tool_call_id: message.toolCallId,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments)
        }
      })),
      reasoning_content: message.reasoningContent
    }));

    if (systemPrompt) {
      return [{ role: "system", content: systemPrompt }, ...wireMessages];
    }

    return wireMessages;
  }

  private toWireTool(tool: ToolSchema): DeepSeekTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input
      }
    };
  }
}

function safeJsonParse(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { raw: value };
  }

  return {};
}
