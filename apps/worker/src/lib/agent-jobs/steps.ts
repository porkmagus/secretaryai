import type { AppConfig } from "@secretary/config";
import type { AgentJobApprovalMode } from "@secretary/core-runtime";
import type { agentJobRequirements, agentJobSteps, DbClient } from "@secretary/db";
import {
  buildAgentJobLocationHint,
  postAgentJobConversationUpdate,
} from "../agent-job-conversation-updates.js";
import {
  buildApprovalResponseMessages,
  detectExecutionRequirements,
  runDraftingAgent,
  runImplementationAgent,
  runVerificationAgent,
} from "../agent-job-executor.js";
import type { AgentJobQueueAdapter } from "../agent-job-queue.js";
import { loadAgentJobSettings } from "../agent-job-settings.js";
import type { JobRow } from "../agent-job-transformers.js";
import { getInferenceRuntimeConfig } from "../inference-settings.js";

import {
  insertArtifact,
  insertCheckpointArtifact,
  insertRequirement,
  insertTrace,
  storeCommandArtifacts,
  storeVerificationEvidenceArtifacts,
} from "./artifacts.js";
import {
  getDraftSummary,
  getImplementationSummary,
  getInspectionSummary,
  getPackageMetadata,
  getRequestFromRow,
  getVerificationAttemptCount,
  getVerifierNotes,
  parseStoredMessages,
  summarizeApprovalRequests,
} from "./context.js";
import { inspectWorkspace } from "./helpers.js";
import {
  clearPendingRequirementsForStep,
  collectVerificationBlockers,
  syncDetectedRequirements,
  syncVerificationRequirements,
} from "./requirements.js";
import { updateJobState, updateStepState } from "./state.js";

export async function executeInspectStep(params: {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  row: JobRow;
  jobId: string;
  inspectStep: typeof agentJobSteps.$inferSelect;
  steps: Array<typeof agentJobSteps.$inferSelect>;
}) {
  const now = new Date();
  const inspection = await inspectWorkspace(params.row.agent.workspacePath);
  const implementStep = params.steps.find((step) => step.stepKey === "implement_scope") ?? null;

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.inspectStep.id,
    status: "completed",
    startedAt: params.inspectStep.startedAt ?? now,
    finishedAt: new Date(),
    outputJson: {
      inspectionSummary: inspection.contentText,
      packageMetadata: inspection.metadataJson,
    },
    summary: "Workspace inspection captured.",
    errorText: null,
  });

  await insertArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.inspectStep.id,
    kind: "note",
    label: "Workspace inspection",
    contentText: inspection.contentText,
    mimeType: "text/plain",
    metadataJson: inspection.metadataJson,
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.inspectStep.id,
    label: "Inspection checkpoint",
    contentText: inspection.contentText,
    metadataJson: {
      phase: "inspect_workspace",
    },
  });

  if (implementStep) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: implementStep.id,
      status: "ready",
      errorText: null,
    });
  }

  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "running",
    blockerSummary: null,
    currentStepId: implementStep?.id ?? null,
  });

  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.inspected",
    payloadJson: {
      stepId: params.inspectStep.id,
      nextStepId: implementStep?.id ?? null,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.inspect_completed",
    importance: "normal",
    text: "Inspection done — moving to implementation.",
    metadataJson: {
      stepId: params.inspectStep.id,
      nextStepId: implementStep?.id ?? null,
    },
  });

  if (implementStep) {
    await params.queue.enqueue(params.jobId);
  }
}

export async function executeDraftingStep(params: {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  row: JobRow;
  jobId: string;
  draftStep: typeof agentJobSteps.$inferSelect;
  steps: Array<typeof agentJobSteps.$inferSelect>;
}) {
  const settings = await loadAgentJobSettings();
  const inference = await getInferenceRuntimeConfig();
  const request = getRequestFromRow(params.row);

  if (!inference.enabled) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.draftStep.id,
      status: "blocked",
      errorText: "Inference provider is not configured.",
    });
    return;
  }

  // Block if the selected provider has no default model and the user hasn't picked one.
  // Without a model the ToolLoopAgent would be constructed with model=null and crash.
  const modelResolutionIssue = inference.model
    ? null
    : "No model is configured for this provider. Pick a model in Settings > General before running agent jobs.";
  if (modelResolutionIssue) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.draftStep.id,
      status: "blocked",
      errorText: modelResolutionIssue,
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "blocked",
      blockerSummary: modelResolutionIssue,
      currentStepId: params.draftStep.id,
      errorText: null,
    });
    return;
  }

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.draftStep.id,
    status: "running",
    startedAt: params.draftStep.startedAt ?? new Date(),
    errorText: null,
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "running",
    blockerSummary: null,
    currentStepId: params.draftStep.id,
    errorText: null,
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.draftStep.id,
    label: "Drafting started",
    contentText: `Drafting started for "${request.title}" in ${params.row.agent.workspacePath}.`,
    metadataJson: {
      phase: "draft_plan",
    },
  });

  // Detect and sync runtime requirements before running the agent.
  const detectedRequirements = await detectExecutionRequirements({
    settings,
    workspacePath: params.row.agent.workspacePath,
  });
  await syncDetectedRequirements({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.draftStep.id,
    detected: detectedRequirements,
  });

  if (detectedRequirements.length > 0) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.draftStep.id,
      status: "waiting_for_runtime",
      errorText: detectedRequirements.map((entry) => entry.label).join("; "),
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "waiting_for_runtime",
      blockerSummary: detectedRequirements[0]?.detail ?? "Missing runtime requirements.",
      currentStepId: params.draftStep.id,
      errorText: null,
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.runtime_requirements_detected",
      importance: "important",
      text: `I'm blocked on runtime requirements before drafting can begin: ${detectedRequirements.map((entry) => entry.label).join("; ")}.`,
      metadataJson: {
        stepId: params.draftStep.id,
        requirements: detectedRequirements,
      },
    });
    return;
  }

  const storedMessages = parseStoredMessages(params.draftStep.outputJson?.agentMessages);

  const result = await runDraftingAgent({
    inference,
    settings,
    request: {
      title: request.title,
      goal: request.goal,
      workspacePath: params.row.agent.workspacePath,
      constraints: request.constraints ?? [],
      deliverables: request.deliverables ?? [],
    },
    workspacePath: params.row.agent.workspacePath,
    approvalMode: params.row.agent.approvalMode as AgentJobApprovalMode,
    inspectionSummary: getInspectionSummary(params.steps),
    messages: storedMessages.length > 0 ? storedMessages : undefined,
  });

  const implementStep = params.steps.find((step) => step.stepKey === "implement_scope") ?? null;
  if (implementStep) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: implementStep.id,
      status: "ready",
      errorText: null,
    });
  }

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.draftStep.id,
    status: "completed",
    finishedAt: new Date(),
    outputJson: {
      agentMessages: result.messages,
      stepSnapshots: result.stepSnapshots,
      finalText: result.finalText,
      usage: result.usage,
    },
    summary: result.finalText || "Drafting complete.",
    errorText: null,
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "running",
    blockerSummary: null,
    currentStepId: implementStep?.id ?? null,
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.draftStep.id,
    label: "Drafting completed",
    contentText: result.finalText || "Draft pass handed off to implementation.",
    metadataJson: {
      nextStepId: implementStep?.id ?? null,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.drafting_completed",
    importance: "normal",
    text: "Plan drafted — starting implementation.",
    metadataJson: {
      stepId: params.draftStep.id,
    },
  });

  if (implementStep) {
    await params.queue.enqueue(params.jobId);
  }
}

export async function executeImplementationStep(params: {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  row: JobRow;
  jobId: string;
  implementStep: typeof agentJobSteps.$inferSelect;
  steps: Array<typeof agentJobSteps.$inferSelect>;
  requirements: Array<typeof agentJobRequirements.$inferSelect>;
}) {
  const settings = await loadAgentJobSettings();
  const inference = await getInferenceRuntimeConfig();
  const request = getRequestFromRow(params.row);
  const verifyNotes = getVerifierNotes(params.steps);

  if (!inference.enabled) {
    const existingCredentialRequirement = params.requirements.find(
      (requirement) =>
        requirement.stepId === params.implementStep.id &&
        requirement.requirementKind === "credential" &&
        requirement.status === "pending",
    );

    if (!existingCredentialRequirement) {
      await insertRequirement({
        dbClient: params.dbClient,
        jobId: params.jobId,
        stepId: params.implementStep.id,
        kind: "credential",
        label: "Inference provider must be configured",
        detail:
          "Autonomous build jobs need an active AI SDK inference provider before execution can continue.",
        metadataJson: {
          providerSummary: inference.summary,
        },
      });
    }

    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.implementStep.id,
      status: "blocked",
      errorText: "Inference provider is not configured.",
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "blocked",
      blockerSummary: "Configure the AI inference provider before running autonomous jobs.",
      currentStepId: params.implementStep.id,
      errorText: null,
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.inference_blocked",
      importance: "important",
      text: "I’m blocked because the AI inference provider is not configured yet. Set that up in Settings > General before I continue this build job.",
      metadataJson: {
        stepId: params.implementStep.id,
      },
    });
    return;
  }

  const pendingApprovals = params.requirements.filter(
    (requirement) =>
      requirement.stepId === params.implementStep.id && requirement.status === "pending",
  );
  const resolvedApprovals = params.requirements.filter(
    (requirement) =>
      requirement.stepId === params.implementStep.id &&
      requirement.requirementKind === "approval" &&
      requirement.status !== "pending",
  );

  const detectedRequirements = await detectExecutionRequirements({
    settings,
    workspacePath: params.row.agent.workspacePath,
  });
  await syncDetectedRequirements({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.implementStep.id,
    detected: detectedRequirements,
  });

  if (detectedRequirements.length > 0) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.implementStep.id,
      status: "waiting_for_runtime",
      errorText: detectedRequirements.map((entry) => entry.label).join("; "),
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "waiting_for_runtime",
      blockerSummary: detectedRequirements[0]?.detail ?? "Missing runtime requirements.",
      currentStepId: params.implementStep.id,
      errorText: null,
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.runtime_requirements_detected",
      importance: "important",
      text: `I’m blocked on runtime requirements before implementation can continue: ${detectedRequirements.map((entry) => entry.label).join("; ")}. ${buildAgentJobLocationHint(params.jobId)}`,
      metadataJson: {
        stepId: params.implementStep.id,
        requirements: detectedRequirements,
      },
    });
    return;
  }

  if (pendingApprovals.length > 0) {
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "waiting_for_approval",
      blockerSummary: `${pendingApprovals.length} tool approval${pendingApprovals.length === 1 ? "" : "s"} waiting in the queue.`,
      currentStepId: params.implementStep.id,
    });
    return;
  }

  const storedMessages = parseStoredMessages(params.implementStep.outputJson?.agentMessages);
  const approvalMessages = buildApprovalResponseMessages({
    approvalDecisions: resolvedApprovals.map((requirement) => ({
      approvalId:
        typeof requirement.metadataJson?.approvalId === "string"
          ? requirement.metadataJson.approvalId
          : requirement.id,
      approved: requirement.status === "satisfied",
      reason: requirement.resolutionText ?? undefined,
    })),
  });
  const messages =
    storedMessages.length > 0 && approvalMessages.length > 0
      ? [...storedMessages, ...approvalMessages]
      : storedMessages.length > 0
        ? storedMessages
        : undefined;

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.implementStep.id,
    status: "running",
    startedAt: params.implementStep.startedAt ?? new Date(),
    errorText: null,
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: resolvedApprovals.length > 0 ? "retrying" : "running",
    blockerSummary: null,
    currentStepId: params.implementStep.id,
    errorText: null,
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.implementStep.id,
    label: "Implementation started",
    contentText: `Implementation started for "${request.title}" in ${params.row.agent.workspacePath}.`,
    metadataJson: {
      phase: "implement_scope",
      approvalMode: params.row.agent.approvalMode,
    },
  });

  const result = await runImplementationAgent({
    inference,
    settings,
    request: {
      title: request.title,
      goal: request.goal,
      workspacePath: params.row.agent.workspacePath,
      constraints: request.constraints ?? [],
      deliverables: request.deliverables ?? [],
    },
    workspacePath: params.row.agent.workspacePath,
    approvalMode: params.row.agent.approvalMode as AgentJobApprovalMode,
    inspectionSummary: getInspectionSummary(params.steps),
    draftSummary: getDraftSummary(params.steps),
    priorVerifierNotes: verifyNotes,
    messages,
  });

  await clearPendingRequirementsForStep({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.implementStep.id,
  });

  await insertArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.implementStep.id,
    kind: "note",
    label: "Implementation agent summary",
    contentText:
      result.finalText || "The implementation agent completed without a final text summary.",
    mimeType: "text/plain",
    metadataJson: {
      usage: result.usage,
      steps: result.stepSnapshots.length,
      approvalRequests: result.approvalRequests.length,
    },
  });
  await storeCommandArtifacts({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.implementStep.id,
    commandLogs: result.commandLogs,
  });

  if (result.kind === "needs_approval") {
    for (const approval of result.approvalRequests) {
      await insertRequirement({
        dbClient: params.dbClient,
        jobId: params.jobId,
        stepId: params.implementStep.id,
        kind: "approval",
        label: `${approval.toolName} needs approval`,
        detail: `Review the requested ${approval.toolName} action before the job can continue.`,
        metadataJson: {
          approvalId: approval.approvalId,
          toolCallId: approval.toolCallId,
          toolName: approval.toolName,
          input: approval.input,
        },
      });
    }

    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.implementStep.id,
      status: "waiting_for_approval",
      outputJson: {
        agentMessages: result.messages,
        stepSnapshots: result.stepSnapshots,
        finalText: result.finalText,
        usage: result.usage,
      },
      summary: result.finalText || params.implementStep.summary,
      errorText: null,
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "waiting_for_approval",
      blockerSummary: result.blockerSummary,
      currentStepId: params.implementStep.id,
    });
    await insertTrace({
      dbClient: params.dbClient,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.awaiting_approval",
      payloadJson: {
        stepId: params.implementStep.id,
        approvals: result.approvalRequests.map((approval) => ({
          approvalId: approval.approvalId,
          toolName: approval.toolName,
        })),
      },
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.awaiting_approval",
      importance: "important",
      text: summarizeApprovalRequests(result.approvalRequests),
      metadataJson: {
        stepId: params.implementStep.id,
        approvals: result.approvalRequests.map((approval) => ({
          approvalId: approval.approvalId,
          toolName: approval.toolName,
        })),
      },
    });
    return;
  }

  const verifyStep = params.steps.find((step) => step.stepKey === "verify_result") ?? null;
  if (verifyStep) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: verifyStep.id,
      status: "ready",
      errorText: null,
    });
  }

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.implementStep.id,
    status: "completed",
    finishedAt: new Date(),
    outputJson: {
      agentMessages: result.messages,
      stepSnapshots: result.stepSnapshots,
      finalText: result.finalText,
      usage: result.usage,
      lastFailureNotes: verifyNotes,
    },
    summary: result.finalText || "Implementation agent completed.",
    errorText: null,
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "running",
    blockerSummary: null,
    currentStepId: verifyStep?.id ?? null,
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.implementStep.id,
    label: "Implementation completed",
    contentText:
      result.finalText || "Implementation pass completed and handed off to verification.",
    metadataJson: {
      commandLogCount: result.commandLogs.length,
      nextStepId: verifyStep?.id ?? null,
    },
  });
  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.implemented",
    payloadJson: {
      stepId: params.implementStep.id,
      nextStepId: verifyStep?.id ?? null,
      commandLogs: result.commandLogs.length,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.implementation_completed",
    importance: "normal",
    text: "Implementation done — starting verification.",
    metadataJson: {
      stepId: params.implementStep.id,
      nextStepId: verifyStep?.id ?? null,
    },
  });

  if (verifyStep) {
    await params.queue.enqueue(params.jobId);
  }
}

export async function executeVerificationStep(params: {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  row: JobRow;
  jobId: string;
  verifyStep: typeof agentJobSteps.$inferSelect;
  steps: Array<typeof agentJobSteps.$inferSelect>;
  requirements: Array<typeof agentJobRequirements.$inferSelect>;
}) {
  const settings = await loadAgentJobSettings();
  const inference = await getInferenceRuntimeConfig();
  const request = getRequestFromRow(params.row);

  if (!inference.enabled) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.verifyStep.id,
      status: "blocked",
      errorText: "Inference provider is not configured.",
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "blocked",
      blockerSummary: "Configure the AI inference provider before running autonomous verification.",
      currentStepId: params.verifyStep.id,
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.verification_inference_blocked",
      importance: "important",
      text: "I’m blocked because the AI inference provider is not configured for verification yet. Update Settings > General before I continue this build job.",
      metadataJson: {
        stepId: params.verifyStep.id,
      },
    });
    return;
  }

  const pendingApprovals = params.requirements.filter(
    (requirement) =>
      requirement.stepId === params.verifyStep.id && requirement.status === "pending",
  );
  const resolvedApprovals = params.requirements.filter(
    (requirement) =>
      requirement.stepId === params.verifyStep.id &&
      requirement.requirementKind === "approval" &&
      requirement.status !== "pending",
  );

  const detectedRequirements = await detectExecutionRequirements({
    settings,
    workspacePath: params.row.agent.workspacePath,
  });
  await syncDetectedRequirements({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
    detected: detectedRequirements,
  });

  if (detectedRequirements.length > 0) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.verifyStep.id,
      status: "waiting_for_runtime",
      errorText: detectedRequirements.map((entry) => entry.label).join("; "),
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "waiting_for_runtime",
      blockerSummary: detectedRequirements[0]?.detail ?? "Missing runtime requirements.",
      currentStepId: params.verifyStep.id,
      errorText: null,
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.verification_requirements_detected",
      importance: "important",
      text: `I’m blocked on runtime requirements before verification can continue: ${detectedRequirements.map((entry) => entry.label).join("; ")}. ${buildAgentJobLocationHint(params.jobId)}`,
      metadataJson: {
        stepId: params.verifyStep.id,
        requirements: detectedRequirements,
      },
    });
    return;
  }

  if (pendingApprovals.length > 0) {
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "waiting_for_approval",
      blockerSummary: `${pendingApprovals.length} verification approval${pendingApprovals.length === 1 ? "" : "s"} waiting in the queue.`,
      currentStepId: params.verifyStep.id,
    });
    return;
  }

  const storedMessages = parseStoredMessages(params.verifyStep.outputJson?.agentMessages);
  const approvalMessages = buildApprovalResponseMessages({
    approvalDecisions: resolvedApprovals.map((requirement) => ({
      approvalId:
        typeof requirement.metadataJson?.approvalId === "string"
          ? requirement.metadataJson.approvalId
          : requirement.id,
      approved: requirement.status === "satisfied",
      reason: requirement.resolutionText ?? undefined,
    })),
  });
  const messages =
    storedMessages.length > 0 && approvalMessages.length > 0
      ? [...storedMessages, ...approvalMessages]
      : storedMessages.length > 0
        ? storedMessages
        : undefined;

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.verifyStep.id,
    status: "running",
    startedAt: params.verifyStep.startedAt ?? new Date(),
    errorText: null,
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "running",
    blockerSummary: null,
    currentStepId: params.verifyStep.id,
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
    label: "Verification started",
    contentText: `Verification started for "${request.title}".`,
    metadataJson: {
      phase: "verify_result",
    },
  });

  const result = await runVerificationAgent({
    inference,
    settings,
    request: {
      title: request.title,
      goal: request.goal,
      workspacePath: params.row.agent.workspacePath,
      constraints: request.constraints ?? [],
      deliverables: request.deliverables ?? [],
    },
    workspacePath: params.row.agent.workspacePath,
    approvalMode: params.row.agent.approvalMode as AgentJobApprovalMode,
    implementationSummary: getImplementationSummary(params.steps),
    packageMetadata: getPackageMetadata(params.steps),
    messages,
  });

  await clearPendingRequirementsForStep({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
  });
  await storeCommandArtifacts({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
    commandLogs: result.commandLogs,
  });
  await storeVerificationEvidenceArtifacts({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
    stepSnapshots: result.stepSnapshots,
  });
  await syncVerificationRequirements({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
    stepSnapshots: result.stepSnapshots,
  });
  await insertArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
    kind: "verification",
    label: "Verification summary",
    contentText: result.finalText || "Verification finished without a final text summary.",
    mimeType: "text/plain",
    metadataJson: {
      usage: result.usage,
      steps: result.stepSnapshots.length,
      approvals: result.approvalRequests.length,
      commandLogs: result.commandLogs.length,
    },
  });

  if (result.kind === "needs_approval") {
    for (const approval of result.approvalRequests) {
      await insertRequirement({
        dbClient: params.dbClient,
        jobId: params.jobId,
        stepId: params.verifyStep.id,
        kind: "approval",
        label: `${approval.toolName} needs approval`,
        detail: `Review the requested ${approval.toolName} action before verification can continue.`,
        metadataJson: {
          approvalId: approval.approvalId,
          toolCallId: approval.toolCallId,
          toolName: approval.toolName,
          input: approval.input,
        },
      });
    }

    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.verifyStep.id,
      status: "waiting_for_approval",
      outputJson: {
        agentMessages: result.messages,
        stepSnapshots: result.stepSnapshots,
        finalText: result.finalText,
        usage: result.usage,
        attemptCount: getVerificationAttemptCount(params.steps) + 1,
      },
      summary: result.finalText || params.verifyStep.summary,
      errorText: null,
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "waiting_for_approval",
      blockerSummary: result.blockerSummary,
      currentStepId: params.verifyStep.id,
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.verification_awaiting_approval",
      importance: "important",
      text: summarizeApprovalRequests(result.approvalRequests),
      metadataJson: {
        stepId: params.verifyStep.id,
        approvals: result.approvalRequests.map((approval) => ({
          approvalId: approval.approvalId,
          toolName: approval.toolName,
        })),
      },
    });
    return;
  }

  const attemptCount = getVerificationAttemptCount(params.steps) + 1;
  const failureNotes = collectVerificationBlockers({
    commandLogs: result.commandLogs,
    stepSnapshots: result.stepSnapshots,
  });

  if (failureNotes.length > 0) {
    const maxAttempts = settings.maxVerificationAttempts;

    if (attemptCount < maxAttempts) {
      const implementStep = params.steps.find((step) => step.stepKey === "implement_scope") ?? null;
      await updateStepState({
        dbClient: params.dbClient,
        stepId: params.verifyStep.id,
        status: "retrying",
        outputJson: {
          agentMessages: result.messages,
          stepSnapshots: result.stepSnapshots,
          finalText: result.finalText,
          usage: result.usage,
          attemptCount,
          lastFailureNotes: failureNotes,
        },
        summary:
          result.finalText ||
          "Verification found blockers and scheduled another implementation pass.",
        errorText: failureNotes.join("; "),
      });
      if (implementStep) {
        await updateStepState({
          dbClient: params.dbClient,
          stepId: implementStep.id,
          status: "ready",
          errorText: failureNotes.join("; "),
        });
      }
      await updateJobState({
        dbClient: params.dbClient,
        jobId: params.jobId,
        status: "retrying",
        blockerSummary: `Verification found blockers. Starting repair pass ${attemptCount + 1} of ${maxAttempts}.`,
        currentStepId: implementStep?.id ?? params.verifyStep.id,
      });
      await insertCheckpointArtifact({
        dbClient: params.dbClient,
        jobId: params.jobId,
        stepId: params.verifyStep.id,
        label: "Verification requested repair pass",
        contentText: failureNotes.join("\n"),
        metadataJson: {
          attemptCount,
          maxAttempts,
        },
      });
      await insertTrace({
        dbClient: params.dbClient,
        conversationId: params.row.agent.conversationId ?? null,
        jobId: params.jobId,
        eventName: "agent.job.verification_retrying",
        payloadJson: {
          attemptCount,
          failingCommands: failureNotes,
        },
      });
      await postAgentJobConversationUpdate({
        dbClient: params.dbClient,
        config: params.config,
        conversationId: params.row.agent.conversationId ?? null,
        jobId: params.jobId,
        eventName: "agent.job.chat.verification_retrying",
        importance: "important",
        text: `Verification found blockers, so I’m starting repair pass ${attemptCount + 1} of ${maxAttempts}.`,
        metadataJson: {
          attemptCount,
          failingCommands: failureNotes,
        },
      });
      await params.queue.enqueue(params.jobId);
      return;
    }

    await updateStepState({
      dbClient: params.dbClient,
      stepId: params.verifyStep.id,
      status: "failed",
      finishedAt: new Date(),
      outputJson: {
        agentMessages: result.messages,
        stepSnapshots: result.stepSnapshots,
        finalText: result.finalText,
        usage: result.usage,
        attemptCount,
        lastFailureNotes: failureNotes,
      },
      summary: result.finalText || "Verification failed.",
      errorText: failureNotes.join("; "),
    });
    await updateJobState({
      dbClient: params.dbClient,
      jobId: params.jobId,
      status: "blocked",
      blockerSummary: `Verification failed after ${attemptCount} attempt${attemptCount === 1 ? "" : "s"}: ${failureNotes.join("; ")}`,
      currentStepId: params.verifyStep.id,
      resultSummary: null,
      errorText: null,
    });
    await insertCheckpointArtifact({
      dbClient: params.dbClient,
      jobId: params.jobId,
      stepId: params.verifyStep.id,
      label: "Verification failed",
      contentText: failureNotes.join("\n"),
      metadataJson: {
        attemptCount,
      },
    });
    await postAgentJobConversationUpdate({
      dbClient: params.dbClient,
      config: params.config,
      conversationId: params.row.agent.conversationId ?? null,
      jobId: params.jobId,
      eventName: "agent.job.chat.verification_failed",
      importance: "important",
      text: `Verification is blocked after ${attemptCount} attempt${attemptCount === 1 ? "" : "s"}: ${failureNotes.join("; ")}. ${buildAgentJobLocationHint(params.jobId)}`,
      metadataJson: {
        attemptCount,
        failingCommands: failureNotes,
      },
    });
    return;
  }

  const finalizeStep = params.steps.find((step) => step.stepKey === "finalize_handoff") ?? null;
  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.verifyStep.id,
    status: "completed",
    finishedAt: new Date(),
    outputJson: {
      agentMessages: result.messages,
      stepSnapshots: result.stepSnapshots,
      finalText: result.finalText,
      usage: result.usage,
      attemptCount,
      lastFailureNotes: [],
    },
    summary: result.finalText || "Verification completed.",
    errorText: null,
  });
  if (finalizeStep) {
    await updateStepState({
      dbClient: params.dbClient,
      stepId: finalizeStep.id,
      status: "ready",
      errorText: null,
    });
  }
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "running",
    blockerSummary: null,
    currentStepId: finalizeStep?.id ?? null,
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.verifyStep.id,
    label: "Verification completed",
    contentText: result.finalText || "Verification completed successfully.",
    metadataJson: {
      attemptCount,
      nextStepId: finalizeStep?.id ?? null,
    },
  });
  if (finalizeStep) {
    await params.queue.enqueue(params.jobId);
  }
}

export async function executeFinalizeStep(params: {
  config: AppConfig;
  dbClient: DbClient;
  row: JobRow;
  jobId: string;
  finalizeStep: typeof agentJobSteps.$inferSelect;
  steps: Array<typeof agentJobSteps.$inferSelect>;
}) {
  const implementationSummary = getImplementationSummary(params.steps);
  const verificationSummary = params.steps.find((step) => step.stepKey === "verify_result")
    ?.outputJson?.finalText;
  const verificationText =
    typeof verificationSummary === "string"
      ? verificationSummary
      : "Verification summary unavailable.";
  const lines = [
    `Goal: ${params.row.agent.goal}`,
    "",
    "Implementation:",
    implementationSummary,
    "",
    "Verification:",
    verificationText,
  ];
  const summaryText = lines.join("\n");
  const finishedAt = new Date();

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.finalizeStep.id,
    status: "completed",
    startedAt: params.finalizeStep.startedAt ?? finishedAt,
    finishedAt,
    outputJson: {
      summaryText,
    },
    summary: "Operator handoff prepared.",
    errorText: null,
  });
  await insertArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.finalizeStep.id,
    kind: "result_summary",
    label: "Operator handoff",
    contentText: summaryText,
    mimeType: "text/plain",
    metadataJson: {},
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.finalizeStep.id,
    label: "Finalize checkpoint",
    contentText: summaryText,
    metadataJson: {
      phase: "finalize_handoff",
    },
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "completed",
    blockerSummary: null,
    currentStepId: null,
    resultSummary: summaryText,
    errorText: null,
    finishedAt,
  });
  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.completed",
    payloadJson: {
      resultSummary: summaryText,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.completed",
    importance: "important",
    text: `The build job is complete.\n\n${summaryText}\n\n${buildAgentJobLocationHint(params.jobId)}`,
    metadataJson: {
      stepId: params.finalizeStep.id,
      resultSummary: summaryText,
    },
  });
}
