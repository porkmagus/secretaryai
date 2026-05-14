import type { AgentJobApprovalMode, CreateAgentJobRequest } from "@secretary/core-runtime";
import type { agentJobSteps } from "@secretary/db";
import type { ModelMessage } from "ai";
import type { JobRow } from "../agent-job-transformers.js";

export function getRequestFromRow(row: JobRow): CreateAgentJobRequest {
  return {
    title: row.agent.title,
    goal: row.agent.goal,
    workspacePath: row.agent.workspacePath,
    conversationId: row.agent.conversationId ?? null,
    approvalMode: row.agent.approvalMode as AgentJobApprovalMode,
    constraints: Array.isArray(row.job.payloadJson.constraints)
      ? row.job.payloadJson.constraints.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    deliverables: Array.isArray(row.job.payloadJson.deliverables)
      ? row.job.payloadJson.deliverables.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

export function parseStoredMessages(value: unknown): ModelMessage[] {
  return Array.isArray(value) ? (value as ModelMessage[]) : [];
}

export function getInspectionSummary(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const inspectStep = steps.find((step) => step.stepKey === "inspect_workspace");
  const summary = inspectStep?.outputJson?.inspectionSummary;
  return typeof summary === "string" ? summary : "No workspace inspection summary recorded yet.";
}

export function getPackageMetadata(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const inspectStep = steps.find((step) => step.stepKey === "inspect_workspace");
  const metadata = inspectStep?.outputJson?.packageMetadata;
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
}

export function getDraftSummary(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const draftStep = steps.find((step) => step.stepKey === "draft_plan");
  const summary = draftStep?.outputJson?.finalText;
  return typeof summary === "string" ? summary : "No detailed plan was drafted.";
}

export function getImplementationSummary(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const implementStep = steps.find((step) => step.stepKey === "implement_scope");
  const summary = implementStep?.outputJson?.finalText;
  return typeof summary === "string" ? summary : "No implementation summary recorded yet.";
}

export function getVerifierNotes(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const verifyStep = steps.find((step) => step.stepKey === "verify_result");
  const notes = verifyStep?.outputJson?.lastFailureNotes;
  return Array.isArray(notes)
    ? notes.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function getVerificationAttemptCount(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const verifyStep = steps.find((step) => step.stepKey === "verify_result");
  const count = verifyStep?.outputJson?.attemptCount;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

export function summarizeApprovalRequests(
  approvals: Array<{
    toolName: string;
  }>,
) {
  const names = approvals.map((approval) => approval.toolName);
  const uniqueNames = [...new Set(names)];

  if (uniqueNames.length === 0) {
    return "A tool action needs approval before the job can continue.";
  }

  if (uniqueNames.length === 1) {
    return `${uniqueNames[0]} needs approval before the job can continue.`;
  }

  return `${uniqueNames.slice(0, 3).join(", ")} need approval before the job can continue.`;
}
