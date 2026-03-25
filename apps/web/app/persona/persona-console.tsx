"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  InferenceModelListResponse,
  InferenceProviderId,
  InferenceSettingsResponse,
  PersonaGender,
  PersonaSettingsResponse,
  SettingsExportResponse,
  SettingsImportRequest,
  SettingsImportResponse,
  UpdateInferenceSettingsRequest,
  UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";
import { AppPage, PageHero } from "../lib/ui";

type PersonaDraft = {
  behaviorRulesText: string;
  gender: PersonaGender;
  name: string;
  personaProfile: string;
  promptTemplate: string;
  toneMode: string;
  voiceProfileId: string;
};

type InferenceDraft = {
  enabled: boolean;
  selectedProviderId: InferenceProviderId;
  baseUrl: string;
  model: string;
  maxOutputTokens: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  apiKey: string;
};

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createInferenceDraft(response: InferenceSettingsResponse): InferenceDraft | null {
  const selectedProvider =
    response.providers.find(
      (provider) => provider.id === response.settings.selectedProviderId,
    ) ?? response.providers[0];

  if (!selectedProvider) {
    return null;
  }

  return {
    enabled: response.settings.enabled,
    selectedProviderId: selectedProvider.id,
    baseUrl: selectedProvider.baseUrl ?? "",
    model: selectedProvider.model ?? "",
    maxOutputTokens:
      selectedProvider.maxOutputTokens != null
        ? String(selectedProvider.maxOutputTokens)
        : "",
    reasoningEffort: response.settings.reasoningEffort,
    apiKey: "",
  };
}

export function PersonaConsole() {
  const [data, setData] = useState<PersonaSettingsResponse | null>(null);
  const [draft, setDraft] = useState<PersonaDraft | null>(null);
  const [inference, setInference] = useState<InferenceSettingsResponse | null>(null);
  const [inferenceDraft, setInferenceDraft] = useState<InferenceDraft | null>(null);
  const [models, setModels] = useState<InferenceModelListResponse["models"]>([]);
  const [importJson, setImportJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingInference, setIsSavingInference] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const selectedProvider = useMemo(() => {
    if (!inferenceDraft || !inference) {
      return null;
    }

    return (
      inference.providers.find(
        (provider) => provider.id === inferenceDraft.selectedProviderId,
      ) ?? null
    );
  }, [inference, inferenceDraft]);

  async function load() {
    try {
      const [personaResponse, inferenceResponse] = await Promise.all([
        fetch("/api/persona", { cache: "no-store" }),
        fetch("/api/inference", { cache: "no-store" }),
      ]);
      const [personaPayload, inferencePayload] = await Promise.all([
        personaResponse.json(),
        inferenceResponse.json(),
      ]);

      if (!personaResponse.ok) {
        throw new Error(personaPayload.error ?? "Unable to load persona settings.");
      }

      if (!inferenceResponse.ok) {
        throw new Error(inferencePayload.error ?? "Unable to load inference settings.");
      }

      const next = personaPayload as PersonaSettingsResponse;
      const nextInference = inferencePayload as InferenceSettingsResponse;
      setData(next);
      setDraft({
        behaviorRulesText: next.persona.behaviorRules.join("\n"),
        gender: next.persona.gender ?? "female",
        name: next.persona.name,
        personaProfile: next.personaProfile,
        promptTemplate: next.persona.promptTemplate,
        toneMode: next.persona.toneMode ?? "calm",
        voiceProfileId: next.persona.voiceProfileId ?? "",
      });
      setInference(nextInference);
      setInferenceDraft(createInferenceDraft(nextInference));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load persona.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    setStatus(null);
    setError(null);

    try {
      const body: UpdatePersonaSettingsRequest = {
        name: draft.name,
        promptTemplate: draft.promptTemplate,
        toneMode: draft.toneMode,
        gender: draft.gender,
        personaProfile: draft.personaProfile,
        behaviorRules: draft.behaviorRulesText
          .split("\n")
          .map((rule) => rule.trim())
          .filter(Boolean),
        voiceProfileId: draft.voiceProfileId || null,
      };

      const response = await fetch("/api/persona", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update persona.");
      }

      setStatus("Persona settings saved.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update persona.");
    } finally {
      setIsSaving(false);
    }
  }

  async function loadModels() {
    if (!inferenceDraft) {
      return;
    }

    setIsLoadingModels(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch(
        `/api/inference/models?providerId=${encodeURIComponent(inferenceDraft.selectedProviderId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to fetch models.");
      }

      const data = payload as InferenceModelListResponse;
      setModels(data.models);
      setStatus(
        data.models.length > 0
          ? `Fetched ${data.models.length} ${data.source} models for ${selectedProvider?.label ?? inferenceDraft.selectedProviderId}.`
          : "No models were returned by the provider.",
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to fetch models.");
    } finally {
      setIsLoadingModels(false);
    }
  }

  async function saveInference() {
    if (!inferenceDraft) {
      return;
    }

    setIsSavingInference(true);
    setStatus(null);
    setError(null);

    try {
      const body: UpdateInferenceSettingsRequest = {
        enabled: inferenceDraft.enabled,
        selectedProviderId: inferenceDraft.selectedProviderId,
        reasoningEffort: inferenceDraft.reasoningEffort,
        providerConfig: {
          id: inferenceDraft.selectedProviderId,
          baseUrl: inferenceDraft.baseUrl,
          model: inferenceDraft.model,
          maxOutputTokens:
            inferenceDraft.maxOutputTokens.trim().length > 0
              ? Number(inferenceDraft.maxOutputTokens)
              : undefined,
          apiKey:
            inferenceDraft.apiKey.trim().length > 0
              ? inferenceDraft.apiKey.trim()
              : undefined,
        },
      };

      const response = await fetch("/api/inference", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update inference settings.");
      }

      const next = payload as InferenceSettingsResponse;
      setInference(next);
      setInferenceDraft(createInferenceDraft(next));
      setStatus("Inference settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to update inference settings.",
      );
    } finally {
      setIsSavingInference(false);
    }
  }

  async function clearInferenceKey() {
    if (!inferenceDraft) {
      return;
    }

    setIsSavingInference(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/inference", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
          selectedProviderId: inferenceDraft.selectedProviderId,
          providerConfig: {
            id: inferenceDraft.selectedProviderId,
            apiKey: null,
          },
        } satisfies UpdateInferenceSettingsRequest),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to clear inference key.");
      }

      const next = payload as InferenceSettingsResponse;
      setInference(next);
      setInferenceDraft(createInferenceDraft(next));
      setStatus("Saved inference key cleared. Samantha is back on local fallback.");
    } catch (clearError) {
      setError(
        clearError instanceof Error ? clearError.message : "Unable to clear inference key.",
      );
    } finally {
      setIsSavingInference(false);
    }
  }

  async function exportSettings() {
    setIsExporting(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/export/settings", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to export settings.");
      }

      const data = payload as SettingsExportResponse;
      downloadJson(
        `secretary-settings-${data.exportedAt.replace(/[:.]/g, "-")}.json`,
        data,
      );
      setStatus("Settings snapshot exported.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export settings.");
    } finally {
      setIsExporting(false);
    }
  }

  async function importSettings() {
    setIsImporting(true);
    setStatus(null);
    setError(null);

    try {
      const parsed = JSON.parse(importJson) as SettingsExportResponse | SettingsImportRequest;
      const requestBody: SettingsImportRequest =
        "snapshot" in parsed ? { snapshot: parsed.snapshot } : parsed;
      const response = await fetch("/api/import/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to import settings.");
      }

      const data = payload as SettingsImportResponse;
      setStatus(`Imported settings for ${data.persona.name}.`);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import settings.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <AppPage>
      <PageHero
        eyebrow="Persona Settings"
        title="Shape how the Secretary sounds and behaves"
        description={
          <p>
            Edit the Secretary&apos;s soul, identity, voice preference, and standing
            behavior in one place. This is the layer that should define how the
            Secretary feels whenever she wakes up into a conversation.
          </p>
        }
        meta={
          <p>
            {error ??
              status ??
              `Load, tune, export, or import the current settings.${data?.soulFilePath ? ` Soul file: ${data.soulFilePath}` : ""}${data?.personaFilePath ? ` Persona file: ${data.personaFilePath}` : ""}`}
          </p>
        }
        tone="dark"
      />

      {data ? (
        <section
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 18,
            border: "1px solid var(--border)",
            background: "var(--panel-strong)",
            display: "grid",
            gap: 8,
          }}
        >
          <p
            style={{
              margin: 0,
              color: "var(--muted)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Conversation engine
          </p>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            {data.conversationEngine.mode === "provider"
              ? `${data.conversationEngine.provider} · ${data.conversationEngine.model}`
              : "Local deterministic fallback"}
          </p>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, fontSize: 13 }}>
            {data.conversationEngine.summary}
          </p>
        </section>
      ) : null}

      <section
        style={{
          marginBottom: 20,
          padding: 20,
          borderRadius: 24,
          border: "1px solid var(--border)",
          background: "var(--panel-strong)",
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <h2 style={{ margin: 0 }}>Conversation provider</h2>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
            Samantha can now use direct AI SDK providers instead of one hardcoded
            inference path. Pick the provider you actually use, save its credentials if
            needed, choose a model, and only fall back when you want to.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr) minmax(180px, 220px)",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Provider</span>
            <select
              value={inferenceDraft?.selectedProviderId ?? ""}
              onChange={(event) => {
                const nextProviderId = event.target.value as InferenceProviderId;
                const nextProvider = inference?.providers.find(
                  (provider) => provider.id === nextProviderId,
                );

                setInferenceDraft((current) =>
                  current && nextProvider
                    ? {
                        ...current,
                        selectedProviderId: nextProviderId,
                        baseUrl: nextProvider.baseUrl ?? "",
                        model: nextProvider.model ?? "",
                        maxOutputTokens:
                          nextProvider.maxOutputTokens != null
                            ? String(nextProvider.maxOutputTokens)
                            : "",
                        apiKey: "",
                      }
                    : current,
                );
                setModels([]);
              }}
              style={{
                borderRadius: 12,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: "10px 12px",
                font: "inherit",
              }}
            >
              {(inference?.providers ?? []).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Base URL</span>
            <input
              value={inferenceDraft?.baseUrl ?? ""}
              onChange={(event) =>
                setInferenceDraft((current) =>
                  current ? { ...current, baseUrl: event.target.value } : current,
                )
              }
              style={{
                borderRadius: 12,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: "10px 12px",
                font: "inherit",
              }}
            />
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "end",
              gap: 10,
              paddingBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={inferenceDraft?.enabled ?? false}
              onChange={(event) =>
                setInferenceDraft((current) =>
                  current ? { ...current, enabled: event.target.checked } : current,
                )
              }
            />
            <span style={{ color: "var(--text)", fontSize: 14 }}>
              Enable model-backed chat
            </span>
          </label>
        </div>

        {selectedProvider ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            {selectedProvider.description} {selectedProvider.summary} The output budget
            below is your call, so Samantha will spend up to that many output tokens on
            a reply.
          </p>
        ) : null}

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns:
              "minmax(0, 1.1fr) minmax(170px, 220px) minmax(170px, 220px) minmax(170px, 260px)",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Model</span>
            <input
              list="inference-models"
              value={inferenceDraft?.model ?? ""}
              onChange={(event) =>
                setInferenceDraft((current) =>
                  current ? { ...current, model: event.target.value } : current,
                )
              }
              placeholder="Choose or type a model id"
              style={{
                borderRadius: 12,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: "10px 12px",
                font: "inherit",
              }}
            />
            <datalist id="inference-models">
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name ?? model.id}
                </option>
              ))}
            </datalist>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Reasoning</span>
            <select
              value={inferenceDraft?.reasoningEffort ?? "low"}
              onChange={(event) =>
                setInferenceDraft((current) =>
                  current
                    ? {
                        ...current,
                        reasoningEffort: event.target.value as
                          | "minimal"
                          | "low"
                          | "medium"
                          | "high",
                      }
                    : current,
                )
              }
              disabled={!selectedProvider?.supportsReasoningEffort}
              style={{
                borderRadius: 12,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: "10px 12px",
                font: "inherit",
                opacity: selectedProvider?.supportsReasoningEffort ? 1 : 0.65,
              }}
            >
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Max output tokens
            </span>
            <input
              type="number"
              min={64}
              max={12000}
              step={1}
              value={inferenceDraft?.maxOutputTokens ?? ""}
              onChange={(event) =>
                setInferenceDraft((current) =>
                  current ? { ...current, maxOutputTokens: event.target.value } : current,
                )
              }
              placeholder="700"
              style={{
                borderRadius: 12,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: "10px 12px",
                font: "inherit",
              }}
            />
          </label>

          {selectedProvider?.authMode === "api_key" ? (
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>API key</span>
              <input
                type="password"
                autoComplete="off"
                value={inferenceDraft?.apiKey ?? ""}
                onChange={(event) =>
                  setInferenceDraft((current) =>
                    current ? { ...current, apiKey: event.target.value } : current,
                  )
                }
                placeholder={
                  selectedProvider.apiKeyConfigured
                    ? "Saved. Enter a new key only to replace it."
                    : "Paste provider key"
                }
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              />
            </label>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 6,
                alignContent: "start",
              }}
            >
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Auth mode</span>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>
                {selectedProvider?.authMode === "account_authorized"
                  ? "Uses your local/account-authorized runtime. No API key is stored here."
                  : "No API key is required for this provider."}
              </p>
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {(inference?.providers ?? []).map((provider) => (
            <div
              key={provider.id}
              style={{
                borderRadius: 16,
                border: `1px solid ${provider.isSelected ? "var(--accent)" : "var(--border)"}`,
                background: provider.isSelected
                  ? "rgba(35, 102, 86, 0.14)"
                  : "rgba(22, 18, 14, 0.72)",
                padding: 14,
                display: "grid",
                gap: 6,
              }}
            >
              <p style={{ margin: 0, fontWeight: 700 }}>{provider.label}</p>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
                {provider.model ?? "No model selected yet"}
              </p>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
                {provider.authMode === "api_key"
                  ? provider.apiKeyConfigured
                    ? "Key saved"
                    : "Key needed"
                  : provider.authMode === "account_authorized"
                    ? "Account-backed"
                    : "No key required"}
              </p>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            {inference?.settings.summary ??
              "No inference provider is configured yet, so Samantha will stay on local fallback."}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void loadModels()}
              disabled={isLoadingModels || !selectedProvider?.supportsModelFetch}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "10px 14px",
                font: "inherit",
                cursor:
                  isLoadingModels || !selectedProvider?.supportsModelFetch
                    ? "not-allowed"
                    : "pointer",
                color: "var(--text)",
                background: "rgba(22, 18, 14, 0.92)",
              }}
            >
              {isLoadingModels ? "Fetching models..." : "Fetch models"}
            </button>
            <button
              type="button"
              onClick={() => void clearInferenceKey()}
              disabled={
                isSavingInference ||
                selectedProvider?.authMode !== "api_key" ||
                !selectedProvider?.apiKeyConfigured
              }
              style={{
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "10px 14px",
                font: "inherit",
                cursor:
                  isSavingInference ||
                  selectedProvider?.authMode !== "api_key" ||
                  !selectedProvider?.apiKeyConfigured
                    ? "not-allowed"
                    : "pointer",
                color: "var(--text)",
                background: "rgba(22, 18, 14, 0.92)",
              }}
            >
              Clear saved key
            </button>
            <button
              type="button"
              onClick={() => void saveInference()}
              disabled={isSavingInference}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "10px 16px",
                font: "inherit",
                fontWeight: 700,
                cursor: isSavingInference ? "wait" : "pointer",
                color: "#f6fffd",
                background:
                  "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
              }}
            >
              {isSavingInference ? "Saving..." : "Save provider"}
            </button>
          </div>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.95fr)",
        }}
      >
        <article
          style={{
            padding: 20,
            borderRadius: 24,
            border: "1px solid var(--border)",
            background: "var(--panel-strong)",
            display: "grid",
            gap: 14,
          }}
        >
          <h2 style={{ margin: 0 }}>Secretary soul and identity</h2>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Name</span>
            <input
              value={draft?.name ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              style={{
                borderRadius: 12,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: "10px 12px",
                font: "inherit",
              }}
            />
          </label>
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns:
                "minmax(150px, 200px) minmax(160px, 200px) minmax(180px, 260px)",
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Secretary gender</span>
              <select
                value={draft?.gender ?? "female"}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, gender: event.target.value as PersonaGender }
                      : current,
                  )
                }
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Tone mode</span>
              <input
                value={draft?.toneMode ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, toneMode: event.target.value } : current,
                  )
                }
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Voice profile</span>
              <select
                value={draft?.voiceProfileId ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, voiceProfileId: event.target.value } : current,
                  )
                }
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              >
                <option value="">No voice profile selected</option>
                {(data?.voiceProfiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.isActive ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            Gender steers the default secretary disposition and which built-in voice
            profile is preferred when no custom cloned voice has been attached.
          </p>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Secretary soul (.md-backed)</span>
            <textarea
              value={draft?.promptTemplate ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, promptTemplate: event.target.value } : current,
                )
              }
              rows={8}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
          </label>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            This editor writes the live Secretary soul file and the stored persona setting
            together, so you can change her voice and inner framing on the fly from the browser.
          </p>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Samantha persona profile (.md-backed)
            </span>
            <textarea
              value={draft?.personaProfile ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, personaProfile: event.target.value } : current,
                )
              }
              rows={10}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
          </label>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            The persona profile is the lived texture of Samantha: voice, posture, habits,
            and what she should feel like in the room. The soul is the deeper inner framing.
          </p>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Behavior rules (one per line)
            </span>
            <textarea
              value={draft?.behaviorRulesText ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, behaviorRulesText: event.target.value }
                    : current,
                )
              }
              rows={6}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "12px 18px",
                font: "inherit",
                fontWeight: 700,
                cursor: isSaving ? "wait" : "pointer",
                color: "#f6fffd",
                background:
                  "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
              }}
            >
              {isSaving ? "Saving..." : "Save Persona"}
            </button>
          </div>
        </article>

        <article
          style={{
            padding: 20,
            borderRadius: 24,
            border: "1px solid var(--border)",
            background: "var(--panel-strong)",
            display: "grid",
            gap: 14,
          }}
        >
          <h2 style={{ margin: 0 }}>Settings import and export</h2>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
            Export a clean JSON snapshot of personas, integrations, tools, and voice
            profile settings. Importing a snapshot reapplies those settings without
            touching conversation history.
          </p>
          <button
            type="button"
            onClick={() => void exportSettings()}
            disabled={isExporting}
            style={{
              justifySelf: "start",
              border: "none",
              borderRadius: 999,
              padding: "12px 18px",
              font: "inherit",
              fontWeight: 700,
              cursor: isExporting ? "wait" : "pointer",
              color: "#f6fffd",
              background:
                "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
            }}
          >
            {isExporting ? "Exporting..." : "Export settings"}
          </button>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Paste a settings snapshot JSON
            </span>
            <textarea
              value={importJson}
              onChange={(event) => setImportJson(event.target.value)}
              rows={14}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => void importSettings()}
              disabled={isImporting || importJson.trim().length === 0}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "12px 18px",
                font: "inherit",
                cursor:
                  isImporting || importJson.trim().length === 0 ? "not-allowed" : "pointer",
                color: "var(--text)",
                background: "rgba(22, 18, 14, 0.92)",
              }}
            >
              {isImporting ? "Importing..." : "Import settings"}
            </button>
          </div>
        </article>
      </section>
    </AppPage>
  );
}
