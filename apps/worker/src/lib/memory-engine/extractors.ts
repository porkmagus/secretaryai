import type { MemoryType } from "@secretary/core-runtime";
import { buildTaskDraft, normalizeTaskTitle, titleCase } from "../task-runtime.js";
import { cleanText } from "../utils.js";

export type MemoryCandidate = {
  memoryType: MemoryType;
  title: string;
  summary: string;
  contentText: string;
  tags: string[];
  canonicalKey: string;
  importanceScore: number;
  confidenceScore: number;
};

export type TaskCandidate = {
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

export function tokenize(text: string) {
  return cleanText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

export function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function dedupeTaskRecords<T extends { title: string }>(records: T[]) {
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

export function extractPreferenceMemory(text: string): MemoryCandidate[] {
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

export function extractProjectMemory(text: string): MemoryCandidate[] {
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

export function extractOperationalMemory(text: string): MemoryCandidate[] {
  if (
    !/\b(repo|docker|postgres|redis|worker|desk|phase|codebase|database|server|api|endpoint|config|deploy|pipeline|workflow)\b/i.test(
      text,
    )
  ) {
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

export function extractPersonalFactMemory(text: string): MemoryCandidate[] {
  // "My X is Y" / "The X is Y" patterns — personal attributes
  const factMatch = text.match(/\b(?:my|the)\s+([a-z][a-z ]{1,24})\s+is\s+([^.!?]{4,60})/i);
  if (!factMatch) {
    return [];
  }

  const attribute = cleanText(factMatch[1]).toLowerCase();
  const value = cleanText(factMatch[2]).replace(/[.?!]+$/g, "");

  // Reject noise attributes
  const skipAttributes = new Set([
    "question",
    "answer",
    "guess",
    "point",
    "thing",
    "issue",
    "result",
    "problem",
    "plan",
    "reason",
    "idea",
  ]);
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

export function extractRelationshipMemory(text: string): MemoryCandidate[] {
  // "X is my Y" or "my Y X" or "my Y is named X"
  const patternA = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+my\s+([a-z][a-z ]{2,24})/);
  const patternB = text.match(
    /\bmy\s+([a-z][a-z ]{2,24})(?:'s name)?\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  );
  const patternC = text.match(/\bmy\s+([a-z][a-z ]{2,24})\s+([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?\b/);

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
  const validRoles = new Set([
    "wife",
    "husband",
    "partner",
    "girlfriend",
    "boyfriend",
    "son",
    "daughter",
    "sister",
    "brother",
    "mother",
    "father",
    "mom",
    "dad",
    "friend",
    "boss",
    "colleague",
    "manager",
    "coworker",
    "assistant",
    "mentor",
    "client",
    "cousin",
    "uncle",
    "aunt",
  ]);

  if (
    !validRoles.has(roleNormalized) &&
    !roleNormalized.includes("project manager") &&
    !roleNormalized.includes("team")
  ) {
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

export function extractScheduleMemory(text: string): MemoryCandidate[] {
  const scheduleMatch =
    text.match(
      /\b(?:every|each)\s+([a-z]+(?:\s+and\s+[a-z]+)?(?:\s+at\s+[\d:]+ ?(?:am|pm)?)?)\b/i,
    ) ??
    text.match(
      /\b(?:the\s+)?(?:standup|meeting|sync|call|check.?in|session|class|workout|run)\s+is\s+(?:every|on|at)\s+(.+)/i,
    ) ??
    text.match(/\b(?:i\s+)?(?:usually|always|normally|typically)\s+([a-z][^.!?]{6,60})/i);

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

export function extractToolSoftwareMemory(text: string): MemoryCandidate[] {
  const toolMatch = text.match(
    /\b(?:i\s+)?(?:use|work(?:s)?\s+(?:in|with)|run(?:s)?|write(?:s)?\s+(?:in|with)|code(?:s)?\s+(?:in|with)|develop(?:s)?\s+(?:in|with))\s+([A-Za-z][a-zA-Z0-9 .+#-]{1,30})/i,
  );
  if (!toolMatch) {
    return [];
  }

  const toolText = cleanText(toolMatch[1]).replace(/[.?!,]+$/g, "");
  // Filter out noise
  const noiseWords = new Set([
    "it",
    "that",
    "this",
    "them",
    "these",
    "those",
    "him",
    "her",
    "me",
    "you",
  ]);
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

export function extractLocationMemory(text: string): MemoryCandidate[] {
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

export function extractLifeEventMemory(text: string): MemoryCandidate[] {
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

export function extractExplicitMemory(text: string): MemoryCandidate[] {
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

export function extractTaskCandidate(text: string): TaskCandidate | null {
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
