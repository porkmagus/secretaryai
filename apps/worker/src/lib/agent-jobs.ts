import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { type ModelMessage } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import type {
  AgentJobActionResponse,
  AgentJobApprovalMode,
  AgentJobArtifactKind,
  AgentJobArtifactRecord,
  AgentJobDetailResponse,
  AgentJobListResponse,
  AgentJobRecord,
  AgentJobRequirementDecisionRequest,
  AgentJobRequirementKind,
  AgentJobRequirementRecord,
  AgentJobRequirementStatus,
  AgentJobSettingsResponse,
  AgentJobStatus,
  AgentJobStepKind,
  AgentJobStepRecord,
  AgentJobStepStatus,
  CreateAgentJobRequest,
} from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import {
  agentJobArtifacts,
  agentJobRequirements,
  agentJobSteps,
  agentJobs,
  activityTraces,
  jobs,
  users,
  type DbClient,
} from "@secretary/db";
import type { AgentJobQueueAdapter } from "./agent-job-queue.js";
import {
  buildApprovalResponseMessages,
  detectExecutionRequirements,
  normalizeWorkspacePath,
  runDraftingAgent,
  runImplementationAgent,
  runVerificationAgent,
} from "./agent-job-executor.js";
import {
  getAgentJobSettings,
  loadAgentJobSettings,
  updateAgentJobSettings,
} from "./agent-job-settings.js";
import {
  buildAgentJobLocationHint,
  postAgentJobConversationUpdate,
} from "./agent-job-conversation-updates.js";
import { getInferenceRuntimeConfig } from "./inference-settings.js";

type CreateAgentJobParams = {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  request: CreateAgentJobRequest;
};

type StepPlan = {
  stepKey: string;
  title: string;
  detail: string;
  kind: AgentJobStepKind;
  status: AgentJobStepStatus;
  dependsOnStepIds: string[];
  toolKey?: string | null;
  summary?: string | null;
};

type JobRow = {
  job: typeof jobs.$inferSelect;
  agent: typeof agentJobs.$inferSelect;
};

async function pathExists(path: string) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeApprovalMode(value: CreateAgentJobRequest["approvalMode"]): AgentJobApprovalMode {
  if (value === "restrictive" || value === "full_access") {
    return value;
  }

  return "builder";
}

async function ensureDefaultUser(dbClient: DbClient, config: AppConfig) {
  const existing = await dbClient.db.query.users.findFirst({
    where: eq(users.id, config.defaultUserId),
  });

  if (existing) {
    return;
  }

  await dbClient.db.insert(users).values({
    id: config.defaultUserId,
    displayName: "Owner",
    defaultPersonaId: config.defaultPersonaId,
  });
}

function toAgentJobRecord(row: JobRow): AgentJobRecord {
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

function toStepRecord(row: typeof agentJobSteps.$inferSelect): AgentJobStepRecord {
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

function toArtifactRecord(row: typeof agentJobArtifacts.$inferSelect): AgentJobArtifactRecord {
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

function toRequirementRecord(row: typeof agentJobRequirements.$inferSelect): AgentJobRequirementRecord {
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

function buildInitialPlan(request: CreateAgentJobRequest): StepPlan[] {
  const deliverables = request.deliverables?.filter(Boolean) ?? [];
  const constraints = request.constraints?.filter(Boolean) ?? [];

  return [
    {
      stepKey: "inspect_workspace",
      title: "Inspect workspace and constraints",
      detail:
        constraints.length > 0
          ? `Review the existing project and honor these constraints: ${constraints.join("; ")}.`
          : "Inspect the current workspace, identify the active stack, and confirm the safest implementation path.",
      kind: "analyze",
      status: "ready",
      dependsOnStepIds: [],
      toolKey: "file_read",
      summary: "Map the workspace before making changes.",
    },
    {
      stepKey: "draft_plan",
      title: "Draft an execution plan",
      detail: "Explore the codebase using search tools to build a comprehensive plan before editing files.",
      kind: "plan",
      status: "pending",
      dependsOnStepIds: ["inspect_workspace"],
      toolKey: "agent_planner",
      summary: "Gather context and construct sequence.",
    },
    {
      stepKey: "implement_scope",
      title: "Implement the requested scope",
      detail:
        deliverables.length > 0
          ? `Build the requested outcome and cover these deliverables: ${deliverables.join("; ")}.`
          : `Implement the requested outcome: ${request.goal}.`,
      kind: "edit",
      status: "pending",
      dependsOnStepIds: ["draft_plan"],
      toolKey: "agent_executor",
      summary: "Make the required code and content changes.",
    },
    {
      stepKey: "verify_result",
      title: "Run verification and capture evidence",
      detail: "Run the strongest available checks, capture logs, and decide whether the workspace is genuinely ready to hand off.",
      kind: "verify",
      status: "pending",
      dependsOnStepIds: ["implement_scope"],
      toolKey: "agent_verifier",
      summary: "Produce proof that the build works or record the exact blocker.",
    },
    {
      stepKey: "finalize_handoff",
      title: "Finalize the handoff summary",
      detail: "Summarize what changed, what remains, and which artifacts or commands matter to the operator.",
      kind: "finalize",
      status: "pending",
      dependsOnStepIds: ["verify_result"],
      summary: "Return a crisp operator-ready result summary.",
    },
  ];
}

async function inspectWorkspace(workspacePath: string) {
  const entries = await readDirectorySafe(workspacePath);
  const directories = entries
    .filter((entry) => entry.kind === "directory")
    .map((entry) => entry.name)
    .sort();
  const files = entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name)
    .sort();

  let packageSummary = "No package.json detected at the workspace root.";
  let packageMetadata: Record<string, unknown> = {
    hasPackageJson: false,
  };

  const packageJsonPath = join(workspacePath, "package.json");

  if (await pathExists(packageJsonPath)) {
    try {
      const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
      packageMetadata = {
        hasPackageJson: true,
        name: typeof parsed.name === "string" ? parsed.name : null,
        private: parsed.private === true,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        scripts:
          parsed.scripts && typeof parsed.scripts === "object"
            ? parsed.scripts
            : {},
      };
      const workspaceCount = Array.isArray(parsed.workspaces) ? parsed.workspaces.length : 0;
      packageSummary = [
        typeof parsed.name === "string" ? `Package: ${parsed.name}` : null,
        workspaceCount > 0 ? `Workspaces: ${workspaceCount}` : null,
        parsed.private === true ? "Private workspace: yes" : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n");
    } catch {
      packageSummary = "package.json exists but could not be parsed.";
      packageMetadata = {
        hasPackageJson: true,
        parseError: true,
      };
    }
  }

  const contentText = [
    `Workspace: ${workspacePath}`,
    "",
    packageSummary,
    "",
    `Top-level directories (${directories.length}): ${directories.slice(0, 16).join(", ") || "none"}`,
    `Top-level files (${files.length}): ${files.slice(0, 16).join(", ") || "none"}`,
  ].join("\n");

  return {
    contentText,
    metadataJson: {
      ...packageMetadata,
      directories: directories.slice(0, 32),
      files: files.slice(0, 32),
    },
  };
}

async function readDirectorySafe(workspacePath: string) {
  const dirents = await (await import("node:fs/promises")).readdir(workspacePath, { withFileTypes: true });
  return dirents.map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
  }));
}

function buildPlanArtifact(request: CreateAgentJobRequest, steps: StepPlan[]) {
  const lines = [
    `# ${request.title}`,
    "",
    `Goal: ${request.goal}`,
    "",
    `Workspace: ${request.workspacePath}`,
  ];

  if (request.constraints?.length) {
    lines.push("", "Constraints:");
    for (const entry of request.constraints) {
      lines.push(`- ${entry}`);
    }
  }

  if (request.deliverables?.length) {
    lines.push("", "Deliverables:");
    for (const entry of request.deliverables) {
      lines.push(`- ${entry}`);
    }
  }

  lines.push("", "Planned steps:");

  for (const [index, step] of steps.entries()) {
    lines.push(`${index + 1}. ${step.title}`);
    lines.push(`   ${step.detail}`);
  }

  return lines.join("\n");
}

async function getAgentJobRow(dbClient: DbClient, jobId: string) {
  const rows = await dbClient.db
    .select({
      job: jobs,
      agent: agentJobs,
    })
    .from(agentJobs)
    .innerJoin(jobs, eq(agentJobs.jobId, jobs.id))
    .where(eq(agentJobs.jobId, jobId))
    .limit(1);

  return rows[0] ?? null;
}

async function listStepRows(dbClient: DbClient, jobId: string) {
  return dbClient.db.query.agentJobSteps.findMany({
    where: eq(agentJobSteps.jobId, jobId),
    orderBy: [asc(agentJobSteps.sequence), asc(agentJobSteps.createdAt)],
  });
}

async function listRequirementRows(dbClient: DbClient, jobId: string) {
  return dbClient.db.query.agentJobRequirements.findMany({
    where: eq(agentJobRequirements.jobId, jobId),
    orderBy: [asc(agentJobRequirements.createdAt)],
  });
}

async function insertTrace(params: {
  dbClient: DbClient;
  conversationId: string | null;
  jobId: string;
  eventName: string;
  payloadJson: Record<string, unknown>;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "runtime",
    parentTraceId: null,
    conversationId: params.conversationId,
    jobId: params.jobId,
    eventName: params.eventName,
    payloadJson: params.payloadJson,
  });
}

async function insertArtifact(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string | null;
  kind: AgentJobArtifactKind;
  label: string;
  storageKey?: string | null;
  contentText?: string | null;
  metadataJson?: Record<string, unknown>;
  mimeType?: string | null;
}) {
  await params.dbClient.db.insert(agentJobArtifacts).values({
    id: createMessageId(),
    jobId: params.jobId,
    stepId: params.stepId,
    artifactKind: params.kind,
    label: params.label,
    storageKey: params.storageKey ?? null,
    contentText: params.contentText ?? null,
    mimeType: params.mimeType ?? null,
    metadataJson: params.metadataJson ?? {},
  });
}

async function insertRequirement(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string | null;
  kind: AgentJobRequirementKind;
  label: string;
  detail: string | null;
  status?: AgentJobRequirementStatus;
  metadataJson?: Record<string, unknown>;
  resolutionText?: string | null;
}) {
  await params.dbClient.db.insert(agentJobRequirements).values({
    id: createMessageId(),
    jobId: params.jobId,
    stepId: params.stepId,
    requirementKind: params.kind,
    label: params.label,
    detail: params.detail,
    status: params.status ?? "pending",
    resolutionText: params.resolutionText ?? null,
    metadataJson: params.metadataJson ?? {},
  });
}

function getRequestFromRow(row: JobRow): CreateAgentJobRequest {
  return {
    title: row.agent.title,
    goal: row.agent.goal,
    workspacePath: row.agent.workspacePath,
    conversationId: row.agent.conversationId ?? null,
    approvalMode: row.agent.approvalMode as AgentJobApprovalMode,
    constraints: Array.isArray(row.job.payloadJson.constraints)
      ? row.job.payloadJson.constraints.filter((value): value is string => typeof value === "string")
      : [],
    deliverables: Array.isArray(row.job.payloadJson.deliverables)
      ? row.job.payloadJson.deliverables.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function getCurrentStep(steps: Array<typeof agentJobSteps.$inferSelect>, currentStepId: string | null) {
  return (
    steps.find((step) => step.id === currentStepId) ??
    steps.find((step) => step.status !== "completed" && step.status !== "cancelled") ??
    null
  );
}

function parseStoredMessages(value: unknown): ModelMessage[] {
  return Array.isArray(value) ? (value as ModelMessage[]) : [];
}

function getInspectionSummary(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const inspectStep = steps.find((step) => step.stepKey === "inspect_workspace");
  const summary = inspectStep?.outputJson?.inspectionSummary;
  return typeof summary === "string" ? summary : "No workspace inspection summary recorded yet.";
}

function getPackageMetadata(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const inspectStep = steps.find((step) => step.stepKey === "inspect_workspace");
  const metadata = inspectStep?.outputJson?.packageMetadata;
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
}

function getDraftSummary(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const draftStep = steps.find((step) => step.stepKey === "draft_plan");
  const summary = draftStep?.outputJson?.finalText;
  return typeof summary === "string" ? summary : "No detailed plan was drafted.";
}

function getImplementationSummary(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const implementStep = steps.find((step) => step.stepKey === "implement_scope");
  const summary = implementStep?.outputJson?.finalText;
  return typeof summary === "string" ? summary : "No implementation summary recorded yet.";
}

function getVerifierNotes(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const verifyStep = steps.find((step) => step.stepKey === "verify_result");
  const notes = verifyStep?.outputJson?.lastFailureNotes;
  return Array.isArray(notes)
    ? notes.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function getVerificationAttemptCount(steps: Array<typeof agentJobSteps.$inferSelect>) {
  const verifyStep = steps.find((step) => step.stepKey === "verify_result");
  const count = verifyStep?.outputJson?.attemptCount;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

function summarizeApprovalRequests(
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

async function updateJobState(params: {
  dbClient: DbClient;
  jobId: string;
  status?: AgentJobStatus;
  blockerSummary?: string | null;
  currentStepId?: string | null;
  resultSummary?: string | null;
  errorText?: string | null;
  finishedAt?: Date | null;
}) {
  const now = new Date();
  await params.dbClient.db.update(jobs).set({
    ...(params.status ? { status: params.status } : {}),
    ...(params.errorText !== undefined ? { errorText: params.errorText } : {}),
    ...(params.finishedAt !== undefined ? { finishedAt: params.finishedAt } : {}),
    updatedAt: now,
  }).where(eq(jobs.id, params.jobId));

  await params.dbClient.db.update(agentJobs).set({
    ...(params.blockerSummary !== undefined ? { blockerSummary: params.blockerSummary } : {}),
    ...(params.currentStepId !== undefined ? { currentStepId: params.currentStepId } : {}),
    ...(params.resultSummary !== undefined ? { resultSummary: params.resultSummary } : {}),
  }).where(eq(agentJobs.jobId, params.jobId));
}

async function updateStepState(params: {
  dbClient: DbClient;
  stepId: string;
  status?: AgentJobStepStatus;
  outputJson?: Record<string, unknown> | null;
  summary?: string | null;
  errorText?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  await params.dbClient.db.update(agentJobSteps).set({
    ...(params.status ? { status: params.status } : {}),
    ...(params.outputJson !== undefined ? { outputJson: params.outputJson } : {}),
    ...(params.summary !== undefined ? { summary: params.summary } : {}),
    ...(params.errorText !== undefined ? { errorText: params.errorText } : {}),
    ...(params.startedAt !== undefined ? { startedAt: params.startedAt } : {}),
    ...(params.finishedAt !== undefined ? { finishedAt: params.finishedAt } : {}),
    updatedAt: new Date(),
  }).where(eq(agentJobSteps.id, params.stepId));
}

async function prepareInitialPlan(params: {
  config: AppConfig;
  dbClient: DbClient;
  jobId: string;
  row: JobRow;
}) {
  const request = getRequestFromRow(params.row);
  const workspaceReady = await pathExists(params.row.agent.workspacePath);
  const plannedSteps = buildInitialPlan(request);
  const firstStepStatus: AgentJobStepStatus = workspaceReady ? "ready" : "waiting_for_runtime";
  plannedSteps[0] = {
    ...plannedSteps[0],
    status: firstStepStatus,
  };

  const now = new Date();
  const stepIdByKey = new Map<string, string>();

  await params.dbClient.db.update(jobs).set({
    status: workspaceReady ? "running" : "waiting_for_runtime",
    startedAt: params.row.job.startedAt ?? now,
    updatedAt: now,
    errorText: null,
  }).where(eq(jobs.id, params.jobId));

  for (const [index, step] of plannedSteps.entries()) {
    const stepId = createMessageId();
    stepIdByKey.set(step.stepKey, stepId);
    await params.dbClient.db.insert(agentJobSteps).values({
      id: stepId,
      jobId: params.jobId,
      parentStepId: null,
      stepKey: step.stepKey,
      title: step.title,
      detail: step.detail,
      stepKind: step.kind,
      status: step.status,
      sequence: index + 1,
      dependsOnStepIds: step.dependsOnStepIds,
      toolKey: step.toolKey ?? null,
      inputJson: {
        goal: params.row.agent.goal,
        workspacePath: params.row.agent.workspacePath,
      },
      outputJson: null,
      summary: step.summary ?? null,
      errorText: null,
      startedAt: null,
      finishedAt: null,
    });
  }

  const currentStepId = stepIdByKey.get("inspect_workspace") ?? null;
  await params.dbClient.db.update(agentJobs).set({
    currentStepId,
    blockerSummary: workspaceReady ? null : `Workspace path is not reachable yet: ${params.row.agent.workspacePath}`,
    resultSummary: null,
  }).where(eq(agentJobs.jobId, params.jobId));

  await insertArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: currentStepId,
    kind: "plan",
    label: "Initial execution plan",
    contentText: buildPlanArtifact(request, plannedSteps),
    mimeType: "text/markdown",
    metadataJson: {
      generatedBy: "durable_planner",
      stepCount: plannedSteps.length,
    },
  });
  await insertCheckpointArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: currentStepId,
    label: "Planner checkpoint",
    contentText: workspaceReady
      ? "Initial plan created and workspace is reachable."
      : "Initial plan created, but the workspace is not reachable yet.",
    metadataJson: {
      workspaceReady,
      stepCount: plannedSteps.length,
    },
  });

  if (!workspaceReady) {
    await insertRequirement({
      dbClient: params.dbClient,
      jobId: params.jobId,
      stepId: currentStepId,
      kind: "runtime",
      label: "Workspace path must be available",
      detail: `The planner could not reach ${params.row.agent.workspacePath}.`,
      metadataJson: {
        workspacePath: params.row.agent.workspacePath,
      },
    });
  }

  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.planned",
    payloadJson: {
      currentStepId,
      stepCount: plannedSteps.length,
      workspaceReady,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: params.row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: workspaceReady
      ? "agent.job.chat.plan_ready"
      : "agent.job.chat.runtime_blocked",
    importance: workspaceReady ? "normal" : "important",
    text: workspaceReady
      ? `I mapped out the build job and I’m starting with a workspace inspection in ${params.row.agent.workspacePath}.`
      : `I mapped out the build job, but the workspace path is not reachable yet: ${params.row.agent.workspacePath}. Once that path is available, I can continue.`,
    metadataJson: {
      currentStepId,
      workspaceReady,
    },
  });
}

async function insertCheckpointArtifact(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string | null;
  label: string;
  contentText: string;
  metadataJson?: Record<string, unknown>;
}) {
  await insertArtifact({
    dbClient: params.dbClient,
    jobId: params.jobId,
    stepId: params.stepId,
    kind: "note",
    label: params.label,
    contentText: params.contentText,
    mimeType: "text/plain",
    metadataJson: {
      checkpoint: true,
      ...(params.metadataJson ?? {}),
    },
  });
}

async function satisfyRuntimeRequirement(params: {
  config: AppConfig;
  dbClient: DbClient;
  jobId: string;
  inspectStep: typeof agentJobSteps.$inferSelect;
  conversationId: string | null;
}) {
  await params.dbClient.db.update(agentJobRequirements).set({
    status: "satisfied",
    resolutionText: "Workspace path became reachable.",
    updatedAt: new Date(),
  }).where(and(eq(agentJobRequirements.jobId, params.jobId), eq(agentJobRequirements.stepId, params.inspectStep.id), eq(agentJobRequirements.status, "pending")));

  await updateStepState({
    dbClient: params.dbClient,
    stepId: params.inspectStep.id,
    status: "ready",
    errorText: null,
  });
  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "running",
    blockerSummary: null,
    currentStepId: params.inspectStep.id,
    errorText: null,
  });
  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.conversationId,
    jobId: params.jobId,
    eventName: "agent.job.runtime_available",
    payloadJson: {
      stepId: params.inspectStep.id,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: params.conversationId,
    jobId: params.jobId,
    eventName: "agent.job.chat.runtime_available",
    importance: "normal",
    text: "The workspace is reachable again, so I’m resuming the build job now.",
    metadataJson: {
      stepId: params.inspectStep.id,
    },
  });
}

async function executeInspectStep(params: {
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
    text: "I finished inspecting the workspace and I’m moving into implementation now.",
    metadataJson: {
      stepId: params.inspectStep.id,
      nextStepId: implementStep?.id ?? null,
    },
  });

  if (implementStep) {
    await params.queue.enqueue(params.jobId);
  }
}

async function storeCommandArtifacts(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string;
  commandLogs: Array<{
    command: string;
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}) {
  for (const [index, entry] of params.commandLogs.entries()) {
    const lines = [
      `$ ${entry.command}`,
      `cwd: ${entry.cwd}`,
      `exitCode: ${entry.exitCode}`,
      "",
      "stdout:",
      entry.stdout || "(empty)",
      "",
      "stderr:",
      entry.stderr || "(empty)",
    ];

    await insertArtifact({
      dbClient: params.dbClient,
      jobId: params.jobId,
      stepId: params.stepId,
      kind: "command_log",
      label: `Command log ${index + 1}`,
      contentText: lines.join("\n"),
      mimeType: "text/plain",
      metadataJson: {
        command: entry.command,
        cwd: entry.cwd,
        exitCode: entry.exitCode,
      },
    });
  }
}

async function clearPendingRequirementsForStep(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string;
}) {
  await params.dbClient.db.delete(agentJobRequirements).where(and(
    eq(agentJobRequirements.jobId, params.jobId),
    eq(agentJobRequirements.stepId, params.stepId),
    eq(agentJobRequirements.status, "pending"),
  ));
}

async function syncDetectedRequirements(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string;
  detected: Awaited<ReturnType<typeof detectExecutionRequirements>>;
}) {
  await params.dbClient.db.delete(agentJobRequirements).where(and(
    eq(agentJobRequirements.jobId, params.jobId),
    eq(agentJobRequirements.stepId, params.stepId),
    inArray(agentJobRequirements.requirementKind, ["runtime", "package_manager", "service", "network", "port"]),
    eq(agentJobRequirements.status, "pending"),
  ));

  for (const requirement of params.detected) {
    await insertRequirement({
      dbClient: params.dbClient,
      jobId: params.jobId,
      stepId: params.stepId,
      kind: requirement.kind,
      label: requirement.label,
      detail: requirement.detail,
      metadataJson: requirement.metadataJson,
    });
  }
}

async function storeVerificationEvidenceArtifacts(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string;
  stepSnapshots: Array<{
    toolResults: Array<{
      toolName: string;
      output: unknown;
    }>;
  }>;
}) {
  let evidenceIndex = 0;

  for (const step of params.stepSnapshots) {
    for (const result of step.toolResults) {
      if (
        result.toolName !== "probe_http" &&
        result.toolName !== "check_port" &&
        result.toolName !== "browser_visit"
      ) {
        continue;
      }

      evidenceIndex += 1;
      const outputRecord =
        result.output && typeof result.output === "object"
          ? (result.output as Record<string, unknown>)
          : null;
      const contentText =
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output, null, 2);

      await insertArtifact({
        dbClient: params.dbClient,
        jobId: params.jobId,
        stepId: params.stepId,
        kind: "verification",
        label: `Verification evidence ${evidenceIndex}`,
        contentText,
        mimeType: "application/json",
        metadataJson: {
          toolName: result.toolName,
        },
      });

      if (
        result.toolName === "browser_visit" &&
        outputRecord?.screenshot &&
        typeof outputRecord.screenshot === "object"
      ) {
        const screenshot = outputRecord.screenshot as Record<string, unknown>;
        const storageKey =
          typeof screenshot.storageKey === "string" ? screenshot.storageKey : null;
        const mimeType =
          typeof screenshot.mimeType === "string" ? screenshot.mimeType : "image/png";

        if (storageKey) {
          await insertArtifact({
            dbClient: params.dbClient,
            jobId: params.jobId,
            stepId: params.stepId,
            kind: "verification",
            label: "Browser screenshot",
            storageKey,
            contentText: null,
            mimeType,
            metadataJson: {
              toolName: result.toolName,
            },
          });
        }
      }
    }
  }
}

function collectVerificationBlockers(params: {
  commandLogs: Array<{
    command: string;
    exitCode: number;
  }>;
  stepSnapshots: Array<{
    toolResults: Array<{
      toolName: string;
      output: unknown;
    }>;
  }>;
}) {
  const notes = params.commandLogs
    .filter((entry) => entry.exitCode !== 0)
    .map((entry) => `${entry.command} exited with ${entry.exitCode}`);

  for (const step of params.stepSnapshots) {
    for (const result of step.toolResults) {
      if (!result.output || typeof result.output !== "object") {
        continue;
      }

      const output = result.output as Record<string, unknown>;

      if (result.toolName === "check_port" && output.open === false) {
        const host = typeof output.host === "string" ? output.host : "127.0.0.1";
        const port = typeof output.port === "number" ? output.port : "unknown";
        notes.push(`Port check failed for ${host}:${port}`);
      }

      if (result.toolName === "probe_http") {
        const status = typeof output.status === "number" ? output.status : null;
        const ok = output.ok === true;
        const url = typeof output.url === "string" ? output.url : "endpoint";
        if (status !== null && (!ok || status >= 400)) {
          notes.push(`HTTP probe failed for ${url} with status ${status}`);
        }
      }
    }
  }

  return [...new Set(notes)];
}

async function syncVerificationRequirements(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string;
  stepSnapshots: Array<{
    toolResults: Array<{
      toolName: string;
      output: unknown;
    }>;
  }>;
}) {
  await params.dbClient.db.delete(agentJobRequirements).where(and(
    eq(agentJobRequirements.jobId, params.jobId),
    eq(agentJobRequirements.stepId, params.stepId),
    inArray(agentJobRequirements.requirementKind, ["network", "port", "service"]),
    eq(agentJobRequirements.status, "pending"),
  ));

  for (const step of params.stepSnapshots) {
    for (const result of step.toolResults) {
      if (!result.output || typeof result.output !== "object") {
        continue;
      }

      const output = result.output as Record<string, unknown>;

      if (result.toolName === "check_port" && output.open === false) {
        const host = typeof output.host === "string" ? output.host : "127.0.0.1";
        const port = typeof output.port === "number" ? output.port : null;
        await insertRequirement({
          dbClient: params.dbClient,
          jobId: params.jobId,
          stepId: params.stepId,
          kind: "port",
          label: `Open ${host}:${port ?? "unknown"}`,
          detail: "The verification pass could not connect to the expected local port.",
          metadataJson: {
            host,
            port,
            error: output.error,
          },
        });
      }

      if (result.toolName === "probe_http") {
        const status = typeof output.status === "number" ? output.status : null;
        const ok = output.ok === true;
        if (status !== null && (!ok || status >= 400)) {
          await insertRequirement({
            dbClient: params.dbClient,
            jobId: params.jobId,
            stepId: params.stepId,
            kind: "network",
            label: `HTTP probe returned ${status}`,
            detail: "The verification pass reached the endpoint, but the response was not healthy yet.",
            metadataJson: {
              url: output.url,
              status,
            },
          });
        }
      }
    }
  }
}

async function recoverInterruptedStep(params: {
  dbClient: DbClient;
  jobId: string;
  row: JobRow;
  currentStep: typeof agentJobSteps.$inferSelect;
}) {
  if (params.currentStep.status !== "running") {
    return params.currentStep;
  }

  const recoveredStatus =
    params.currentStep.stepKey === "verify_result" ? "retrying" : "ready";

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

async function executeDraftingStep(params: {
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
    text: "I finished drafting the execution plan and I’m beginning the implementation pass.",
    metadataJson: {
      stepId: params.draftStep.id,
    },
  });

  if (implementStep) {
    await params.queue.enqueue(params.jobId);
  }
}

async function executeImplementationStep(params: {
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
      (requirement) => requirement.stepId === params.implementStep.id && requirement.requirementKind === "credential" && requirement.status === "pending",
    );

    if (!existingCredentialRequirement) {
      await insertRequirement({
        dbClient: params.dbClient,
        jobId: params.jobId,
        stepId: params.implementStep.id,
        kind: "credential",
        label: "Inference provider must be configured",
        detail: "Autonomous build jobs need an active AI SDK inference provider before execution can continue.",
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
    (requirement) => requirement.stepId === params.implementStep.id && requirement.status === "pending",
  );
  const resolvedApprovals = params.requirements.filter(
    (requirement) => requirement.stepId === params.implementStep.id && requirement.requirementKind === "approval" && requirement.status !== "pending",
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
      approvalId: typeof requirement.metadataJson?.approvalId === "string" ? requirement.metadataJson.approvalId : requirement.id,
      approved: requirement.status === "satisfied",
      reason: requirement.resolutionText ?? undefined,
    })),
  });
  const messages = storedMessages.length > 0 && approvalMessages.length > 0
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
    contentText: result.finalText || "The implementation agent completed without a final text summary.",
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
    contentText: result.finalText || "Implementation pass completed and handed off to verification.",
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
    text: "I finished the implementation pass and I’m starting verification.",
    metadataJson: {
      stepId: params.implementStep.id,
      nextStepId: verifyStep?.id ?? null,
    },
  });

  if (verifyStep) {
    await params.queue.enqueue(params.jobId);
  }
}

async function executeVerificationStep(params: {
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
    (requirement) => requirement.stepId === params.verifyStep.id && requirement.status === "pending",
  );
  const resolvedApprovals = params.requirements.filter(
    (requirement) => requirement.stepId === params.verifyStep.id && requirement.requirementKind === "approval" && requirement.status !== "pending",
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
      approvalId: typeof requirement.metadataJson?.approvalId === "string" ? requirement.metadataJson.approvalId : requirement.id,
      approved: requirement.status === "satisfied",
      reason: requirement.resolutionText ?? undefined,
    })),
  });
  const messages = storedMessages.length > 0 && approvalMessages.length > 0
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
        summary: result.finalText || "Verification found blockers and scheduled another implementation pass.",
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

async function executeFinalizeStep(params: {
  config: AppConfig;
  dbClient: DbClient;
  row: JobRow;
  jobId: string;
  finalizeStep: typeof agentJobSteps.$inferSelect;
  steps: Array<typeof agentJobSteps.$inferSelect>;
}) {
  const implementationSummary = getImplementationSummary(params.steps);
  const verificationSummary = params.steps.find((step) => step.stepKey === "verify_result")?.outputJson?.finalText;
  const verificationText = typeof verificationSummary === "string" ? verificationSummary : "Verification summary unavailable.";
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

export async function listAgentJobs(dbClient: DbClient): Promise<AgentJobListResponse> {
  const rows = await dbClient.db
    .select({
      job: jobs,
      agent: agentJobs,
    })
    .from(agentJobs)
    .innerJoin(jobs, eq(agentJobs.jobId, jobs.id))
    .orderBy(desc(jobs.createdAt));

  return {
    jobs: rows.map(toAgentJobRecord),
  };
}

export async function getAgentJobDetail(dbClient: DbClient, jobId: string): Promise<AgentJobDetailResponse | null> {
  const row = await getAgentJobRow(dbClient, jobId);

  if (!row) {
    return null;
  }

  const [steps, artifacts, requirements] = await Promise.all([
    listStepRows(dbClient, jobId),
    dbClient.db.query.agentJobArtifacts.findMany({
      where: eq(agentJobArtifacts.jobId, jobId),
      orderBy: [asc(agentJobArtifacts.createdAt)],
    }),
    listRequirementRows(dbClient, jobId),
  ]);

  return {
    job: toAgentJobRecord(row),
    steps: steps.map(toStepRecord),
    artifacts: artifacts.map(toArtifactRecord),
    requirements: requirements.map(toRequirementRecord),
  };
}

export async function createAgentJob(params: CreateAgentJobParams): Promise<AgentJobRecord> {
  const settings = await loadAgentJobSettings();
  const approvalMode = normalizeApprovalMode(params.request.approvalMode ?? settings.defaultApprovalMode);
  const normalizedWorkspacePath = normalizeWorkspacePath(
    params.request.workspacePath?.trim() || settings.defaultWorkspacePath || process.cwd(),
    settings.executionBackend,
  );
  const jobId = createMessageId();
  const scheduledFor = new Date();

  await ensureDefaultUser(params.dbClient, params.config);

  await params.dbClient.db.insert(jobs).values({
    id: jobId,
    jobType: "agent.build",
    status: "queued",
    payloadJson: {
      goal: params.request.goal,
      workspacePath: normalizedWorkspacePath,
      constraints: params.request.constraints ?? [],
      deliverables: params.request.deliverables ?? [],
      approvalMode,
    },
    resultJson: null,
    parentJobId: null,
    scheduledFor,
    startedAt: null,
    finishedAt: null,
    errorText: null,
  });

  await params.dbClient.db.insert(agentJobs).values({
    jobId,
    requestedByUserId: params.config.defaultUserId,
    conversationId: params.request.conversationId ?? null,
    title: params.request.title,
    goal: params.request.goal,
    workspacePath: normalizedWorkspacePath,
    approvalMode,
    blockerSummary: null,
    currentStepId: null,
    resultSummary: null,
  });

  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.request.conversationId ?? null,
    jobId,
    eventName: "agent.job.created",
    payloadJson: {
      title: params.request.title,
      approvalMode,
      workspacePath: normalizedWorkspacePath,
    },
  });

  try {
    await params.queue.enqueue(jobId);
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Unknown queue enqueue error";
    const failedAt = new Date();

    await params.dbClient.db.update(jobs).set({
      status: "failed",
      errorText,
      finishedAt: failedAt,
      updatedAt: failedAt,
    }).where(eq(jobs.id, jobId));

    await params.dbClient.db.update(agentJobs).set({
      blockerSummary: errorText,
    }).where(eq(agentJobs.jobId, jobId));

    await insertTrace({
      dbClient: params.dbClient,
      conversationId: params.request.conversationId ?? null,
      jobId,
      eventName: "agent.job.enqueue_failed",
      payloadJson: {
        errorText,
      },
    });

    throw error instanceof Error ? error : new Error(errorText);
  }

  const row = await getAgentJobRow(params.dbClient, jobId);
  if (!row) {
    throw new Error("Agent job was created but could not be reloaded.");
  }

  return toAgentJobRecord(row);
}

export async function markAgentJobFailed(
  config: AppConfig,
  dbClient: DbClient,
  jobId: string,
  errorText: string,
) {
  const row = await getAgentJobRow(dbClient, jobId);
  const finishedAt = new Date();

  await dbClient.db.update(jobs).set({
    status: "failed",
    errorText,
    finishedAt,
    updatedAt: finishedAt,
  }).where(eq(jobs.id, jobId));

  await dbClient.db.update(agentJobs).set({
    blockerSummary: errorText,
  }).where(eq(agentJobs.jobId, jobId));

  await insertTrace({
    dbClient,
    conversationId: row?.agent.conversationId ?? null,
    jobId,
    eventName: "agent.job.failed",
    payloadJson: {
      errorText,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient,
    config,
    conversationId: row?.agent.conversationId ?? null,
    jobId,
    eventName: "agent.job.chat.failed",
    importance: "important",
    text: `The build job failed: ${errorText}. ${buildAgentJobLocationHint(jobId)}`,
    metadataJson: {
      errorText,
    },
  });
}

export async function resumeAgentJob(params: {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  jobId: string;
}): Promise<AgentJobActionResponse | null> {
  const row = await getAgentJobRow(params.dbClient, params.jobId);

  if (!row) {
    return null;
  }

  if (row.job.status === "completed" || row.job.status === "cancelled") {
    return {
      job: toAgentJobRecord(row),
    };
  }

  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "queued",
    blockerSummary: row.agent.blockerSummary,
    currentStepId: row.agent.currentStepId ?? null,
    errorText: null,
  });
  await params.queue.enqueue(params.jobId);

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.resumed",
    importance: "normal",
    text: "I resumed the build job and I’m continuing from the current step.",
  });

  const nextRow = await getAgentJobRow(params.dbClient, params.jobId);
  return nextRow ? { job: toAgentJobRecord(nextRow) } : null;
}

export async function cancelAgentJob(params: {
  config: AppConfig;
  dbClient: DbClient;
  jobId: string;
}): Promise<AgentJobActionResponse | null> {
  const row = await getAgentJobRow(params.dbClient, params.jobId);

  if (!row) {
    return null;
  }

  const finishedAt = new Date();
  await params.dbClient.db.update(agentJobSteps).set({
    status: "cancelled",
    finishedAt,
    updatedAt: finishedAt,
  }).where(and(eq(agentJobSteps.jobId, params.jobId), inArray(agentJobSteps.status, ["pending", "ready", "running", "retrying", "waiting_for_approval", "waiting_for_runtime", "blocked"])));

  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "cancelled",
    blockerSummary: "Cancelled by operator.",
    currentStepId: null,
    resultSummary: row.agent.resultSummary,
    errorText: null,
    finishedAt,
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.cancelled",
    importance: "important",
    text: "The build job was cancelled by the operator.",
  });

  const nextRow = await getAgentJobRow(params.dbClient, params.jobId);
  return nextRow ? { job: toAgentJobRecord(nextRow) } : null;
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
    where: and(eq(agentJobRequirements.id, params.requirementId), eq(agentJobRequirements.jobId, params.jobId)),
  });

  if (!requirement) {
    return null;
  }

  await params.dbClient.db.update(agentJobRequirements).set({
    status: params.decision.approved ? "satisfied" : "rejected",
    resolutionText: params.decision.reason?.trim() || (params.decision.approved ? "Approved by operator." : "Denied by operator."),
    updatedAt: new Date(),
  }).where(eq(agentJobRequirements.id, params.requirementId));

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

  if (row.job.status === "completed" || row.job.status === "cancelled" || row.job.status === "failed") {
    return;
  }

  if (
    row.job.startedAt &&
    Date.now() - row.job.startedAt.getTime() >
      settings.maxJobRuntimeMinutes * 60 * 1000
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
      if (refreshedCurrentStep.status === "ready" || refreshedCurrentStep.status === "retrying" || refreshedCurrentStep.status === "running") {
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
      if (refreshedCurrentStep.status === "ready" || refreshedCurrentStep.status === "retrying" || refreshedCurrentStep.status === "running") {
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
      if (["ready", "retrying", "running", "waiting_for_approval"].includes(refreshedCurrentStep.status)) {
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
      if (["ready", "retrying", "running", "waiting_for_approval"].includes(refreshedCurrentStep.status)) {
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

export {
  getAgentJobSettings,
  updateAgentJobSettings,
};
