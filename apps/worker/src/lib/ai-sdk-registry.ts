/**
 * AI SDK provider registry — lean edition.
 *
 * Only includes providers that are actually usable in this codebase:
 *   - Cloud / API providers:  OpenAI, Anthropic, HuggingFace, OpenRouter,
 *     Moonshot/Kimi (via OpenAI-compatible), OpenCode Zen/Go (via OAI-compatible)
 *   - Local runtimes:        Ollama, LM Studio, llama.cpp
 *   - Agentic CLI tools:     Claude Code, Codex CLI, Gemini CLI, OpenCode SDK
 *
 * All other providers that were previously imported and case-handled have been removed
 * to reduce bundle size, startup import cost, and compilation overhead. To re-add any
 * removed provider, restore its import and case statement here and its definition in
 * `inference-provider-definitions.ts`.
 */
import { createProviderRegistry } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createHuggingFace } from "@ai-sdk/huggingface";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { createCodexCli } from "ai-sdk-provider-codex-cli";
import { createGeminiProvider } from "ai-sdk-provider-gemini-cli";
// Deferred: ai-sdk-provider-opencode-sdk is loaded lazily to avoid TDZ on repoRoot
// import { createOpencode } from "ai-sdk-provider-opencode-sdk";
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

export type InferenceResolutionIssue =
  | "disabled"
  | "missing_provider"
  | "unknown_provider"
  | "missing_model"
  | "missing_api_key"
  | "registry_unavailable";

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
    // ── Cloud / API providers ────────────────────────────────────────────────
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

    // ── OpenAI-compatible providers ─────────────────────────────────────────
    // Moonshot / Kimi Code — use OpenAI-compatible with the Kimi endpoint.
    case "moonshot":
      return createOpenAICompatible({
        name: "moonshot",
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? "https://api.kimi.com/coding/v1",
      });
    // OpenCode Zen — curated pay-as-you-go models via OpenAI-compatible.
    // See https://opencode.ai/docs/zen/
    case "opencode_zen":
      return createOpenAICompatible({
        name: "opencode-zen",
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? "https://opencode.ai/zen/v1",
      });
    // OpenCode Go — low-cost subscription models via OpenAI-compatible.
    // See https://opencode.ai/docs/go/
    case "opencode_go":
      return createOpenAICompatible({
        name: "opencode-go",
        apiKey: inference.apiKey ?? undefined,
        baseURL: inference.baseUrl ?? "https://opencode.ai/zen/go/v1",
      });

    // ── Local runtimes (Ollama, LM Studio, llama.cpp) ───────────────────────
    // Direct Ollama local server — no API key required.
    case "ollama_local":
      return createOllama({
        baseURL: inference.baseUrl ?? undefined,
        compatibility: "strict",
        name: "ollama",
      });
    // Ollama Cloud — hosted Ollama account via OpenAI-compatible API.
    case "ollama_cloud":
      return createOpenAICompatible({
        name: "ollama-cloud",
        baseURL: inference.baseUrl ?? "https://ollama.com/v1",
        apiKey: inference.apiKey ?? undefined,
      });
    // LM Studio — local model server via OpenAI-compatible.
    case "lmstudio":
      return createOpenAICompatible({
        name: "lmstudio",
        baseURL: inference.baseUrl ?? "http://127.0.0.1:1234/v1",
        apiKey: inference.apiKey ?? undefined,
      });
    // llama.cpp server — local GGUF serving via OpenAI-compatible.
    case "llama_cpp":
      return createOpenAICompatible({
        name: "llama-cpp",
        baseURL: inference.baseUrl ?? "http://127.0.0.1:8080/v1",
        apiKey: inference.apiKey ?? undefined,
      });

    // ── Agentic CLI tools ───────────────────────────────────────────────────
    case "opencode": {
      // Lazy require to avoid TDZ — repoRoot must be initialized first
      const { createOpencode } = require("ai-sdk-provider-opencode-sdk");
      return createOpencode({
        baseUrl: inference.baseUrl ?? undefined,
        autoStartServer: true,
        defaultSettings: {
          agent: isAgentJob ? "build" : "general",
          directory: isAgentJob ? workspacePath : undefined,
          cwd: isAgentJob ? workspacePath : undefined,
        },
      });
    }
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

export function getInferenceResolutionIssue(
  inference: InferenceRuntimeConfig,
  options: InferenceResolutionOptions = {},
): InferenceResolutionIssue | null {
  if (!inference.enabled) {
    return "disabled";
  }

  if (!inference.providerId) {
    return "missing_provider";
  }

  const definition = getInferenceProviderDefinition(inference.providerId);

  if (!definition) {
    return "unknown_provider";
  }

  if (!inference.model) {
    return "missing_model";
  }

  if (
    providerNeedsApiKey(definition.id) &&
    providerSupportsStoredApiKey(definition.authMode) &&
    !inference.apiKey
  ) {
    return "missing_api_key";
  }

  const registry = buildRegistry(inference, options);

  if (!registry) {
    return "registry_unavailable";
  }

  return null;
}
