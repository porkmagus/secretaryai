import type {
  AgentJobArtifactKind,
  AgentJobRequirementKind,
  AgentJobRequirementStatus,
} from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import {
  activityTraces,
  agentJobArtifacts,
  agentJobRequirements,
  type DbClient,
} from "@secretary/db";

export async function insertTrace(params: {
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

export async function insertArtifact(params: {
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

export async function insertRequirement(params: {
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
  await insertRequirements({
    dbClient: params.dbClient,
    requirements: [
      {
        jobId: params.jobId,
        stepId: params.stepId,
        kind: params.kind,
        label: params.label,
        detail: params.detail,
        status: params.status,
        metadataJson: params.metadataJson,
        resolutionText: params.resolutionText,
      },
    ],
  });
}

export async function insertRequirements(params: {
  dbClient: DbClient;
  requirements: Array<{
    jobId: string;
    stepId: string | null;
    kind: AgentJobRequirementKind;
    label: string;
    detail: string | null;
    status?: AgentJobRequirementStatus;
    metadataJson?: Record<string, unknown>;
    resolutionText?: string | null;
  }>;
}) {
  if (params.requirements.length === 0) {
    return;
  }

  await params.dbClient.db.insert(agentJobRequirements).values(
    params.requirements.map((req) => ({
      id: createMessageId(),
      jobId: req.jobId,
      stepId: req.stepId,
      requirementKind: req.kind,
      label: req.label,
      detail: req.detail,
      status: req.status ?? "pending",
      resolutionText: req.resolutionText ?? null,
      metadataJson: req.metadataJson ?? {},
    })),
  );
}

export async function insertCheckpointArtifact(params: {
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

export async function storeCommandArtifacts(params: {
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

export async function storeVerificationEvidenceArtifacts(params: {
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
        typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);

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
        const storageKey = typeof screenshot.storageKey === "string" ? screenshot.storageKey : null;
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
