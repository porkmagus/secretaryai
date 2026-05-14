import type { AppConfig } from "@secretary/config";
import type { AgentJobRequirementKind } from "@secretary/core-runtime";
import { agentJobRequirements, type agentJobSteps, type DbClient } from "@secretary/db";
import { and, eq, inArray } from "drizzle-orm";
import { postAgentJobConversationUpdate } from "../agent-job-conversation-updates.js";
import type { detectExecutionRequirements } from "../agent-job-executor/index.js";

import { insertRequirements, insertTrace } from "./artifacts.js";
import { updateJobState, updateStepState } from "./state.js";

export async function satisfyRuntimeRequirement(params: {
  config: AppConfig;
  dbClient: DbClient;
  jobId: string;
  inspectStep: typeof agentJobSteps.$inferSelect;
  conversationId: string | null;
}) {
  await params.dbClient.db
    .update(agentJobRequirements)
    .set({
      status: "satisfied",
      resolutionText: "Workspace path became reachable.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentJobRequirements.jobId, params.jobId),
        eq(agentJobRequirements.stepId, params.inspectStep.id),
        eq(agentJobRequirements.status, "pending"),
      ),
    );

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
    text: "Workspace is back — resuming now.",
    metadataJson: {
      stepId: params.inspectStep.id,
    },
  });
}

export async function clearPendingRequirementsForStep(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string;
}) {
  await params.dbClient.db
    .delete(agentJobRequirements)
    .where(
      and(
        eq(agentJobRequirements.jobId, params.jobId),
        eq(agentJobRequirements.stepId, params.stepId),
        eq(agentJobRequirements.status, "pending"),
      ),
    );
}

export async function syncDetectedRequirements(params: {
  dbClient: DbClient;
  jobId: string;
  stepId: string;
  detected: Awaited<ReturnType<typeof detectExecutionRequirements>>;
}) {
  await params.dbClient.db
    .delete(agentJobRequirements)
    .where(
      and(
        eq(agentJobRequirements.jobId, params.jobId),
        eq(agentJobRequirements.stepId, params.stepId),
        inArray(agentJobRequirements.requirementKind, [
          "runtime",
          "package_manager",
          "service",
          "network",
          "port",
        ]),
        eq(agentJobRequirements.status, "pending"),
      ),
    );

  await insertRequirements({
    dbClient: params.dbClient,
    requirements: params.detected.map((requirement) => ({
      jobId: params.jobId,
      stepId: params.stepId,
      kind: requirement.kind,
      label: requirement.label,
      detail: requirement.detail,
      metadataJson: requirement.metadataJson,
    })),
  });
}

export function collectVerificationBlockers(params: {
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

  const _requirements: Array<{
    jobId: string;
    stepId: string | null;
    kind: AgentJobRequirementKind;
    label: string;
    detail: string | null;
    metadataJson?: Record<string, unknown>;
  }> = [];

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

export async function syncVerificationRequirements(params: {
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
  await params.dbClient.db
    .delete(agentJobRequirements)
    .where(
      and(
        eq(agentJobRequirements.jobId, params.jobId),
        eq(agentJobRequirements.stepId, params.stepId),
        inArray(agentJobRequirements.requirementKind, ["network", "port", "service"]),
        eq(agentJobRequirements.status, "pending"),
      ),
    );

  const requirements: Array<{
    jobId: string;
    stepId: string;
    kind: "port" | "network" | "service";
    label: string;
    detail: string;
    metadataJson: Record<string, unknown>;
  }> = [];

  for (const step of params.stepSnapshots) {
    for (const result of step.toolResults) {
      if (!result.output || typeof result.output !== "object") {
        continue;
      }

      const output = result.output as Record<string, unknown>;

      if (result.toolName === "check_port" && output.open === false) {
        const host = typeof output.host === "string" ? output.host : "127.0.0.1";
        const port = typeof output.port === "number" ? output.port : null;
        requirements.push({
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
          requirements.push({
            jobId: params.jobId,
            stepId: params.stepId,
            kind: "network",
            label: `HTTP probe returned ${status}`,
            detail:
              "The verification pass reached the endpoint, but the response was not healthy yet.",
            metadataJson: {
              url: output.url,
              status,
            },
          });
        }
      }
    }
  }

  await insertRequirements({
    dbClient: params.dbClient,
    requirements,
  });
}
