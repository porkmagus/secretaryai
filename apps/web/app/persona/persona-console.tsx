"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  InferenceModelListResponse,
  InferenceProviderId,
  InferenceSettingsResponse,
  PersonaGender,
  PersonaSettingsResponse,
  SecretaryClarifyingStyle,
  SecretaryClosingStyle,
  SecretaryDirectness,
  SecretaryGreetingStyle,
  SecretaryInitiative,
  SecretaryMode,
  SecretaryPlanningStyle,
  SecretaryPresenceStyle,
  SecretaryRelationshipRole,
  SecretaryReminderStyle,
  SecretaryResponseLength,
  SettingsExportResponse,
  SettingsImportRequest,
  SettingsImportResponse,
  UpdateInferenceSettingsRequest,
  UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";
import { ActionRow, AppPage, FieldHint, NoticeBanner, SurfaceCard } from "../lib/ui";
import { SecretaryPortraitField } from "../lib/secretary-portrait-field";

type PersonaDraft = {
  addressPreference: string;
  antiExampleReply: string;
  avoidancesText: string;
  behaviorRulesText: string;
  clarifyingStyle: SecretaryClarifyingStyle;
  closingStyle: SecretaryClosingStyle;
  directness: SecretaryDirectness;
  gender: PersonaGender;
  greetingStyle: SecretaryGreetingStyle;
  initiative: SecretaryInitiative;
  mode: SecretaryMode;
  name: string;
  personaProfile: string;
  presenceStyle: SecretaryPresenceStyle;
  relationshipRole: SecretaryRelationshipRole;
  reminderStyle: SecretaryReminderStyle;
  responseLength: SecretaryResponseLength;
  title: string;
  promptTemplate: string;
  toneMode: string;
  voiceProfileId: string;
  exampleReply: string;
  planningStyle: SecretaryPlanningStyle;
};

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

const secretaryModes: Array<{ value: SecretaryMode; label: string }> = [
  { value: "workday", label: "Workday" },
  { value: "personal", label: "Personal" },
  { value: "travel", label: "Travel" },
  { value: "deep_focus", label: "Deep focus" },
  { value: "operator", label: "Operator" },
];

const relationshipRoles: Array<{ value: SecretaryRelationshipRole; label: string }> = [
  { value: "private_secretary", label: "Private secretary" },
  { value: "chief_of_staff", label: "Chief of staff" },
  { value: "operator", label: "Operator" },
  { value: "companion", label: "Companion in the work" },
  { value: "household_coordinator", label: "Household coordinator" },
];

const presenceStyles: Array<{ value: SecretaryPresenceStyle; label: string }> = [
  { value: "composed", label: "Composed" },
  { value: "warm", label: "Warm" },
  { value: "playful", label: "Playful" },
  { value: "formal", label: "Formal" },
  { value: "assertive", label: "Assertive" },
];

const responseLengths: Array<{ value: SecretaryResponseLength; label: string }> = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "expansive", label: "Expansive" },
];

const directnessOptions: Array<{ value: SecretaryDirectness; label: string }> = [
  { value: "soft", label: "Soft" },
  { value: "balanced", label: "Balanced" },
  { value: "direct", label: "Direct" },
];

const initiativeOptions: Array<{ value: SecretaryInitiative; label: string }> = [
  { value: "reactive", label: "Reactive" },
  { value: "balanced", label: "Balanced" },
  { value: "proactive", label: "Proactive" },
];

const planningStyles: Array<{ value: SecretaryPlanningStyle; label: string }> = [
  { value: "checklist", label: "Checklist" },
  { value: "narrative", label: "Narrative" },
  { value: "executive", label: "Executive" },
];

const greetingStyles: Array<{ value: SecretaryGreetingStyle; label: string }> = [
  { value: "minimal", label: "Minimal" },
  { value: "name_forward", label: "Name-forward" },
  { value: "warm", label: "Warm" },
];

const closingStyles: Array<{ value: SecretaryClosingStyle; label: string }> = [
  { value: "none", label: "None" },
  { value: "next_steps", label: "Next steps" },
  { value: "summary", label: "Summary" },
];

const clarifyingStyles: Array<{ value: SecretaryClarifyingStyle; label: string }> = [
  { value: "sparing", label: "Sparing" },
  { value: "balanced", label: "Balanced" },
  { value: "proactive", label: "Proactive" },
];

const reminderStyles: Array<{ value: SecretaryReminderStyle; label: string }> = [
  { value: "gentle", label: "Gentle" },
  { value: "balanced", label: "Balanced" },
  { value: "firm", label: "Firm" },
];

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

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildSecretaryExamplesMarkdown(draft: PersonaDraft) {
  return `# Secretary Examples

## Avoidances
${draft.avoidancesText.trim().length > 0 ? draft.avoidancesText : "- none set"}

## Good Example Reply
${draft.exampleReply.trim().length > 0 ? draft.exampleReply : "_none set_"}

## Reply To Avoid
${draft.antiExampleReply.trim().length > 0 ? draft.antiExampleReply : "_none set_"}
`;
}

const FieldNote = FieldHint;

function createInferenceDraft(response: InferenceSettingsResponse): InferenceDraft | null {
  const selectedProvider =
    response.providers.find(
      (provider) => provider.id === response.settings.selectedProviderId,
    ) ?? response.providers[0];

  if (!selectedProvider) {
    return null;
  }

  return {
    activeTarget: response.settings.activeTarget,
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

export function PersonaConsole({
  embedded = false,
  mode = "all",
}: {
  embedded?: boolean;
  mode?: "all" | "general" | "secretary";
}) {
  const [data, setData] = useState<PersonaSettingsResponse | null>(null);
  const [draft, setDraft] = useState<PersonaDraft | null>(null);
  const [inference, setInference] = useState<InferenceSettingsResponse | null>(null);
  const [inferenceDraft, setInferenceDraft] = useState<InferenceDraft | null>(null);
  const [models, setModels] = useState<InferenceModelListResponse["models"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingInference, setIsSavingInference] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

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

  const activeVoiceName = useMemo(() => {
    if (!data) {
      return "none";
    }

    return (
      data.voiceProfiles.find((profile) => profile.id === draft?.voiceProfileId)?.name ??
      data.voiceProfiles.find((profile) => profile.isActive)?.name ??
      "none"
    );
  }, [data, draft?.voiceProfileId]);

  const providerOptions = useMemo(
    () =>
      (inference?.providers ?? []).filter(
        (provider) => provider.accessMode !== "local_runtime",
      ),
    [inference?.providers],
  );

  const localProviderOptions = useMemo(
    () =>
      (inference?.providers ?? []).filter(
        (provider) => provider.accessMode === "local_runtime",
      ),
    [inference?.providers],
  );

  const providerDropdownGroups = useMemo(() => {
    return [
      {
        key: "direct" as const,
        title: "Direct APIs",
        providers: providerOptions.filter((provider) => provider.accessMode === "direct_api"),
      },
      {
        key: "linked" as const,
        title: "Linked accounts",
        providers: providerOptions.filter(
          (provider) => provider.accessMode === "linked_account",
        ),
      },
      {
        key: "mcp" as const,
        title: "MCP clients",
        providers: providerOptions.filter((provider) => provider.accessMode === "mcp_client"),
      },
    ].filter((group) => group.providers.length > 0);
  }, [providerOptions]);

  const localProvider = useMemo(() => {
    if (selectedProvider?.accessMode === "local_runtime") {
      return selectedProvider;
    }

    return localProviderOptions[0] ?? null;
  }, [localProviderOptions, selectedProvider]);

  const providerById = useMemo(
    () =>
      Object.fromEntries((inference?.providers ?? []).map((provider) => [provider.id, provider])),
    [inference?.providers],
  );

  const inferenceTab = inferenceDraft?.activeTarget ?? "provider";
  const showGeneral = mode !== "secretary";
  const showSecretary = mode !== "general";
  const isLoaded = Boolean(data && draft && (!showGeneral || (inference && inferenceDraft)));

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
        addressPreference: next.persona.customization.addressPreference ?? "",
        antiExampleReply: next.persona.customization.antiExampleReply ?? "",
        avoidancesText: next.persona.customization.avoidances.join("\n"),
        behaviorRulesText: next.persona.behaviorRules.join("\n"),
        clarifyingStyle: next.persona.customization.clarifyingStyle,
        closingStyle: next.persona.customization.closingStyle,
        directness: next.persona.customization.directness,
        gender: next.persona.gender ?? "female",
        greetingStyle: next.persona.customization.greetingStyle,
        initiative: next.persona.customization.initiative,
        mode: next.persona.customization.mode,
        name: next.persona.name,
        personaProfile: next.personaProfile,
        presenceStyle: next.persona.customization.presenceStyle,
        promptTemplate: next.persona.promptTemplate,
        relationshipRole: next.persona.customization.relationshipRole,
        reminderStyle: next.persona.customization.reminderStyle,
        responseLength: next.persona.customization.responseLength,
        title: next.persona.customization.title ?? "",
        toneMode: next.persona.toneMode ?? "calm",
        voiceProfileId: next.persona.voiceProfileId ?? "",
        exampleReply: next.persona.customization.exampleReply ?? "",
        planningStyle: next.persona.customization.planningStyle,
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

  function handlePortraitResponse(next: PersonaSettingsResponse) {
    setData((current) =>
      current
        ? {
            ...current,
            persona: next.persona,
          }
        : next,
    );
  }

  function handlePortraitStatus(message: string | null, tone: "error" | "success") {
    if (message) {
      if (tone === "error") {
        setError(message);
      } else {
        setStatus(message);
      }
      return;
    }

    setError(null);
  }

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
        customization: {
          title: draft.title || null,
          mode: draft.mode,
          relationshipRole: draft.relationshipRole,
          presenceStyle: draft.presenceStyle,
          responseLength: draft.responseLength,
          directness: draft.directness,
          initiative: draft.initiative,
          planningStyle: draft.planningStyle,
          greetingStyle: draft.greetingStyle,
          closingStyle: draft.closingStyle,
          clarifyingStyle: draft.clarifyingStyle,
          reminderStyle: draft.reminderStyle,
          addressPreference: draft.addressPreference || null,
          avoidances: draft.avoidancesText
            .split("\n")
            .map((rule) => rule.trim())
            .filter(Boolean),
          exampleReply: draft.exampleReply || null,
          antiExampleReply: draft.antiExampleReply || null,
        },
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

  function providerAuthLabel(provider: InferenceSettingsResponse["providers"][number]) {
    switch (provider.authMode) {
      case "api_key_or_account":
        return "API or cloud auth";
      case "account_authorized":
        return "Account link";
      case "api_key":
        return "API key";
      default:
        return "Local runtime";
    }
  }

  function switchInferenceTab(nextTab: "provider" | "local") {
    if (!inferenceDraft || !inference) {
      return;
    }

    const nextProvider =
      nextTab === "local"
        ? localProviderOptions.find(
            (provider) => provider.id === inferenceDraft.selectedProviderId,
          ) ?? localProviderOptions[0]
        : providerOptions.find(
            (provider) => provider.id === inferenceDraft.selectedProviderId,
          ) ?? providerOptions[0];

    if (!nextProvider) {
      return;
    }

    setInferenceDraft((current) =>
      current
        ? {
            ...current,
            activeTarget: nextTab,
            enabled: true,
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
        enabled: true,
        activeTarget: inferenceDraft.activeTarget,
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
          activeTarget: inferenceDraft.activeTarget,
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
      setStatus("Saved inference key cleared. The secretary is back on local fallback.");
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

  async function importSettingsFromText(text: string) {
    setIsImporting(true);
    setStatus(null);
    setError(null);

    try {
      const parsed = JSON.parse(text) as SettingsExportResponse | SettingsImportRequest;
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

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      await importSettingsFromText(text);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Unable to read import file.");
    }
  }

  if (!isLoaded) {
    return (
      <AppPage>
        <SurfaceCard
          tone="dark"
          title={mode === "secretary" ? "Secretary settings" : "General settings"}
          description={
            <p>
              {mode === "secretary"
                ? "Loading the secretary's portrait, voice, and writing profile..."
                : "Loading inference and shared settings..."}
            </p>
          }
        >
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Preparing the current settings surface...
          </p>
        </SurfaceCard>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <div className="stack-md">
        {!embedded ? (
          <div className="stack-sm">
            <h1 style={{ margin: 0, fontSize: 28 }}>
              {mode === "secretary" ? "Secretary settings" : "General settings"}
            </h1>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
              {mode === "secretary"
                ? "Shape the secretary&apos;s portrait, identity, and long-form voice."
                : "Shape the secretary&apos;s inference layer and shared settings snapshots."}
            </p>
          </div>
        ) : null}

        <SurfaceCard
          tone="dark"
          title={mode === "secretary" ? "Secretary" : "General"}
          description={
            <p>
              {mode === "secretary"
                ? "Portrait, identity, and voice-shaping text in one place."
                : "The current inference layer and operating posture, in one compact view."}
            </p>
          }
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div className="persona-summary-strip">
              {[
                ...(showGeneral
                  ? ([
                      [
                        "Conversation",
                        data
                          ? data.conversationEngine.mode === "provider"
                            ? `${data.conversationEngine.provider} · ${data.conversationEngine.model}`
                            : "Local fallback"
                          : "loading",
                      ],
                      [
                        "Provider",
                        selectedProvider?.label ?? inferenceDraft?.selectedProviderId ?? "none",
                      ],
                    ] as Array<[string, string]>)
                  : []),
                ...(showSecretary
                  ? ([
                      ["Name", draft?.name ?? data?.persona.name ?? "SetAgentName"],
                      ["Tone", draft?.toneMode ?? data?.persona.toneMode ?? "calm"],
                    ] as Array<[string, string]>)
                  : []),
                ["Voice", activeVoiceName],
              ].map(([label, value], index) => (
                <div key={String(label)} className="persona-summary-item">
                  <span className="summary-chip-label" style={{ whiteSpace: "nowrap", fontSize: 9 }}>
                    {label}
                  </span>
                  <span
                    className="summary-chip-value"
                    style={{
                      fontSize: 12,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div className="pill" style={{ minWidth: 220, justifyContent: "center" }}>
              {mode === "secretary"
                ? "Secretary profile ready"
                : data!.conversationEngine.mode === "provider"
                  ? "Provider-backed conversation ready"
                  : "Local fallback ready"}
            </div>
          </div>

          {(error || status) ? (
            <NoticeBanner tone={error ? "error" : "success"}>{error ?? status}</NoticeBanner>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
              {mode === "secretary"
                ? "Shape the portrait, habits, and deeper writing voice from one focused profile surface."
                : data?.conversationEngine.summary ??
                  "Load, tune, export, or import the current settings from one place."}
            </p>
          )}
          {showSecretary ? (
            <ActionRow align="start">
              <div className="persona-action-cluster">
                <button
                  type="button"
                  onClick={() => void exportSettings()}
                  disabled={isExporting}
                  className="button-secondary"
                >
                  {isExporting ? "Exporting..." : "Export settings"}
                </button>
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  disabled={isImporting}
                  className="button-secondary"
                >
                  {isImporting ? "Importing..." : "Import settings"}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={isSaving}
                  className="button-primary"
                >
                  {isSaving ? "Saving..." : "Save persona"}
                </button>
              </div>
            </ActionRow>
          ) : null}
        </SurfaceCard>
      </div>

      {showGeneral ? (
        <SurfaceCard
          title="Inference"
          description={
            <p>Choose either a hosted provider or the local runtime, then set the model the secretary should use.</p>
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
                        const nextProvider = providerOptions.find(
                          (provider) => provider.id === nextProviderId,
                        );

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
                    gridTemplateColumns:
                      "minmax(0, 1.2fr) minmax(150px, 190px) minmax(170px, 210px)",
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
                  Local mode talks straight to your local runtime. Pick whichever local endpoint is already running on your machine.
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
      ) : null}

      {showSecretary ? (
        <>
          <SurfaceCard
            title="Identity basics"
            description={
              <p>The short identity fields that shape the secretary before the long-form writing takes over.</p>
            }
            className="stack-md"
          >
            <div className="persona-identity-grid">
              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Portrait</span>
                <SecretaryPortraitField
                  avatar={data?.persona.avatar}
                  name={draft?.name ?? data?.persona.name ?? "SetAgentName"}
                  variant="settings"
                  onUploaded={handlePortraitResponse}
                  onStatusChange={handlePortraitStatus}
                />
                <FieldNote>
                  Use a centered portrait with a clean face crop so it reads well in the polaroid frame on Desk.
                </FieldNote>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  alignContent: "start",
                }}
              >
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
                      maxWidth: 280,
                    }}
                    placeholder="SetAgentName"
                  />
                  <FieldNote>
                    This is the public identity shown on Desk, in chat headers, and across settings.
                  </FieldNote>
                </label>

                <div className="persona-identity-row">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>Gender</span>
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
                    <FieldNote>
                      Sets the default presentation seed used for voice/profile defaults when nothing more specific is configured.
                    </FieldNote>
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
                      placeholder="calm"
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--field-border)",
                        background: "var(--field-bg)",
                        color: "var(--text)",
                        padding: "10px 12px",
                        font: "inherit",
                      }}
                    />
                    <FieldNote>
                      A short internal mood tag for the secretary, like <code>calm</code>, <code>sharp</code>, or <code>warm</code>.
                    </FieldNote>
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
                    <FieldNote>
                      Picks the default speaking voice the secretary should use whenever voice replies are active.
                    </FieldNote>
                  </label>
                </div>
              </div>
            </div>

            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
              Keep the name and tone simple here. The deeper presence, habits, and style examples below do the real shaping.
            </p>
          </SurfaceCard>

          <SurfaceCard
            title="Presence and posture"
            description={
              <p>How the secretary should show up, take initiative, and frame the relationship before a single reply is written.</p>
            }
            className="stack-md"
          >
            <div className="persona-identity-row">
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Mode</span>
                <select
                  value={draft?.mode ?? "workday"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, mode: event.target.value as SecretaryMode } : current,
                    )
                  }
                >
                  {secretaryModes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Sets the secretary&apos;s overall operating context, so the same persona can feel different during work, travel, or deep-focus sessions.
                </FieldNote>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Relationship</span>
                <select
                  value={draft?.relationshipRole ?? "private_secretary"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            relationshipRole: event.target.value as SecretaryRelationshipRole,
                          }
                        : current,
                    )
                  }
                >
                  {relationshipRoles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Defines the role posture the model should adopt when it decides how to help, lead, or follow.
                </FieldNote>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Presence</span>
                <select
                  value={draft?.presenceStyle ?? "composed"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, presenceStyle: event.target.value as SecretaryPresenceStyle }
                        : current,
                    )
                  }
                >
                  {presenceStyles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Controls the emotional texture of replies: composed, warmer, more formal, more playful, or more forceful.
                </FieldNote>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Initiative</span>
                <select
                  value={draft?.initiative ?? "balanced"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, initiative: event.target.value as SecretaryInitiative }
                        : current,
                    )
                  }
                >
                  {initiativeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Decides how often the secretary should volunteer next steps, reminders, or useful nudges without waiting to be asked.
                </FieldNote>
              </label>
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="persona-file-label-row">
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Optional title</span>
              </span>
              <input
                value={draft?.title ?? ""}
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, title: event.target.value } : current))
                }
                placeholder="Chief of Staff, Private Secretary, Studio Operator..."
                style={{ maxWidth: 420 }}
              />
              <FieldNote>
                Use a title only if you want the secretary to occasionally identify herself with a role beyond her name.
              </FieldNote>
            </label>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
              These controls are fed into the live model instructions, so they change both the feel of model-backed replies and the fallback guidance.
            </p>
          </SurfaceCard>

          <SurfaceCard
            title="Habits and preferences"
            description={
              <p>Compact habits that change how replies are phrased, structured, and delivered turn after turn.</p>
            }
            className="stack-md"
          >
            <div className="persona-identity-row">
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Reply length</span>
                <select
                  value={draft?.responseLength ?? "balanced"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, responseLength: event.target.value as SecretaryResponseLength }
                        : current,
                    )
                  }
                >
                  {responseLengths.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Shapes how much the secretary says before she stops, from clipped answers to fuller, more developed replies.
                </FieldNote>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Directness</span>
                <select
                  value={draft?.directness ?? "balanced"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, directness: event.target.value as SecretaryDirectness }
                        : current,
                    )
                  }
                >
                  {directnessOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Tunes whether the secretary sounds gentler, balanced, or blunt when she gives an answer or correction.
                </FieldNote>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Planning style</span>
                <select
                  value={draft?.planningStyle ?? "executive"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, planningStyle: event.target.value as SecretaryPlanningStyle }
                        : current,
                    )
                  }
                >
                  {planningStyles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Guides whether plans come back as checklists, narrative guidance, or crisp executive-style summaries.
                </FieldNote>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Reminder tone</span>
                <select
                  value={draft?.reminderStyle ?? "gentle"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, reminderStyle: event.target.value as SecretaryReminderStyle }
                        : current,
                    )
                  }
                >
                  {reminderStyles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Controls how reminders and nudges should feel when the secretary follows up on pending work.
                </FieldNote>
              </label>
            </div>

            <div className="persona-identity-row">
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Greeting habit</span>
                <select
                  value={draft?.greetingStyle ?? "minimal"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, greetingStyle: event.target.value as SecretaryGreetingStyle }
                        : current,
                    )
                  }
                >
                  {greetingStyles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Decides whether replies open with no greeting, your name, or a softer, warmer lead-in.
                </FieldNote>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Closing habit</span>
                <select
                  value={draft?.closingStyle ?? "next_steps"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, closingStyle: event.target.value as SecretaryClosingStyle }
                        : current,
                    )
                  }
                >
                  {closingStyles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Tells the secretary whether to end cleanly, summarize, or naturally point toward the next step.
                </FieldNote>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Clarifying questions</span>
                <select
                  value={draft?.clarifyingStyle ?? "sparing"}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            clarifyingStyle: event.target.value as SecretaryClarifyingStyle,
                          }
                        : current,
                    )
                  }
                >
                  {clarifyingStyles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  Sets how eager the secretary should be to ask follow-up questions before acting or answering.
                </FieldNote>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Address preference</span>
                <input
                  value={draft?.addressPreference ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, addressPreference: event.target.value } : current,
                    )
                  }
                  placeholder="Preferred form of address for the user"
                />
                <FieldNote>
                  If you want a stable form of address, set it here and the secretary can use it naturally in greetings and warmer replies.
                </FieldNote>
              </label>
            </div>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
              Use this row for durable habits. Save one-off wording or richer demonstrations for the examples section below.
            </p>
          </SurfaceCard>

          <SurfaceCard
            title="Boundaries and examples"
            description={
              <p>Tell the secretary what to avoid, then anchor the voice with one good example and one answer to avoid.</p>
            }
            className="stack-md"
          >
            <div className="persona-file-label-row">
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Download companion file</span>
              <button
                type="button"
                className="persona-file-pill"
                onClick={() => draft && downloadText("secretary-examples.md", buildSecretaryExamplesMarkdown(draft))}
                disabled={!draft}
              >
                secretary-examples.md
              </button>
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Avoidances (one per line)</span>
              <textarea
                value={draft?.avoidancesText ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, avoidancesText: event.target.value } : current,
                  )
                }
                rows={4}
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
              <FieldNote>
                List habits, tones, or behaviors the secretary should actively avoid, one line at a time.
              </FieldNote>
            </label>
            <div
              style={{
                display: "grid",
                gap: 18,
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Good example reply</span>
                <textarea
                  value={draft?.exampleReply ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, exampleReply: event.target.value } : current,
                    )
                  }
                  rows={4}
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
                <FieldNote>
                  Give one reply that feels exactly right so the secretary has a concrete target to imitate.
                </FieldNote>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Reply to avoid</span>
                <textarea
                  value={draft?.antiExampleReply ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, antiExampleReply: event.target.value } : current,
                    )
                  }
                  rows={4}
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
                <FieldNote>
                  Give one reply that feels wrong so the secretary learns the line she should not cross.
                </FieldNote>
              </label>
            </div>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
              This companion export mirrors the current boundaries and examples block into one markdown file for documentation and tuning.
            </p>
          </SurfaceCard>

          <SurfaceCard
            title="Soul and behavior"
            description={
              <p>The markdown-backed soul, persona profile, and guardrails that shape the secretary&apos;s deeper voice.</p>
            }
            className="stack-md"
          >
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span className="persona-file-label-row">
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Secretary soul</span>
              <button
                type="button"
                className="persona-file-pill"
                onClick={() => draft && downloadText("secretary-soul.md", draft.promptTemplate)}
                disabled={!draft}
              >
                secretary-soul.md
              </button>
            </span>
            <textarea
              value={draft?.promptTemplate ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, promptTemplate: event.target.value } : current,
                )
              }
              rows={7}
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
            <FieldNote>
              This is the deepest framing file for the secretary: the enduring voice, posture, and private internal instructions she should carry.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="persona-file-label-row">
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Persona profile</span>
              <button
                type="button"
                className="persona-file-pill"
                onClick={() => draft && downloadText("secretary-persona.md", draft.personaProfile)}
                disabled={!draft}
              >
                secretary-persona.md
              </button>
            </span>
            <textarea
              value={draft?.personaProfile ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, personaProfile: event.target.value } : current,
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
            <FieldNote>
              This file is the lived texture of the secretary: identity, voice, posture, and the kind of person she should feel like in use.
            </FieldNote>
          </label>
        </div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
            The soul holds the deeper framing. The persona profile carries the lived texture. Saving writes both the live markdown-backed files and the stored settings together.
          </p>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Behavior rules (one per line)</span>
          <textarea
            value={draft?.behaviorRulesText ?? ""}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, behaviorRulesText: event.target.value } : current,
              )
            }
            rows={5}
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
          <FieldNote>
            Keep these short, durable, and operational. They work best as a clean list of high-value guardrails rather than a second persona essay.
          </FieldNote>
        </label>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Keep this tight and durable. The shorter this stays, the easier it is to maintain.
        </p>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImportFile(file);
              }
              event.currentTarget.value = "";
            }}
          />
          </SurfaceCard>
        </>
      ) : null}
    </AppPage>
  );
}
