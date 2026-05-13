import type {
  InferenceModelListResponse,
  InferenceProviderId,
  InferenceSettingsResponse,
} from "@secretary/core-runtime";
import type { Dispatch, SetStateAction } from "react";
import { SurfaceCard } from "../lib/ui";

type InferenceDraft = {
  activeTarget: "provider" | "local";
  enabled: boolean;
  selectedProviderId: InferenceProviderId;
  baseUrl: string;
  model: string;
  maxOutputTokens: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  apiKey: string;
};

interface InferenceSettingsSectionProps {
  inference: InferenceSettingsResponse | null;
  inferenceDraft: InferenceDraft | null;
  setInferenceDraft: Dispatch<SetStateAction<InferenceDraft | null>>;
  selectedProvider: InferenceSettingsResponse["providers"][number] | null;
  localProvider: InferenceSettingsResponse["providers"][number] | null;
  localProviderOptions: InferenceSettingsResponse["providers"];
  providerDropdownGroups: Array<{
    key: string;
    title: string;
    providers: InferenceSettingsResponse["providers"];
  }>;
  providerById: Record<string, InferenceSettingsResponse["providers"][number]>;
  models: InferenceModelListResponse["models"];
  setModels: Dispatch<SetStateAction<InferenceModelListResponse["models"]>>;
  isLoadingModels: boolean;
  isSavingInference: boolean;
  loadModels: () => Promise<void>;
  clearInferenceKey: () => Promise<void>;
  saveInference: () => Promise<void>;
  switchInferenceTab: (tab: "provider" | "local") => void;
  providerAuthLabel: (provider: InferenceSettingsResponse["providers"][number]) => string;
}

export function InferenceSettingsSection({
  inference,
  inferenceDraft,
  setInferenceDraft,
  selectedProvider,
  localProvider,
  localProviderOptions,
  providerDropdownGroups,
  providerById,
  models,
  setModels,
  isLoadingModels,
  isSavingInference,
  loadModels,
  clearInferenceKey,
  saveInference,
  switchInferenceTab,
  providerAuthLabel,
}: InferenceSettingsSectionProps) {
  const inferenceTab = inferenceDraft?.activeTarget ?? "provider";

  return (
    <SurfaceCard
      title="Inference"
      description={
        <p>
          Choose either a hosted provider or the local runtime, then set the model the secretary
          should use.
        </p>
      }
      className="stack-md"
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { id: "provider", label: "Provider" },
            { id: "local", label: "Local" },
          ].map((tab) => {
            const active = inferenceTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchInferenceTab(tab.id as "provider" | "local")}
                className={active ? "button-primary" : "button-secondary"}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {inferenceTab === "provider" ? (
          <>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Provider</span>
                <select
                  value={inferenceDraft?.selectedProviderId ?? ""}
                  onChange={(event) => {
                    const nextProviderId = event.target.value as InferenceProviderId;
                    const nextProvider = providerById[nextProviderId];

                    setInferenceDraft((current) =>
                      current && nextProvider
                        ? {
                            ...current,
                            activeTarget: "provider",
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
                  {providerDropdownGroups.map((group) => (
                    <optgroup key={group.key} label={group.title}>
                      {group.providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label} · {providerAuthLabel(provider)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <div
                style={{
                  display: "grid",
                  gap: 6,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "rgba(32, 26, 21, 0.72)",
                }}
              >
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Provider summary</span>
                <p style={{ margin: 0, lineHeight: 1.55 }}>
                  {selectedProvider?.description ?? "Choose a provider to configure."}
                </p>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
                  {selectedProvider?.summary ??
                    "Hosted providers use the AI SDK registry path and keep local fallback available if auth is missing."}
                </p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "minmax(0, 1.2fr) minmax(150px, 190px) minmax(170px, 210px)",
              }}
            >
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
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Max output tokens</span>
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
            </div>

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
            ) : selectedProvider?.authMode === "api_key_or_account" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>API key (optional)</span>
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
                      : "Optional when ambient cloud auth is available"
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
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
                {selectedProvider?.authMode === "account_authorized"
                  ? "This provider relies on an account-authorized runtime instead of a stored API key."
                  : "No stored API key is needed for this provider."}
              </p>
            )}
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              {localProvider?.summary ??
                "Local mode runs the secretary against the local runtime instead of a hosted provider."}
            </p>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(170px, 210px)",
              }}
            >
              <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Local runtime</span>
                <select
                  value={inferenceDraft?.selectedProviderId ?? localProvider?.id ?? ""}
                  onChange={(event) => {
                    const nextProvider = providerById[event.target.value];

                    setInferenceDraft((current) =>
                      current && nextProvider
                        ? {
                            ...current,
                            activeTarget: "local",
                            selectedProviderId: nextProvider.id,
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
                  {localProviderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Local URL</span>
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
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Max output tokens</span>
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
                  placeholder="600"
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
            </div>

            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
              Local mode talks straight to your local runtime. Pick whichever local endpoint is
              already running on your machine.
            </p>
          </>
        )}

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
              "No inference provider is configured yet, so the secretary will stay on local fallback."}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void loadModels()}
              disabled={
                isLoadingModels ||
                (inferenceTab === "provider"
                  ? !selectedProvider?.supportsModelFetch
                  : !localProvider?.supportsModelFetch)
              }
              className="button-secondary"
            >
              {isLoadingModels ? "Fetching models..." : "Fetch models"}
            </button>
            {inferenceTab === "provider" ? (
              <button
                type="button"
                onClick={() => void clearInferenceKey()}
                disabled={
                  isSavingInference ||
                  selectedProvider?.authMode !== "api_key" ||
                  !selectedProvider?.apiKeyConfigured
                }
                className="button-secondary"
              >
                Clear saved key
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void saveInference()}
              disabled={isSavingInference}
              className="button-primary"
            >
              {isSavingInference
                ? "Saving..."
                : inferenceTab === "provider"
                  ? "Save provider"
                  : "Save local"}
            </button>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}
