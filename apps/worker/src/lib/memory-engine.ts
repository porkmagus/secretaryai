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
import {
  buildTaskDraft,
  cleanText,
  normalizeTaskTitle,
  titleCase,
} from "./task-runtime.js";

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
  dueAt: Date | null;
  reminderAt: Date | null;
};

const stopWords = new Set([
  "about",
  "and",
  "are",
  "can",
  "did",
  "do",
  "does",
  "feel",
  "feeling",
  "for",
  "from",
  "have",
  "how",
  "i",
  "is",
  "it",
  "me",
  "more",
  "my",
  "normal",
  "not",
  "now",
  "remember",
  "so",
  "that",
  "the",
  "this",
  "to",
  "what",
  "you",
  "yet",
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

function dedupeTaskRecords<T extends { title: string }>(records: T[]) {
  const seen = new Set<string>();

  return records.filter((record) => {
    const normalizedTitle = normalizeTaskTitle(record.title);

    if (seen.has(normalizedTitle)) {
      return false;
    }

    seen.add(normalizedTitle);
    return true;
  });
}

function extractPreferenceMemory(text: string): MemoryCandidate[] {
  const preferenceMatch = text.match(
    /\b(?:i\s+)?(?:prefer|like|love|hate|dislike|want|enjoy|can't stand|can't bear|am into|am not into)\s+(.+)/i,
  );

  if (!preferenceMatch) {
    return [];
  }

  const preferenceText = cleanText(preferenceMatch[1]).replace(/[.?!]+$/g, "");
  const preferenceTokens = tokenize(preferenceText);

  if (preferenceTokens.length < 2 || preferenceText.length < 8) {
    return [];
  }

  const positive = !/\b(hate|dislike|can't stand|can't bear|am not into)\b/i.test(text);

  return [
    {
      memoryType: "semantic",
      title: `Preference: ${titleCase(preferenceText).slice(0, 48)}`,
      summary: positive
        ? `User preference noted: ${preferenceText}`
        : `User dislike noted: ${preferenceText}`,
      contentText: text,
      tags: unique(["preference", ...preferenceTokens.slice(0, 4)]),
      canonicalKey: `semantic:preference:${preferenceText.toLowerCase().slice(0, 120)}`,
      importanceScore: /\bremember\b/i.test(text) ? 92 : 70,
      confidenceScore: 80,
    },
  ];
}

function extractProjectMemory(text: string): MemoryCandidate[] {
  const projectMatch = text.match(
    /\b(?:we(?:'re| are)?|i(?:'m| am)?)\s+(?:building|working on|shipping|finishing|developing|launching|releasing|designing)\s+(.+)/i,
  );
  const goalMatch = !projectMatch
    ? text.match(
        /\b(?:i want to|i'm trying to|i plan to|i'm planning to|my goal is to|we need to)\s+(?:launch|ship|build|create|finish|deploy|release)\s+(.+)/i,
      )
    : null;
  const match = projectMatch ?? goalMatch;

  if (!match) {
    return [];
  }

  const projectText = cleanText(match[1]).replace(/[.?!]+$/g, "");

  return [
    {
      memoryType: "project",
      title: `Project: ${titleCase(projectText).slice(0, 52)}`,
      summary: goalMatch ? `User goal: ${projectText}` : `Active workstream: ${projectText}`,
      contentText: text,
      tags: unique(["project", ...tokenize(projectText).slice(0, 4)]),
      canonicalKey: `project:${projectText.toLowerCase().slice(0, 120)}`,
      importanceScore: /\bremember\b/i.test(text) ? 88 : 66,
      confidenceScore: 74,
    },
  ];
}

function extractOperationalMemory(text: string): MemoryCandidate[] {
  if (!/\b(repo|docker|postgres|redis|worker|desk|phase|codebase|database|server|api|endpoint|config|deploy|pipeline|workflow)\b/i.test(text)) {
    return [];
  }

  return [
    {
      memoryType: "operational",
      title: `Operational note: ${titleCase(cleanText(text).slice(0, 42))}`,
      summary: cleanText(text).slice(0, 140),
      contentText: text,
      tags: unique(["operational", ...tokenize(text).slice(0, 5)]),
      canonicalKey: `operational:${cleanText(text).toLowerCase().slice(0, 120)}`,
      importanceScore: /\bremember\b/i.test(text) ? 84 : 55,
      confidenceScore: 68,
    },
  ];
}

function extractPersonalFactMemory(text: string): MemoryCandidate[] {
  // "My X is Y" / "The X is Y" patterns — personal attributes
  const factMatch = text.match(
    /\b(?:my|the)\s+([a-z][a-z ]{1,24})\s+is\s+([^.!?]{4,60})/i,
  );
  if (!factMatch) {
    return [];
  }

  const attribute = cleanText(factMatch[1]).toLowerCase();
  const value = cleanText(factMatch[2]).replace(/[.?!]+$/g, "");

  // Reject noise attributes
  const skipAttributes = new Set(["question", "answer", "guess", "point", "thing", "issue", "result", "problem", "plan", "reason", "idea"]);
  if (skipAttributes.has(attribute) || attribute.length < 2) {
    return [];
  }

  return [
    {
      memoryType: "semantic",
      title: `Personal fact: ${titleCase(attribute)} is ${titleCase(value).slice(0, 40)}`,
      summary: `User's ${attribute}: ${value}`,
      contentText: text,
      tags: unique(["personal", attribute, ...tokenize(value).slice(0, 3)]),
      canonicalKey: `semantic:personal:${attribute}:${value.toLowerCase().slice(0, 80)}`,
      importanceScore: /\bremember\b/i.test(text) ? 90 : 72,
      confidenceScore: 82,
    },
  ];
}

function extractRelationshipMemory(text: string): MemoryCandidate[] {
  // "X is my Y" or "my Y X" or "my Y is named X"
  const patternA = text.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+my\s+([a-z][a-z ]{2,24})/,
  );
  const patternB = text.match(
    /\bmy\s+([a-z][a-z ]{2,24})(?:'s name)?\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  );
  const patternC = text.match(
    /\bmy\s+([a-z][a-z ]{2,24})\s+([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?\b/,
  );

  const match = patternA ?? patternB ?? patternC;
  if (!match) {
    return [];
  }

  let personName: string;
  let role: string;

  if (patternA) {
    personName = patternA[1];
    role = patternA[2];
  } else if (patternB) {
    role = patternB[1];
    personName = patternB[2];
  } else if (patternC) {
    role = patternC[1];
    personName = patternC[2];
  } else {
    return [];
  }

  const roleNormalized = role.toLowerCase().trim();
  const validRoles = new Set(["wife", "husband", "partner", "girlfriend", "boyfriend", "son", "daughter", "sister", "brother", "mother", "father", "mom", "dad", "friend", "boss", "colleague", "manager", "coworker", "assistant", "mentor", "client", "cousin", "uncle", "aunt"]);

  if (!validRoles.has(roleNormalized) && !roleNormalized.includes("project manager") && !roleNormalized.includes("team")) {
    return [];
  }

  return [
    {
      memoryType: "relationship",
      title: `Relationship: ${personName} (${roleNormalized})`,
      summary: `${personName} is the user's ${roleNormalized}`,
      contentText: text,
      tags: unique(["relationship", roleNormalized, personName.toLowerCase()]),
      canonicalKey: `relationship:${roleNormalized}:${personName.toLowerCase()}`,
      importanceScore: 85,
      confidenceScore: 84,
    },
  ];
}

function extractScheduleMemory(text: string): MemoryCandidate[] {
  const scheduleMatch = text.match(
    /\b(?:every|each)\s+([a-z]+(?:\s+and\s+[a-z]+)?(?:\s+at\s+[\d:]+ ?(?:am|pm)?)?)\b/i,
  ) ?? text.match(
    /\b(?:the\s+)?(?:standup|meeting|sync|call|check.?in|session|class|workout|run)\s+is\s+(?:every|on|at)\s+(.+)/i,
  ) ?? text.match(
    /\b(?:i\s+)?(?:usually|always|normally|typically)\s+([a-z][^.!?]{6,60})/i,
  );

  if (!scheduleMatch) {
    return [];
  }

  const scheduleText = cleanText(scheduleMatch[1] ?? scheduleMatch[0]).replace(/[.?!]+$/g, "");
  if (tokenize(scheduleText).length < 1) {
    return [];
  }

  return [
    {
      memoryType: "episodic",
      title: `Schedule: ${titleCase(scheduleText).slice(0, 52)}`,
      summary: `Recurring event or habit: ${scheduleText}`,
      contentText: text,
      tags: unique(["schedule", "recurring", ...tokenize(scheduleText).slice(0, 4)]),
      canonicalKey: `episodic:schedule:${scheduleText.toLowerCase().slice(0, 100)}`,
      importanceScore: 72,
      confidenceScore: 70,
    },
  ];
}

function extractToolSoftwareMemory(text: string): MemoryCandidate[] {
  const toolMatch = text.match(
    /\b(?:i\s+)?(?:use|work(?:s)?\s+(?:in|with)|run(?:s)?|write(?:s)?\s+(?:in|with)|code(?:s)?\s+(?:in|with)|develop(?:s)?\s+(?:in|with))\s+([A-Za-z][a-zA-Z0-9 .+#-]{1,30})/i,
  );
  if (!toolMatch) {
    return [];
  }

  const toolText = cleanText(toolMatch[1]).replace(/[.?!,]+$/g, "");
  // Filter out noise
  const noiseWords = new Set(["it", "that", "this", "them", "these", "those", "him", "her", "me", "you"]);
  if (noiseWords.has(toolText.toLowerCase()) || toolText.length < 2) {
    return [];
  }

  return [
    {
      memoryType: "operational",
      title: `Tool: ${titleCase(toolText)}`,
      summary: `User works with: ${toolText}`,
      contentText: text,
      tags: unique(["tool", "software", ...tokenize(toolText).slice(0, 3)]),
      canonicalKey: `operational:tool:${toolText.toLowerCase()}`,
      importanceScore: 65,
      confidenceScore: 76,
    },
  ];
}

function extractLocationMemory(text: string): MemoryCandidate[] {
  const locationMatch = text.match(
    /\b(?:i(?:'m| am)?\s+(?:based|located|living|working)\s+(?:in|out of)|i\s+live\s+in|i\s+work\s+(?:from|in|out of)|my\s+(?:office|home|timezone)\s+is)\s+([A-Za-z][^.!?]{2,40})/i,
  );
  if (!locationMatch) {
    return [];
  }

  const locationText = cleanText(locationMatch[1]).replace(/[.?!]+$/g, "");

  return [
    {
      memoryType: "semantic",
      title: `Location: ${titleCase(locationText).slice(0, 48)}`,
      summary: `User location/timezone: ${locationText}`,
      contentText: text,
      tags: unique(["location", "timezone", ...tokenize(locationText).slice(0, 3)]),
      canonicalKey: `semantic:location:${locationText.toLowerCase().slice(0, 80)}`,
      importanceScore: 74,
      confidenceScore: 80,
    },
  ];
}

function extractLifeEventMemory(text: string): MemoryCandidate[] {
  const eventMatch = text.match(
    /\b(?:we(?:'re| are)?|i(?:'m| am)?)\s+(?:moving|getting married|engaged|having a baby|expecting|graduating|starting a new job|retiring|relocating|traveling to)\b(.{0,60})/i,
  );
  if (!eventMatch) {
    return [];
  }

  const eventContext = cleanText(`${eventMatch[0]} ${eventMatch[1] ?? ""}`).replace(/[.?!]+$/g, "");

  return [
    {
      memoryType: "episodic",
      title: `Life event: ${titleCase(eventContext).slice(0, 52)}`,
      summary: `Life event mention: ${eventContext}`,
      contentText: text,
      tags: unique(["life_event", ...tokenize(eventContext).slice(0, 4)]),
      canonicalKey: `episodic:life_event:${eventContext.toLowerCase().slice(0, 120)}`,
      importanceScore: 88,
      confidenceScore: 78,
    },
  ];
}

function extractExplicitMemory(text: string): MemoryCandidate[] {
  if (
    !/\b(remember (?:that|this)|please remember|note this|save this|don't forget|do not forget|keep in mind|make a note)\b/i.test(
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
      canonicalKey: `episodic:explicit:${normalized.toLowerCase().slice(0, 120)}`,
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

  const rawTaskText = cleanText(match[1]).replace(/[.?!]+$/g, "");
  const draft = buildTaskDraft({
    text: rawTaskText,
    fallbackDetail: `Created from memory extraction: ${rawTaskText}`,
  });

  return {
    title: draft.title,
    detail: draft.detail,
    dueAt: draft.dueAt,
    reminderAt: draft.reminderAt,
  };
}

function extractMemoryCandidates(text: string) {
  const specificCandidates = [
    ...extractExplicitMemory(text),
    ...extractRelationshipMemory(text),
    ...extractPersonalFactMemory(text),
    ...extractLifeEventMemory(text),
    ...extractPreferenceMemory(text),
    ...extractProjectMemory(text),
    ...extractScheduleMemory(text),
    ...extractLocationMemory(text),
    ...extractToolSoftwareMemory(text),
    ...extractOperationalMemory(text),
  ];

  // Deduplicate by canonicalKey, keeping highest importanceScore per key
  const byKey = new Map<string, MemoryCandidate>();
  for (const candidate of specificCandidates) {
    const existing = byKey.get(candidate.canonicalKey);
    if (!existing || candidate.importanceScore > existing.importanceScore) {
      byKey.set(candidate.canonicalKey, candidate);
    }
  }

  return [...byKey.values()];
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
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
    deliveryChannelType: record.deliveryChannelType,
    deliveryTargetRef: record.deliveryTargetRef,
    lastDeliveryError: record.lastDeliveryError,
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
  const now = Date.now();

  // Detect query context signals for type-specific boosting
  const queryHasPersonSignal = /\b(who|name|wife|husband|partner|son|daughter|sister|brother|mom|dad|friend|boss|colleague)\b/i.test(queryText);
  const queryHasScheduleSignal = /\b(when|time|schedule|meeting|standup|every|weekly|monday|tuesday|wednesday|thursday|friday|daily|routine)\b/i.test(queryText);
  const queryHasToolSignal = /\b(use|using|editor|tool|language|framework|stack|coding|development)\b/i.test(queryText);
  const queryHasLocationSignal = /\b(where|timezone|location|city|office|remote)\b/i.test(queryText);

  const scored = records
    .map((record) => {
      const candidateTokens = unique(
        tokenize(
          [record.title ?? "", record.summary ?? "", record.contentText, ...(record.tags ?? [])].join(
            " ",
          ),
        ),
      );
      const haystack = [
        record.title ?? "",
        record.summary ?? "",
        record.contentText,
        ...(record.tags ?? []),
      ].join(" ").toLowerCase();

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
        record.memoryType === "semantic" &&
        recordTokens.length < 2 &&
        !record.pinned;

      // Pinned memories: require token overlap now to prevent blind injection
      if (record.pinned) {
        return !lowSignalMemory && overlap >= 1;
      }

      return (
        !lowSignalMemory &&
        queryTokens.length > 0 &&
        ((queryTokens.length <= 2 && overlap >= 1) ||
          overlap >= 2 ||
          overlapRatio >= 0.5) &&
        score >= 45
      );
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);

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
    limit: 25,
  });

  return dedupeTaskRecords(records).slice(0, 5).map(toRuntimeTaskContextItem);
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
        (task) =>
          normalizeTaskTitle(task.title) === normalizeTaskTitle(taskCandidate.title),
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
