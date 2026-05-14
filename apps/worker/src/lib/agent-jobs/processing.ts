import type { AppConfig } from "@secretary/config";
import type {
  AgentJobActionResponse,
  AgentJobRequirementDecisionRequest,
} from "@secretary/core-runtime";
import { agentJobRequirements, agentJobSteps, type DbClient } from "@secretary/db";
import { and, eq } from "drizzle-orm";
import { postAgentJobConversationUpdate } from "../agent-job-conversation-updates.js";
import type { AgentJobQueueAdapter } from "../agent-job-queue.js";
import { loadAgentJobSettings } from "../agent-job-settings.js";
import { type JobRow, toAgentJobRecord } from "../agent-job-transformers.js";
import { pathExists } from "../utils.js";

import { insertCheckpointArtifact, insertTrace } from "./artifacts.js";
import { prepareInitialPlan } from "./helpers.js";
import { markAgentJobFailed } from "./lifecycle.js";
import { satisfyRuntimeRequirement } from "./requirements.js";
import {
  getAgentJobRow,
  getCurrentStep,
  listRequirementRows,
  listStepRows,
  updateJobState,
  updateStepState,
} from "./state.js";
import {
  executeDraftingStep,
  executeFinalizeStep,
  executeImplementationStep,
  executeInspectStep,
  executeVerificationStep,
} from "./steps.js";

export async function recoverInterruptedStep(params: {
  dbClient: DbClient;
  jobId: string;
  row: JobRow;
  currentStep: typeof agentJobSteps.$inferSelect;
}) {
  if (params.currentStep.status !== "running") {
    return params.currentStep;
  }

  const recoveredStatus = params.currentStep.stepKey === "verify_result" ? "retrying" : "ready";

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.currentStep.id,
    status: recoveredStatus,
    errorText: "Recovered after worker interruption.",
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "queued",
    blockerSummary: "Recovered after worker interruption. Re-queueing the current step.",
    currentStepId: params.currentStep.id,
    errorText: null,
  });
  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.recovered_after_interruption",
    payloadJson: {
      stepId: params.currentStep.id,
      stepKey: params.currentStep.stepKey,
      recoveredStatus,
    },
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.currentStep.id,
    label: "Recovered after interruption",
    contentText: `Recovered ${params.currentStep.stepKey} after worker interruption and reset it to ${recoveredStatus}.`,
    metadataJson: {
      stepKey: params.currentStep.stepKey,
      recoveredStatus,
    },
  });

  const refreshedStep = await params.dbClient.db.query.agentJobSteps.findFirst({
    where: eq(agentJobSteps.id, params.currentStep.id),
  });

  return refreshedStep ?? params.currentStep;
}

export async function decideAgentJobRequirement(params: {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  jobId: string;
  requirementId: string;
  decision: AgentJobRequirementDecisionRequest;
  notifyConversation?: boolean;
}): Promise<AgentJobActionResponse | null> {
  const requirement = await params.dbClient.db.query.agentJobRequirements.findFirst({
    where: and(
      eq(agentJobRequirements.id, params.requirementId),
      eq(agentJobRequirements.jobId, params.jobId),
    ),
  });

  if (!requirement) {
    return null;
  }

  await params.dbClient.db
    .update(agentJobRequirements)
    .set({
      status: params.decision.approved ? "satisfied" : "rejected",
      resolutionText:
        params.decision.reason?.trim() ||
        (params.decision.approved ? "Approved by operator." : "Denied by operator."),
      updatedAt: new Date(),
    })
    .where(eq(agentJobRequirements.id, params.requirementId));

  const row = await getAgentJobRow(params.dbClient, params.jobId);
  if (!row) {
    return null;
  }

  const requirements = await listRequirementRows(params.dbClient, params.jobId);
  const pendingForCurrentStep = requirements.filter(
    (entry) => entry.stepId === row.agent.currentStepId && entry.status === "pending",
  );

  if (pendingForCurrentStep.length === 0) {
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "queued",
      blockerSummary: null,
      currentStepId: row.agent.currentStepId ?? null,
      errorText: null,
    });
    await params.queue.enqueue(params.jobId);
  }

  if (params.notifyConversation !== false) {
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.requirement_decided",
      importance: params.decision.approved ? "normal" : "important",
      text: params.decision.approved
        ? `Approved: ${requirement.label}. I’m continuing the build job now.`
        : `Denied: ${requirement.label}. The build job will stay blocked until that requirement is resolved.`,
      metadataJson: {
        requirementId: requirement.id,
        approved: params.decision.approved,
      },
    });
  }

  const nextRow = await getAgentJobRow(params.dbClient, params.jobId);
  return nextRow ? { job: toAgentJobRecord(nextRow) } : null;
}

export async function processAgentJob(
  config: AppConfig,
  dbClient: DbClient,
  jobId: string,
  queue: AgentJobQueueAdapter,
) {
  let row = await getAgentJobRow(dbClient, jobId);
  const settings = await loadAgentJobSettings();
  if (!row) {
    throw new Error(`Agent job ${jobId} not found.`);
  }

  if (
    row.job.status === "completed" ||
    row.job.status === "cancelled" ||
    row.job.status === "failed"
  ) {
    return;
  }

  if (
    row.job.startedAt &&
    Date.now() - row.job.startedAt.getTime() > settings.maxJobRuntimeMinutes * 60 * 1000
  ) {
    const errorText = `Job exceeded the configured runtime limit of ${settings.maxJobRuntimeMinutes} minutes.`;
    await markAgentJobFailed(config, dbClient, jobId, errorText);
    return;
  }

  let steps = await listStepRows(dbClient, jobId);
  if (steps.length === 0) {
    await prepareInitialPlan({
      config,
      dbClient,
      jobId,
      row,
    });
    row = await getAgentJobRow(dbClient, jobId);
    steps = await listStepRows(dbClient, jobId);
  }

  if (!row) {
    throw new Error(`Agent job ${jobId} disappeared during processing.`);
  }

  let requirements = await listRequirementRows(dbClient, jobId);
  const currentStep = getCurrentStep(steps, row.agent.currentStepId ?? null);

  if (!currentStep) {
    return;
  }

  if (currentStep.stepKey === "inspect_workspace" && currentStep.status === "waiting_for_runtime") {
    if (!(await pathExists(row.agent.workspacePath))) {
      await updateJobState({
        dbClient,
        jobId,
        status: "waiting_for_runtime",
        blockerSummary: `Workspace path is not reachable yet: ${row.agent.workspacePath}`,
        currentStepId: currentStep.id,
      });
      return;
    }

    await satisfyRuntimeRequirement({
      config,
      dbClient,
      jobId,
      inspectStep: currentStep,
      conversationId: row.agent.conversationId ?? null,
    });
    row = (await getAgentJobRow(dbClient, jobId)) ?? row;
    steps = await listStepRows(dbClient, jobId);
    requirements = await listRequirementRows(dbClient, jobId);
  }

  let refreshedCurrentStep = getCurrentStep(steps, row.agent.currentStepId ?? null) ?? currentStep;
  refreshedCurrentStep = await recoverInterruptedStep({
    dbClient,
    jobId,
    row,
    currentStep: refreshedCurrentStep,
  });

  switch (refreshedCurrentStep.stepKey) {
    case "inspect_workspace":
      if (
        refreshedCurrentStep.status === "ready" ||
        refreshedCurrentStep.status === "retrying" ||
        refreshedCurrentStep.status === "running"
      ) {
        await executeInspectStep({
          config,
          dbClient,
          queue,
          row,
          jobId,
          inspectStep: refreshedCurrentStep,
          steps,
        });
      }
      return;
    case "draft_plan":
      if (
        refreshedCurrentStep.status === "ready" ||
        refreshedCurrentStep.status === "retrying" ||
        refreshedCurrentStep.status === "running"
      ) {
        await executeDraftingStep({
          config,
          dbClient,
          queue,
          row,
          jobId,
          draftStep: refreshedCurrentStep,
          steps,
        });
      }
      return;
    case "implement_scope":
      if (
        ["ready", "retrying", "running", "waiting_for_approval"].includes(
          refreshedCurrentStep.status,
        )
      ) {
        await executeImplementationStep({
          config,
          dbClient,
          queue,
          row,
          jobId,
          implementStep: refreshedCurrentStep,
          steps,
          requirements,
        });
      }
      return;
    case "verify_result":
      if (
        ["ready", "retrying", "running", "waiting_for_approval"].includes(
          refreshedCurrentStep.status,
        )
      ) {
        await executeVerificationStep({
          config,
          dbClient,
          queue,
          row,
          jobId,
          verifyStep: refreshedCurrentStep,
          steps,
          requirements,
        });
      }
      return;
    case "finalize_handoff":
      if (refreshedCurrentStep.status === "ready" || refreshedCurrentStep.status === "running") {
        await executeFinalizeStep({
          config,
          dbClient,
          row,
          jobId,
          finalizeStep: refreshedCurrentStep,
          steps,
        });
      }
      return;
    default:
      return;
  }
}
