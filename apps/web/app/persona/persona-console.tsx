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
import { ActionRow, AppPage, FieldHint, LoadingSurface, NoticeBanner, StatCard, StatGrid, SurfaceCard } from "../lib/ui";
import { HeartbeatSettingsSection } from "./heartbeat-settings-section";
import { InferenceSettingsSection } from "./inference-settings-section";
import { PersonaIdentitySection } from "./persona-identity-section";
import { PersonaWritingSection } from "./persona-writing-section";
import {
  clarifyingStyles,
  closingStyles,
  directnessOptions,
  greetingStyles,
  initiativeOptions,
  planningStyles,
  presenceStyles,
  relationshipRoles,
  reminderStyles,
  responseLengths,
  secretaryModes,
} from "./persona-constants";


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
        <LoadingSurface
          title={mode === "secretary" ? "Preparing the secretary profile" : "Preparing settings"}
          description={
            <p>
              {mode === "secretary"
                ? "Pulling in portrait, identity, voice, and writing guidance so the profile opens in one complete surface."
                : "Loading inference, defaults, and saved settings into one clean control surface."}
            </p>
          }
          blocks={4}
        />
      </AppPage>
    );
  }

  const resolvedData = data!;
  const resolvedDraft = draft!;

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
          <StatGrid>
            {showGeneral ? (
              <StatCard
                label="Conversation"
                value={
                  resolvedData.conversationEngine.mode === "provider"
                    ? `${resolvedData.conversationEngine.provider} · ${resolvedData.conversationEngine.model}`
                    : "Local fallback"
                }
                detail="Current reply path"
                tone="soft"
              />
            ) : null}
            {showGeneral ? (
              <StatCard
                label="Provider"
                value={selectedProvider?.label ?? inferenceDraft?.selectedProviderId ?? "none"}
                detail="Selected inference source"
                tone="soft"
              />
            ) : null}
            {showSecretary ? (
              <StatCard
                label="Name"
                value={resolvedDraft.name ?? resolvedData.persona.name ?? "SetAgentName"}
                detail="Displayed throughout Desk and settings"
                tone="soft"
              />
            ) : null}
            {showSecretary ? (
              <StatCard
                label="Tone"
                value={resolvedDraft.toneMode ?? resolvedData.persona.toneMode ?? "calm"}
                detail="Current public tone tag"
                tone="soft"
              />
            ) : null}
            <StatCard
              label="Voice"
              value={activeVoiceName}
              detail={
                mode === "secretary"
                  ? "Voice currently tied to the secretary profile"
                  : "Default speaking voice for replies"
              }
              tone="soft"
            />
          </StatGrid>

          {(error || status) ? (
            <NoticeBanner tone={error ? "error" : "success"}>{error ?? status}</NoticeBanner>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
              {mode === "secretary"
                ? (resolvedDraft.name.trim() === "SetAgentName"
                    ? "The secretary is ready for shaping, but still needs a real public name before the profile feels complete."
                    : "Shape the portrait, habits, and deeper writing voice from one focused profile surface.")
                : resolvedData.conversationEngine.summary ??
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
        <InferenceSettingsSection
          inference={inference}
          inferenceDraft={inferenceDraft}
          setInferenceDraft={setInferenceDraft}
          selectedProvider={selectedProvider}
          localProvider={localProvider}
          localProviderOptions={localProviderOptions}
          providerDropdownGroups={providerDropdownGroups}
          providerById={providerById}
          models={models}
          setModels={setModels}
          isLoadingModels={isLoadingModels}
          isSavingInference={isSavingInference}
          loadModels={loadModels}
          clearInferenceKey={clearInferenceKey}
          saveInference={saveInference}
          switchInferenceTab={switchInferenceTab}
          providerAuthLabel={providerAuthLabel}
        />
      ) : null}

      {showSecretary ? (
        <>
          <PersonaIdentitySection
            data={resolvedData}
            draft={resolvedDraft}
            setDraft={setDraft}
            handlePortraitResponse={handlePortraitResponse}
            handlePortraitStatus={handlePortraitStatus}
          />

          <PersonaWritingSection
            draft={resolvedDraft}
            setDraft={setDraft}
            downloadText={downloadText}
            buildSecretaryExamplesMarkdown={buildSecretaryExamplesMarkdown}
          />

          <HeartbeatSettingsSection />

          <ActionRow align="start">
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving}
              className="button-primary"
            >
              {isSaving ? "Saving..." : "Save persona"}
            </button>
          </ActionRow>

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
        </>
      ) : null}
    </AppPage>

  );
}
