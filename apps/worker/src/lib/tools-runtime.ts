import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  activityTraces,
  conversations,
  messages,
  personas,
  tasks,
  toolExecutions,
  tools,
  users,
  type DbClient,
} from "@secretary/db";
import {
  createConversationId,
  createMessageId,
  type MemoryCandidateJobPayload,
  type RuntimeChatRequest,
  type RuntimeChatResponse,
  type ToolApprovalDecisionResponse,
  type ToolApprovalMode,
  type ToolExecutionListResponse,
  type ToolExecutionRecord,
  type ToolListResponse,
  type ToolRecord,
  type UpdateToolRequest,
} from "@secretary/core-runtime";
import { getActiveTaskContext, retrieveRelevantMemories } from "./memory-engine.js";
import { findConversationIdByChannelRef, getConversationMessages } from "./chat-persistence.js";

const FILE_PREVIEW_LIMIT = 1500;
const MAX_FILE_READ_BYTES = 256 * 1024;
const SHELL_TIMEOUT_MS = 20_000;

type BuiltInTool = {
  key: string;
  name: string;
  description: string;
  approvalMode: ToolApprovalMode;
};

type ToolIntent =
  | {
      requestJson: Record<string, unknown>;
      summary: string;
      toolKey: "task_create";
    }
  | {
      requestJson: Record<string, unknown>;
      summary: string;
      toolKey: "web_search";
    }
  | {
      requestJson: Record<string, unknown>;
      summary: string;
      toolKey: "file_read";
    }
  | {
      requestJson: Record<string, unknown>;
      summary: string;
      toolKey: "shell_command";
    };

const builtInTools: BuiltInTool[] = [
  {
    key: "web_search",
    name: "Web Search",
    description: "Look up current public information through a constrained search wrapper.",
    approvalMode: "always_allow",
  },
  {
    key: "file_read",
    name: "Read File",
    description: "Read a local text file from the workspace or runtime area.",
    approvalMode: "ask_first",
  },
  {
    key: "shell_command",
    name: "Shell Command",
    description: "Run a tightly constrained read-only shell command.",
    approvalMode: "ask_first",
  },
  {
    key: "task_create",
    name: "Create Task",
    description: "Create a task or reminder from an explicit user request.",
    approvalMode: "ask_first",
  },
];

function toToolRecord(record: typeof tools.$inferSelect): ToolRecord {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    description: record.description,
    enabled: record.enabled,
    approvalMode: record.approvalMode as ToolApprovalMode,
    healthStatus: record.healthStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toToolExecutionRecord(
  record: typeof toolExecutions.$inferSelect,
  tool: typeof tools.$inferSelect | undefined,
): ToolExecutionRecord {
  return {
    id: record.id,
    toolId: record.toolId,
    toolKey: tool?.key ?? "unknown",
    toolName: tool?.name ?? "Unknown tool",
    conversationId: record.conversationId,
    requestedBy: record.requestedBy,
    executionStatus: record.executionStatus as ToolExecutionRecord["executionStatus"],
    approvalState: record.approvalState as ToolExecutionRecord["approvalState"],
    requestJson: record.requestJson,
    responseJson: record.responseJson ?? null,
    summary: record.summary,
    errorText: record.errorText ?? null,
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function parseInlinePath(text: string) {
  const backtickMatch = text.match(/`([^`]+)`/);
  if (backtickMatch?.[1]) {
    return backtickMatch[1].trim();
  }

  const quotedMatch = text.match(/"([^"]+\.[a-z0-9]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainMatch = text.match(/\b([./\\A-Za-z0-9_-]+\.[A-Za-z0-9]+)\b/);
  return plainMatch?.[1]?.trim() ?? null;
}

function isWindowsPlatform() {
  return process.platform === "win32";
}

function isPathInsideWorkspace(root: string, candidate: string) {
  const normalizedRoot = isWindowsPlatform() ? root.toLowerCase() : root;
  const normalizedCandidate = isWindowsPlatform() ? candidate.toLowerCase() : candidate;

  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${isWindowsPlatform() ? "\\" : "/"}`)
  );
}

function hasBinaryLikeContent(buffer: Buffer) {
  if (buffer.includes(0)) {
    return true;
  }

  const sample = buffer.subarray(0, 2048);
  let suspiciousBytes = 0;

  for (const value of sample) {
    const isTabOrNewLine = value === 9 || value === 10 || value === 13;
    const isPrintableAscii = value >= 32 && value <= 126;

    if (!isTabOrNewLine && !isPrintableAscii) {
      suspiciousBytes += 1;
    }
  }

  return sample.length > 0 && suspiciousBytes / sample.length > 0.3;
}

function parseReminderIntent(text: string) {
  const match = text.match(/\b(?:remind me to|create task to|add (?:a )?(?:task|reminder) to)\s+(.+)/i);
  if (!match?.[1]) {
    return null;
  }

  const rawTitle = match[1].trim().replace(/[.?!]+$/, "");
  const reminderAt = /\btomorrow\b/i.test(rawTitle)
    ? new Date(Date.now() + 24 * 60 * 60 * 1000)
    : /\btoday\b/i.test(rawTitle)
      ? new Date(Date.now() + 60 * 60 * 1000)
      : null;

  return {
    requestJson: {
      reminderAt: reminderAt?.toISOString() ?? null,
      title: rawTitle,
    },
    summary: `Create task: ${rawTitle}`,
    toolKey: "task_create" as const,
  };
}

function parseSearchIntent(text: string) {
  const match = text.match(/\b(?:search (?:the )?web for|look up|find latest on|latest on|google)\s+(.+)/i);
  if (!match?.[1]) {
    return null;
  }

  const query = match[1].trim().replace(/[.?!]+$/, "");
  return {
    requestJson: { query },
    summary: `Search the web for "${query}"`,
    toolKey: "web_search" as const,
  };
}

function parseFileIntent(text: string) {
  if (!/\b(?:read|open|show|inspect)\b/i.test(text)) {
    return null;
  }

  const path = parseInlinePath(text);
  if (!path) {
    return null;
  }

  return {
    requestJson: { path },
    summary: `Read local file ${path}`,
    toolKey: "file_read" as const,
  };
}

function parseShellIntent(text: string) {
  const match =
    text.match(/\b(?:run|execute)\s+(?:the )?(?:shell )?command\s+`([^`]+)`/i) ??
    text.match(/^run\s+([a-z0-9].+)$/i);
  if (!match?.[1]) {
    return null;
  }

  const command = match[1].trim();
  return {
    requestJson: { command },
    summary: `Run shell command: ${command}`,
    toolKey: "shell_command" as const,
  };
}

function detectToolIntent(text: string): ToolIntent | null {
  return (
    parseReminderIntent(text) ??
    parseSearchIntent(text) ??
    parseFileIntent(text) ??
    parseShellIntent(text)
  );
}

async function insertActivityTrace(params: {
  conversationId: string | null;
  dbClient: DbClient;
  eventName: string;
  payload: Record<string, unknown>;
  parentTraceId: string;
  traceType?: string;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: params.traceType ?? "tool",
    parentTraceId: params.parentTraceId,
    conversationId: params.conversationId,
    jobId: null,
    eventName: params.eventName,
    payloadJson: params.payload,
  });
}

async function recordToolTrace(params: {
  conversationId: string | null;
  dbClient: DbClient;
  eventName: string;
  executionId: string;
  payload?: Record<string, unknown>;
  traceId: string;
}) {
  await insertActivityTrace({
    conversationId: params.conversationId,
    dbClient: params.dbClient,
    eventName: params.eventName,
    payload: {
      executionId: params.executionId,
      ...params.payload,
    },
    parentTraceId: params.traceId,
    traceType: "tool",
  });
}

async function ensureConversationEnvelope(params: {
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
}) {
  const existingConversationId =
    params.request.conversationId ??
    (params.request.channel === "telegram" && params.request.metadata?.telegramChatId
      ? await findConversationIdByChannelRef(
          params.dbClient,
          params.request.channel,
          params.request.metadata.telegramChatId,
        )
      : null);
  const conversationId = existingConversationId ?? createConversationId();
  const userId = params.request.userId || params.defaultUserId;
  const userDisplayName =
    params.request.metadata?.telegramUserDisplayName ?? "Local Owner";
  const userMessageId = createMessageId();
  const conversationTitle =
    params.request.channel === "telegram" && params.request.metadata?.telegramChatLabel
      ? `Telegram: ${params.request.metadata.telegramChatLabel}`
      : params.request.message.text.slice(0, 80);

  await params.dbClient.db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: userId,
        displayName: "Local Owner",
        defaultPersonaId: params.defaultPersonaId,
      })
      .onConflictDoNothing();

    await tx
      .insert(personas)
      .values({
        id: params.defaultPersonaId,
        name: "Secretary",
        toneProfile: {
          mode: "calm",
        },
        behaviorRules: [
          "Be helpful",
          "Protect local-first privacy defaults",
        ],
        promptTemplate: "Phase 1 placeholder",
        isDefault: true,
      })
      .onConflictDoNothing();

    await tx
      .insert(conversations)
      .values({
        id: conversationId,
        userId,
        channelType: params.request.channel,
        channelRef: params.request.metadata?.telegramChatId ?? null,
        channelLabel: params.request.metadata?.telegramChatLabel ?? null,
        title: conversationTitle,
        status: "active",
        lastMessageAt: new Date(),
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          channelType: params.request.channel,
          channelRef: params.request.metadata?.telegramChatId ?? null,
          channelLabel: params.request.metadata?.telegramChatLabel ?? null,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await tx.insert(messages).values({
      id: userMessageId,
      conversationId,
      role: "user",
      contentText: params.request.message.text,
      contentJson: params.request.message.attachments
        ? { attachments: params.request.message.attachments }
        : null,
      channelMessageId: params.request.metadata?.sourceMessageId,
      parentMessageId: null,
    });
  });

  await insertActivityTrace({
    conversationId,
    dbClient: params.dbClient,
    eventName: "runtime.chat.received",
    payload: {
      channel: params.request.channel,
      messageId: userMessageId,
      traceId: params.traceId,
    },
    parentTraceId: params.traceId,
    traceType: "runtime",
  });

  return {
    conversationId,
    userDisplayName,
    userId,
    userMessageId,
  };
}

async function buildToolContext(params: {
  conversationId: string;
  dbClient: DbClient;
  userId: string;
  userText: string;
}) {
  const [recentMessages, relevantMemories, activeTasks] = await Promise.all([
    getConversationMessages(params.dbClient, params.conversationId),
    retrieveRelevantMemories(params.dbClient, params.userText),
    getActiveTaskContext(params.dbClient, params.userId),
  ]);

  return {
    activeTasks,
    recentMessages,
    relevantMemories,
  };
}

async function persistAssistantResult(params: {
  actions: RuntimeChatResponse["actions"];
  conversationId: string;
  dbClient: DbClient;
  outputText: string;
  pendingApproval?: RuntimeChatResponse["pendingApproval"];
  traceId: string;
  userMessageId: string;
  context: Awaited<ReturnType<typeof buildToolContext>>;
}) {
  const assistantMessageId = createMessageId();

  await params.dbClient.db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: assistantMessageId,
      conversationId: params.conversationId,
      role: "assistant",
      contentText: params.outputText,
      contentJson: params.pendingApproval ? { pendingApproval: params.pendingApproval } : null,
      channelMessageId: null,
      parentMessageId: params.userMessageId,
    });

    await tx
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, params.conversationId));
  });

  await insertActivityTrace({
    conversationId: params.conversationId,
    dbClient: params.dbClient,
    eventName: "runtime.chat.completed",
    payload: {
      assistantMessageId,
      memoryIds: params.context.relevantMemories.map((memory) => memory.id),
      outputLength: params.outputText.length,
      pendingApproval: Boolean(params.pendingApproval),
      taskIds: params.context.activeTasks.map((task) => task.id),
      traceId: params.traceId,
    },
    parentTraceId: params.traceId,
    traceType: "runtime",
  });

  return assistantMessageId;
}

async function createExecution(params: {
  approvalState: ToolExecutionRecord["approvalState"];
  conversationId: string;
  dbClient: DbClient;
  executionStatus: ToolExecutionRecord["executionStatus"];
  requestJson: Record<string, unknown>;
  requestedBy: string;
  summary: string;
  toolId: string;
}) {
  const id = createMessageId();
  await params.dbClient.db.insert(toolExecutions).values({
    id,
    toolId: params.toolId,
    conversationId: params.conversationId,
    requestedBy: params.requestedBy,
    executionStatus: params.executionStatus,
    approvalState: params.approvalState,
    requestJson: params.requestJson,
    responseJson: null,
    summary: params.summary,
    errorText: null,
    startedAt:
      params.executionStatus === "completed" || params.executionStatus === "failed"
        ? new Date()
        : null,
    finishedAt: null,
  });

  return id;
}

async function ensureToolRegistry(dbClient: DbClient) {
  for (const tool of builtInTools) {
    await dbClient.db
      .insert(tools)
      .values({
        id: createMessageId(),
        key: tool.key,
        name: tool.name,
        description: tool.description,
        enabled: true,
        approvalMode: tool.approvalMode,
        configSchemaJson: {},
        healthStatus: "ok",
      })
      .onConflictDoNothing({
        target: tools.key,
      });
  }
}

async function getToolByKey(dbClient: DbClient, key: string) {
  await ensureToolRegistry(dbClient);
  return dbClient.db.query.tools.findFirst({
    where: eq(tools.key, key),
  });
}

function resolveWorkspacePath(inputPath: string) {
  const root = resolve(process.cwd());
  const candidate = resolve(root, inputPath);

  if (!isPathInsideWorkspace(root, candidate)) {
    throw new Error("Requested path is outside the workspace.");
  }

  return candidate;
}

async function executeWebSearch(query: string) {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url, {
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
  };

  const topResults = (payload.RelatedTopics ?? [])
    .flatMap((entry) =>
      "Text" in entry && entry.Text
        ? [{ title: entry.Text, url: entry.FirstURL ?? null }]
        : [],
    )
    .slice(0, 3);

  const lines = [
    payload.AbstractText?.trim() || null,
    ...topResults.map((result, index) => `${index + 1}. ${result.title}${result.url ? ` (${result.url})` : ""}`),
  ].filter(Boolean) as string[];

  return {
    responseJson: {
      abstractUrl: payload.AbstractURL ?? null,
      query,
      results: topResults,
    },
    text:
      lines.length > 0
        ? `I searched the web for "${query}". ${lines.join(" ")}`
        : `I searched the web for "${query}", but the search wrapper did not return a strong summary.`,
  };
}

async function executeFileRead(pathInput: string) {
  const filePath = resolveWorkspacePath(pathInput);
  const raw = await readFile(filePath);

  if (raw.byteLength > MAX_FILE_READ_BYTES) {
    throw new Error("Requested file is too large for the safe preview limit.");
  }

  if (hasBinaryLikeContent(raw)) {
    throw new Error("Requested file looks binary and cannot be shown in the text reader.");
  }

  const text = raw.toString("utf8");
  const preview = text.slice(0, FILE_PREVIEW_LIMIT);
  const truncated = text.length > FILE_PREVIEW_LIMIT;

  return {
    responseJson: {
      bytes: raw.byteLength,
      path: pathInput,
      preview,
      truncated,
    },
    text: `I read ${pathInput}.${truncated ? " This is a preview, not the full file." : ""} Preview: ${preview}`,
  };
}

function allowedShellCommand(command: string) {
  const normalized = command.trim();
  const allowedPatterns = [
    /^git status$/i,
    /^git diff --stat$/i,
    /^npm run (build|typecheck)$/i,
    /^Get-ChildItem(?:\s|$)/i,
    /^Get-Content(?:\s|$)/i,
    /^dir(?:\s|$)/i,
  ];

  return allowedPatterns.some((pattern) => pattern.test(normalized));
}

async function executeShellCommand(command: string) {
  if (!allowedShellCommand(command)) {
    throw new Error("Shell command is outside the constrained allowlist.");
  }

  const shellCommand = process.platform === "win32" ? "powershell" : "bash";
  const shellArgs =
    process.platform === "win32"
      ? ["-NoProfile", "-Command", command]
      : ["-lc", command];

  const output = await new Promise<{ durationMs: number; stderr: string; stdout: string }>((resolvePromise, rejectPromise) => {
    const startedAt = Date.now();
    const child = spawn(shellCommand, shellArgs, {
      cwd: process.cwd(),
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`Command exceeded the ${SHELL_TIMEOUT_MS / 1000}s safety timeout.`));
    }, SHELL_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise({ durationMs: Date.now() - startedAt, stdout, stderr });
        return;
      }

      rejectPromise(new Error(stderr || `Command exited with ${code}`));
    });
  });

  return {
    responseJson: {
      command,
      durationMs: output.durationMs,
      stderr: output.stderr.slice(0, 4000),
      stdout: output.stdout.slice(0, 4000),
    },
    text: `I ran the approved shell command \`${command}\`. Output: ${(output.stdout || output.stderr || "No output.").slice(0, 1200)}`,
  };
}

async function executeTaskCreate(dbClient: DbClient, userId: string, requestJson: Record<string, unknown>) {
  const title = typeof requestJson.title === "string" ? requestJson.title.trim() : "";
  if (!title) {
    throw new Error("Task title is required.");
  }

  const taskId = createMessageId();
  const reminderAt =
    typeof requestJson.reminderAt === "string" && requestJson.reminderAt
      ? new Date(requestJson.reminderAt)
      : null;

  await dbClient.db.insert(tasks).values({
    id: taskId,
    userId,
    conversationId: null,
    title,
    detail: "Created through the Phase 5 task tool.",
    status: "open",
    dueAt: null,
    reminderAt,
    deliveryChannelType: null,
    deliveryTargetRef: null,
    sourceKind: "tool",
    sourceRef: "task_create",
  });

  return {
    responseJson: {
      reminderAt: reminderAt?.toISOString() ?? null,
      taskId,
      title,
    },
    text: reminderAt
      ? `I created the task "${title}" with a reminder at ${reminderAt.toLocaleString()}.`
      : `I created the task "${title}".`,
  };
}

async function executeToolRequest(params: {
  dbClient: DbClient;
  requestJson: Record<string, unknown>;
  requestedBy: string;
  toolKey: string;
}) {
  switch (params.toolKey) {
    case "web_search":
      return executeWebSearch(String(params.requestJson.query ?? ""));
    case "file_read":
      return executeFileRead(String(params.requestJson.path ?? ""));
    case "shell_command":
      return executeShellCommand(String(params.requestJson.command ?? ""));
    case "task_create":
      return executeTaskCreate(params.dbClient, params.requestedBy, params.requestJson);
    default:
      throw new Error(`Unsupported tool key ${params.toolKey}.`);
  }
}

export async function listTools(dbClient: DbClient): Promise<ToolListResponse> {
  await ensureToolRegistry(dbClient);
  const records = await dbClient.db.query.tools.findMany({
    orderBy: asc(tools.name),
  });

  return {
    tools: records.map(toToolRecord),
  };
}

export async function updateTool(
  dbClient: DbClient,
  toolId: string,
  request: UpdateToolRequest,
) {
  const existing = await dbClient.db.query.tools.findFirst({
    where: eq(tools.id, toolId),
  });

  if (!existing) {
    return null;
  }

  await dbClient.db
    .update(tools)
    .set({
      approvalMode: request.approvalMode ?? existing.approvalMode,
      enabled: request.enabled ?? existing.enabled,
      updatedAt: new Date(),
    })
    .where(eq(tools.id, toolId));

  return dbClient.db.query.tools.findFirst({
    where: eq(tools.id, toolId),
  });
}

export async function listToolExecutions(params: {
  approvalState?: string;
  conversationId?: string;
  dbClient: DbClient;
}) : Promise<ToolExecutionListResponse> {
  const records = await params.dbClient.db.query.toolExecutions.findMany({
    where:
      params.conversationId && params.approvalState
        ? and(
            eq(toolExecutions.conversationId, params.conversationId),
            eq(toolExecutions.approvalState, params.approvalState),
          )
        : params.conversationId
          ? eq(toolExecutions.conversationId, params.conversationId)
          : params.approvalState
            ? eq(toolExecutions.approvalState, params.approvalState)
            : undefined,
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    limit: 50,
  });
  const toolMap = new Map(
    (await params.dbClient.db.query.tools.findMany()).map((tool) => [tool.id, tool]),
  );

  return {
    executions: records.map((record) => toToolExecutionRecord(record, toolMap.get(record.toolId))),
  };
}

function createMemoryPayload(params: {
  assistantMessageId: string;
  conversationId: string;
  request: RuntimeChatRequest;
  traceId: string;
}) {
  return {
    conversationId: params.conversationId,
    messageId: params.assistantMessageId,
    traceId: params.traceId,
    userId: params.request.userId,
    source: params.request.channel,
    text: params.request.message.text,
    telegramChatId: params.request.metadata?.telegramChatId ?? null,
  } satisfies MemoryCandidateJobPayload;
}

export async function handleToolAwareTurn(params: {
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
}) {
  const intent = detectToolIntent(params.request.message.text);

  if (!intent) {
    return null;
  }

  const tool = await getToolByKey(params.dbClient, intent.toolKey);

  if (!tool) {
    return null;
  }

  const envelope = await ensureConversationEnvelope({
    dbClient: params.dbClient,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: params.request,
    traceId: params.traceId,
  });
  const context = await buildToolContext({
    conversationId: envelope.conversationId,
    dbClient: params.dbClient,
    userId: envelope.userId,
    userText: params.request.message.text,
  });

  let outputText = "";
  let pendingApproval: RuntimeChatResponse["pendingApproval"] = null;
  let actions: RuntimeChatResponse["actions"] = [];

  if (!tool.enabled || tool.approvalMode === "deny") {
    const executionId = await createExecution({
      approvalState: "policy_denied",
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      executionStatus: "denied",
      requestJson: intent.requestJson,
      requestedBy: envelope.userId,
      summary: intent.summary,
      toolId: tool.id,
    });
    await recordToolTrace({
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.policy_denied",
      executionId,
      payload: {
        approvalMode: tool.approvalMode,
        enabled: tool.enabled,
        toolKey: tool.key,
      },
      traceId: params.traceId,
    });

    await params.dbClient.db
      .update(toolExecutions)
      .set({
        errorText: tool.enabled ? "Tool policy is set to deny." : "Tool is disabled.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, executionId));

    outputText = `${tool.name} is currently unavailable for direct execution here because its policy is set to deny or it is disabled.`;
  } else if (tool.approvalMode === "ask_first") {
    const executionId = await createExecution({
      approvalState: "pending",
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      executionStatus: "awaiting_approval",
      requestJson: intent.requestJson,
      requestedBy: envelope.userId,
      summary: intent.summary,
      toolId: tool.id,
    });
    await recordToolTrace({
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.pending_approval",
      executionId,
      payload: {
        requestJson: intent.requestJson,
        summary: intent.summary,
        toolKey: tool.key,
      },
      traceId: params.traceId,
    });

    pendingApproval = {
      executionId,
      summary: intent.summary,
      toolId: tool.id,
      toolKey: tool.key,
      toolName: tool.name,
    };
    actions = [
      {
        kind: "approval_requested",
        payload: {
          executionId,
          toolKey: tool.key,
        },
      },
    ];
    outputText = `I can do that with ${tool.name}, but it needs approval first. Review the request and approve or deny it.`;
  } else {
    const executionId = await createExecution({
      approvalState: "not_required",
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      executionStatus: "completed",
      requestJson: intent.requestJson,
      requestedBy: envelope.userId,
      summary: intent.summary,
      toolId: tool.id,
    });
    await recordToolTrace({
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.started",
      executionId,
      payload: {
        requestJson: intent.requestJson,
        summary: intent.summary,
        toolKey: tool.key,
      },
      traceId: params.traceId,
    });

    try {
      const result = await executeToolRequest({
        dbClient: params.dbClient,
        requestJson: intent.requestJson,
        requestedBy: envelope.userId,
        toolKey: tool.key,
      });

      await params.dbClient.db
        .update(toolExecutions)
        .set({
          responseJson: result.responseJson,
          startedAt: new Date(),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolExecutions.id, executionId));
      await recordToolTrace({
        conversationId: envelope.conversationId,
        dbClient: params.dbClient,
        eventName: "tool.execution.completed",
        executionId,
        payload: {
          toolKey: tool.key,
        },
        traceId: params.traceId,
      });

      outputText = result.text;
      actions = [
        {
          kind: tool.key === "task_create" ? "task_created" : "tool_executed",
          payload: {
            toolKey: tool.key,
          },
        },
      ];
    } catch (error) {
      await params.dbClient.db
        .update(toolExecutions)
        .set({
          executionStatus: "failed",
          responseJson: null,
          errorText: error instanceof Error ? error.message : String(error),
          startedAt: new Date(),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolExecutions.id, executionId));
      await recordToolTrace({
        conversationId: envelope.conversationId,
        dbClient: params.dbClient,
        eventName: "tool.execution.failed",
        executionId,
        payload: {
          error: error instanceof Error ? error.message : String(error),
          toolKey: tool.key,
        },
        traceId: params.traceId,
      });

      outputText = `${tool.name} failed safely. ${error instanceof Error ? error.message : "Unknown tool error."}`;
    }
  }

  const assistantMessageId = await persistAssistantResult({
    actions,
    conversationId: envelope.conversationId,
    dbClient: params.dbClient,
    outputText,
    pendingApproval,
    traceId: params.traceId,
    userMessageId: envelope.userMessageId,
    context,
  });

  return {
    memoryPayload: createMemoryPayload({
      assistantMessageId,
      conversationId: envelope.conversationId,
      request: {
        ...params.request,
        userId: envelope.userId,
      },
      traceId: params.traceId,
    }),
    response: {
      actions,
      contextSummary: {
        memories: context.relevantMemories,
        tasks: context.activeTasks,
      },
      conversationId: envelope.conversationId,
      messageId: assistantMessageId,
      outputText,
      pendingApproval,
      traceId: params.traceId,
    } satisfies RuntimeChatResponse,
  };
}

async function appendApprovalMessage(params: {
  conversationId: string | null;
  dbClient: DbClient;
  text: string;
}) {
  if (!params.conversationId) {
    return null;
  }

  const messageId = createMessageId();
  await params.dbClient.db.insert(messages).values({
    id: messageId,
    conversationId: params.conversationId,
    role: "assistant",
    contentText: params.text,
    contentJson: null,
    channelMessageId: null,
    parentMessageId: null,
  });
  await params.dbClient.db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, params.conversationId));

  return {
    id: messageId,
    text: params.text,
  };
}

export async function decideToolExecution(params: {
  approve: boolean;
  dbClient: DbClient;
  executionId: string;
  traceId?: string;
}): Promise<ToolApprovalDecisionResponse | null> {
  const execution = await params.dbClient.db.query.toolExecutions.findFirst({
    where: eq(toolExecutions.id, params.executionId),
  });

  if (!execution) {
    return null;
  }

  const tool = await params.dbClient.db.query.tools.findFirst({
    where: eq(tools.id, execution.toolId),
  });

  if (!tool) {
    return null;
  }

  if (execution.approvalState !== "pending") {
    return {
      assistantMessage: null,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(execution, tool),
    };
  }

  if (!params.approve) {
    await params.dbClient.db
      .update(toolExecutions)
      .set({
        approvalState: "denied",
        executionStatus: "denied",
        errorText: "User denied execution.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, execution.id));
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.denied",
      executionId: execution.id,
      payload: {
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });

    const deniedExecution = await params.dbClient.db.query.toolExecutions.findFirst({
      where: eq(toolExecutions.id, execution.id),
    });
    const assistantMessage = await appendApprovalMessage({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      text: `${tool.name} was denied, so nothing was executed.`,
    });

    return {
      assistantMessage,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(deniedExecution ?? execution, tool),
    };
  }

  try {
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.approved",
      executionId: execution.id,
      payload: {
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });
    const result = await executeToolRequest({
      dbClient: params.dbClient,
      requestJson: execution.requestJson,
      requestedBy: execution.requestedBy,
      toolKey: tool.key,
    });

    await params.dbClient.db
      .update(toolExecutions)
      .set({
        approvalState: "approved",
        executionStatus: "completed",
        responseJson: result.responseJson,
        startedAt: execution.startedAt ?? new Date(),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, execution.id));
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.completed",
      executionId: execution.id,
      payload: {
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });

    const approvedExecution = await params.dbClient.db.query.toolExecutions.findFirst({
      where: eq(toolExecutions.id, execution.id),
    });
    const assistantMessage = await appendApprovalMessage({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      text: result.text,
    });

    return {
      assistantMessage,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(approvedExecution ?? execution, tool),
    };
  } catch (error) {
    await params.dbClient.db
      .update(toolExecutions)
      .set({
        approvalState: "approved",
        executionStatus: "failed",
        errorText: error instanceof Error ? error.message : String(error),
        startedAt: execution.startedAt ?? new Date(),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, execution.id));
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.failed",
      executionId: execution.id,
      payload: {
        error: error instanceof Error ? error.message : String(error),
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });

    const failedExecution = await params.dbClient.db.query.toolExecutions.findFirst({
      where: eq(toolExecutions.id, execution.id),
    });
    const assistantMessage = await appendApprovalMessage({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      text: `${tool.name} failed safely after approval. ${error instanceof Error ? error.message : "Unknown tool error."}`,
    });

    return {
      assistantMessage,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(failedExecution ?? execution, tool),
    };
  }
}
