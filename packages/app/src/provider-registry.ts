import { DeepSeekProvider, OpenAICompatibleProvider, type LlmProvider } from "@zer-agent/llm-core";
import { type AppConfig, readProviderApiKey, type ProviderId } from "./config.js";

export function createProvider(config: AppConfig, providerId: ProviderId = config.provider, model = config.model): LlmProvider {
  const providerConfig = { ...config, provider: providerId, model };
  const apiKey = readProviderApiKey(providerConfig);

  if (providerId === "openai-compatible") {
    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl: providerConfig.openAIBaseUrl,
      defaultModel: model
    });
  }

  return new DeepSeekProvider({
    apiKey,
    baseUrl: providerConfig.deepSeekBaseUrl,
    defaultModel: model
  });
}

export function listProviderIds(): ProviderId[] {
  return ["deepseek", "openai-compatible"];
}
