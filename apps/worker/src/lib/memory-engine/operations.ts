import type {
  ActivityTraceResponse,
  MemoryListResponse,
  TaskListResponse,
  UpdateMemoryRequest,
} from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import { activityTraces, type DbClient, memoryEntries, memoryLinks, tasks } from "@secretary/db";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { logMemoryRetrieval } from "../utils.js";
import { dedupeTaskRecords, tokenize, unique } from "./extractors.js";
import {
  toMemoryRecord,
  toRuntimeMemoryContextItem,
  toRuntimeTaskContextItem,
  toTaskRecord,
} from "./transformers.js";

export async function ensureMemoryLink(params: {
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
    orderBy: [
      desc(memoryEntries.pinned),
      desc(memoryEntries.importanceScore),
      desc(memoryEntries.updatedAt),
    ],
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
    where: and(
      eq(tasks.userId, userId),
      or(eq(tasks.status, "open"), eq(tasks.status, "in_progress")),
    ),
    orderBy: [asc(tasks.reminderAt), asc(tasks.dueAt), desc(tasks.createdAt)],
    limit: 25,
  });

  return {
    tasks: dedupeTaskRecords(records).map(toTaskRecord),
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

export async function retrieveRelevantMemories(dbClient: DbClient, queryText: string) {
  const startTime = performance.now();
  const records = await dbClient.db.query.memoryEntries.findMany({
    where: eq(memoryEntries.suppressed, false),
    orderBy: [
      desc(memoryEntries.pinned),
      desc(memoryEntries.importanceScore),
      desc(memoryEntries.updatedAt),
    ],
    limit: 200,
  });

  const queryTokens = tokenize(queryText);
  const now = Date.now();

  // Detect query context signals for type-specific boosting
  const queryHasPersonSignal =
    /\b(who|name|wife|husband|partner|son|daughter|sister|brother|mom|dad|friend|boss|colleague)\b/i.test(
      queryText,
    );
  const queryHasScheduleSignal =
    /\b(when|time|schedule|meeting|standup|every|weekly|monday|tuesday|wednesday|thursday|friday|daily|routine)\b/i.test(
      queryText,
    );
  const queryHasToolSignal =
    /\b(use|using|editor|tool|language|framework|stack|coding|development)\b/i.test(queryText);
  const queryHasLocationSignal = /\b(where|timezone|location|city|office|remote)\b/i.test(
    queryText,
  );

  const scored = records
    .map((record) => {
      const candidateTokens = unique(
        tokenize(
          [
            record.title ?? "",
            record.summary ?? "",
            record.contentText,
            ...(record.tags ?? []),
          ].join(" "),
        ),
      );
      const haystack = [
        record.title ?? "",
        record.summary ?? "",
        record.contentText,
        ...(record.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();

      const overlapTokens = unique(
        queryTokens.filter(
          (token) =>
            haystack.includes(token) || candidateTokens.some((candidate) => candidate === token),
        ),
      );
      const overlap = overlapTokens.length;
      const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;

      // Recency decay: memories accessed recently score *lower* to prevent repetition
      const lastAccessedMs = record.lastAccessedAt ? record.lastAccessedAt.getTime() : 0;
      const hoursSinceAccess = lastAccessedMs > 0 ? (now - lastAccessedMs) / (1000 * 60 * 60) : 999;
      const recencyDecayPenalty = hoursSinceAccess < 0.5 ? -20 : hoursSinceAccess < 2 ? -10 : 0;

      // Age boost: newer memories score slightly higher (fresher = more likely relevant)
      const createdMs = record.createdAt.getTime();
      const daysSinceCreation = (now - createdMs) / (1000 * 60 * 60 * 24);
      const ageBoost = daysSinceCreation < 1 ? 12 : daysSinceCreation < 7 ? 6 : 0;

      // Type-context boost: surface memory types matching the query intent
      const typeBoost =
        (queryHasPersonSignal && record.memoryType === "relationship" ? 25 : 0) +
        (queryHasScheduleSignal && record.memoryType === "episodic" ? 20 : 0) +
        (queryHasToolSignal && record.memoryType === "operational" ? 18 : 0) +
        (queryHasLocationSignal && (record.tags ?? []).includes("location") ? 20 : 0) +
        (record.memoryType === "project" && queryTokens.includes("project") ? 15 : 0);

      // Pinned memories require at least 1 token overlap (no blind injection)
      const pinnedBoost = record.pinned && overlap >= 1 ? 100 : 0;

      const score =
        pinnedBoost +
        record.importanceScore * 0.7 +
        overlap * 28 +
        ageBoost +
        typeBoost +
        recencyDecayPenalty;

      return {
        record,
        overlap,
        overlapRatio,
        score,
      };
    })
    .filter(({ record, overlap, overlapRatio, score }) => {
      const recordTokens = tokenize(
        [record.title ?? "", record.summary ?? "", record.contentText, ...(record.tags ?? [])].join(
          " ",
        ),
      );
      const lowSignalMemory =
        record.memoryType === "semantic" && recordTokens.length < 2 && !record.pinned;

      // Pinned memories: require token overlap now to prevent blind injection
      if (record.pinned) {
        return !lowSignalMemory && overlap >= 1;
      }

      return (
        !lowSignalMemory &&
        queryTokens.length > 0 &&
        ((queryTokens.length <= 2 && overlap >= 1) || overlap >= 2 || overlapRatio >= 0.5) &&
        score >= 25
      );
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);

  const selectedIds = scored.map(({ record }) => record.id);

  // Log retrieval metrics for debugging
  logMemoryRetrieval({
    query: queryText,
    durationMs: Math.round(performance.now() - startTime),
    resultsCount: scored.length,
    topScore: scored[0]?.score,
  });

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

export async function getActiveTaskContext(dbClient: DbClient, userId: string) {
  const records = await dbClient.db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, userId),
      or(eq(tasks.status, "open"), eq(tasks.status, "in_progress")),
    ),
    orderBy: [asc(tasks.reminderAt), asc(tasks.dueAt), desc(tasks.createdAt)],
    limit: 25,
  });

  return dedupeTaskRecords(records).slice(0, 5).map(toRuntimeTaskContextItem);
}
