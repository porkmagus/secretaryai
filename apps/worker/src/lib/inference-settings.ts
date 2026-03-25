import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpencodeModels } from "ai-sdk-provider-opencode-sdk";
import type {
  InferenceModelListResponse,
  InferenceProviderAuthMode,
  InferenceProviderId,
  InferenceSettingsResponse,
  UpdateInferenceSettingsRequest,
} from "@secretary/core-runtime";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const settingsFilePath = resolve(repoRoot, "runtime/config/inference-provider.json");
const secretFilePath = resolve(repoRoot, "runtime/secrets/inference-provider.json");

type StoredInferenceSettings = {
  enabled: boolean;
  selectedProviderId: InferenceProviderId | null;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  providers: Partial<
    Record<
      InferenceProviderId,
      {
        baseUrl?: string | null;
        model?: string | null;
        maxOutputTokens?: number | null;
      }
    >
  >;
};

type StoredInferenceSecrets = Partial<
  Record<
    InferenceProviderId,
    {
      apiKey?: string;
    }
  >
>;

type ProviderDefinition = {
  id: InferenceProviderId;
  label: string;
  description: string;
  authMode: InferenceProviderAuthMode;
  defaultBaseUrl: string | null;
  defaultModel: string;
  defaultMaxOutputTokens: number;
  supportsModelFetch: boolean;
  supportsReasoningEffort: boolean;
};

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "moonshot",
    label: "Kimi Code (Moonshot)",
    description: "Direct Moonshot/Kimi API via the Vercel AI SDK Moonshot provider.",
    authMode: "api_key",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2.5",
    defaultMaxOutputTokens: 700,
    supportsModelFetch: true,
    supportsReasoningEffort: true,
  },
  {
    id: "ollama_local",
    label: "Ollama",
    description: "Direct local Ollama runtime on your machine or LAN.",
    authMode: "none",
    defaultBaseUrl: "http://127.0.0.1:11434",
    defaultModel: "qwen3:8b",
    defaultMaxOutputTokens: 600,
    supportsModelFetch: true,
    supportsReasoningEffort: false,
  },
  {
    id: "ollama_cloud",
    label: "Ollama Cloud",
    description: "Hosted Ollama account through its OpenAI-compatible API.",
    authMode: "api_key",
    defaultBaseUrl: "https://ollama.com/v1",
    defaultModel: "qwen3:30b",
    defaultMaxOutputTokens: 900,
    supportsModelFetch: true,
    supportsReasoningEffort: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter direct provider with its own model routing and provider mix.",
    authMode: "api_key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "moonshotai/kimi-k2.5",
    defaultMaxOutputTokens: 700,
    supportsModelFetch: true,
    supportsReasoningEffort: true,
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    description: "Hugging Face Inference Router through the official AI SDK provider.",
    authMode: "api_key",
    defaultBaseUrl: "https://router.huggingface.co/v1",
    defaultModel: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    defaultMaxOutputTokens: 700,
    supportsModelFetch: true,
    supportsReasoningEffort: false,
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Local/account-authorized OpenCode runtime for subscription-backed access.",
    authMode: "account_authorized",
    defaultBaseUrl: "http://127.0.0.1:4096",
    defaultModel: OpencodeModels["claude-sonnet-4-5"],
    defaultMaxOutputTokens: 700,
    supportsModelFetch: true,
    supportsReasoningEffort: false,
  },
];

const providerDefinitionMap = Object.fromEntries(
  providerDefinitions.map((provider) => [provider.id, provider]),
) as Record<InferenceProviderId, ProviderDefinition>;

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(path: string, payload: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeReasoningEffort(
  reasoningEffort?: string | null,
): "minimal" | "low" | "medium" | "high" {
  switch (reasoningEffort?.trim()) {
    case "minimal":
      return "minimal";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "low";
  }
}

function normalizeProviderId(
  providerId?: string | null,
): InferenceProviderId | null {
  if (!providerId) {
    return null;
  }

  return providerDefinitionMap[providerId as InferenceProviderId]
    ? (providerId as InferenceProviderId)
    : null;
}

function normalizeBaseUrl(
  providerId: InferenceProviderId,
  baseUrl?: string | null,
) {
  const defaultBaseUrl = providerDefinitionMap[providerId].defaultBaseUrl;

  if (!defaultBaseUrl) {
    return baseUrl?.trim() || null;
  }

  const normalized = (baseUrl?.trim() || defaultBaseUrl).replace(/\/+$/, "");

  if (
    providerId === "ollama_cloud" &&
    /^https:\/\/ollama\.com$/i.test(normalized)
  ) {
    return "https://ollama.com/v1";
  }

  return normalized;
}

function normalizeModel(
  providerId: InferenceProviderId,
  model?: string | null,
) {
  return model?.trim() || providerDefinitionMap[providerId].defaultModel;
}

function normalizeMaxOutputTokens(
  providerId: InferenceProviderId,
  maxOutputTokens?: number | null,
) {
  if (typeof maxOutputTokens !== "number" || !Number.isFinite(maxOutputTokens)) {
    return providerDefinitionMap[providerId].defaultMaxOutputTokens;
  }

  return Math.max(64, Math.min(12000, Math.round(maxOutputTokens)));
}

function normalizeStoredSettings(
  settings: StoredInferenceSettings | null,
): StoredInferenceSettings {
  return {
    enabled: settings?.enabled ?? false,
    selectedProviderId: normalizeProviderId(settings?.selectedProviderId) ?? null,
    reasoningEffort: normalizeReasoningEffort(settings?.reasoningEffort),
    providers: settings?.providers ?? {},
  };
}

async function readStoredSettings() {
  return normalizeStoredSettings(
    await readJsonFile<StoredInferenceSettings>(settingsFilePath),
  );
}

async function readStoredSecrets() {
  return (await readJsonFile<StoredInferenceSecrets>(secretFilePath)) ?? {};
}

function providerHasUsableAuth(params: {
  authMode: InferenceProviderAuthMode;
  apiKey: string | null;
}) {
  if (params.authMode === "api_key") {
    return Boolean(params.apiKey);
  }

  return true;
}

function toProviderSummary(params: {
  definition: ProviderDefinition;
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
  isSelected: boolean;
}) {
  const { definition, model, apiKey, isSelected } = params;

  if (definition.authMode === "api_key") {
    if (apiKey) {
      return isSelected
        ? `${definition.label} is selected and ready on ${model}.`
        : `Saved key available for ${definition.label}.`;
    }

    return `No saved API key for ${definition.label} yet.`;
  }

  if (definition.id === "opencode") {
    return isSelected
      ? `OpenCode is selected and will use the local/account-authorized runtime at ${params.baseUrl ?? "its default endpoint"}.`
      : "OpenCode can use your local/account-authorized runtime without a stored API key.";
  }

  return isSelected
    ? `${definition.label} is selected and will use ${params.baseUrl ?? "its default local endpoint"}.`
    : `${definition.label} is available without a stored API key.`;
}

function buildSummary(params: {
  enabled: boolean;
  selectedProviderId: InferenceProviderId | null;
  providers: InferenceSettingsResponse["providers"];
}) {
  if (!params.enabled || !params.selectedProviderId) {
    return {
      mode: "deterministic_fallback" as const,
      summary:
        "Samantha text conversation is running on the local deterministic fallback until an inference provider is configured.",
    };
  }

  const selectedProvider = params.providers.find(
    (provider) => provider.id === params.selectedProviderId,
  );

  if (!selectedProvider) {
    return {
      mode: "deterministic_fallback" as const,
      summary:
        "Samantha text conversation is running on the local deterministic fallback until an inference provider is configured.",
    };
  }

  const definition = providerDefinitionMap[selectedProvider.id];
  const runtimeReady = providerHasUsableAuth({
    authMode: definition.authMode,
    apiKey: selectedProvider.apiKeyConfigured ? "configured" : null,
  });

  if (!runtimeReady) {
    return {
      mode: "deterministic_fallback" as const,
      summary: `Samantha is set to use ${selectedProvider.label}, but credentials are missing. The local deterministic fallback is still active.`,
    };
  }

  return {
    mode: "provider" as const,
    summary: `Samantha text conversation is configured to use ${selectedProvider.label} on ${selectedProvider.model}.`,
  };
}

export async function loadInferenceSettings(): Promise<InferenceSettingsResponse> {
  const storedSettings = await readStoredSettings();
  const storedSecrets = await readStoredSecrets();

  const providers = providerDefinitions.map((definition) => {
    const storedProvider = storedSettings.providers[definition.id];
    const apiKey = storedSecrets[definition.id]?.apiKey?.trim() || null;
    const baseUrl = normalizeBaseUrl(definition.id, storedProvider?.baseUrl);
    const model = normalizeModel(definition.id, storedProvider?.model);
    const maxOutputTokens = normalizeMaxOutputTokens(
      definition.id,
      storedProvider?.maxOutputTokens,
    );
    const isSelected = storedSettings.selectedProviderId === definition.id;

    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      authMode: definition.authMode,
      baseUrl,
      model,
      maxOutputTokens,
      apiKeyConfigured: Boolean(apiKey),
      supportsModelFetch: definition.supportsModelFetch,
      supportsReasoningEffort: definition.supportsReasoningEffort,
      isSelected,
      summary: toProviderSummary({
        definition,
        baseUrl,
        model,
        apiKey,
        isSelected,
      }),
    };
  });

  const summary = buildSummary({
    enabled: storedSettings.enabled,
    selectedProviderId: storedSettings.selectedProviderId,
    providers,
  });

  return {
    settings: {
      enabled: storedSettings.enabled,
      mode: summary.mode,
      selectedProviderId: storedSettings.selectedProviderId,
      reasoningEffort: storedSettings.reasoningEffort,
      source: "file",
      summary: summary.summary,
    },
    providers,
  };
}

export async function updateInferenceSettings(params: {
  request: UpdateInferenceSettingsRequest;
}) {
  const currentSettings = await readStoredSettings();
  const currentSecrets = await readStoredSecrets();

  if (params.request.providerConfig) {
    const providerId = params.request.providerConfig.id;
    currentSettings.providers[providerId] = {
      baseUrl:
        params.request.providerConfig.baseUrl !== undefined
          ? params.request.providerConfig.baseUrl
          : currentSettings.providers[providerId]?.baseUrl,
      model:
        params.request.providerConfig.model !== undefined
          ? params.request.providerConfig.model
          : currentSettings.providers[providerId]?.model,
      maxOutputTokens:
        params.request.providerConfig.maxOutputTokens !== undefined
          ? params.request.providerConfig.maxOutputTokens
          : currentSettings.providers[providerId]?.maxOutputTokens,
    };

    if (params.request.providerConfig.apiKey !== undefined) {
      currentSecrets[providerId] = {
        apiKey: params.request.providerConfig.apiKey?.trim() || "",
      };
    }
  }

  const nextSettings: StoredInferenceSettings = {
    enabled: params.request.enabled ?? currentSettings.enabled,
    selectedProviderId:
      params.request.selectedProviderId !== undefined
        ? normalizeProviderId(params.request.selectedProviderId)
        : currentSettings.selectedProviderId,
    reasoningEffort: normalizeReasoningEffort(
      params.request.reasoningEffort ?? currentSettings.reasoningEffort,
    ),
    providers: currentSettings.providers,
  };

  await writeJsonFile(settingsFilePath, nextSettings);
  await writeJsonFile(secretFilePath, currentSecrets);

  return loadInferenceSettings();
}

function stripToOllamaRoot(baseUrl: string) {
  return baseUrl.replace(/\/v1$/i, "");
}

async function listMoonshotModels(params: {
  baseUrl: string;
  apiKey: string | null;
}): Promise<InferenceModelListResponse> {
  if (!params.apiKey) {
    throw new Error("Set a Moonshot API key before fetching models.");
  }

  const response = await fetch(`${params.baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Moonshot model fetch failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      owned_by?: string | null;
    }>;
  };

  return {
    providerId: "moonshot",
    source: "remote",
    models: (payload.data ?? []).map((model) => ({
      id: model.id,
      ownedBy: model.owned_by ?? null,
    })),
  };
}

async function listOpenRouterModels(baseUrl: string): Promise<InferenceModelListResponse> {
  const response = await fetch(`${baseUrl}/models`);

  if (!response.ok) {
    throw new Error(`OpenRouter model fetch failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string | null;
      description?: string | null;
    }>;
  };

  return {
    providerId: "openrouter",
    source: "remote",
    models: (payload.data ?? []).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      description: model.description ?? null,
    })),
  };
}

async function listOllamaModels(params: {
  providerId: "ollama_local" | "ollama_cloud";
  baseUrl: string;
  apiKey: string | null;
}): Promise<InferenceModelListResponse> {
  const headers: Record<string, string> = {};

  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const response = await fetch(`${stripToOllamaRoot(params.baseUrl)}/api/tags`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Ollama model fetch failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    models?: Array<{
      model: string;
      name?: string | null;
    }>;
  };

  return {
    providerId: params.providerId,
    source: "remote",
    models: (payload.models ?? []).map((model) => ({
      id: model.model,
      name: model.name ?? model.model,
    })),
  };
}

async function listHuggingFaceModels(): Promise<InferenceModelListResponse> {
  const response = await fetch(
    "https://huggingface.co/api/models?pipeline_tag=text-generation&limit=60&sort=downloads&direction=-1",
  );

  if (!response.ok) {
    throw new Error(`Hugging Face model fetch failed (${response.status}).`);
  }

  const payload = (await response.json()) as Array<{
    id: string;
    cardData?: {
      model_name?: string | null;
    };
  }>;

  return {
    providerId: "huggingface",
    source: "remote",
    models: payload.map((model) => ({
      id: model.id,
      name: model.cardData?.model_name ?? model.id,
    })),
  };
}

function listOpencodeModels(): InferenceModelListResponse {
  return {
    providerId: "opencode",
    source: "static",
    models: Object.entries(OpencodeModels).map(([id, model]) => ({
      id: model,
      name: id,
    })),
  };
}

export async function listInferenceModels(
  providerId?: InferenceProviderId | null,
): Promise<InferenceModelListResponse> {
  const settings = await loadInferenceSettings();
  const selectedProviderId =
    providerId ?? settings.settings.selectedProviderId ?? "moonshot";
  const selectedProvider = settings.providers.find(
    (provider) => provider.id === selectedProviderId,
  );

  if (!selectedProvider) {
    throw new Error("Inference provider not found.");
  }

  const apiKey = selectedProvider.apiKeyConfigured
    ? (await readStoredSecrets())[selectedProvider.id]?.apiKey?.trim() || null
    : null;

  switch (selectedProvider.id) {
    case "moonshot":
      return listMoonshotModels({
        baseUrl: selectedProvider.baseUrl ?? providerDefinitionMap.moonshot.defaultBaseUrl!,
        apiKey,
      });
    case "openrouter":
      return listOpenRouterModels(
        selectedProvider.baseUrl ?? providerDefinitionMap.openrouter.defaultBaseUrl!,
      );
    case "ollama_local":
    case "ollama_cloud":
      return listOllamaModels({
        providerId: selectedProvider.id,
        baseUrl:
          selectedProvider.baseUrl ??
          providerDefinitionMap[selectedProvider.id].defaultBaseUrl!,
        apiKey,
      });
    case "huggingface":
      return listHuggingFaceModels();
    case "opencode":
      return listOpencodeModels();
  }
}

export async function getInferenceRuntimeConfig() {
  const settings = await loadInferenceSettings();
  const selectedProvider = settings.providers.find(
    (provider) => provider.id === settings.settings.selectedProviderId,
  );

  if (!settings.settings.enabled || !selectedProvider) {
    return {
      enabled: false,
      providerId: null,
      providerLabel: null,
      authMode: null,
      baseUrl: null,
      model: null,
      maxOutputTokens: null,
      reasoningEffort: settings.settings.reasoningEffort,
      apiKey: null,
      summary: settings.settings.summary,
    };
  }

  const definition = providerDefinitionMap[selectedProvider.id];
  const secret = (await readStoredSecrets())[selectedProvider.id]?.apiKey?.trim() || null;
  const runtimeReady = providerHasUsableAuth({
    authMode: definition.authMode,
    apiKey: secret,
  });

  return {
    enabled: runtimeReady,
    providerId: selectedProvider.id,
    providerLabel: selectedProvider.label,
    authMode: definition.authMode,
    baseUrl: selectedProvider.baseUrl,
    model: selectedProvider.model,
    maxOutputTokens: selectedProvider.maxOutputTokens,
    reasoningEffort: settings.settings.reasoningEffort,
    apiKey: secret,
    summary: settings.settings.summary,
  };
}
