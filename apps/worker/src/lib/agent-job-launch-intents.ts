import type { AppConfig } from "@secretary/config";
import {
  type AgentExecutionBackend,
  createMessageId,
  type RuntimeChatRequest,
} from "@secretary/core-runtime";
import { activityTraces, agentJobLaunchIntents, type DbClient } from "@secretary/db";
import { and, desc, eq } from "drizzle-orm";
import { normalizeWorkspacePath } from "./agent-job-executor/index.js";
import type { AgentJobQueueAdapter } from "./agent-job-queue.js";
import { createAgentJob } from "./agent-job-runtime.js";
import { loadAgentJobSettings } from "./agent-job-settings.js";
import { finalizeChatTurn, prepareChatTurn } from "./chat-persistence.js";
import { detectConversationDecision, extractWorkspacePathHint } from "./conversation-decisions.js";
import { repoRoot, resolveConversationId } from "./utils.js";

type MaybeHandleAgentJobLaunchTurnParams = {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
};

const buildIntentPatterns = [
  /\b(?:build|create|make|scaffold|generate|spin up|set up|setup|code)\b[\s\S]{0,80}\b(?:app|application|site|website|dashboard|bot|service|api|plugin|tool|project|repo)\b/i,
  /\b(?:implement|add|ship|wire up)\b[\s\S]{0,80}\b(?:feature|flow|screen|page|endpoint|integration|component)\b/i,
  /\b(?:debug|fix|repair|unstick)\b[\s\S]{0,80}\b(?:app|build|test|repo|project|server|deploy|pipeline|bug)\b/i,
  /\b(?:refactor|rewrite|upgrade|modernize)\b[\s\S]{0,80}\b(?:app|project|repo|codebase|feature|service)\b/i,
];

function looksLikeAgentJobRequest(text: string) {
  const trimmed = text.trim();

  if (trimmed.length < 12) {
    return false;
  }

  return buildIntentPatterns.some((pattern) => pattern.test(trimmed));
}

function deriveJobTitle(goal: string) {
  const trimmed = goal.replace(/\s+/g, " ").trim();

  if (!trimmed) {
    return "New build job";
  }

  const sentence = trimmed.split(/[.!?]/, 1)[0] ?? trimmed;
  const normalized = sentence.length > 72 ? `${sentence.slice(0, 69).trimEnd()}...` : sentence;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildConfirmationText(params: {
  title: string;
  workspacePath: string;
  channel: RuntimeChatRequest["channel"];
}) {
  const workspaceNote = params.workspacePath ? ` in ${params.workspacePath}` : "";
  return `I can help with "${params.title}"${workspaceNote}. Want me to go ahead with that?`;
}

function buildPendingClarificationText() {
  return "Still waiting on your go-ahead for that. Want me to start, or should we keep talking?";
}

function buildCancellationText() {
  return "Got it — I'll hold off. What would you like to talk about instead?";
}

function buildStartedText(params: {
  title: string;
  workspacePath: string;
  channel: RuntimeChatRequest["channel"];
}) {
  const location = params.workspacePath ? ` Working in ${params.workspacePath}.` : "";
  const followUp = params.channel === "telegram" ? " I'll update you here as it progresses." : "";

  return `On it — started "${params.title}".${location}${followUp}`;
}

async function recordLaunchIntentTrace(params: {
  dbClient: DbClient;
  conversationId: string;
  traceId: string;
  eventName: string;
  payload: Record<string, unknown>;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "runtime",
    parentTraceId: params.traceId,
    conversationId: params.conversationId,
    jobId: null,
    eventName: params.eventName,
    payloadJson: params.payload,
  });
}

// Note: resolveConversationId is now imported from utils/conversation.ts

async function getPendingLaunchIntent(dbClient: DbClient, conversationId: string) {
  return dbClient.db.query.agentJobLaunchIntents.findFirst({
    where: and(
      eq(agentJobLaunchIntents.conversationId, conversationId),
      eq(agentJobLaunchIntents.status, "pending"),
    ),
    orderBy: [desc(agentJobLaunchIntents.createdAt)],
  });
}

async function cancelPendingLaunchIntents(
  dbClient: DbClient,
  conversationId: string,
  resolutionText: string,
) {
  await dbClient.db
    .update(agentJobLaunchIntents)
    .set({
      status: "cancelled",
      resolutionText,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentJobLaunchIntents.conversationId, conversationId),
        eq(agentJobLaunchIntents.status, "pending"),
      ),
    );
}

async function createPendingLaunchIntent(params: {
  dbClient: DbClient;
  conversationId: string;
  requestedByUserId: string;
  sourceMessageId: string;
  title: string;
  goal: string;
  workspacePath: string;
  approvalMode: string;
  payloadJson: Record<string, unknown>;
}) {
  await cancelPendingLaunchIntents(
    params.dbClient,
    params.conversationId,
    "Replaced by a newer pending launch request.",
  );

  const id = createMessageId();
  await params.dbClient.db.insert(agentJobLaunchIntents).values({
    id,
    conversationId: params.conversationId,
    requestedByUserId: params.requestedByUserId,
    sourceMessageId: params.sourceMessageId,
    status: "pending",
    title: params.title,
    goal: params.goal,
    workspacePath: params.workspacePath,
    approvalMode: params.approvalMode,
    payloadJson: params.payloadJson,
    resolutionText: null,
  });

  return id;
}

function getFallbackWorkspacePath(
  defaultWorkspacePath: string | null,
  executionBackend: AgentExecutionBackend,
) {
  return normalizeWorkspacePath(defaultWorkspacePath?.trim() || repoRoot, executionBackend);
}

async function updatePendingLaunchIntentWorkspace(params: {
  dbClient: DbClient;
  intentId: string;
  workspacePath: string;
}) {
  await params.dbClient.db
    .update(agentJobLaunchIntents)
    .set({
      workspacePath: params.workspacePath,
      updatedAt: new Date(),
    })
    .where(eq(agentJobLaunchIntents.id, params.intentId));
}

export async function maybeHandleAgentJobLaunchTurn(params: MaybeHandleAgentJobLaunchTurnParams) {
  const text = params.request.message.text.trim();
  const existingConversationId = await resolveConversationId(params.dbClient, params.request);
  const pendingIntent = existingConversationId
    ? await getPendingLaunchIntent(params.dbClient, existingConversationId)
    : null;
  const decision = detectConversationDecision(text);

  if (!pendingIntent && !looksLikeAgentJobRequest(text)) {
    return null;
  }

  const preparedTurn = await prepareChatTurn({
    config: params.config,
    dbClient: params.dbClient,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: params.request,
    traceId: params.traceId,
  });

  if (pendingIntent) {
    const workspaceHint =
      extractWorkspacePathHint(text) ??
      (typeof pendingIntent.payloadJson?.workspacePath === "string"
        ? pendingIntent.payloadJson.workspacePath
        : null);
    const resolvedWorkspacePath = workspaceHint
      ? normalizeWorkspacePath(
          workspaceHint,
          pendingIntent.payloadJson?.executionBackend === "host_native" ||
            pendingIntent.payloadJson?.executionBackend === "docker_sandbox" ||
            pendingIntent.payloadJson?.executionBackend === "wsl_bash"
            ? pendingIntent.payloadJson.executionBackend
            : "host_native",
        )
      : pendingIntent.workspacePath;

    if (resolvedWorkspacePath !== pendingIntent.workspacePath) {
      await updatePendingLaunchIntentWorkspace({
        dbClient: params.dbClient,
        intentId: pendingIntent.id,
        workspacePath: resolvedWorkspacePath,
      });
    }

    if (decision === "deny") {
      await params.dbClient.db
        .update(agentJobLaunchIntents)
        .set({
          status: "cancelled",
          resolutionText: "User declined to start the agent job.",
          updatedAt: new Date(),
        })
        .where(eq(agentJobLaunchIntents.id, pendingIntent.id));

      await recordLaunchIntentTrace({
        dbClient: params.dbClient,
        conversationId: preparedTurn.conversationId,
        traceId: params.traceId,
        eventName: "agent_job.launch_intent.cancelled",
        payload: { intentId: pendingIntent.id },
      });

      return finalizeChatTurn({
        dbClient: params.dbClient,
        preparedTurn,
        assistantMessageId: createMessageId(),
        outputText: buildCancellationText(),
        mode: "tool",
        providerError: null,
      });
    }

    if (decision === "approve") {
      const job = await createAgentJob({
        config: params.config,
        dbClient: params.dbClient,
        queue: params.queue,
        request: {
          title: pendingIntent.title,
          goal: pendingIntent.goal,
          workspacePath: resolvedWorkspacePath,
          conversationId: preparedTurn.conversationId,
          approvalMode:
            pendingIntent.approvalMode === "restrictive" ||
            pendingIntent.approvalMode === "full_access"
              ? pendingIntent.approvalMode
              : "builder",
          constraints: [],
          deliverables: [],
        },
      });

      await params.dbClient.db
        .update(agentJobLaunchIntents)
        .set({
          status: "launched",
          resolutionText: `Launched agent job ${job.id}.`,
          updatedAt: new Date(),
        })
        .where(eq(agentJobLaunchIntents.id, pendingIntent.id));

      await recordLaunchIntentTrace({
        dbClient: params.dbClient,
        conversationId: preparedTurn.conversationId,
        traceId: params.traceId,
        eventName: "agent_job.launch_intent.launched",
        payload: {
          intentId: pendingIntent.id,
          jobId: job.id,
          workspacePath: job.workspacePath,
        },
      });

      return finalizeChatTurn({
        dbClient: params.dbClient,
        preparedTurn,
        assistantMessageId: createMessageId(),
        outputText: buildStartedText({
          title: job.title,
          workspacePath: job.workspacePath,
          channel: preparedTurn.request.channel,
        }),
        mode: "tool",
        providerError: null,
      });
    }

    if (looksLikeAgentJobRequest(text)) {
      const settings = await loadAgentJobSettings();
      const title = deriveJobTitle(text);
      const workspacePath = normalizeWorkspacePath(
        extractWorkspacePathHint(text) ??
          getFallbackWorkspacePath(settings.defaultWorkspacePath, settings.executionBackend),
        settings.executionBackend,
      );
      await createPendingLaunchIntent({
        dbClient: params.dbClient,
        conversationId: preparedTurn.conversationId,
        requestedByUserId: preparedTurn.userId,
        sourceMessageId: preparedTurn.userMessageId,
        title,
        goal: text,
        workspacePath,
        approvalMode: settings.defaultApprovalMode,
        payloadJson: {
          sourceChannel: preparedTurn.request.channel,
          originalRequestText: text,
          sourceMessageId: preparedTurn.userMessageId,
          executionBackend: settings.executionBackend,
          workspacePath,
        },
      });

      await recordLaunchIntentTrace({
        dbClient: params.dbClient,
        conversationId: preparedTurn.conversationId,
        traceId: params.traceId,
        eventName: "agent_job.launch_intent.updated",
        payload: {
          title,
          workspacePath,
        },
      });

      return finalizeChatTurn({
        dbClient: params.dbClient,
        preparedTurn,
        assistantMessageId: createMessageId(),
        outputText: buildConfirmationText({
          title,
          workspacePath,
          channel: preparedTurn.request.channel,
        }),
        mode: "tool",
        providerError: null,
      });
    }

    if (workspaceHint) {
      await recordLaunchIntentTrace({
        dbClient: params.dbClient,
        conversationId: preparedTurn.conversationId,
        traceId: params.traceId,
        eventName: "agent_job.launch_intent.workspace_updated",
        payload: {
          intentId: pendingIntent.id,
          workspacePath: resolvedWorkspacePath,
        },
      });

      return finalizeChatTurn({
        dbClient: params.dbClient,
        preparedTurn,
        assistantMessageId: createMessageId(),
        outputText: buildConfirmationText({
          title: pendingIntent.title,
          workspacePath: resolvedWorkspacePath,
          channel: preparedTurn.request.channel,
        }),
        mode: "tool",
        providerError: null,
      });
    }

    await recordLaunchIntentTrace({
      dbClient: params.dbClient,
      conversationId: preparedTurn.conversationId,
      traceId: params.traceId,
      eventName: "agent_job.launch_intent.awaiting_confirmation",
      payload: {
        intentId: pendingIntent.id,
      },
    });

    return finalizeChatTurn({
      dbClient: params.dbClient,
      preparedTurn,
      assistantMessageId: createMessageId(),
      outputText: buildPendingClarificationText(),
      mode: "tool",
      providerError: null,
    });
  }

  const settings = await loadAgentJobSettings();
  const title = deriveJobTitle(text);
  const workspacePath = normalizeWorkspacePath(
    extractWorkspacePathHint(text) ??
      getFallbackWorkspacePath(settings.defaultWorkspacePath, settings.executionBackend),
    settings.executionBackend,
  );
  const intentId = await createPendingLaunchIntent({
    dbClient: params.dbClient,
    conversationId: preparedTurn.conversationId,
    requestedByUserId: preparedTurn.userId,
    sourceMessageId: preparedTurn.userMessageId,
    title,
    goal: text,
    workspacePath,
    approvalMode: settings.defaultApprovalMode,
    payloadJson: {
      sourceChannel: preparedTurn.request.channel,
      originalRequestText: text,
      sourceMessageId: preparedTurn.userMessageId,
      executionBackend: settings.executionBackend,
      workspacePath,
    },
  });

  await recordLaunchIntentTrace({
    dbClient: params.dbClient,
    conversationId: preparedTurn.conversationId,
    traceId: params.traceId,
    eventName: "agent_job.launch_intent.created",
    payload: {
      intentId,
      title,
      workspacePath,
    },
  });

  return finalizeChatTurn({
    dbClient: params.dbClient,
    preparedTurn,
    assistantMessageId: createMessageId(),
    outputText: buildConfirmationText({
      title,
      workspacePath,
      channel: preparedTurn.request.channel,
    }),
    mode: "tool",
    providerError: null,
  });
}
