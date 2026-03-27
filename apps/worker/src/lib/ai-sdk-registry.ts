import { createProviderRegistry } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createBaseten } from "@ai-sdk/baseten";
import { createCerebras } from "@ai-sdk/cerebras";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGroq } from "@ai-sdk/groq";
import { createHuggingFace } from "@ai-sdk/huggingface";
import { createMistral } from "@ai-sdk/mistral";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createVercel } from "@ai-sdk/vercel";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { createCodexCli } from "ai-sdk-provider-codex-cli";
import { createGeminiProvider } from "ai-sdk-provider-gemini-cli";
import { createOpencode } from "ai-sdk-provider-opencode-sdk";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModelV3, SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { InferenceProviderId } from "@secretary/core-runtime";
import {
  getInferenceProviderDefinition,
  providerSupportsStoredApiKey,
} from "./inference-provider-definitions.js";

export type InferenceRuntimeConfig = {
  providerId: InferenceProviderId | null;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  maxOutputTokens: number | null;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  enabled: boolean;
};

function hasElevatedReasoning(
  reasoningEffort: InferenceRuntimeConfig["reasoningEffort"],
) {
  return reasoningEffort === "medium" || reasoningEffort === "high";
}

function buildProviderOptions(
  inference: InferenceRuntimeConfig,
): SharedV3ProviderOptions | undefined {
  const definition = getInferenceProviderDefinition(inference.providerId);

  if (!definition) {
    return undefined;
  }

  switch (definition.runtimeKind) {
    case "moonshot":
      return hasElevatedReasoning(inference.reasoningEffort)
        ? ({
            moonshotai: {
              thinking: {
                type: "enabled",
              },
            },
          } satisfies SharedV3ProviderOptions)
        : undefined;
    case "openrouter":
      return inference.reasoningEffort === "minimal"
        ? undefined
        : ({
            openrouter: {
              reasoning: {
                effort: inference.reasoningEffort,
              },
            },
          } satisfies SharedV3ProviderOptions);
    case "openai":
      return inference.reasoningEffort === "minimal"
        ? undefined
        : ({
            openai: {
              reasoningEffort: inference.reasoningEffort,
            },
          } satisfies SharedV3ProviderOptions);
    case "azure":
      return inference.reasoningEffort === "minimal"
        ? undefined
        : ({
            azure: {
              reasoningEffort: inference.reasoningEffort,
            },
          } satisfies SharedV3ProviderOptions);
    case "xai":
      return inference.reasoningEffort === "minimal"
        ? ({
            xai: {
              reasoningEffort: "low",
            },
          } satisfies SharedV3ProviderOptions)
        : ({
            xai: {
              reasoningEffort:
                inference.reasoningEffort === "high" ? "high" : "medium",
            },
          } satisfies SharedV3ProviderOptions);
    case "openai_compatible":
      return inference.reasoningEffort === "minimal"
        ? undefined
        : ({
            openaiCompatible: {
              reasoningEffort: inference.reasoningEffort,
            },
          } satisfies SharedV3ProviderOptions);
    default:
      return undefined;
  }
}

function buildRegistry(inference: InferenceRuntimeConfig) {
  return createProviderRegistry({
    openai: createOpenAI({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    anthropic: createAnthropic({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    google: createGoogleGenerativeAI({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    google_vertex: createVertex({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    xai: createXai({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    moonshot: createMoonshotAI({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    mistral: createMistral({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    togetherai: createTogetherAI({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    cohere: createCohere({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    fireworks: createFireworks({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    deepinfra: createDeepInfra({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    deepseek: createDeepSeek({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    cerebras: createCerebras({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    groq: createGroq({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    perplexity: createPerplexity({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    azure: createAzure({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    amazon_bedrock: createAmazonBedrock({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    baseten: createBaseten({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    vercel: createVercel({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    huggingface: createHuggingFace({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
    }),
    openrouter: createOpenRouter({
      apiKey: inference.apiKey ?? undefined,
      baseURL: inference.baseUrl ?? undefined,
      compatibility: "strict",
    }),
    ollama_local: createOllama({
      baseURL: inference.baseUrl ?? undefined,
      compatibility: "strict",
      name: "ollama",
    }),
    ollama_cloud: createOpenAICompatible({
      name: "ollama-cloud",
      baseURL: inference.baseUrl ?? "https://ollama.com/v1",
      apiKey: inference.apiKey ?? undefined,
    }),
    lmstudio: createOpenAICompatible({
      name: "lmstudio",
      baseURL: inference.baseUrl ?? "http://127.0.0.1:1234/v1",
      apiKey: inference.apiKey ?? undefined,
    }),
    llama_cpp: createOpenAICompatible({
      name: "llama-cpp",
      baseURL: inference.baseUrl ?? "http://127.0.0.1:8080/v1",
      apiKey: inference.apiKey ?? undefined,
    }),
    opencode: createOpencode({
      baseUrl: inference.baseUrl ?? undefined,
      autoStartServer: true,
      defaultSettings: {
        agent: "general",
      },
    }),
    codex_cli: createCodexCli({
      defaultSettings: {
        cwd: process.cwd(),
        sandboxMode: "workspace-write",
        approvalMode: "never",
      },
    }),
    gemini_cli: createGeminiProvider({
      authType: "oauth-personal",
    }),
    claude_code: createClaudeCode({
      defaultSettings: {
        cwd: process.cwd(),
      },
    }),
  });
}

function providerNeedsApiKey(providerId: InferenceProviderId) {
  const definition = getInferenceProviderDefinition(providerId);

  if (!definition) {
    return false;
  }

  return definition.authMode === "api_key";
}

export function resolveInferenceLanguageModel(
  inference: InferenceRuntimeConfig,
): {
  model: LanguageModelV3;
  providerOptions?: SharedV3ProviderOptions;
  modelId: string;
} | null {
  const definition = getInferenceProviderDefinition(inference.providerId);

  if (!inference.enabled || !definition || !inference.model) {
    return null;
  }

  if (
    providerNeedsApiKey(definition.id) &&
    providerSupportsStoredApiKey(definition.authMode) &&
    !inference.apiKey
  ) {
    return null;
  }

  const registry = buildRegistry(inference);
  const modelId =
    `${definition.id}:${inference.model}` as Parameters<typeof registry.languageModel>[0];

  return {
    model: registry.languageModel(modelId),
    providerOptions: buildProviderOptions(inference),
    modelId,
  };
}
