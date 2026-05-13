import type {
  AgentJobApprovalMode,
  AgentJobArtifactKind,
  AgentJobArtifactRecord,
  AgentJobRecord,
  AgentJobRequirementKind,
  AgentJobRequirementRecord,
  AgentJobRequirementStatus,
  AgentJobStatus,
  AgentJobStepKind,
  AgentJobStepRecord,
  AgentJobStepStatus,
} from "@secretary/core-runtime";
import type {
  agentJobArtifacts,
  agentJobRequirements,
  agentJobSteps,
  agentJobs,
  jobs,
} from "@secretary/db";

export type JobRow = {
  job: typeof jobs.$inferSelect;
  agent: typeof agentJobs.$inferSelect;
};

export function toAgentJobRecord(row: JobRow): AgentJobRecord {
  return {
    id: row.job.id,
    jobType: "agent.build",
    title: row.agent.title,
    goal: row.agent.goal,
    workspacePath: row.agent.workspacePath,
    requestedByUserId: row.agent.requestedByUserId,
    conversationId: row.agent.conversationId ?? null,
    status: row.job.status as AgentJobStatus,
    approvalMode: row.agent.approvalMode as AgentJobApprovalMode,
    blockerSummary: row.agent.blockerSummary ?? null,
    currentStepId: row.agent.currentStepId ?? null,
    resultSummary: row.agent.resultSummary ?? null,
    payloadJson: row.job.payloadJson,
    resultJson: row.job.resultJson ?? null,
    scheduledFor: row.job.scheduledFor.toISOString(),
    startedAt: row.job.startedAt?.toISOString() ?? null,
    finishedAt: row.job.finishedAt?.toISOString() ?? null,
    errorText: row.job.errorText ?? null,
    createdAt: row.job.createdAt.toISOString(),
    updatedAt: row.job.updatedAt.toISOString(),
  };
}

export function toStepRecord(row: typeof agentJobSteps.$inferSelect): AgentJobStepRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    parentStepId: row.parentStepId ?? null,
    stepKey: row.stepKey,
    title: row.title,
    detail: row.detail ?? null,
    kind: row.stepKind as AgentJobStepKind,
    status: row.status as AgentJobStepStatus,
    sequence: row.sequence,
    dependsOnStepIds: row.dependsOnStepIds,
    toolKey: row.toolKey ?? null,
    inputJson: row.inputJson,
    outputJson: row.outputJson ?? null,
    summary: row.summary ?? null,
    errorText: row.errorText ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toArtifactRecord(
  row: typeof agentJobArtifacts.$inferSelect,
): AgentJobArtifactRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    stepId: row.stepId ?? null,
    kind: row.artifactKind as AgentJobArtifactKind,
    label: row.label,
    storageKey: row.storageKey ?? null,
    contentText: row.contentText ?? null,
    mimeType: row.mimeType ?? null,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toRequirementRecord(
  row: typeof agentJobRequirements.$inferSelect,
): AgentJobRequirementRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    stepId: row.stepId ?? null,
    kind: row.requirementKind as AgentJobRequirementKind,
    label: row.label,
    detail: row.detail ?? null,
    status: row.status as AgentJobRequirementStatus,
    resolutionText: row.resolutionText ?? null,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
