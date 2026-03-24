import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import {
  activityTraces,
  jobs,
  memoryEntries,
  memoryLinks,
  tasks,
  type DbClient,
} from "@secretary/db";
import {
  createMessageId,
  type ActivityTraceResponse,
  type MemoryCandidateJobPayload,
  type MemoryListResponse,
  type MemoryRecord,
  type MemoryType,
  type RuntimeMemoryContextItem,
  type RuntimeTaskContextItem,
  type TaskListResponse,
  type TaskRecord,
  type UpdateMemoryRequest,
} from "@secretary/core-runtime";

type MemoryCandidate = {
  memoryType: MemoryType;
  title: string;
  summary: string;
  contentText: string;
  tags: string[];
  canonicalKey: string;
  importanceScore: number;
  confidenceScore: number;
};

type TaskCandidate = {
  title: string;
  detail: string | null;
};

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

const stopWords = new Set([
  "about",
  "and",
  "are",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "have",
  "how",
  "i",
  "is",
  "it",
  "me",
  "my",
  "now",
  "remember",
  "that",
  "the",
  "this",
  "to",
  "what",
  "you",
]);

function tokenize(text: string) {
  return cleanText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function extractPreferenceMemory(text: string): MemoryCandidate[] {
  const preferenceMatch = text.match(
    /\b(?:i\s+)?(?:prefer|like|love|hate|dislike|want)\s+(.+)/i,
  );

  if (!preferenceMatch) {
    return [];
  }

  const preferenceText = cleanText(preferenceMatch[1]).replace(/[.?!]+$/g, "");
  const positive = !/\b(hate|dislike)\b/i.test(text);

  return [
    {
      memoryType: "semantic",
      title: `Preference: ${titleCase(preferenceText).slice(0, 48)}`,
      summary: positive
        ? `User preference noted: ${preferenceText}`
        : `User dislike noted: ${preferenceText}`,
      contentText: text,
      tags: unique(["preference", ...tokenize(preferenceText).slice(0, 4)]),
      canonicalKey: `semantic:preference:${preferenceText.toLowerCase()}`,
      importanceScore: /\bremember\b/i.test(text) ? 92 : 70,
      confidenceScore: 80,
    },
  ];
}

function extractProjectMemory(text: string): MemoryCandidate[] {
  const projectMatch = text.match(
    /\b(?:we(?:'re| are)?|i(?:'m| am)?)\s+(?:building|working on|shipping|finishing)\s+(.+)/i,
  );

  if (!projectMatch) {
    return [];
  }

  const projectText = cleanText(projectMatch[1]).replace(/[.?!]+$/g, "");

  return [
    {
      memoryType: "project",
      title: `Project: ${titleCase(projectText).slice(0, 52)}`,
      summary: `Active workstream: ${projectText}`,
      contentText: text,
      tags: unique(["project", ...tokenize(projectText).slice(0, 4)]),
      canonicalKey: `project:${projectText.toLowerCase()}`,
      importanceScore: /\bremember\b/i.test(text) ? 88 : 66,
      confidenceScore: 74,
    },
  ];
}

function extractOperationalMemory(text: string): MemoryCandidate[] {
  if (!/\b(repo|docker|postgres|redis|worker|desk|phase)\b/i.test(text)) {
    return [];
  }

  return [
    {
      memoryType: "operational",
      title: `Operational note: ${titleCase(cleanText(text).slice(0, 42))}`,
      summary: cleanText(text).slice(0, 140),
      contentText: text,
      tags: unique(["operational", ...tokenize(text).slice(0, 5)]),
      canonicalKey: `operational:${cleanText(text).toLowerCase()}`,
      importanceScore: /\bremember\b/i.test(text) ? 84 : 55,
      confidenceScore: 68,
    },
  ];
}

function extractExplicitMemory(text: string): MemoryCandidate[] {
  if (
    !/\b(remember (?:that|this)|please remember|note this|save this|don't forget|do not forget)\b/i.test(
      text,
    )
  ) {
    return [];
  }

  const normalized = cleanText(text).replace(/[.?!]+$/g, "");

  return [
    {
      memoryType: "episodic",
      title: `Remember: ${titleCase(normalized.slice(0, 48))}`,
      summary: normalized.slice(0, 140),
      contentText: text,
      tags: unique(["remember", ...tokenize(normalized).slice(0, 5)]),
      canonicalKey: `episodic:${normalized.toLowerCase()}`,
      importanceScore: 95,
      confidenceScore: 88,
    },
  ];
}

function extractTaskCandidate(text: string): TaskCandidate | null {
  const match = text.match(/\bremind me to\s+(.+)/i);

  if (!match) {
    return null;
  }

  const taskText = cleanText(match[1]).replace(/[.?!]+$/g, "");

  return {
    title: titleCase(taskText).slice(0, 120),
    detail: `Created from memory extraction: ${taskText}`,
  };
}

function extractMemoryCandidates(text: string) {
  const specificCandidates = [
    ...extractPreferenceMemory(text),
    ...extractProjectMemory(text),
    ...extractOperationalMemory(text),
  ];
  const fallbackCandidates =
    specificCandidates.length === 0 ? extractExplicitMemory(text) : [];

  return unique([...specificCandidates, ...fallbackCandidates].map((candidate) => JSON.stringify(candidate))).map((value) =>
    JSON.parse(value) as MemoryCandidate,
  );
}

function toMemoryRecord(
  record: typeof memoryEntries.$inferSelect,
): MemoryRecord {
  return {
    id: record.id,
    memoryType: record.memoryType as MemoryType,
    title: record.title,
    summary: record.summary,
    contentText: record.contentText,
    importanceScore: record.importanceScore,
    confidenceScore: record.confidenceScore,
    pinned: record.pinned,
    suppressed: record.suppressed,
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
    tags: record.tags ?? [],
    lastAccessedAt: record.lastAccessedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toRuntimeMemoryContextItem(
  record: typeof memoryEntries.$inferSelect,
): RuntimeMemoryContextItem {
  return {
    id: record.id,
    memoryType: record.memoryType as MemoryType,
    title: record.title,
    summary: record.summary,
    contentText: record.contentText,
    importanceScore: record.importanceScore,
    confidenceScore: record.confidenceScore,
    pinned: record.pinned,
    sourceRef: record.sourceRef,
    tags: record.tags ?? [],
  };
}

function toRuntimeTaskContextItem(record: typeof tasks.$inferSelect): RuntimeTaskContextItem {
  return {
    id: record.id,
    title: record.title,
    detail: record.detail,
    status: record.status,
    dueAt: record.dueAt?.toISOString() ?? null,
    reminderAt: record.reminderAt?.toISOString() ?? null,
  };
}

function toTaskRecord(record: typeof tasks.$inferSelect): TaskRecord {
  return {
    id: record.id,
    title: record.title,
    detail: record.detail,
    status: record.status,
    dueAt: record.dueAt?.toISOString() ?? null,
    reminderAt: record.reminderAt?.toISOString() ?? null,
  };
}

async function ensureMemoryLink(params: {
  dbClient: DbClient;
  memoryEntryId: string;
  linkType: string;
  linkedEntityType: string;
  linkedEntityId: string;
}) {
  const existing = await params.dbClient.db.query.memoryLinks.findFirst({
    where: and(
      eq(memoryLinks.memoryEntryId, params.memoryEntryId),
      eq(memoryLinks.linkType, params.linkType),
      eq(memoryLinks.linkedEntityType, params.linkedEntityType),
      eq(memoryLinks.linkedEntityId, params.linkedEntityId),
    ),
  });

  if (existing) {
    return existing.id;
  }

  const id = createMessageId();

  await params.dbClient.db.insert(memoryLinks).values({
    id,
    memoryEntryId: params.memoryEntryId,
    linkType: params.linkType,
    linkedEntityType: params.linkedEntityType,
    linkedEntityId: params.linkedEntityId,
  });

  return id;
}

export async function listMemories(
  dbClient: DbClient,
  filters: {
    search?: string;
    memoryType?: string;
    includeSuppressed?: boolean;
  },
): Promise<MemoryListResponse> {
  const records = await dbClient.db.query.memoryEntries.findMany({
    orderBy: [desc(memoryEntries.pinned), desc(memoryEntries.importanceScore), desc(memoryEntries.updatedAt)],
    limit: 200,
  });

  const searchTokens = filters.search ? tokenize(filters.search) : [];
  const filtered = records.filter((record) => {
    if (!filters.includeSuppressed && record.suppressed) {
      return false;
    }

    if (filters.memoryType && record.memoryType !== filters.memoryType) {
      return false;
    }

    if (searchTokens.length === 0) {
      return true;
    }

    const haystack = [
      record.title ?? "",
      record.summary ?? "",
      record.contentText,
      ...(record.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();

    return searchTokens.every((token) => haystack.includes(token));
  });

  return {
    memories: filtered.map(toMemoryRecord),
  };
}

export async function updateMemory(
  dbClient: DbClient,
  memoryId: string,
  patch: UpdateMemoryRequest,
) {
  await dbClient.db
    .update(memoryEntries)
    .set({
      title: patch.title,
      summary: patch.summary,
      contentText: patch.contentText,
      memoryType: patch.memoryType,
      pinned: patch.pinned,
      suppressed: patch.suppressed,
      tags: patch.tags,
      updatedAt: new Date(),
    })
    .where(eq(memoryEntries.id, memoryId));

  return dbClient.db.query.memoryEntries.findFirst({
    where: eq(memoryEntries.id, memoryId),
  });
}

export async function listTasksForUser(
  dbClient: DbClient,
  userId: string,
): Promise<TaskListResponse> {
  const records = await dbClient.db.query.tasks.findMany({
    where: and(eq(tasks.userId, userId), or(eq(tasks.status, "open"), eq(tasks.status, "in_progress"))),
    orderBy: [asc(tasks.reminderAt), asc(tasks.dueAt), desc(tasks.createdAt)],
    limit: 25,
  });

  return {
    tasks: records.map(toTaskRecord),
  };
}

export async function getConversationActivity(
  dbClient: DbClient,
  conversationId: string,
): Promise<ActivityTraceResponse> {
  const traces = await dbClient.db.query.activityTraces.findMany({
    where: eq(activityTraces.conversationId, conversationId),
    orderBy: asc(activityTraces.createdAt),
    limit: 200,
  });

  return {
    conversationId,
    traces: traces.map((trace) => ({
      id: trace.id,
      traceType: trace.traceType,
      eventName: trace.eventName,
      payload: trace.payloadJson,
      createdAt: trace.createdAt.toISOString(),
    })),
  };
}

export async function retrieveRelevantMemories(
  dbClient: DbClient,
  queryText: string,
) {
  const records = await dbClient.db.query.memoryEntries.findMany({
    where: eq(memoryEntries.suppressed, false),
    orderBy: [desc(memoryEntries.pinned), desc(memoryEntries.importanceScore), desc(memoryEntries.updatedAt)],
    limit: 200,
  });

  const queryTokens = tokenize(queryText);
  const scored = records
    .map((record) => {
      const haystack = [
        record.title ?? "",
        record.summary ?? "",
        record.contentText,
        ...(record.tags ?? []),
      ].join(" ").toLowerCase();

      const overlap = queryTokens.filter((token) => haystack.includes(token)).length;
      const score =
        (record.pinned ? 120 : 0) +
        record.importanceScore +
        overlap * 18 +
        (record.memoryType === "project" && queryTokens.includes("project") ? 20 : 0);

      return {
        record,
        overlap,
        score,
      };
    })
    .filter(({ record, overlap, score }) =>
      record.pinned ||
      (queryTokens.length > 0 && overlap > 0 && score >= 45),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  const selectedIds = scored.map(({ record }) => record.id);

  if (selectedIds.length > 0) {
    await dbClient.db
      .update(memoryEntries)
      .set({
        lastAccessedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(or(...selectedIds.map((id) => eq(memoryEntries.id, id))));
  }

  return scored.map(({ record }) => toRuntimeMemoryContextItem(record));
}

export async function getActiveTaskContext(
  dbClient: DbClient,
  userId: string,
) {
  const records = await dbClient.db.query.tasks.findMany({
    where: and(eq(tasks.userId, userId), or(eq(tasks.status, "open"), eq(tasks.status, "in_progress"))),
    orderBy: [asc(tasks.reminderAt), asc(tasks.dueAt), desc(tasks.createdAt)],
    limit: 5,
  });

  return records.map(toRuntimeTaskContextItem);
}

export async function processMemoryCandidateJob(params: {
  dbClient: DbClient;
  payload: MemoryCandidateJobPayload;
  jobId: string;
}) {
  const { dbClient, payload, jobId } = params;
  const startedAt = new Date();

  await dbClient.db
    .update(jobs)
    .set({
      status: "processing",
      startedAt,
      updatedAt: startedAt,
    })
    .where(eq(jobs.id, jobId));

  await dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "specialist",
    parentTraceId: payload.traceId,
    conversationId: payload.conversationId,
    jobId,
    eventName: "memory.specialist.started",
    payloadJson: {
      jobId,
      messageId: payload.messageId,
    },
  });

  const candidates = extractMemoryCandidates(payload.text);
  const createdMemoryIds: string[] = [];
  const createdTaskIds: string[] = [];

  for (const candidate of candidates) {
    const existing = await dbClient.db.query.memoryEntries.findFirst({
      where: eq(memoryEntries.canonicalKey, candidate.canonicalKey),
    });

    const memoryId = existing?.id ?? createMessageId();

    if (existing) {
      await dbClient.db
        .update(memoryEntries)
        .set({
          memoryType: candidate.memoryType,
          title: candidate.title,
          summary: candidate.summary,
          contentText: candidate.contentText,
          tags: candidate.tags,
          importanceScore: Math.max(existing.importanceScore, candidate.importanceScore),
          confidenceScore: Math.max(existing.confidenceScore, candidate.confidenceScore),
          sourceKind: "conversation",
          sourceRef: payload.conversationId,
          canonicalKey: candidate.canonicalKey,
          updatedAt: new Date(),
        })
        .where(eq(memoryEntries.id, memoryId));
    } else {
      await dbClient.db.insert(memoryEntries).values({
        id: memoryId,
        memoryType: candidate.memoryType,
        title: candidate.title,
        summary: candidate.summary,
        contentText: candidate.contentText,
        contentJson: {
          sourceMessageId: payload.messageId,
          extractedFrom: payload.source,
        },
        tags: candidate.tags,
        importanceScore: candidate.importanceScore,
        confidenceScore: candidate.confidenceScore,
        sourceKind: "conversation",
        sourceRef: payload.conversationId,
        canonicalKey: candidate.canonicalKey,
      });
    }

    await ensureMemoryLink({
      dbClient,
      memoryEntryId: memoryId,
      linkType: "source",
      linkedEntityType: "conversation",
      linkedEntityId: payload.conversationId,
    });
    await ensureMemoryLink({
      dbClient,
      memoryEntryId: memoryId,
      linkType: "source",
      linkedEntityType: "message",
      linkedEntityId: payload.messageId,
    });

    await dbClient.db.insert(activityTraces).values({
      id: createMessageId(),
      traceType: "memory",
      parentTraceId: payload.traceId,
      conversationId: payload.conversationId,
      jobId,
      eventName: "memory.entry.written",
      payloadJson: {
        memoryId,
        memoryType: candidate.memoryType,
        pinned: existing?.pinned ?? false,
        title: candidate.title,
      },
    });

    createdMemoryIds.push(memoryId);
  }

  const taskCandidate = extractTaskCandidate(payload.text);

  if (taskCandidate) {
    const existingTask = await dbClient.db.query.tasks.findFirst({
      where: and(
        eq(tasks.userId, payload.userId),
        eq(tasks.title, taskCandidate.title),
        or(eq(tasks.status, "open"), eq(tasks.status, "in_progress")),
      ),
      orderBy: desc(tasks.createdAt),
    });

    if (existingTask) {
      createdTaskIds.push(existingTask.id);
      await dbClient.db.insert(activityTraces).values({
        id: createMessageId(),
        traceType: "task",
        parentTraceId: payload.traceId,
        conversationId: payload.conversationId,
        jobId,
        eventName: "task.reused",
        payloadJson: {
          taskId: existingTask.id,
          title: existingTask.title,
        },
      });
    } else {
      const taskId = createMessageId();
      await dbClient.db.insert(tasks).values({
        id: taskId,
        userId: payload.userId,
        conversationId: payload.conversationId,
        title: taskCandidate.title,
        detail: taskCandidate.detail,
        status: "open",
        sourceKind: "conversation",
        sourceRef: payload.messageId,
      });

      await dbClient.db.insert(activityTraces).values({
        id: createMessageId(),
        traceType: "task",
        parentTraceId: payload.traceId,
        conversationId: payload.conversationId,
        jobId,
        eventName: "task.created",
        payloadJson: {
          taskId,
          title: taskCandidate.title,
        },
      });

      createdTaskIds.push(taskId);
    }
  }

  const finishedAt = new Date();

  await dbClient.db
    .update(jobs)
    .set({
      status: "completed",
      resultJson: {
        memoryIds: createdMemoryIds,
        taskIds: createdTaskIds,
      },
      finishedAt,
      updatedAt: finishedAt,
      errorText: null,
    })
    .where(eq(jobs.id, jobId));

  await dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "specialist",
    parentTraceId: payload.traceId,
    conversationId: payload.conversationId,
    jobId,
    eventName: "memory.specialist.completed",
    payloadJson: {
      jobId,
      memoryIds: createdMemoryIds,
      taskIds: createdTaskIds,
    },
  });
}

export async function markMemoryCandidateJobFailed(params: {
  dbClient: DbClient;
  jobId: string;
  traceId: string;
  conversationId: string;
  errorText: string;
}) {
  const { dbClient, jobId, traceId, conversationId, errorText } = params;

  await dbClient.db
    .update(jobs)
    .set({
      status: "failed",
      errorText,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  await dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "specialist",
    parentTraceId: traceId,
    conversationId,
    jobId,
    eventName: "memory.specialist.failed",
    payloadJson: {
      jobId,
      errorText,
    },
  });
}
