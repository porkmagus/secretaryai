import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "@secretary/config";
import type { AgentJobStepStatus, CreateAgentJobRequest } from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import { agentJobSteps, agentJobs, type DbClient, jobs, users } from "@secretary/db";
import { eq } from "drizzle-orm";
import { postAgentJobConversationUpdate } from "../agent-job-conversation-updates.js";
import type { JobRow } from "../agent-job-transformers.js";
import { logError, pathExists } from "../utils.js";
import {
  insertArtifact,
  insertCheckpointArtifact,
  insertRequirement,
  insertTrace,
} from "./artifacts.js";
import { getRequestFromRow } from "./context.js";
import type { StepPlan } from "./types.js";

export async function ensureDefaultUser(dbClient: DbClient, config: AppConfig) {
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

export function buildInitialPlan(request: CreateAgentJobRequest): StepPlan[] {
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
      detail:
        "Explore the codebase using search tools to build a comprehensive plan before editing files.",
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
      detail:
        "Run the strongest available checks, capture logs, and decide whether the workspace is genuinely ready to hand off.",
      kind: "verify",
      status: "pending",
      dependsOnStepIds: ["implement_scope"],
      toolKey: "agent_verifier",
      summary: "Produce proof that the build works or record the exact blocker.",
    },
    {
      stepKey: "finalize_handoff",
      title: "Finalize the handoff summary",
      detail:
        "Summarize what changed, what remains, and which artifacts or commands matter to the operator.",
      kind: "finalize",
      status: "pending",
      dependsOnStepIds: ["verify_result"],
      summary: "Return a crisp operator-ready result summary.",
    },
  ];
}

export async function inspectWorkspace(workspacePath: string) {
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
        scripts: parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {},
      };
      const workspaceCount = Array.isArray(parsed.workspaces) ? parsed.workspaces.length : 0;
      packageSummary = [
        typeof parsed.name === "string" ? `Package: ${parsed.name}` : null,
        workspaceCount > 0 ? `Workspaces: ${workspaceCount}` : null,
        parsed.private === true ? "Private workspace: yes" : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n");
    } catch (error) {
      logError({
        service: "worker",
        event: "agent.job.package_json_parse_failed",
        error,
        metadataJson: { workspacePath },
      });
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

export async function readDirectorySafe(workspacePath: string) {
  const dirents = await (await import("node:fs/promises")).readdir(workspacePath, {
    withFileTypes: true,
  });
  return dirents.map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
  }));
}

export function buildPlanArtifact(request: CreateAgentJobRequest, steps: StepPlan[]) {
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

export async function prepareInitialPlan(params: {
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

  await params.dbClient.db
    .update(jobs)
    .set({
      status: workspaceReady ? "running" : "waiting_for_runtime",
      startedAt: params.row.job.startedAt ?? now,
      updatedAt: now,
      errorText: null,
    })
    .where(eq(jobs.id, params.jobId));

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
  await params.dbClient.db
    .update(agentJobs)
    .set({
      currentStepId,
      blockerSummary: workspaceReady
        ? null
        : `Workspace path is not reachable yet: ${params.row.agent.workspacePath}`,
      resultSummary: null,
    })
    .where(eq(agentJobs.jobId, params.jobId));

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
    eventName: workspaceReady ? "agent.job.chat.plan_ready" : "agent.job.chat.runtime_blocked",
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
