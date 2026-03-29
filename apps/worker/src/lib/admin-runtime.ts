import { access, rm, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import {
  type AdminMaintenanceAction,
  type AdminMaintenanceActionResponse,
  type AdminMaintenanceOverviewResponse,
  createMessageId,
  type OnboardingStatusResponse,
  type PersonaAvatarRecord,
  type SecretaryCustomizationRecord,
  type PersonaGender,
  type PersonaSettingsRecord,
  type PersonaSettingsResponse,
  type SettingsExportResponse,
  type SettingsImportRequest,
  type SettingsImportResponse,
  type SystemHealthResponse,
  type UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";
import {
  agentJobArtifacts,
  agentJobLaunchIntents,
  agentJobRequirements,
  agentJobSteps,
  agentJobs,
  activityTraces,
  conversations,
  integrations,
  jobs,
  memoryEntries,
  memoryLinks,
  messages,
  personas,
  phaseSixTables,
  speechArtifacts,
  tasks,
  toolExecutions,
  tools,
  users,
  voiceProfiles,
  type DbClient,
} from "@secretary/db";
import { getSpeechServiceStatus } from "./speech-health.js";
import {
  defaultSecretaryName,
  defaultSecretaryPersonaProfile,
  defaultSecretarySoul,
  getSecretaryPersonaFilePath,
  getSecretarySoulFilePath,
  loadSecretaryPersonaProfile,
  loadSecretarySoul,
  saveSecretaryPersonaProfile,
  saveSecretarySoul,
} from "./persona-soul.js";
import {
  activateVoiceProfile,
  ensureDefaultVoiceProfile,
  ensureGenderVoiceProfile,
  getVoiceProfileById,
  isBuiltInGenderVoiceProfileName,
  listVoiceProfiles,
} from "./speech-runtime.js";
import { getTelegramIntegrationStatus } from "./telegram-integration.js";
import { listTools } from "./tools-runtime.js";
import type { Infrastructure } from "./infrastructure.js";
import { loadInferenceSettings } from "./inference-settings.js";
import { getHeartbeatIntegrationStatus } from "./heartbeat-runtime.js";
import { loadAgentJobSettings } from "./agent-job-settings.js";
import { resolveManagedAgentJobArtifactPath } from "./agent-job-artifact-storage.js";
import { cancelAgentJob } from "./agent-jobs.js";
import { resolveManagedSpeechStoragePath } from "./speech-storage.js";
import { pathExists, logError } from "./utils.js";
import { repoRoot } from "./utils/index.js";

function normalizePersonaGender(value: unknown): PersonaGender {
  return value === "male" ? "male" : "female";
}

export function defaultSecretaryCustomization(): SecretaryCustomizationRecord {
  return {
    title: null,
    mode: "workday",
    relationshipRole: "private_secretary",
    presenceStyle: "composed",
    responseLength: "balanced",
    directness: "balanced",
    initiative: "balanced",
    planningStyle: "executive",
    greetingStyle: "minimal",
    closingStyle: "next_steps",
    clarifyingStyle: "sparing",
    reminderStyle: "gentle",
    addressPreference: null,
    avoidances: [],
    exampleReply: null,
    antiExampleReply: null,
  };
}

function parsePersonaAvatar(
  toneProfile: Record<string, unknown> | null | undefined,
): PersonaAvatarRecord | null {
  const avatar =
    toneProfile && typeof toneProfile.avatar === "object" && toneProfile.avatar
      ? (toneProfile.avatar as Record<string, unknown>)
      : null;

  if (!avatar || typeof avatar.storageKey !== "string" || avatar.storageKey.trim().length === 0) {
    return null;
  }

  return {
    storageKey: avatar.storageKey,
    mimeType: typeof avatar.mimeType === "string" ? avatar.mimeType : null,
    updatedAt:
      typeof avatar.updatedAt === "string" ? avatar.updatedAt : new Date().toISOString(),
  };
}

export function parseSecretaryCustomization(
  toneProfile: Record<string, unknown> | null | undefined,
): SecretaryCustomizationRecord {
  const defaults = defaultSecretaryCustomization();
  const customization =
    toneProfile && typeof toneProfile.customization === "object" && toneProfile.customization
      ? (toneProfile.customization as Record<string, unknown>)
      : null;

  if (!customization) {
    return defaults;
  }

  return {
    title: typeof customization.title === "string" && customization.title.trim().length > 0
      ? customization.title.trim()
      : null,
    mode:
      customization.mode === "personal" ||
      customization.mode === "travel" ||
      customization.mode === "deep_focus" ||
      customization.mode === "operator"
        ? customization.mode
        : defaults.mode,
    relationshipRole:
      customization.relationshipRole === "chief_of_staff" ||
      customization.relationshipRole === "operator" ||
      customization.relationshipRole === "companion" ||
      customization.relationshipRole === "household_coordinator"
        ? customization.relationshipRole
        : defaults.relationshipRole,
    presenceStyle:
      customization.presenceStyle === "warm" ||
      customization.presenceStyle === "playful" ||
      customization.presenceStyle === "formal" ||
      customization.presenceStyle === "assertive"
        ? customization.presenceStyle
        : defaults.presenceStyle,
    responseLength:
      customization.responseLength === "concise" ||
      customization.responseLength === "expansive"
        ? customization.responseLength
        : defaults.responseLength,
    directness:
      customization.directness === "soft" || customization.directness === "direct"
        ? customization.directness
        : defaults.directness,
    initiative:
      customization.initiative === "reactive" || customization.initiative === "proactive"
        ? customization.initiative
        : defaults.initiative,
    planningStyle:
      customization.planningStyle === "checklist" ||
      customization.planningStyle === "narrative"
        ? customization.planningStyle
        : defaults.planningStyle,
    greetingStyle:
      customization.greetingStyle === "name_forward" ||
      customization.greetingStyle === "warm"
        ? customization.greetingStyle
        : defaults.greetingStyle,
    closingStyle:
      customization.closingStyle === "none" || customization.closingStyle === "summary"
        ? customization.closingStyle
        : defaults.closingStyle,
    clarifyingStyle:
      customization.clarifyingStyle === "balanced" ||
      customization.clarifyingStyle === "proactive"
        ? customization.clarifyingStyle
        : defaults.clarifyingStyle,
    reminderStyle:
      customization.reminderStyle === "balanced" || customization.reminderStyle === "firm"
        ? customization.reminderStyle
        : defaults.reminderStyle,
    addressPreference:
      typeof customization.addressPreference === "string" &&
      customization.addressPreference.trim().length > 0
        ? customization.addressPreference.trim()
        : null,
    avoidances: Array.isArray(customization.avoidances)
      ? customization.avoidances
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : defaults.avoidances,
    exampleReply:
      typeof customization.exampleReply === "string" &&
      customization.exampleReply.trim().length > 0
        ? customization.exampleReply.trim()
        : null,
    antiExampleReply:
      typeof customization.antiExampleReply === "string" &&
      customization.antiExampleReply.trim().length > 0
        ? customization.antiExampleReply.trim()
        : null,
  };
}

function toPersonaRecord(record: typeof personas.$inferSelect): PersonaSettingsRecord {
  return {
    id: record.id,
    name: record.name,
    promptTemplate: record.promptTemplate,
    toneMode:
      typeof record.toneProfile?.mode === "string" ? record.toneProfile.mode : null,
    gender: normalizePersonaGender(record.toneProfile?.gender),
    avatar: parsePersonaAvatar(record.toneProfile),
    customization: parseSecretaryCustomization(record.toneProfile),
    behaviorRules: record.behaviorRules,
    voiceProfileId: record.voiceProfileId ?? null,
    isDefault: record.isDefault,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function getConversationEngineStatus(config: AppConfig) {
  const inference = await loadInferenceSettings();
  const selectedProvider =
    inference.providers.find(
      (provider) => provider.id === inference.settings.selectedProviderId,
    ) ?? null;

  if (inference.settings.mode === "provider") {
    if (!selectedProvider) {
      return {
        mode: "deterministic_fallback" as const,
        provider: null,
        model: null,
        summary: inference.settings.summary,
      };
    }

    return {
      mode: "provider" as const,
      provider: selectedProvider.id,
      model: selectedProvider.model,
      summary: inference.settings.summary,
    };
  }

  return {
    mode: "deterministic_fallback" as const,
    provider: null,
    model: null,
    summary: inference.settings.summary,
  };
}


async function deleteFileIfPresent(path: string) {
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

type AgentJobWorkspaceRow = {
  jobId: string;
  status: string;
  workspacePath: string;
};

type LaunchIntentWorkspaceRow = {
  id: string;
  status: string;
  workspacePath: string;
};

async function getAgentJobWorkspaceRows(dbClient: DbClient): Promise<AgentJobWorkspaceRow[]> {
  const result = await dbClient.pool.query<AgentJobWorkspaceRow>(
    `select jobs.id as "jobId", jobs.status, agent_jobs.workspace_path as "workspacePath"
     from jobs
     inner join agent_jobs on agent_jobs.job_id = jobs.id`,
  );

  return result.rows;
}

async function getLaunchIntentWorkspaceRows(dbClient: DbClient): Promise<LaunchIntentWorkspaceRow[]> {
  const result = await dbClient.pool.query<LaunchIntentWorkspaceRow>(
    `select id, status, workspace_path as "workspacePath"
     from agent_job_launch_intents`,
  );

  return result.rows;
}

async function findStaleAgentJobIds(dbClient: DbClient) {
  const rows = await getAgentJobWorkspaceRows(dbClient);
  const staleRows: AgentJobWorkspaceRow[] = [];

  for (const row of rows) {
    if (!(await pathExists(row.workspacePath))) {
      staleRows.push(row);
    }
  }

  return staleRows;
}

async function findStaleLaunchIntentIds(dbClient: DbClient) {
  const rows = await getLaunchIntentWorkspaceRows(dbClient);
  const staleRows: LaunchIntentWorkspaceRow[] = [];

  for (const row of rows) {
    if (!(await pathExists(row.workspacePath))) {
      staleRows.push(row);
    }
  }

  return staleRows;
}

type StaleSpeechArtifactRow = {
  id: string;
  storageKey: string;
};

type StaleVoiceProfileSampleRow = {
  id: string;
  sampleStorageKey: string;
};

async function findStaleSpeechArtifacts(dbClient: DbClient) {
  const records = await dbClient.db.query.speechArtifacts.findMany({
    orderBy: (fields) => [asc(fields.createdAt)],
  });
  const staleRows: StaleSpeechArtifactRow[] = [];

  for (const record of records) {
    try {
      const path = resolveManagedSpeechStoragePath(record.storageKey);
      if (!(await pathExists(path))) {
        staleRows.push({ id: record.id, storageKey: record.storageKey });
      }
    } catch (error) {
      logError({
        service: "worker",
        event: "admin.maintenance.speech_artifact_staleness_check_failed",
        error,
        metadataJson: { storageKey: record.storageKey },
      });
      staleRows.push({ id: record.id, storageKey: record.storageKey });
    }
  }

  return staleRows;
}

async function findStaleVoiceProfileSamples(dbClient: DbClient) {
  const records = await dbClient.db.query.voiceProfiles.findMany({
    where: (fields, { isNotNull }) => isNotNull(fields.sampleStorageKey),
    orderBy: (fields) => [asc(fields.updatedAt)],
  });
  const staleRows: StaleVoiceProfileSampleRow[] = [];

  for (const record of records) {
    if (!record.sampleStorageKey) {
      continue;
    }

    try {
      const path = resolveManagedSpeechStoragePath(record.sampleStorageKey);
      if (!(await pathExists(path))) {
        staleRows.push({ id: record.id, sampleStorageKey: record.sampleStorageKey });
      }
    } catch (error) {
      logError({
        service: "worker",
        event: "admin.maintenance.voice_profile_sample_staleness_check_failed",
        error,
        metadataJson: { sampleStorageKey: record.sampleStorageKey },
      });
      staleRows.push({ id: record.id, sampleStorageKey: record.sampleStorageKey });
    }
  }

  return staleRows;
}

async function removeArtifactFilesByJobIds(dbClient: DbClient, jobIds: string[]) {
  if (jobIds.length === 0) {
    return 0;
  }

  const artifacts = await dbClient.db.query.agentJobArtifacts.findMany({
    where: inArray(agentJobArtifacts.jobId, jobIds),
  });

  let deletedFiles = 0;

  for (const artifact of artifacts) {
    if (!artifact.storageKey) {
      continue;
    }

    try {
      await unlink(resolveManagedAgentJobArtifactPath(artifact.storageKey));
      deletedFiles += 1;
    } catch (error) {
      logError({
        service: "worker",
        event: "admin.maintenance.artifact_file_deletion_failed",
        error,
        metadataJson: { storageKey: artifact.storageKey },
      });
      continue;
    }
  }

  return deletedFiles;
}

async function deleteAgentJobsByIds(dbClient: DbClient, jobIds: string[]) {
  if (jobIds.length === 0) {
    return {
      deletedJobs: 0,
      deletedTraces: 0,
      deletedArtifactFiles: 0,
    };
  }

  const deletedArtifactFiles = await removeArtifactFilesByJobIds(dbClient, jobIds);

  await dbClient.db.delete(activityTraces).where(inArray(activityTraces.jobId, jobIds));
  await dbClient.db.delete(jobs).where(inArray(jobs.id, jobIds));

  return {
    deletedJobs: jobIds.length,
    deletedTraces: jobIds.length,
    deletedArtifactFiles,
  };
}

async function removePathIfPresent(path: string) {
  try {
    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: 2,
    });
    return true;
    } catch (error) {
      logError({
        service: "worker",
        event: "admin.maintenance.path_removal_failed",
        error,
        metadataJson: { path },
      });
      return false;
    }
}

async function flushQueueRetainedState(
  queue: Infrastructure["agentJobQueue"]["queue"] | Infrastructure["memoryQueue"]["queue"],
) {
  await queue.drain(true);
  await queue.clean(0, 1000, "wait");
  await queue.clean(0, 1000, "delayed");
  await queue.clean(0, 1000, "prioritized");
  await queue.clean(0, 1000, "completed");
  await queue.clean(0, 1000, "failed");
  await queue.clean(0, 1000, "paused");
}

async function flushAllWorkerQueues(infrastructure: Infrastructure) {
  await Promise.all([
    flushQueueRetainedState(infrastructure.agentJobQueue.queue),
    flushQueueRetainedState(infrastructure.memoryQueue.queue),
  ]);
}

async function truncateSecretaryTables(dbClient: DbClient) {
  const tableNames = [...phaseSixTables].reverse();
  await dbClient.pool.query(
    `TRUNCATE TABLE ${tableNames.map((name) => `"${name}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

async function resetSecretaryFileBackings() {
  await Promise.all([
    saveSecretarySoul(defaultSecretarySoul),
    saveSecretaryPersonaProfile(defaultSecretaryPersonaProfile),
  ]);

  const deleted = await Promise.all([
    deleteFileIfPresent(resolve(repoRoot, "runtime/config/agent-jobs.json")),
    deleteFileIfPresent(resolve(repoRoot, "runtime/config/inference-provider.json")),
    deleteFileIfPresent(resolve(repoRoot, "runtime/secrets/inference-provider.json")),
  ]);

  return {
    deletedSettingsFiles: deleted.filter(Boolean).length,
  };
}

async function purgeSecretaryRuntimeDirectories(params: {
  includeGeneratedState: boolean;
}) {
  const targets = [
    resolve(repoRoot, "runtime/persona/avatars"),
    resolve(repoRoot, "runtime/speech/inbound"),
    resolve(repoRoot, "runtime/speech/transcripts"),
    resolve(repoRoot, "runtime/speech/tts"),
    resolve(repoRoot, "runtime/speech/profiles"),
    resolve(repoRoot, "runtime/agent-jobs/artifacts"),
  ];

  if (params.includeGeneratedState) {
    targets.push(
      resolve(repoRoot, "runtime/generated"),
      resolve(repoRoot, "runtime/downloads"),
      resolve(repoRoot, "runtime/exports"),
      resolve(repoRoot, "runtime/dev-logs"),
      resolve(repoRoot, "runtime/live-telegram-test"),
      resolve(repoRoot, "runtime/live-tts-test"),
      resolve(repoRoot, "runtime/perm-repro-user"),
    );
  }

  const removed = await Promise.all(targets.map((target) => removePathIfPresent(target)));

  return {
    runtimePathsCleared: removed.filter(Boolean).length,
  };
}

async function reseedFreshSecretaryState(params: {
  config: AppConfig;
  dbClient: DbClient;
}) {
  await ensureDefaultPersonaRecord(params.dbClient, params.config);
  await Promise.all([
    listTools(params.dbClient),
    ensureDefaultVoiceProfile(params.dbClient),
  ]);
}

async function resetSecretaryState(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
  includeGeneratedState: boolean;
}) {
  const dbClient = params.infrastructure.dbClient;
  const activeJobCounts = await dbClient.pool.query<{ count: number }>(
    `select count(*)::int as count
     from jobs
     inner join agent_jobs on agent_jobs.job_id = jobs.id
     where jobs.status in ('queued', 'planning', 'running', 'retrying', 'waiting_for_approval', 'waiting_for_runtime', 'blocked')`,
  );

  await flushAllWorkerQueues(params.infrastructure);
  await truncateSecretaryTables(dbClient);
  const fileReset = await resetSecretaryFileBackings();
  const runtimeReset = await purgeSecretaryRuntimeDirectories({
    includeGeneratedState: params.includeGeneratedState,
  });
  await reseedFreshSecretaryState({
    config: params.config,
    dbClient,
  });

  return {
    activeJobsCancelled: activeJobCounts.rows[0]?.count ?? 0,
    tablesReset: phaseSixTables.length,
    ...fileReset,
    ...runtimeReset,
    generatedStateCleared: params.includeGeneratedState,
  };
}

async function getAdminMaintenanceOverview(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
}): Promise<AdminMaintenanceOverviewResponse> {
  const [
    settings,
    health,
    jobRows,
    staleJobs,
    staleLaunchIntents,
    staleSpeechArtifacts,
    staleVoiceProfileSamples,
    queueCounts,
  ] = await Promise.all([
    loadAgentJobSettings(),
    getSystemHealth(params),
    getAgentJobWorkspaceRows(params.infrastructure.dbClient),
    findStaleAgentJobIds(params.infrastructure.dbClient),
    findStaleLaunchIntentIds(params.infrastructure.dbClient),
    findStaleSpeechArtifacts(params.infrastructure.dbClient),
    findStaleVoiceProfileSamples(params.infrastructure.dbClient),
    params.infrastructure.agentJobQueue.queue.getJobCounts(
      "wait",
      "active",
      "delayed",
      "paused",
      "failed",
      "completed",
      "prioritized",
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    defaultWorkspacePath: settings.defaultWorkspacePath,
    jobs: {
      active: jobRows.filter((row) => ["queued", "planning", "running", "retrying"].includes(row.status)).length,
      waiting: jobRows.filter((row) => ["waiting_for_approval", "waiting_for_runtime", "blocked"].includes(row.status)).length,
      finished: jobRows.filter((row) => ["completed", "failed", "cancelled"].includes(row.status)).length,
      staleWorkspaceJobs: staleJobs.length,
      staleWorkspaceLaunchIntents: staleLaunchIntents.length,
    },
    speech: {
      staleArtifacts: staleSpeechArtifacts.length,
      staleProfileSamples: staleVoiceProfileSamples.length,
    },
    queue: {
      wait: queueCounts.wait ?? 0,
      active: queueCounts.active ?? 0,
      delayed: queueCounts.delayed ?? 0,
      paused: queueCounts.paused ?? 0,
      failed: queueCounts.failed ?? 0,
      completed: queueCounts.completed ?? 0,
      prioritized: queueCounts.prioritized ?? 0,
    },
    health,
  };
}

export async function runAdminMaintenanceAction(params: {
  action: AdminMaintenanceAction;
  config: AppConfig;
  infrastructure: Infrastructure;
}): Promise<AdminMaintenanceActionResponse> {
  const dbClient = params.infrastructure.dbClient;
  const ranAt = new Date().toISOString();
  let summary = "Maintenance action completed.";
  let details: Record<string, number | string | boolean | null> = {};

  if (params.action === "clear_stale_agent_jobs") {
    const staleJobs = await findStaleAgentJobIds(dbClient);
    const staleLaunchIntents = await findStaleLaunchIntentIds(dbClient);
    const deleted = await deleteAgentJobsByIds(dbClient, staleJobs.map((row) => row.jobId));

    if (staleLaunchIntents.length > 0) {
      await dbClient.db
        .delete(agentJobLaunchIntents)
        .where(inArray(agentJobLaunchIntents.id, staleLaunchIntents.map((row) => row.id)));
    }

    summary = staleJobs.length || staleLaunchIntents.length
      ? "Cleared stale agent jobs and unreachable launch intents."
      : "No stale agent jobs or launch intents were found.";
    details = {
      staleJobsCleared: staleJobs.length,
      staleLaunchIntentsCleared: staleLaunchIntents.length,
      artifactFilesDeleted: deleted.deletedArtifactFiles,
      };
  } else if (params.action === "clear_stale_speech_media") {
    const staleArtifacts = await findStaleSpeechArtifacts(dbClient);
    const staleProfileSamples = await findStaleVoiceProfileSamples(dbClient);

    if (staleArtifacts.length > 0) {
      await dbClient.db
        .delete(speechArtifacts)
        .where(inArray(speechArtifacts.id, staleArtifacts.map((row) => row.id)));
    }

    if (staleProfileSamples.length > 0) {
      await dbClient.db
        .update(voiceProfiles)
        .set({
          sampleStorageKey: null,
          sampleMimeType: null,
          sampleDurationMs: null,
          updatedAt: new Date(),
        })
        .where(inArray(voiceProfiles.id, staleProfileSamples.map((row) => row.id)));
    }

    summary = staleArtifacts.length || staleProfileSamples.length
      ? "Cleared stale speech artifacts and broken voice sample references."
      : "No stale speech artifacts or broken voice sample references were found.";
    details = {
      staleSpeechArtifactsCleared: staleArtifacts.length,
      staleVoiceProfileSamplesCleared: staleProfileSamples.length,
    };
  } else if (params.action === "clear_finished_agent_jobs") {
    const result = await dbClient.pool.query<{ id: string }>(
      `select jobs.id
       from jobs
       inner join agent_jobs on agent_jobs.job_id = jobs.id
       where jobs.status in ('completed', 'failed', 'cancelled')`,
    );

    const deleted = await deleteAgentJobsByIds(dbClient, result.rows.map((row) => row.id));
    summary = deleted.deletedJobs > 0
      ? "Cleared finished agent job history."
      : "No finished agent jobs were available to clear.";
    details = {
      finishedJobsCleared: deleted.deletedJobs,
      artifactFilesDeleted: deleted.deletedArtifactFiles,
    };
  } else if (params.action === "cancel_active_agent_jobs") {
    const result = await dbClient.pool.query<{ id: string }>(
      `select jobs.id
       from jobs
       inner join agent_jobs on agent_jobs.job_id = jobs.id
       where jobs.status in ('queued', 'planning', 'running', 'retrying', 'waiting_for_approval', 'waiting_for_runtime', 'blocked')`,
    );

    for (const row of result.rows) {
      await cancelAgentJob({
        config: params.config,
        dbClient,
        jobId: row.id,
      });
    }

    summary = result.rows.length > 0
      ? "Cancelled active and waiting agent jobs."
      : "No active or waiting agent jobs were running.";
    details = {
      cancelledJobs: result.rows.length,
    };
  } else if (params.action === "flush_agent_queue") {
    const queue = params.infrastructure.agentJobQueue.queue;
    await flushQueueRetainedState(queue);


    const queueCounts = await queue.getJobCounts(
      "wait",
      "active",
      "delayed",
      "paused",
      "failed",
      "completed",
      "prioritized",
    );

    summary = "Flushed queued and retained agent queue jobs.";
    details = {
      wait: queueCounts.wait ?? 0,
      active: queueCounts.active ?? 0,
      delayed: queueCounts.delayed ?? 0,
      paused: queueCounts.paused ?? 0,
      failed: queueCounts.failed ?? 0,
      completed: queueCounts.completed ?? 0,
      prioritized: queueCounts.prioritized ?? 0,
    };
  } else if (params.action === "run_health_sweep") {
    summary = "Completed a live health sweep across jobs, queue, and runtime dependencies.";
    details = {
      checked: true,
    };
  } else if (params.action === "reset_secretary_onboarding") {
    details = await resetSecretaryState({
      config: params.config,
      infrastructure: params.infrastructure,
      includeGeneratedState: false,
    });
    summary =
      "Reset the secretary to a first-run state and cleared memory, conversations, jobs, integrations, and voice state.";
  } else if (params.action === "wipe_runtime_state") {
    details = await resetSecretaryState({
      config: params.config,
      infrastructure: params.infrastructure,
      includeGeneratedState: true,
    });
    summary =
      "Wiped local runtime state, cleared all secretary settings and memory, and restored fresh-install defaults.";
  }

  return {
    action: params.action,
    ranAt,
    summary,
    details,
    overview: await getAdminMaintenanceOverview(params),
  };
}

export async function getAdminMaintenanceSnapshot(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
}) {
  return getAdminMaintenanceOverview(params);
}

async function ensureDefaultPersonaRecord(dbClient: DbClient, config: AppConfig) {
  await dbClient.db
    .insert(users)
    .values({
      id: config.defaultUserId,
      displayName: "Local Owner",
      defaultPersonaId: config.defaultPersonaId,
    })
    .onConflictDoNothing();

  await dbClient.db
    .insert(personas)
    .values({
      id: config.defaultPersonaId,
      name: defaultSecretaryName,
      toneProfile: {
        mode: "calm",
        gender: "female",
        customization: defaultSecretaryCustomization(),
      },
      behaviorRules: [
        "Be warm, competent, and calm.",
        "Answer naturally instead of narrating internal system state unless the user asks for it.",
        "Protect local-first privacy defaults.",
      ],
      promptTemplate:
        defaultSecretarySoul,
      isDefault: true,
      voiceProfileId: null,
    })
    .onConflictDoNothing();

  await dbClient.db
    .update(users)
    .set({
      defaultPersonaId: config.defaultPersonaId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, config.defaultUserId));

  let persona =
    (await dbClient.db.query.personas.findFirst({
      where: eq(personas.id, config.defaultPersonaId),
    })) ??
    (await dbClient.db.query.personas.findFirst({
      where: eq(personas.isDefault, true),
    }));

  if (!persona) {
    throw new Error("Default persona could not be ensured.");
  }

  const soulText = await loadSecretarySoul(persona.promptTemplate);

  if (soulText !== persona.promptTemplate) {
    await dbClient.db
      .update(personas)
      .set({
        promptTemplate: soulText,
        updatedAt: new Date(),
      })
      .where(eq(personas.id, persona.id));

    const refreshed = await dbClient.db.query.personas.findFirst({
      where: eq(personas.id, persona.id),
    });

    if (refreshed) {
      persona = refreshed;
    }
  }

  const gender = normalizePersonaGender(persona.toneProfile?.gender);
  const toneMode =
    typeof persona.toneProfile?.mode === "string" && persona.toneProfile.mode.trim().length > 0
      ? persona.toneProfile.mode
      : "calm";
  const customization = parseSecretaryCustomization(persona.toneProfile);
  let voiceProfileId = persona.voiceProfileId ?? null;

  if (voiceProfileId) {
    const selectedProfile = await getVoiceProfileById(dbClient, voiceProfileId);

    if (selectedProfile) {
      await activateVoiceProfile(dbClient, selectedProfile.id);
    } else {
      voiceProfileId = null;
    }
  }

  if (!voiceProfileId) {
    const defaultVoiceProfile = await ensureGenderVoiceProfile(dbClient, gender);
    voiceProfileId = defaultVoiceProfile.id;
    await activateVoiceProfile(dbClient, defaultVoiceProfile.id);
  }

  const needsNormalization =
    persona.toneProfile?.gender !== gender ||
    persona.toneProfile?.mode !== toneMode ||
    persona.voiceProfileId !== voiceProfileId;

  if (needsNormalization) {
    await dbClient.db
      .update(personas)
      .set({
        toneProfile: {
          ...(persona.toneProfile ?? {}),
          mode: toneMode,
          gender,
          customization,
        },
        voiceProfileId,
        updatedAt: new Date(),
      })
      .where(eq(personas.id, persona.id));

    const refreshedPersona = await dbClient.db.query.personas.findFirst({
      where: eq(personas.id, persona.id),
    });

    if (refreshedPersona) {
      return refreshedPersona;
    }
  }

  return persona;
}

export async function getPersonaSettings(
  dbClient: DbClient,
  config: AppConfig,
): Promise<PersonaSettingsResponse> {
  const persona = await ensureDefaultPersonaRecord(dbClient, config);
  const voiceList = await listVoiceProfiles(dbClient);
  const personaProfile = await loadSecretaryPersonaProfile(defaultSecretaryPersonaProfile);
  const conversationEngine = await getConversationEngineStatus(config);

  return {
    conversationEngine,
    persona: toPersonaRecord(persona),
    personaFilePath: getSecretaryPersonaFilePath(),
    personaProfile,
    soulFilePath: getSecretarySoulFilePath(),
    voiceProfiles: voiceList.profiles,
  };
}

export async function updatePersonaSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: UpdatePersonaSettingsRequest;
}) {
  const persona = await ensureDefaultPersonaRecord(params.dbClient, params.config);
  const currentGender = normalizePersonaGender(persona.toneProfile?.gender);
  const gender = normalizePersonaGender(
    params.request.gender ?? persona.toneProfile?.gender,
  );
  const toneMode =
    params.request.toneMode?.trim() ||
    (typeof persona.toneProfile?.mode === "string" ? persona.toneProfile.mode : "calm");
  let voiceProfileId = persona.voiceProfileId ?? null;
  const currentCustomization = parseSecretaryCustomization(persona.toneProfile);
  const nextCustomization = {
    ...currentCustomization,
    ...(params.request.customization ?? {}),
    title:
      params.request.customization?.title !== undefined
        ? params.request.customization.title?.trim() || null
        : currentCustomization.title,
    addressPreference:
      params.request.customization?.addressPreference !== undefined
        ? params.request.customization.addressPreference?.trim() || null
        : currentCustomization.addressPreference,
    avoidances:
      params.request.customization?.avoidances !== undefined
        ? params.request.customization.avoidances
            .map((entry) => entry.trim())
            .filter(Boolean)
        : currentCustomization.avoidances,
    exampleReply:
      params.request.customization?.exampleReply !== undefined
        ? params.request.customization.exampleReply?.trim() || null
        : currentCustomization.exampleReply,
    antiExampleReply:
      params.request.customization?.antiExampleReply !== undefined
        ? params.request.customization.antiExampleReply?.trim() || null
        : currentCustomization.antiExampleReply,
  };
  const nextSoul = params.request.promptTemplate?.trim() || persona.promptTemplate;
  const nextPersonaProfile =
    params.request.personaProfile?.trim() ||
    (await loadSecretaryPersonaProfile(defaultSecretaryPersonaProfile));

  if (params.request.voiceProfileId !== undefined) {
    voiceProfileId = params.request.voiceProfileId?.trim() || null;
  }

  if (voiceProfileId) {
    const selectedProfile = await getVoiceProfileById(params.dbClient, voiceProfileId);

    if (selectedProfile) {
      const shouldSwitchBuiltInVoice =
        gender !== currentGender &&
        persona.voiceProfileId === selectedProfile.id &&
        isBuiltInGenderVoiceProfileName(selectedProfile.name);

      if (shouldSwitchBuiltInVoice) {
        voiceProfileId = null;
      } else {
        await activateVoiceProfile(params.dbClient, selectedProfile.id);
      }
    } else {
      voiceProfileId = null;
    }
  }

  if (!voiceProfileId) {
    const defaultVoiceProfile = await ensureGenderVoiceProfile(params.dbClient, gender);
    voiceProfileId = defaultVoiceProfile.id;
    await activateVoiceProfile(params.dbClient, defaultVoiceProfile.id);
  }

  await params.dbClient.db
    .update(personas)
    .set({
      name: params.request.name?.trim() || persona.name,
      promptTemplate: nextSoul,
      toneProfile: {
        ...(persona.toneProfile ?? {}),
        mode: toneMode,
        gender,
        customization: nextCustomization,
      },
      behaviorRules:
        params.request.behaviorRules?.map((rule) => rule.trim()).filter(Boolean) ??
        persona.behaviorRules,
      voiceProfileId,
      updatedAt: new Date(),
    })
    .where(eq(personas.id, persona.id));

  await saveSecretarySoul(nextSoul);
  await saveSecretaryPersonaProfile(nextPersonaProfile);

  return getPersonaSettings(params.dbClient, params.config);
}

export async function updatePersonaAvatar(params: {
  dbClient: DbClient;
  config: AppConfig;
  storageKey: string;
  mimeType: string | null;
}) {
  const persona = await ensureDefaultPersonaRecord(params.dbClient, params.config);

  await params.dbClient.db
    .update(personas)
    .set({
      toneProfile: {
        ...(persona.toneProfile ?? {}),
        avatar: {
          storageKey: params.storageKey,
          mimeType: params.mimeType,
          updatedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(personas.id, persona.id));

  return getPersonaSettings(params.dbClient, params.config);
}

export async function getSystemHealth(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
}): Promise<SystemHealthResponse> {
  const dependencyHealth = await params.infrastructure.checkHealth();
  const [speechStatus, telegramStatus, heartbeatStatus] = await Promise.all([
    getSpeechServiceStatus(params.config),
    getTelegramIntegrationStatus(params.infrastructure.dbClient, params.config),
    getHeartbeatIntegrationStatus(params.infrastructure.dbClient, params.config),
  ]);
  const conversationEngine = await getConversationEngineStatus(params.config);

  const [
    conversationsCount,
    messagesCount,
    memoriesCount,
    tasksCount,
    toolExecutionsCount,
    voiceProfilesCount,
  ] = await Promise.all([
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from conversations"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from messages"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from memory_entries"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from tasks"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from tool_executions"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from voice_profiles"),
  ]);

  const storage = await Promise.all(
    [
      { label: "Postgres data", path: resolve(repoRoot, "runtime/postgres/data") },
      { label: "Redis data", path: resolve(repoRoot, "runtime/redis/data") },
      { label: "Speech storage", path: resolve(repoRoot, "runtime/speech") },
      { label: "Speech profiles", path: resolve(repoRoot, "runtime/speech/profiles") },
      { label: "Backups", path: resolve(repoRoot, "runtime/backups") },
      { label: "Exports", path: resolve(repoRoot, "runtime/exports") },
    ].map(async (entry) => ({
      ...entry,
      exists: await pathExists(entry.path),
    })),
  );

  return {
    generatedAt: new Date().toISOString(),
    services: {
      worker: {
        status: "ok",
        summary: "Worker runtime is responding.",
      },
      conversation: {
        status: conversationEngine.mode === "provider" ? "ok" : "attention",
        summary: conversationEngine.summary,
      },
      postgres: {
        status: dependencyHealth.postgres === "ok" ? "ok" : "degraded",
        summary:
          dependencyHealth.postgres === "ok"
            ? "PostgreSQL is reachable."
            : String(dependencyHealth.postgres),
      },
      redis: {
        status: dependencyHealth.redis === "ok" ? "ok" : "degraded",
        summary:
          dependencyHealth.redis === "ok" ? "Redis is reachable." : String(dependencyHealth.redis),
      },
      telegram: {
        status:
          telegramStatus.integration.healthStatus === "ok"
            ? "ok"
            : telegramStatus.integration.healthStatus === "not_configured"
              ? "not_configured"
              : "degraded",
        summary: telegramStatus.integration.healthSummary,
      },
      heartbeat: {
        status:
          heartbeatStatus.integration.enabled
            ? heartbeatStatus.integration.healthStatus === "degraded"
              ? "degraded"
              : "ok"
            : "not_configured",
        summary: heartbeatStatus.integration.healthSummary,
      },
      stt: {
        status: speechStatus.services.stt.healthStatus,
        summary: speechStatus.services.stt.summary,
      },
      tts: {
        status: speechStatus.services.tts.healthStatus,
        summary: speechStatus.services.tts.summary,
      },
      ffmpeg: {
        status: speechStatus.services.ffmpeg.available ? "ok" : "degraded",
        summary: speechStatus.services.ffmpeg.summary,
      },
    },
    storage,
    stats: {
      conversations: conversationsCount.rows[0]?.count ?? 0,
      memories: memoriesCount.rows[0]?.count ?? 0,
      messages: messagesCount.rows[0]?.count ?? 0,
      tasks: tasksCount.rows[0]?.count ?? 0,
      toolExecutions: toolExecutionsCount.rows[0]?.count ?? 0,
      voiceProfiles: voiceProfilesCount.rows[0]?.count ?? 0,
    },
  };
}

export async function getOnboardingStatus(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
}): Promise<OnboardingStatusResponse> {
  const [health, persona, toolsResponse, telegramStatus, voiceList] = await Promise.all([
    getSystemHealth(params),
    getPersonaSettings(params.infrastructure.dbClient, params.config),
    listTools(params.infrastructure.dbClient),
    getTelegramIntegrationStatus(params.infrastructure.dbClient, params.config),
    listVoiceProfiles(params.infrastructure.dbClient),
  ]);
  const conversationEngine = await getConversationEngineStatus(params.config);

  const activeVoice = voiceList.profiles.find((profile) => profile.isActive);

  const steps: OnboardingStatusResponse["steps"] = [
    {
      id: "install",
      title: "Local stack is healthy",
      status:
        health.services.postgres.status === "ok" && health.services.redis.status === "ok"
          ? "complete"
          : "attention",
      detail:
        health.services.postgres.status === "ok" && health.services.redis.status === "ok"
          ? "Worker, Postgres, and Redis are all reachable."
          : "Bring the local stack fully online before relying on daily use.",
      href: "/health",
    },
    {
      id: "conversation",
      title: "Conversation engine is chosen",
      status: conversationEngine.mode === "provider" ? "complete" : "attention",
      detail: conversationEngine.summary,
      href: "/persona",
    },
    {
      id: "persona",
      title: "Secretary persona is customized",
      status:
        persona.persona.promptTemplate.trim() === defaultSecretarySoul.trim() &&
        persona.persona.name === "Secretary"
          ? "attention"
          : "complete",
      detail:
        persona.persona.name === "Secretary"
          ? `Default persona still uses the starter identity (${persona.persona.gender ?? "female"}).`
          : `Current persona is "${persona.persona.name}" (${persona.persona.gender ?? "female"}).`,
      href: "/persona",
    },
    {
      id: "telegram",
      title: "Telegram channel is configured",
      status:
        telegramStatus.integration.enabled && telegramStatus.integration.botConfigured
          ? "complete"
          : telegramStatus.integration.envConfigured
            ? "attention"
            : "not_started",
      detail: telegramStatus.integration.healthSummary,
      href: "/channels",
    },
    {
      id: "tools",
      title: "Tool approval baseline is reviewed",
      status:
        toolsResponse.tools.some((tool) => tool.approvalMode === "ask_first")
          ? "complete"
          : "attention",
      detail: `${toolsResponse.tools.length} tools are registered for review.`,
      href: "/tools",
    },
    {
      id: "voice",
      title: "Voice profile and speech services are ready",
      status:
        activeVoice && health.services.tts.status !== "not_configured"
          ? "complete"
          : activeVoice
            ? "attention"
            : "not_started",
      detail: activeVoice
        ? `Active profile: ${activeVoice.name}.`
        : "No active voice profile has been selected yet.",
      href: "/voice",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    completedSteps: steps.filter((step) => step.status === "complete").length,
    totalSteps: steps.length,
    steps,
  };
}

export async function exportSettingsSnapshot(params: {
  config: AppConfig;
  dbClient: DbClient;
}): Promise<SettingsExportResponse> {
  const [personaSettings, integrationsList, toolsList, voiceList, user] = await Promise.all([
    getPersonaSettings(params.dbClient, params.config),
    params.dbClient.db.query.integrations.findMany({
      orderBy: asc(integrations.integrationType),
    }),
    listTools(params.dbClient),
    listVoiceProfiles(params.dbClient),
    params.dbClient.db.query.users.findFirst({
      where: eq(users.id, params.config.defaultUserId),
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    snapshot: {
      userDefaultPersonaId: user?.defaultPersonaId ?? null,
      personas: [personaSettings.persona],
      integrations: integrationsList.map((integration) => ({
        id: integration.id,
        integrationType: integration.integrationType,
        enabled: integration.enabled,
        configJson: integration.configJson,
        healthStatus: integration.healthStatus,
      })),
      tools: toolsList.tools.map((tool) => ({
        id: tool.id,
        key: tool.key,
        enabled: tool.enabled,
        approvalMode: tool.approvalMode,
      })),
      voiceProfiles: voiceList.profiles,
    },
  };
}

export async function importSettingsSnapshot(params: {
  config: AppConfig;
  dbClient: DbClient;
  request: SettingsImportRequest;
}): Promise<SettingsImportResponse> {
  const snapshot = params.request.snapshot;

  await params.dbClient.db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: params.config.defaultUserId,
        displayName: "Local Owner",
        defaultPersonaId: snapshot.userDefaultPersonaId ?? params.config.defaultPersonaId,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          defaultPersonaId: snapshot.userDefaultPersonaId ?? params.config.defaultPersonaId,
          updatedAt: new Date(),
        },
      });

    for (const persona of snapshot.personas) {
      await tx
        .insert(personas)
        .values({
          id: persona.id,
          name: persona.name,
          promptTemplate: persona.promptTemplate,
          toneProfile: {
            mode: persona.toneMode ?? "calm",
            gender: normalizePersonaGender(persona.gender),
          },
          behaviorRules: persona.behaviorRules,
          voiceProfileId: persona.voiceProfileId,
          isDefault: persona.isDefault,
        })
        .onConflictDoUpdate({
          target: personas.id,
          set: {
            name: persona.name,
            promptTemplate: persona.promptTemplate,
            toneProfile: {
              mode: persona.toneMode ?? "calm",
              gender: normalizePersonaGender(persona.gender),
            },
            behaviorRules: persona.behaviorRules,
            voiceProfileId: persona.voiceProfileId,
            isDefault: persona.isDefault,
            updatedAt: new Date(),
          },
        });
    }

    for (const integration of snapshot.integrations) {
      const existing = await tx.query.integrations.findFirst({
        where: eq(integrations.integrationType, integration.integrationType),
      });

      if (existing) {
        await tx
          .update(integrations)
          .set({
            enabled: integration.enabled,
            configJson: integration.configJson,
            healthStatus: integration.healthStatus,
            updatedAt: new Date(),
          })
          .where(eq(integrations.id, existing.id));
      } else {
        await tx.insert(integrations).values({
          id: integration.id || createMessageId(),
          integrationType: integration.integrationType,
          enabled: integration.enabled,
          configJson: integration.configJson,
          healthStatus: integration.healthStatus,
        });
      }
    }

    for (const tool of snapshot.tools) {
      const existing = await tx.query.tools.findFirst({
        where: eq(tools.key, tool.key),
      });

      if (existing) {
        await tx
          .update(tools)
          .set({
            enabled: tool.enabled,
            approvalMode: tool.approvalMode,
            updatedAt: new Date(),
          })
          .where(eq(tools.id, existing.id));
      } else {
        await tx.insert(tools).values({
          id: tool.id || createMessageId(),
          key: tool.key,
          name: tool.key,
          description: `${tool.key} imported from settings snapshot.`,
          enabled: tool.enabled,
          approvalMode: tool.approvalMode,
          configSchemaJson: {},
          healthStatus: "ok",
        });
      }
    }

    for (const voiceProfile of snapshot.voiceProfiles) {
      await tx
        .insert(voiceProfiles)
        .values({
          id: voiceProfile.id,
          name: voiceProfile.name,
          engineId: voiceProfile.engineId,
          sampleStorageKey: voiceProfile.sampleStorageKey,
          sampleMimeType: voiceProfile.sampleMimeType,
          sampleDurationMs: voiceProfile.sampleDurationMs,
          qualityPreset: voiceProfile.qualityPreset,
          speakingStyle: voiceProfile.speakingStyle,
          isActive: voiceProfile.isActive,
        })
        .onConflictDoUpdate({
          target: voiceProfiles.id,
          set: {
            name: voiceProfile.name,
            engineId: voiceProfile.engineId,
            sampleStorageKey: voiceProfile.sampleStorageKey,
            sampleMimeType: voiceProfile.sampleMimeType,
            sampleDurationMs: voiceProfile.sampleDurationMs,
            qualityPreset: voiceProfile.qualityPreset,
            speakingStyle: voiceProfile.speakingStyle,
            isActive: voiceProfile.isActive,
            updatedAt: new Date(),
          },
        });
    }
  });

  const persona = await getPersonaSettings(params.dbClient, params.config);
  await saveSecretarySoul(persona.persona.promptTemplate);

  return {
    importedAt: new Date().toISOString(),
    persona: persona.persona,
  };
}
