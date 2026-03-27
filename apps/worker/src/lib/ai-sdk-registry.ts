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

export type InferenceResolutionPurpose = "conversation" | "agent_job";

type InferenceResolutionOptions = {
  purpose?: InferenceResolutionPurpose;
  workspacePath?: string | null;
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

function createProviderForDefinition(
  inference: InferenceRuntimeConfig,
  options: InferenceResolutionOptions,
) {
  const definition = getInferenceProviderDefinition(inference.providerId);

  if (!definition) {
    return null;
  }

  const workspacePath = options.workspacePath?.trim() || process.cwd();
  const isAgentJob = options.purpose === "agent_job";

  switch (definition.id) {
    case "openai":
      return createOpenAI({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "anthropic":
      return createAnthropic({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "google":
      return createGoogleGenerativeAI({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "google_vertex":
      return createVertex({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "xai":
      return createXai({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "moonshot":
      return createMoonshotAI({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "mistral":
      return createMistral({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "togetherai":
      return createTogetherAI({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "cohere":
      return createCohere({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "fireworks":
      return createFireworks({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "deepinfra":
      return createDeepInfra({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "deepseek":
      return createDeepSeek({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "cerebras":
      return createCerebras({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "groq":
      return createGroq({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "perplexity":
      return createPerplexity({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "azure":
      return createAzure({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "amazon_bedrock":
      return createAmazonBedrock({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "baseten":
      return createBaseten({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "vercel":
      return createVercel({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "huggingface":
      return createHuggingFace({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
      });
    case "openrouter":
      return createOpenRouter({
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? undefined,
        compatibility: "strict",
      });
    case "ollama_local":
      return createOllama({
        baseURL: inference.baseUrl ?? undefined,
        compatibility: "strict",
        name: "ollama",
      });
    case "ollama_cloud":
      return createOpenAICompatible({
        name: "ollama-cloud",
        baseURL: inference.baseUrl ?? "https://ollama.com/v1",
        apiKey: inference.apiKey ?? undefined,
      });
    case "lmstudio":
      return createOpenAICompatible({
        name: "lmstudio",
        baseURL: inference.baseUrl ?? "http://127.0.0.1:1234/v1",
        apiKey: inference.apiKey ?? undefined,
      });
    case "llama_cpp":
      return createOpenAICompatible({
        name: "llama-cpp",
        baseURL: inference.baseUrl ?? "http://127.0.0.1:8080/v1",
        apiKey: inference.apiKey ?? undefined,
      });
    case "opencode":
      return createOpencode({
        baseUrl: inference.baseUrl ?? undefined,
        autoStartServer: true,
        defaultSettings: {
          agent: isAgentJob ? "build" : "general",
          directory: isAgentJob ? workspacePath : undefined,
          cwd: isAgentJob ? workspacePath : undefined,
        },
      });
    case "codex_cli":
      return createCodexCli({
        defaultSettings: {
          cwd: workspacePath,
          sandboxMode: "workspace-write",
          approvalMode: "never",
        },
      });
    case "gemini_cli":
      return createGeminiProvider({
        authType: "oauth-personal",
      });
    case "claude_code":
      return createClaudeCode({
        defaultSettings: {
          cwd: workspacePath,
        },
      });
    default:
      return null;
  }
}

function buildRegistry(
  inference: InferenceRuntimeConfig,
  options: InferenceResolutionOptions,
) {
  const definition = getInferenceProviderDefinition(inference.providerId);
  const provider = createProviderForDefinition(inference, options);

  if (!definition || !provider) {
    return null;
  }

  return createProviderRegistry({
    [definition.id]: provider,
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
  options: InferenceResolutionOptions = {},
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

  const registry = buildRegistry(inference, options);

  if (!registry) {
    return null;
  }

  const modelId =
    `${definition.id}:${inference.model}` as Parameters<typeof registry.languageModel>[0];

  return {
    model: registry.languageModel(modelId),
    providerOptions: buildProviderOptions(inference),
    modelId,
  };
}
