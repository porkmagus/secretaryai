import type { InferenceProviderId, MemoryCandidateJobPayload } from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import { activityTraces, type DbClient, jobs, memoryEntries, tasks } from "@secretary/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { normalizeTaskTitle } from "../task-runtime.js";
import { extractTaskCandidate, unique } from "./extractors.js";
import { ensureMemoryLink } from "./operations.js";
import { extractMemoryCandidates } from "./retrieval.js";

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

  const jobPayload = payload as any; // Bypass stale type check if core-runtime build is lagging
  const candidates = await extractMemoryCandidates({
    text: jobPayload.text,
    inference: jobPayload.inference
      ? {
          ...jobPayload.inference,
          enabled: true,
          providerId: jobPayload.inference.selectedProviderId as InferenceProviderId,
          reasoningEffort: jobPayload.inference.reasoningEffort ?? "low",
          maxOutputTokens: jobPayload.inference.maxOutputTokens
            ? parseInt(jobPayload.inference.maxOutputTokens, 10)
            : null,
        }
      : undefined,
  });

  const createdMemoryIds: string[] = [];
  const createdTaskIds: string[] = [];

  const canonicalKeys = unique(candidates.map((c) => c.canonicalKey));
  const existingEntries =
    canonicalKeys.length > 0
      ? await dbClient.db.query.memoryEntries.findMany({
          where: inArray(memoryEntries.canonicalKey, canonicalKeys),
        })
      : [];

  const existingMap = new Map(
    existingEntries
      .filter((e) => e.canonicalKey !== null)
      .map((e) => [e.canonicalKey as string, e]),
  );

  for (const candidate of candidates) {
    const existing = existingMap.get(candidate.canonicalKey);

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
    const openTasks = await dbClient.db.query.tasks.findMany({
      where: and(
        eq(tasks.userId, payload.userId),
        or(eq(tasks.status, "open"), eq(tasks.status, "in_progress")),
      ),
      orderBy: desc(tasks.createdAt),
      limit: 50,
    });
    const existingTask =
      openTasks.find(
        (task) => normalizeTaskTitle(task.title) === normalizeTaskTitle(taskCandidate.title),
      ) ?? null;

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
        dueAt: taskCandidate.dueAt,
        reminderAt: taskCandidate.reminderAt,
        deliveryChannelType: payload.telegramChatId ? "telegram" : null,
        deliveryTargetRef: payload.telegramChatId ?? null,
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
          reminderAt: taskCandidate.reminderAt?.toISOString() ?? null,
          deliveryTargetRef: payload.telegramChatId ?? null,
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
