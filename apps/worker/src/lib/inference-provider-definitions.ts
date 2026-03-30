/**
 * Inference provider definitions — lean edition.
 *
 * Only includes providers that are wired into `ai-sdk-registry.ts`.
 * Removed providers (google, xai, mistral, togetherai, cohere, fireworks,
 * deepinfra, deepseek, cerebras, groq, perplexity, azure, amazon_bedrock,
 * baseten, vercel) can be restored here alongside their registry case.
 *
 * Note: Moonshot/Kimi uses the `openai_compatible` runtimeKind because
 * it is configured via createOpenAICompatible in the registry.
 */
import type {
  InferenceProviderAuthMode,
  InferenceProviderCatalogAccessMode,
  InferenceProviderCatalogFamily,
  InferenceProviderId,
} from "@secretary/core-runtime";

export type InferenceRuntimeKind =
  | "openai"
  | "anthropic"
  | "huggingface"
  | "openrouter"
  | "openai_compatible"
  | "opencode"
  | "ollama"
  | "claude_code"
  | "codex_cli"
  | "gemini_cli";

export type InferenceProviderDefinition = {
  id: InferenceProviderId;
  label: string;
  description: string;
  authMode: InferenceProviderAuthMode;
  docsUrl: string;
  packageName: string | null;
  providerFamily: InferenceProviderCatalogFamily;
  accessMode: InferenceProviderCatalogAccessMode;
  availableInApp: boolean;
  defaultBaseUrl: string | null;
  defaultModel: string | null;
  defaultMaxOutputTokens: number;
  supportsModelFetch: boolean;
  supportsReasoningEffort: boolean;
  runtimeKind: InferenceRuntimeKind;
};

const docsBase = "https://ai-sdk.dev";

// ── Cloud / API providers ────────────────────────────────────────────────────

const openaiDef: InferenceProviderDefinition = {
  id: "openai",
  label: "OpenAI",
  description: "Direct OpenAI provider through the AI SDK.",
  authMode: "api_key",
  docsUrl: `${docsBase}/providers/ai-sdk-providers/openai`,
  packageName: "@ai-sdk/openai",
  providerFamily: "ai_sdk_provider",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: null,
  defaultModel: "gpt-5.4",
  defaultMaxOutputTokens: 1200,
  supportsModelFetch: true,
  supportsReasoningEffort: true,
  runtimeKind: "openai",
};

const anthropicDef: InferenceProviderDefinition = {
  id: "anthropic",
  label: "Anthropic",
  description: "Direct Anthropic provider through the AI SDK.",
  authMode: "api_key",
  docsUrl: `${docsBase}/providers/ai-sdk-providers/anthropic`,
  packageName: "@ai-sdk/anthropic",
  providerFamily: "ai_sdk_provider",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: "https://api.anthropic.com/v1",
  defaultModel: "claude-sonnet-4-6",
  defaultMaxOutputTokens: 1400,
  supportsModelFetch: false,
  supportsReasoningEffort: false,
  runtimeKind: "anthropic",
};

const huggingfaceDef: InferenceProviderDefinition = {
  id: "huggingface",
  label: "Hugging Face",
  description: "Hugging Face Inference Router through the AI SDK provider.",
  authMode: "api_key",
  docsUrl: `${docsBase}/providers/ai-sdk-providers/hugging-face`,
  packageName: "@ai-sdk/huggingface",
  providerFamily: "ai_sdk_provider",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: "https://router.huggingface.co/v1",
  defaultModel: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
  defaultMaxOutputTokens: 1000,
  supportsModelFetch: true,
  supportsReasoningEffort: false,
  runtimeKind: "huggingface",
};

const openrouterDef: InferenceProviderDefinition = {
  id: "openrouter",
  label: "OpenRouter",
  description: "OpenRouter routing layer through its community AI SDK provider.",
  authMode: "api_key",
  docsUrl: `${docsBase}/providers/community-providers/openrouter`,
  packageName: "@openrouter/ai-sdk-provider",
  providerFamily: "community",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "moonshotai/kimi-k2.5",
  defaultMaxOutputTokens: 1000,
  supportsModelFetch: true,
  supportsReasoningEffort: true,
  runtimeKind: "openrouter",
};

// ── OpenAI-compatible providers ─────────────────────────────────────────────

const moonshotDef: InferenceProviderDefinition = {
  id: "moonshot",
  label: "Kimi Code (Moonshot)",
  description:
    "Kimi Code API via the OpenAI-compatible endpoint. " +
    "Use your Kimi Code API key from https://platform.moonshot.cn.",
  authMode: "api_key",
  docsUrl: `${docsBase}/providers/openai-compatible-providers`,
  packageName: "@ai-sdk/openai-compatible",
  providerFamily: "openai_compatible",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: "https://api.kimi.com/coding/v1",
  defaultModel: "kimi-for-coding",
  defaultMaxOutputTokens: 900,
  supportsModelFetch: true,
  supportsReasoningEffort: false,
  runtimeKind: "openai_compatible",
};

const opencodeZenDef: InferenceProviderDefinition = {
  id: "opencode_zen",
  label: "OpenCode Zen",
  description:
    "OpenCode Zen API key provider for curated pay-as-you-go models. " +
    "See https://opencode.ai/docs/zen/",
  authMode: "api_key",
  docsUrl: "https://opencode.ai/docs/zen/",
  packageName: "@ai-sdk/openai-compatible",
  providerFamily: "openai_compatible",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: "https://opencode.ai/zen/v1",
  defaultModel: null,
  defaultMaxOutputTokens: 1000,
  supportsModelFetch: true,
  supportsReasoningEffort: false,
  runtimeKind: "openai_compatible",
};

const opencodeGoDef: InferenceProviderDefinition = {
  id: "opencode_go",
  label: "OpenCode Go",
  description:
    "OpenCode Go API key provider for low-cost subscription models. " +
    "See https://opencode.ai/docs/go/",
  authMode: "api_key",
  docsUrl: "https://opencode.ai/docs/go/",
  packageName: "@ai-sdk/openai-compatible",
  providerFamily: "openai_compatible",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: "https://opencode.ai/zen/go/v1",
  defaultModel: null,
  defaultMaxOutputTokens: 1000,
  supportsModelFetch: true,
  supportsReasoningEffort: false,
  runtimeKind: "openai_compatible",
};

const ollamaCloudDef: InferenceProviderDefinition = {
  id: "ollama_cloud",
  label: "Ollama Cloud",
  description: "Hosted Ollama account through its OpenAI-compatible API.",
  authMode: "api_key",
  docsUrl: `${docsBase}/providers/openai-compatible-providers`,
  packageName: "@ai-sdk/openai-compatible",
  providerFamily: "openai_compatible",
  accessMode: "direct_api",
  availableInApp: true,
  defaultBaseUrl: "https://ollama.com/v1",
  defaultModel: "qwen3:30b",
  defaultMaxOutputTokens: 1000,
  supportsModelFetch: true,
  supportsReasoningEffort: true,
  runtimeKind: "openai_compatible",
};

const lmstudioDef: InferenceProviderDefinition = {
  id: "lmstudio",
  label: "LM Studio",
  description: "Local LM Studio runtime through the OpenAI-compatible provider path.",
  authMode: "none",
  docsUrl: `${docsBase}/providers/openai-compatible-providers/lmstudio`,
  packageName: "@ai-sdk/openai-compatible",
  providerFamily: "openai_compatible",
  accessMode: "local_runtime",
  availableInApp: true,
  defaultBaseUrl: "http://127.0.0.1:1234/v1",
  defaultModel: null,
  defaultMaxOutputTokens: 900,
  supportsModelFetch: true,
  supportsReasoningEffort: true,
  runtimeKind: "openai_compatible",
};

const llamaCppDef: InferenceProviderDefinition = {
  id: "llama_cpp",
  label: "llama.cpp",
  description: "Local llama.cpp server through the OpenAI-compatible provider path.",
  authMode: "none",
  docsUrl: `${docsBase}/providers/openai-compatible-providers`,
  packageName: "@ai-sdk/openai-compatible",
  providerFamily: "openai_compatible",
  accessMode: "local_runtime",
  availableInApp: true,
  defaultBaseUrl: "http://127.0.0.1:8080/v1",
  defaultModel: null,
  defaultMaxOutputTokens: 900,
  supportsModelFetch: true,
  supportsReasoningEffort: true,
  runtimeKind: "openai_compatible",
};

// ── Local runtimes ───────────────────────────────────────────────────────────

const ollamaLocalDef: InferenceProviderDefinition = {
  id: "ollama_local",
  label: "Ollama",
  description: "Direct local Ollama runtime on your machine or LAN.",
  authMode: "none",
  docsUrl: `${docsBase}/providers/community-providers/ollama`,
  packageName: "ollama-ai-provider-v2",
  providerFamily: "community",
  accessMode: "local_runtime",
  availableInApp: true,
  defaultBaseUrl: "http://127.0.0.1:11434",
  defaultModel: "qwen3:8b",
  defaultMaxOutputTokens: 900,
  supportsModelFetch: true,
  supportsReasoningEffort: false,
  runtimeKind: "ollama",
};

// ── Agentic CLI tools ───────────────────────────────────────────────────────

const opencodeDef: InferenceProviderDefinition = {
  id: "opencode",
  label: "OpenCode",
  description:
    "Local or account-authorized OpenCode runtime for subscription-backed access.",
  authMode: "account_authorized",
  docsUrl: `${docsBase}/providers/community-providers/opencode-sdk`,
  packageName: "ai-sdk-provider-opencode-sdk",
  providerFamily: "community",
  accessMode: "linked_account",
  availableInApp: true,
  defaultBaseUrl: "http://127.0.0.1:4096",
  defaultModel: "anthropic/claude-sonnet-4-5-20250929",
  defaultMaxOutputTokens: 1000,
  supportsModelFetch: true,
  supportsReasoningEffort: false,
  runtimeKind: "opencode",
};

const codexCliDef: InferenceProviderDefinition = {
  id: "codex_cli",
  label: "Codex CLI",
  description: "ChatGPT subscription-backed or API-key-backed Codex CLI provider.",
  authMode: "account_authorized",
  docsUrl: `${docsBase}/providers/community-providers/codex-cli`,
  packageName: "ai-sdk-provider-codex-cli",
  providerFamily: "community",
  accessMode: "linked_account",
  availableInApp: true,
  defaultBaseUrl: null,
  defaultModel: "gpt-5.3-codex",
  defaultMaxOutputTokens: 1200,
  supportsModelFetch: true,
  supportsReasoningEffort: true,
  runtimeKind: "codex_cli",
};

const geminiCliDef: InferenceProviderDefinition = {
  id: "gemini_cli",
  label: "Gemini CLI",
  description: "Gemini CLI provider for subscription-linked or API-key Gemini access.",
  authMode: "account_authorized",
  docsUrl: `${docsBase}/providers/community-providers/gemini-cli`,
  packageName: "ai-sdk-provider-gemini-cli",
  providerFamily: "community",
  accessMode: "linked_account",
  availableInApp: true,
  defaultBaseUrl: null,
  defaultModel: "gemini-3.1-pro-preview",
  defaultMaxOutputTokens: 1200,
  supportsModelFetch: false,
  supportsReasoningEffort: false,
  runtimeKind: "gemini_cli",
};

const claudeCodeDef: InferenceProviderDefinition = {
  id: "claude_code",
  label: "Claude Code",
  description:
    "Claude Code local/account-linked provider through the community SDK package.",
  authMode: "account_authorized",
  docsUrl: `${docsBase}/providers/community-providers/claude-code`,
  packageName: "ai-sdk-provider-claude-code",
  providerFamily: "community",
  accessMode: "linked_account",
  availableInApp: true,
  defaultBaseUrl: null,
  defaultModel: "sonnet",
  defaultMaxOutputTokens: 1200,
  supportsModelFetch: false,
  supportsReasoningEffort: false,
  runtimeKind: "claude_code",
};

// ── Registry ────────────────────────────────────────────────────────────────

export const inferenceProviderDefinitions: InferenceProviderDefinition[] = [
  // Cloud / API
  openaiDef,
  anthropicDef,
  huggingfaceDef,
  openrouterDef,
  // OpenAI-compatible (Moonshot/Kimi, OpenCode Zen/Go, Ollama Cloud, LM Studio, llama.cpp)
  moonshotDef,
  opencodeZenDef,
  opencodeGoDef,
  ollamaCloudDef,
  lmstudioDef,
  llamaCppDef,
  // Local runtimes
  ollamaLocalDef,
  // Agentic CLI tools
  opencodeDef,
  codexCliDef,
  geminiCliDef,
  claudeCodeDef,
];

export const inferenceProviderDefinitionMap = Object.fromEntries(
  inferenceProviderDefinitions.map((provider) => [provider.id, provider]),
) as Record<InferenceProviderId, InferenceProviderDefinition>;

export function getInferenceProviderDefinition(providerId?: string | null) {
  if (!providerId) {
    return null;
  }

  return inferenceProviderDefinitionMap[providerId as InferenceProviderId] ?? null;
}

export function isLocalRuntimeProvider(providerId?: string | null) {
  return getInferenceProviderDefinition(providerId)?.accessMode === "local_runtime";
}

export function providerSupportsStoredApiKey(authMode: InferenceProviderAuthMode) {
  return authMode === "api_key" || authMode === "api_key_or_account";
}
