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

export type OpenAICompatibleProviderOptions = {
  name?: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  defaultModel?: string;
};

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
        messages: toWireMessages(options.messages, options.systemPrompt),
        tools: options.tools?.map(toWireTool),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        reasoning_effort: options.reasoningEffort,
        thinking: { type: "disabled" },
        stream: false
      })
    });

    return parseChatCompletionResponse(response, "DeepSeek");
  }
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.name = options.name ?? "openai-compatible";
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultModel = options.defaultModel ?? "gpt-4.1-mini";
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
        messages: toWireMessages(options.messages, options.systemPrompt),
        tools: options.tools?.map(toWireTool),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: false
      })
    });

    return parseChatCompletionResponse(response, "OpenAI-compatible");
  }
}

function toWireMessages(messages: ChatMessage[], systemPrompt?: string): DeepSeekMessage[] {
  const wireMessages = messages.map((message) => {
    const wireMessage: DeepSeekMessage = {
      role: message.role,
      content: message.content,
      name: message.name,
      tool_call_id: message.toolCallId,
      reasoning_content: message.reasoningContent
    };

    if (message.toolCalls?.length) {
      wireMessage.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments)
        }
      }));
    }

    return wireMessage;
  });

  if (systemPrompt) {
    return [{ role: "system", content: systemPrompt }, ...wireMessages];
  }

  return wireMessages;
}

function toWireTool(tool: ToolSchema): DeepSeekTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input
    }
  };
}

async function parseChatCompletionResponse(response: Response, providerName: string): Promise<ChatResponse> {
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${providerName} request failed: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`);
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
  const parsedToolCalls = message?.tool_calls?.map((call, index) => ({
    id: call.id ?? `tool_call_${index}`,
    name: call.function?.name ?? "unknown",
    arguments: safeJsonParse(call.function?.arguments)
  })) ?? [];
  const inferredToolCalls = parsedToolCalls.length > 0 ? [] : parseDsmlToolCalls(message?.content);
  const normalizedToolCalls = parsedToolCalls.length > 0 ? parsedToolCalls : inferredToolCalls;
  const responseToolCalls = normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined;
  const normalizedContent = inferredToolCalls.length > 0
    ? stripDsmlToolCalls(message?.content ?? "")
    : (message?.content ?? "");

  return {
    message: {
      role: message?.role ?? "assistant",
      content: normalizedContent,
      toolCalls: responseToolCalls,
      reasoningContent: message?.reasoning_content
    },
    toolCalls: responseToolCalls,
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
      totalTokens: payload.usage?.total_tokens
    },
    finishReason: choice?.finish_reason
  };
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

function parseDsmlToolCalls(content: string | undefined): ToolCallRequest[] {
  if (!content || !/tool_calls/i.test(content) || !/invoke name=/i.test(content)) {
    return [];
  }

  const invokePattern = /<[^>]*invoke name="([^"]+)"[^>]*>([\s\S]*?)<\/[^>]*invoke>/gi;
  const calls: ToolCallRequest[] = [];
  let match: RegExpExecArray | null;
  let callIndex = 0;

  while ((match = invokePattern.exec(content)) !== null) {
    callIndex += 1;
    const name = match[1] ?? "unknown";
    const body = match[2] ?? "";
    const argumentsObject: Record<string, unknown> = {};
    const parameterPattern = /<[^>]*parameter name="([^"]+)" string="(true|false)"[^>]*>([\s\S]*?)<\/[^>]*parameter>/gi;
    let parameterMatch: RegExpExecArray | null;

    while ((parameterMatch = parameterPattern.exec(body)) !== null) {
      const parameterName = parameterMatch[1] ?? "value";
      const isString = parameterMatch[2] === "true";
      const rawValue = decodeXmlEntities((parameterMatch[3] ?? "").trim());
      argumentsObject[parameterName] = isString ? rawValue : coerceScalar(rawValue);
    }

    calls.push({
      id: `dsml_tool_call_${callIndex}`,
      name,
      arguments: argumentsObject
    });
  }

  return calls;
}

function stripDsmlToolCalls(content: string): string {
  return content.replace(/<[^>]*tool_calls[^>]*>[\s\S]*?<\/[^>]*tool_calls>/gi, "").trim();
}

function coerceScalar(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
