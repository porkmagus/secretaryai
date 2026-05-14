import { rm, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "@secretary/config";
import type {
  AdminMaintenanceAction,
  AdminMaintenanceActionResponse,
  AdminMaintenanceOverviewResponse,
} from "@secretary/core-runtime";
import {
  activityTraces,
  agentJobArtifacts,
  agentJobLaunchIntents,
  type DbClient,
  jobs,
  phaseSixTables,
  speechArtifacts,
  voiceProfiles,
} from "@secretary/db";
import { asc, inArray } from "drizzle-orm";
import { resolveManagedAgentJobArtifactPath } from "../agent-job-artifact-storage.js";
import { cancelAgentJob } from "../agent-job-runtime.js";
import { loadAgentJobSettings } from "../agent-job-settings.js";
import { loadInferenceSettings } from "../inference-settings.js";
import type { Infrastructure } from "../infrastructure.js";
import {
  defaultSecretaryPersonaProfile,
  defaultSecretarySoul,
  saveSecretaryPersonaProfile,
  saveSecretarySoul,
} from "../persona-soul.js";
import { ensureDefaultVoiceProfile } from "../speech-runtime.js";
import { resolveManagedSpeechStoragePath } from "../speech-storage.js";
import { listTools } from "../tools/index.js";
import { logError, pathExists, repoRoot } from "../utils.js";
import { getSystemHealth } from "./health.js";
import { ensureDefaultPersonaRecord } from "./persona.js";

export async function getConversationEngineStatus(_config: AppConfig) {
  const inference = await loadInferenceSettings();
  const selectedProvider =
    inference.providers.find((provider) => provider.id === inference.settings.selectedProviderId) ??
    null;

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

async function getLaunchIntentWorkspaceRows(
  dbClient: DbClient,
): Promise<LaunchIntentWorkspaceRow[]> {
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

export async function flushAllWorkerQueues(infrastructure: Infrastructure) {
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

async function purgeSecretaryRuntimeDirectories(params: { includeGeneratedState: boolean }) {
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

async function reseedFreshSecretaryState(params: { config: AppConfig; dbClient: DbClient }) {
  await ensureDefaultPersonaRecord(params.dbClient, params.config);
  await Promise.all([listTools(params.dbClient), ensureDefaultVoiceProfile(params.dbClient)]);
}

export async function resetSecretaryState(params: {
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

export async function getAdminMaintenanceOverview(params: {
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
      active: jobRows.filter((row) =>
        ["queued", "planning", "running", "retrying"].includes(row.status),
      ).length,
      waiting: jobRows.filter((row) =>
        ["waiting_for_approval", "waiting_for_runtime", "blocked"].includes(row.status),
      ).length,
      finished: jobRows.filter((row) => ["completed", "failed", "cancelled"].includes(row.status))
        .length,
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
    const deleted = await deleteAgentJobsByIds(
      dbClient,
      staleJobs.map((row) => row.jobId),
    );

    if (staleLaunchIntents.length > 0) {
      await dbClient.db.delete(agentJobLaunchIntents).where(
        inArray(
          agentJobLaunchIntents.id,
          staleLaunchIntents.map((row) => row.id),
        ),
      );
    }

    summary =
      staleJobs.length || staleLaunchIntents.length
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
      await dbClient.db.delete(speechArtifacts).where(
        inArray(
          speechArtifacts.id,
          staleArtifacts.map((row) => row.id),
        ),
      );
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
        .where(
          inArray(
            voiceProfiles.id,
            staleProfileSamples.map((row) => row.id),
          ),
        );
    }

    summary =
      staleArtifacts.length || staleProfileSamples.length
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

    const deleted = await deleteAgentJobsByIds(
      dbClient,
      result.rows.map((row) => row.id),
    );
    summary =
      deleted.deletedJobs > 0
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

    summary =
      result.rows.length > 0
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
