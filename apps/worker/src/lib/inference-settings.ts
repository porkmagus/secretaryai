import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  InferenceModelListResponse,
  InferenceProviderAuthMode,
  InferenceProviderId,
  InferenceSettingsResponse,
  InferenceTarget,
  UpdateInferenceSettingsRequest,
} from "@secretary/core-runtime";
import {
  getInferenceProviderDefinition,
  inferenceProviderDefinitions,
  isLocalRuntimeProvider,
  providerSupportsStoredApiKey,
} from "./inference-provider-definitions.js";
import { repoRoot } from "./utils.js";

// Lazy initialization to avoid circular dependency issues
function getSettingsFilePath() {
  return resolve(repoRoot, "runtime/config/inference-provider.json");
}
function getSecretFilePath() {
  return resolve(repoRoot, "runtime/secrets/inference-provider.json");
}

type StoredInferenceSettings = {
  enabled: boolean;
  activeTarget: InferenceTarget;
  selectedProviderId: InferenceProviderId | null;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  providers: Partial<
    Record<
      string,
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
    string,
    {
      apiKey?: string;
    }
  >
>;

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

function normalizeProviderId(providerId?: string | null): InferenceProviderId | null {
  return getInferenceProviderDefinition(providerId)?.id ?? null;
}

function normalizeBaseUrl(providerId: InferenceProviderId, baseUrl?: string | null) {
  const definition = getInferenceProviderDefinition(providerId);

  if (!definition) {
    return baseUrl?.trim() || null;
  }

  const fallback = definition.defaultBaseUrl;
  const normalizedSource = baseUrl?.trim() || fallback;

  if (!normalizedSource) {
    return null;
  }

  const normalized = normalizedSource.replace(/\/+$/, "");

  if (providerId === "ollama_cloud" && /^https:\/\/ollama\.com$/i.test(normalized)) {
    return "https://ollama.com/v1";
  }

  return normalized;
}

function normalizeModel(providerId: InferenceProviderId, model?: string | null) {
  const definition = getInferenceProviderDefinition(providerId);
  const normalized = model?.trim();

  if (normalized) {
    return normalized;
  }

  return definition?.defaultModel ?? null;
}

function normalizeMaxOutputTokens(
  providerId: InferenceProviderId,
  maxOutputTokens?: number | null,
) {
  const definition = getInferenceProviderDefinition(providerId);
  const fallback = definition?.defaultMaxOutputTokens ?? 1000;

  if (typeof maxOutputTokens !== "number" || !Number.isFinite(maxOutputTokens)) {
    return fallback;
  }

  return Math.max(64, Math.min(12000, Math.round(maxOutputTokens)));
}

function normalizeStoredSettings(
  settings: StoredInferenceSettings | null,
): StoredInferenceSettings {
  const selectedProviderId = normalizeProviderId(settings?.selectedProviderId) ?? null;

  return {
    enabled: settings?.enabled ?? false,
    activeTarget:
      settings?.activeTarget === "local" || isLocalRuntimeProvider(selectedProviderId)
        ? "local"
        : "provider",
    selectedProviderId,
    reasoningEffort: normalizeReasoningEffort(settings?.reasoningEffort),
    providers: settings?.providers ?? {},
  };
}

async function readStoredSettings() {
  return normalizeStoredSettings(
    await readJsonFile<StoredInferenceSettings>(getSettingsFilePath()),
  );
}

async function readStoredSecrets() {
  return (await readJsonFile<StoredInferenceSecrets>(getSecretFilePath())) ?? {};
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

function buildProviderSummary(params: {
  label: string;
  authMode: InferenceProviderAuthMode;
  baseUrl: string | null;
  model: string | null;
  isSelected: boolean;
  apiKeyConfigured: boolean;
  accessMode: InferenceSettingsResponse["providers"][number]["accessMode"];
}) {
  const modelLine = params.model ? ` on ${params.model}` : "";

  switch (params.authMode) {
    case "api_key":
      if (!params.apiKeyConfigured) {
        return `No saved API key for ${params.label} yet.`;
      }

      return params.isSelected
        ? `${params.label} is selected and ready${modelLine}.`
        : `Saved key available for ${params.label}.`;
    case "api_key_or_account":
      return params.isSelected
        ? `${params.label} is selected${modelLine}. It can use a saved key or ambient cloud authentication.`
        : `${params.label} can use a saved key or ambient cloud authentication.`;
    case "account_authorized":
      return params.isSelected
        ? `${params.label} is selected${modelLine}. It relies on a linked local or account-authorized runtime.`
        : `${params.label} can use a linked local or account-authorized runtime.`;
    default:
      return params.isSelected
        ? `${params.label} is selected${modelLine} at ${params.baseUrl ?? "its default local endpoint"}.`
        : `${params.label} is available as a local runtime.`;
  }
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
        "Secretary text conversation is running on the local deterministic fallback until an inference provider is configured.",
    };
  }

  const selectedProvider = params.providers.find(
    (provider) => provider.id === params.selectedProviderId,
  );

  if (!selectedProvider) {
    return {
      mode: "deterministic_fallback" as const,
      summary:
        "Secretary text conversation is running on the local deterministic fallback until an inference provider is configured.",
    };
  }

  if (!selectedProvider.model) {
    return {
      mode: "deterministic_fallback" as const,
      summary: `${selectedProvider.label} is selected, but no model is set yet. The secretary is still on local deterministic fallback.`,
    };
  }

  const runtimeReady = providerHasUsableAuth({
    authMode: selectedProvider.authMode,
    apiKey: selectedProvider.apiKeyConfigured ? "configured" : null,
  });

  if (!runtimeReady) {
    return {
      mode: "deterministic_fallback" as const,
      summary: `The secretary is set to use ${selectedProvider.label}, but credentials are missing. The local deterministic fallback is still active.`,
    };
  }

  const endpointPhrase =
    selectedProvider.accessMode === "local_runtime"
      ? "local runtime"
      : selectedProvider.accessMode === "linked_account"
        ? "linked runtime"
        : "provider";

  return {
    mode: "provider" as const,
    summary: `Secretary text conversation is configured to use ${selectedProvider.label} on ${selectedProvider.model} through the ${endpointPhrase} path.`,
  };
}

export async function loadInferenceSettings(): Promise<InferenceSettingsResponse> {
  const storedSettings = await readStoredSettings();
  const storedSecrets = await readStoredSecrets();

  const providers = inferenceProviderDefinitions.map((definition) => {
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
      docsUrl: definition.docsUrl,
      packageName: definition.packageName,
      providerFamily: definition.providerFamily,
      accessMode: definition.accessMode,
      availableInApp: definition.availableInApp,
      baseUrl,
      model,
      maxOutputTokens,
      apiKeyConfigured: providerSupportsStoredApiKey(definition.authMode) && Boolean(apiKey),
      supportsModelFetch: definition.supportsModelFetch,
      supportsReasoningEffort: definition.supportsReasoningEffort,
      isSelected,
      summary: buildProviderSummary({
        label: definition.label,
        authMode: definition.authMode,
        baseUrl,
        model,
        isSelected,
        apiKeyConfigured: Boolean(apiKey),
        accessMode: definition.accessMode,
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
      activeTarget: storedSettings.activeTarget,
      selectedProviderId: storedSettings.selectedProviderId,
      reasoningEffort: storedSettings.reasoningEffort,
      source: "file",
      summary: summary.summary,
    },
    providers,
  };
}

export async function updateInferenceSettings(params: { request: UpdateInferenceSettingsRequest }) {
  const currentSettings = await readStoredSettings();
  const currentSecrets = await readStoredSecrets();

  if (params.request.providerConfig) {
    const providerId = normalizeProviderId(params.request.providerConfig.id);

    if (!providerId) {
      throw new Error("Inference provider is not supported.");
    }

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

  const nextSelectedProviderId =
    params.request.selectedProviderId !== undefined
      ? normalizeProviderId(params.request.selectedProviderId)
      : currentSettings.selectedProviderId;

  const nextSettings: StoredInferenceSettings = {
    enabled: params.request.enabled ?? currentSettings.enabled,
    activeTarget:
      params.request.activeTarget ??
      (isLocalRuntimeProvider(nextSelectedProviderId) ? "local" : currentSettings.activeTarget),
    selectedProviderId: nextSelectedProviderId,
    reasoningEffort: normalizeReasoningEffort(
      params.request.reasoningEffort ?? currentSettings.reasoningEffort,
    ),
    providers: currentSettings.providers,
  };

  await writeJsonFile(getSettingsFilePath(), nextSettings);
  await writeJsonFile(getSecretFilePath(), currentSecrets);

  return loadInferenceSettings();
}

function stripToOllamaRoot(baseUrl: string) {
  return baseUrl.replace(/\/v1$/i, "");
}

async function listGenericModels(params: {
  providerId: InferenceProviderId;
  baseUrl: string;
  apiKey: string | null;
}): Promise<InferenceModelListResponse> {
  const headers: Record<string, string> = {};

  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const response = await fetch(`${params.baseUrl}/models`, { headers });

  if (!response.ok) {
    throw new Error(`${params.providerId} model fetch failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string | null;
      owned_by?: string | null;
      description?: string | null;
    }>;
  };

  return {
    providerId: params.providerId,
    source: "remote",
    models: (payload.data ?? []).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      ownedBy: model.owned_by ?? null,
      description: model.description ?? null,
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
  providerId: InferenceProviderId;
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
  // Lazy import to avoid TDZ — repoRoot must be initialized before the SDK loads
  const { OpencodeModels } = require("ai-sdk-provider-opencode-sdk");
  return {
    providerId: "opencode",
    source: "static",
    models: Object.entries(OpencodeModels).map(([id, model]) => ({
      id: model as string,
      name: id,
    })),
  };
}

async function listCodexModels(): Promise<InferenceModelListResponse> {
  // Lazy import to avoid TDZ
  const { listModels } = await import("ai-sdk-provider-codex-cli");
  const payload = await listModels();

  return {
    providerId: "codex_cli",
    source: "static",
    models: payload.models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      ownedBy: model.modelProvider ?? null,
      description: model.description ?? null,
    })),
  };
}

export async function listInferenceModels(
  providerId?: InferenceProviderId | null,
): Promise<InferenceModelListResponse> {
  const settings = await loadInferenceSettings();
  const selectedProviderId = providerId ?? settings.settings.selectedProviderId;

  if (!selectedProviderId) {
    throw new Error("Choose an inference provider before fetching models.");
  }

  const selectedProvider = settings.providers.find(
    (provider) => provider.id === selectedProviderId,
  );
  const definition = getInferenceProviderDefinition(selectedProviderId);

  if (!selectedProvider || !definition) {
    throw new Error("Inference provider not found.");
  }

  if (!definition.supportsModelFetch) {
    throw new Error(`Model fetch is not available for ${definition.label} yet.`);
  }

  const apiKey = selectedProvider.apiKeyConfigured
    ? (await readStoredSecrets())[selectedProvider.id]?.apiKey?.trim() || null
    : null;

  switch (definition.runtimeKind) {
    case "openrouter":
      return listOpenRouterModels(
        selectedProvider.baseUrl ?? definition.defaultBaseUrl ?? "https://openrouter.ai/api/v1",
      );
    case "huggingface":
      return listHuggingFaceModels();
    case "opencode":
      return listOpencodeModels();
    case "codex_cli":
      return listCodexModels();
    case "ollama":
      return listOllamaModels({
        providerId: selectedProvider.id,
        baseUrl: selectedProvider.baseUrl ?? definition.defaultBaseUrl ?? "http://127.0.0.1:11434",
        apiKey,
      });
    case "openai_compatible":
      if (
        selectedProvider.id === "ollama_cloud" &&
        selectedProvider.baseUrl &&
        (() => {
          try {
            const hostname = new URL(selectedProvider.baseUrl).hostname;
            return hostname === "ollama.com" || hostname.endsWith(".ollama.com");
          } catch {
            return false;
          }
        })()
      ) {
        return listOllamaModels({
          providerId: selectedProvider.id,
          baseUrl: selectedProvider.baseUrl,
          apiKey,
        });
      }

      return listGenericModels({
        providerId: selectedProvider.id,
        baseUrl:
          selectedProvider.baseUrl ?? definition.defaultBaseUrl ?? "http://127.0.0.1:1234/v1",
        apiKey,
      });
    case "openai":
      return listGenericModels({
        providerId: selectedProvider.id,
        baseUrl:
          selectedProvider.baseUrl ?? definition.defaultBaseUrl ?? "https://api.openai.com/v1",
        apiKey,
      });
    default:
      throw new Error(`Model fetch is not available for ${definition.label} yet.`);
  }
}

export async function getInferenceRuntimeConfig() {
  const settings = await loadInferenceSettings();
  const selectedProvider = settings.providers.find(
    (provider) => provider.id === settings.settings.selectedProviderId,
  );

  if (!settings.settings.enabled || !selectedProvider?.model) {
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

  const secret = selectedProvider.apiKeyConfigured
    ? (await readStoredSecrets())[selectedProvider.id]?.apiKey?.trim() || null
    : null;
  const runtimeReady = providerHasUsableAuth({
    authMode: selectedProvider.authMode,
    apiKey: secret,
  });

  return {
    enabled: runtimeReady,
    providerId: selectedProvider.id,
    providerLabel: selectedProvider.label,
    authMode: selectedProvider.authMode,
    baseUrl: selectedProvider.baseUrl,
    model: selectedProvider.model,
    maxOutputTokens: selectedProvider.maxOutputTokens,
    reasoningEffort: settings.settings.reasoningEffort,
    apiKey: secret,
    summary: settings.settings.summary,
  };
}
