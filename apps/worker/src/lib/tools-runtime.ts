import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  activityTraces,
  conversations,
  memoryEntries,
  messages,
  personas,
  tasks,
  toolExecutions,
  tools,
  users,
  type DbClient,
} from "@secretary/db";
import type { AppConfig } from "@secretary/config";
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
import { createTelegramClient } from "@secretary/integrations";
import { getActiveTaskContext, retrieveRelevantMemories } from "./memory-engine.js";
import { findConversationIdByChannelRef, getConversationMessages } from "./chat-persistence.js";
import { parseSecretaryCustomization } from "./admin-runtime.js";
import { sendConfiguredEmail } from "./outbound-channel-integrations.js";
import { defaultSecretaryName, defaultSecretarySoul } from "./persona-soul.js";
import {
  buildTaskDraft,
  normalizeTaskTitle,
  parseReminderTime,
  summarizeTaskSchedule,
} from "./task-runtime.js";
import { cleanText as cleanTaskText, logToolExecution } from "./utils/index.js";

const FILE_PREVIEW_LIMIT = 1500;
const MAX_FILE_READ_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
const SHELL_TIMEOUT_MS = 20_000;
const GENERATED_DOCUMENTS_DIR = "runtime/generated/documents";
const EMAIL_DRAFTS_DIR = "runtime/generated/email-drafts";
const CALENDAR_EXPORTS_DIR = "runtime/generated/calendar-events";
const BROWSER_TARGETS_DIR = "runtime/generated/browser-targets";
const DOWNLOADS_DIR = "runtime/downloads";
import { repoRoot } from "./utils/index.js";

type BuiltInTool = {
  key: string;
  name: string;
  description: string;
  approvalMode: ToolApprovalMode;
  enabled?: boolean;
  healthStatus?: string;
};

type ToolIntent = {
  requestJson: Record<string, unknown>;
  summary: string;
  toolKey:
    | "task_create"
    | "task_list"
    | "task_update"
    | "web_search"
    | "web_scrape"
    | "file_read"
    | "file_write"
    | "document_create"
    | "download_url"
    | "memory_write"
    | "memory_read"
    | "note_to_self"
    | "telegram_send"
    | "shell_command"
    | "browser_open"
    | "calendar_create"
    | "email_draft"
    | "email_send";
};

const builtInTools: BuiltInTool[] = [
  {
    key: "web_search",
    name: "Web Search",
    description: "Look up current public information through the local SearXNG search wrapper.",
    approvalMode: "always_allow",
  },
  {
    key: "crawl4ai_light",
    name: "Crawl4AI Light Crawl",
    description: "Quickly extract basic content from a web page using the local Crawl4AI service (light mode).",
    approvalMode: "ask_first",
  },
  {
    key: "crawl4ai_deep",
    name: "Crawl4AI Deep Crawl",
    description: "Extract full content and metadata from a web page using Crawl4AI's deep extraction mode.",
    approvalMode: "ask_first",
  },
  {
    key: "crawl4ai_variable",
    name: "Crawl4AI Variable Crawl",
    description: "Extract content from a web page using Crawl4AI with custom options (strategy, hooks, etc.).",
    approvalMode: "ask_first",
  },
  {
    key: "file_read",
    name: "Read File",
    description: "Read a local text file from the workspace or runtime area.",
    approvalMode: "ask_first",
  },
  {
    key: "file_write",
    name: "Write File",
    description: "Create or update a safe local text file inside the workspace.",
    approvalMode: "ask_first",
  },
  {
    key: "document_create",
    name: "Create Document",
    description: "Draft a markdown document into the local generated-documents area.",
    approvalMode: "ask_first",
  },
  {
    key: "download_url",
    name: "Download URL",
    description: "Download a public file into the local downloads area.",
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
    approvalMode: "always_allow",
  },
  {
    key: "task_list",
    name: "List Tasks",
    description: "Review current lightweight tasks, reminders, and follow-through items.",
    approvalMode: "always_allow",
  },
  {
    key: "task_update",
    name: "Update Task",
    description: "Mark a task done, reopen it, or reschedule its reminder.",
    approvalMode: "always_allow",
  },
  {
    key: "memory_write",
    name: "Update Memory",
    description: "Create or adjust a memory entry by pinning, suppressing, or editing it.",
    approvalMode: "ask_first",
  },
  {
    key: "telegram_send",
    name: "Send Telegram Message",
    description: "Send a proactive Telegram message through the configured bot.",
    approvalMode: "ask_first",
  },
  {
    key: "browser_open",
    name: "Open Browser Target",
    description: "Save a browser target and next-action note for follow-through.",
    approvalMode: "always_allow",
  },
  {
    key: "calendar_create",
    name: "Create Calendar Event",
    description: "Draft a portable calendar event export for review and follow-through.",
    approvalMode: "always_allow",
  },
  {
    key: "email_draft",
    name: "Draft Email",
    description: "Create a reviewable outbound email draft and save it for later sending.",
    approvalMode: "always_allow",
  },
  {
    key: "email_send",
    name: "Send Email",
    description: "Send a real outbound email through the configured email channel.",
    approvalMode: "ask_first",
  },
  {
    key: "memory_read",
    name: "Read Memory",
    description: "Search and retrieve relevant memory entries to answer a question about what the secretary knows.",
    approvalMode: "always_allow",
  },
  {
    key: "note_to_self",
    name: "Note to Self",
    description: "Proactively save a personal detail, name, preference, or context note as a memory entry without an explicit user command.",
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

function parseInlineQuotedValue(text: string) {
  const backtickMatch = text.match(/`([^`]+)`/);
  if (backtickMatch?.[1]) {
    return backtickMatch[1].trim();
  }

  const quotedMatch = text.match(/"([^"]+)"/);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  return null;
}

function parseInlineUrl(text: string) {
  const urlMatch = text.match(/\bhttps?:\/\/[^\s`]+/i);
  return urlMatch?.[0]?.trim() ?? null;
}

function sanitizeFileNamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || `item-${Date.now()}`;
}

function resolveRuntimePath(relativePath: string) {
  return resolveWorkspacePath(relativePath);
}

async function ensureRuntimeGeneratedPath(relativeDir: string) {
  const directory = resolveRuntimePath(relativeDir);
  await mkdir(directory, { recursive: true });
  return directory;
}

function shortSnippet(text: string, max = 96) {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
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
  const match = text.match(
    /\b(?:remind me to|remember to|create task to|add (?:a )?(?:task|reminder) to|add to my list|put on my list)\s+(.+)/i,
  );
  if (!match?.[1]) {
    return null;
  }

  const rawTitle = cleanTaskText(match[1]).replace(/[.?!]+$/, "");
  const draft = buildTaskDraft({
    text: rawTitle,
    fallbackDetail: `Created from an explicit task request: ${rawTitle}`,
  });

  return {
    requestJson: {
      detail: draft.detail,
      dueAt: draft.dueAt?.toISOString() ?? null,
      reminderAt: draft.reminderAt?.toISOString() ?? null,
      title: draft.title,
    },
    summary: `Create task: ${draft.title}`,
    toolKey: "task_create" as const,
  };
}

function extractTaskReference(text: string) {
  const quotedReference = parseInlineQuotedValue(text);
  if (quotedReference) {
    return quotedReference;
  }

  const normalized = text.replace(/[.?!]+$/, "");

  const completeMatch = normalized.match(
    /\b(?:mark|set|complete|finish)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed)\b/i,
  );
  if (completeMatch?.[1]) {
    return cleanTaskText(completeMatch[1]);
  }

  const reopenMatch = normalized.match(/\b(?:reopen|resume)\s+(?:the\s+)?(?:task\s+)?(.+)$/i);
  if (reopenMatch?.[1]) {
    return cleanTaskText(reopenMatch[1]);
  }

  const rescheduleMatch = normalized.match(
    /\b(?:reschedule|move|push)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+\b(?:to|for)\b/i,
  );
  if (rescheduleMatch?.[1]) {
    return cleanTaskText(rescheduleMatch[1]);
  }

  return null;
}

function parseTaskUpdateIntent(text: string) {
  const reference = extractTaskReference(text);
  if (!reference) {
    return null;
  }

  if (/\b(?:mark|set|complete|finish)\b.+\b(?:done|complete|completed)\b/i.test(text)) {
    return {
      requestJson: {
        reference,
        status: "done",
      },
      summary: `Mark task ${reference} done`,
      toolKey: "task_update" as const,
    };
  }

  if (/\b(?:reopen|resume)\b.+\b(?:task\b|$)/i.test(text)) {
    return {
      requestJson: {
        reference,
        status: "open",
      },
      summary: `Reopen task ${reference}`,
      toolKey: "task_update" as const,
    };
  }

  const rescheduleMatch = text.match(/\b(?:reschedule|move|push)\b.+\b(?:to|for)\b\s+(.+)$/i);
  if (!rescheduleMatch?.[1]) {
    return null;
  }

  const scheduleText = cleanTaskText(rescheduleMatch[1]).replace(/[.?!]+$/, "");
  const reminderAt = parseReminderTime(scheduleText);

  return {
    requestJson: {
      dueAt: reminderAt?.toISOString() ?? null,
      reference,
      reminderAt: reminderAt?.toISOString() ?? null,
      scheduleText,
    },
    summary: `Reschedule task ${reference}`,
    toolKey: "task_update" as const,
  };
}

function parseTaskListIntent(text: string) {
  if (
    !/\b(?:my\s+tasks|task list|what(?:'s| is)\s+on\s+my\s+list|what\s+tasks\s+do\s+i\s+have|what\s+reminders\s+are\s+(?:due|open)|show\s+(?:my\s+)?tasks|list\s+(?:my\s+)?tasks)\b/i.test(
      text,
    )
  ) {
    return null;
  }

  const status =
    /\b(done|completed|finished)\b/i.test(text)
      ? "done"
      : /\b(all|everything)\b/i.test(text)
        ? "all"
        : "open";

  return {
    requestJson: {
      limit: /\brecent\b/i.test(text) ? 8 : 12,
      status,
    },
    summary: status === "all" ? "List all tasks" : `List ${status} tasks`,
    toolKey: "task_list" as const,
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

function parseScrapeIntent(text: string) {
  const url = parseInlineUrl(text);
  if (!url) {
    return null;
  }

  // Match patterns like "scrape", "extract content from", "get content of", "fetch page"
  const hasScrapeIntent = /\b(?:scrape|extract content from|get content of|fetch page|pull content from|read this page|summarize this)\b/i.test(text);
  if (!hasScrapeIntent) {
    return null;
  }

  return {
    requestJson: { url },
    summary: `Scrape content from ${url}`,
    toolKey: "web_scrape" as const,
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

function parseFileWriteIntent(text: string) {
  const path =
    parseInlinePath(text) ??
    text.match(/\b(?:write|save|update)\s+(?:a\s+)?file\s+([^\s]+)\s+(?:with|to)\b/i)?.[1]?.trim() ??
    null;

  if (!path || !/\b(?:write|save|update)\b/i.test(text)) {
    return null;
  }

  const contentMatch =
    text.match(/\b(?:with|to)\s+content\s*:\s*(.+)$/i) ??
    text.match(/\b(?:with|to)\s+(.+)$/i);
  const content = contentMatch?.[1]?.trim().replace(/[.]+$/, "") ?? "";

  if (!content) {
    return null;
  }

  return {
    requestJson: { content, path },
    summary: `Write local file ${path}`,
    toolKey: "file_write" as const,
  };
}

function parseDocumentCreateIntent(text: string) {
  const match =
    text.match(/\b(?:create|draft|write|make)\s+(?:a\s+)?(?:document|note|report|brief|checklist)\s+(?:called|named|titled)\s+["`]?([^"`]+)["`]?/i) ??
    text.match(/\b(?:create|draft|write|make)\s+(?:a\s+)?(?:document|note|report|brief|checklist)\b[:\s-]+(.+)$/i);

  if (!match?.[1]) {
    return null;
  }

  const raw = match[1].trim();
  const [titleCandidate, ...rest] = raw.split(/\s+-\s+|\s+with\s+/);
  const title = titleCandidate.trim().replace(/[.?!]+$/, "");
  const content = rest.join(" ").trim();

  return {
    requestJson: {
      content: content || `# ${title}\n`,
      title,
    },
    summary: `Create document "${title}"`,
    toolKey: "document_create" as const,
  };
}

function parseDownloadIntent(text: string) {
  const url = parseInlineUrl(text);
  if (!url || !/\b(?:download|fetch|grab)\b/i.test(text)) {
    return null;
  }

  const path = parseInlinePath(text);

  return {
    requestJson: {
      path,
      url,
    },
    summary: `Download ${url}`,
    toolKey: "download_url" as const,
  };
}

function parseMemoryWriteIntent(text: string) {
  const reference = parseInlineQuotedValue(text);

  if (/\bpin memory\b/i.test(text) && reference) {
    return {
      requestJson: { operation: "pin", reference },
      summary: `Pin memory ${reference}`,
      toolKey: "memory_write" as const,
    };
  }

  if (/\bsuppress memory\b/i.test(text) && reference) {
    return {
      requestJson: { operation: "suppress", reference },
      summary: `Suppress memory ${reference}`,
      toolKey: "memory_write" as const,
    };
  }

  if (/\bunsuppress memory\b/i.test(text) && reference) {
    return {
      requestJson: { operation: "unsuppress", reference },
      summary: `Unsuppress memory ${reference}`,
      toolKey: "memory_write" as const,
    };
  }

  const rememberMatch =
    text.match(/\bremember(?: this)?[:\s]+(.+)$/i) ??
    text.match(/\bstore in memory[:\s]+(.+)$/i);

  if (!rememberMatch?.[1]) {
    return null;
  }

  const contentText = rememberMatch[1].trim().replace(/[.]+$/, "");
  return {
    requestJson: {
      contentText,
      operation: "create",
      title: contentText.slice(0, 60),
    },
    summary: "Create explicit memory entry",
    toolKey: "memory_write" as const,
  };
}

function parseTelegramSendIntent(text: string) {
  if (!/\b(?:send|message)\b.+\btelegram\b/i.test(text)) {
    return null;
  }

  const bodyMatch =
    text.match(/\btelegram\b(?:\s+message)?\s*:\s*(.+)$/i) ??
    text.match(/\bsend\b.+\btelegram\b.+\bthat\b\s+(.+)$/i);
  const message = bodyMatch?.[1]?.trim();

  if (!message) {
    return null;
  }

  return {
    requestJson: {
      message,
    },
    summary: `Send Telegram message: ${shortSnippet(message, 72)}`,
    toolKey: "telegram_send" as const,
  };
}

function parseBrowserOpenIntent(text: string) {
  const url = parseInlineUrl(text);
  if (!url || !/\bopen\b/i.test(text)) {
    return null;
  }

  return {
    requestJson: { target: url },
    summary: `Open ${url} in the browser`,
    toolKey: "browser_open" as const,
  };
}

function parseEmailDraftIntent(text: string) {
  const match =
    text.match(/\b(?:draft|write|compose|create)\s+(?:an?\s+)?email\s+to\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i) ??
    text.match(/\bemail\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i);

  if (!match?.[1]) {
    return null;
  }

  const to = cleanTaskText(match[1]).replace(/[.?!]+$/, "");
  const subject = cleanTaskText(match[2] ?? "").replace(/[.?!]+$/, "");
  const body = cleanTaskText(match[3] ?? "").replace(/[.?!]+$/, "");

  if (!to || (!subject && !body)) {
    return null;
  }

  return {
    requestJson: {
      to,
      subject: subject || `Follow-up: ${shortSnippet(body || to, 48)}`,
      body,
    },
    summary: `Draft email to ${to}`,
    toolKey: "email_draft" as const,
  };
}

function parseEmailSendIntent(text: string) {
  const match =
    text.match(/\b(?:send)\s+(?:an?\s+)?email\s+to\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i) ??
    text.match(/\bsend\s+email\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i);

  if (!match?.[1]) {
    return null;
  }

  const to = cleanTaskText(match[1]).replace(/[.?!]+$/, "");
  const subject = cleanTaskText(match[2] ?? "").replace(/[.?!]+$/, "");
  const body = cleanTaskText(match[3] ?? "").replace(/[.?!]+$/, "");

  if (!to || (!subject && !body)) {
    return null;
  }

  return {
    requestJson: {
      body,
      subject: subject || `Follow-up: ${shortSnippet(body || to, 48)}`,
      to,
    },
    summary: `Send email to ${to}`,
    toolKey: "email_send" as const,
  };
}

function parseDurationMinutes(text: string) {
  const hoursMatch = text.match(/\bfor\s+(\d+)\s+hours?\b/i);
  if (hoursMatch?.[1]) {
    return Number(hoursMatch[1]) * 60;
  }

  const minutesMatch = text.match(/\bfor\s+(\d+)\s+minutes?\b/i);
  if (minutesMatch?.[1]) {
    return Number(minutesMatch[1]);
  }

  return 60;
}

function parseCalendarCreateIntent(text: string) {
  const match =
    text.match(/\b(?:schedule|add|create|draft)\s+(?:an?\s+)?(?:calendar event|event|meeting)\s+(?:for\s+)?(.+)$/i) ??
    text.match(/\bput\s+(.+)\s+on\s+(?:my\s+)?calendar\b/i);

  if (!match?.[1]) {
    return null;
  }

  const raw = cleanTaskText(match[1]).replace(/[.?!]+$/, "");
  const startAt = parseReminderTime(raw);
  const title = cleanTaskText(
    raw
      .replace(/\b(?:tomorrow|today|in\s+\d+\s+(?:minutes?|hours?)|at\s+\d+(?::\d{2})?\s*(?:am|pm)?|for\s+\d+\s+(?:minutes?|hours?))\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );

  if (!title || !startAt) {
    return null;
  }

  return {
    requestJson: {
      detail: raw,
      durationMinutes: parseDurationMinutes(raw),
      startAt: startAt.toISOString(),
      title: title.charAt(0).toUpperCase() + title.slice(1),
    },
    summary: `Draft calendar event "${title}"`,
    toolKey: "calendar_create" as const,
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

function parseMemoryReadIntent(text: string) {
  // Expanded patterns to catch more natural phrasing
  const memoryPhrases = [
    /\b(?:do you remember|what do you know about|what do you have on|recall)\b/i,
    /\b(?:look up|check|search)\s+(?:in |through )?(?:your |my )?memory\b/i,
    /\b(?:search|look)\s+(?:your |my )?memory\s+for\b/i,
    /\bwhat\s+(?:is|are)\s+(?:in|stored in)\s+(?:your |my )?memory\b/i,
    /\bread\s+(?:from )?(?:your |my )?memory\b/i,
    /\bcheck\s+(?:your |my )?notes\b/i,
    /\bwhat\s+did\s+(?:i|we)\s+(?:say|talk about|discuss)\b/i,
  ];
  
  const hasMemoryPhrase = memoryPhrases.some(pattern => pattern.test(text));
  if (!hasMemoryPhrase) {
    return null;
  }

  // Extract the query - look for what comes after the trigger phrase
  const queryMatch =
    text.match(/\b(?:do you remember|recall|what do you know about|what do you have on|search(?:\s+your)?\s+memory\s+for|check(?:\s+your)?\s+memory\s+for|look(?:\s+in)?(?:\s+your)?\s+memory\s+for)\s+(.+)/i) ??
    text.match(/\b(?:about|regarding|on)\s+(.+)/i);
  
  // If no specific query found, use the whole text minus common prefixes
  const query = queryMatch?.[1]?.trim().replace(/[.?!]+$/, "") ?? 
    text.replace(/^\s*(?:can you|please|i want to|let me|i'll)\s+/i, "").trim();

  return {
    requestJson: { query },
    summary: `Search memory for "${query}"`,
    toolKey: "memory_read" as const,
  };
}

function parseNoteToSelfIntent(text: string) {
  // Expanded patterns for more natural note-taking phrasing
  const notePatterns = [
    /\b(?:make|take|write|create)\s+(?:a\s+)?note(?:\s+that)?\s*[:\s]+(.+)$/i,
    /\b(?:jot|write)\s+(?:this\s+)?down\s*[:\s]+(.+)$/i,
    /\bnote\s+(?:to\s+)?(?:yourself|self)\s*[:\s]+(.+)$/i,
    /\bremember\s+(?:this|that)\s*[:\s]+(.+)$/i,
    /\bdon'?t\s+forget\s+(?:that)?\s*[:\s]+(.+)$/i,
    /\badd\s+(?:this\s+)?to\s+(?:your\s+)?memory\s*[:\s]+(.+)$/i,
    /\bsave\s+(?:this\s+)?(?:to\s+memory|for\s+later)\s*[:\s]+(.+)$/i,
  ];
  
  for (const pattern of notePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const contentText = match[1].trim().replace(/[.]+$/, "");
      return {
        requestJson: {
          contentText,
          title: contentText.slice(0, 60),
          memoryType: "semantic",
        },
        summary: `Note to self: ${contentText.slice(0, 60)}`,
        toolKey: "note_to_self" as const,
      };
    }
  }
  
  return null;
}

function detectToolIntent(text: string): ToolIntent | null {
  return (
    parseTaskListIntent(text) ??
    parseReminderIntent(text) ??
    parseTaskUpdateIntent(text) ??
    parseMemoryReadIntent(text) ??
    parseSearchIntent(text) ??
    parseScrapeIntent(text) ??
    parseBrowserOpenIntent(text) ??
    parseEmailSendIntent(text) ??
    parseFileWriteIntent(text) ??
    parseFileIntent(text) ??
    parseDocumentCreateIntent(text) ??
    parseDownloadIntent(text) ??
    parseNoteToSelfIntent(text) ??
    parseMemoryWriteIntent(text) ??
    parseTelegramSendIntent(text) ??
    parseCalendarCreateIntent(text) ??
    parseEmailDraftIntent(text) ??
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
        name: defaultSecretaryName,
        toneProfile: {
          mode: "calm",
          customization: parseSecretaryCustomization(null),
        },
        behaviorRules: [
          "Be warm, competent, and calm.",
          "Answer naturally instead of narrating internal system state unless the user asks for it.",
          "Protect local-first privacy defaults.",
        ],
        promptTemplate: defaultSecretarySoul,
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
        enabled: tool.enabled ?? true,
        approvalMode: tool.approvalMode,
        configSchemaJson: {},
        healthStatus: tool.healthStatus ?? "ok",
      })
      .onConflictDoUpdate({
        target: tools.key,
        set: {
          description: tool.description,
          enabled: sql`case when ${tools.healthStatus} = 'not_configured' then ${tool.enabled ?? true} else ${tools.enabled} end`,
          healthStatus: tool.healthStatus ?? "ok",
          name: tool.name,
          approvalMode: sql`case when ${tools.healthStatus} = 'not_configured' then ${tool.approvalMode} else ${tools.approvalMode} end`,
          updatedAt: new Date(),
        },
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
  const root = repoRoot;
  const candidate = resolve(root, inputPath);

  if (!isPathInsideWorkspace(root, candidate)) {
    throw new Error("Requested path is outside the workspace.");
  }

  return candidate;
}


async function executeCrawl4aiLight(config: AppConfig, url: string) {
  if (!config.crawl4ai?.baseUrl) {
    throw new Error("Crawl4AI is not configured.");
  }
  const apiUrl = new URL("/crawl", config.crawl4ai.baseUrl);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: [url],
      crawler_config: { type: "CrawlerRunConfig", params: { stream: false, cache_mode: "bypass" } },
      browser_config: { type: "BrowserConfig", params: { headless: true } },
    }),
  });
  if (!response.ok) throw new Error(`Crawl4AI Light Crawl failed: ${response.status}`);
  const result = await response.json();
  const data = result.results?.[0] || result;
  const content = data.markdown || data.html || "";
  const title = data.title || "Untitled Page";
  return {
    responseJson: data,
    text: `Crawl4AI Light: "${title}"\n\n${content.slice(0, 8000)}${content.length > 8000 ? "...\n\n[Content truncated]" : ""}`,
  };
}

async function executeCrawl4aiDeep(config: AppConfig, url: string) {
  if (!config.crawl4ai?.baseUrl) {
    throw new Error("Crawl4AI is not configured.");
  }
  const apiUrl = new URL("/crawl", config.crawl4ai.baseUrl);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: [url],
      crawler_config: { type: "CrawlerRunConfig", params: { stream: false, cache_mode: "bypass", extraction_strategy: { type: "JsonCssExtractionStrategy", params: {} } } },
      browser_config: { type: "BrowserConfig", params: { headless: true, viewport: { type: "dict", value: { width: 1920, height: 1080 } } } },
    }),
  });
  if (!response.ok) throw new Error(`Crawl4AI Deep Crawl failed: ${response.status}`);
  const result = await response.json();
  const data = result.results?.[0] || result;
  const content = data.markdown || data.html || "";
  const title = data.title || "Untitled Page";
  return {
    responseJson: data,
    text: `Crawl4AI Deep: "${title}"\n\n${content.slice(0, 8000)}${content.length > 8000 ? "...\n\n[Content truncated]" : ""}`,
  };
}

async function executeCrawl4aiVariable(config: AppConfig, url: string, options: Record<string, unknown>) {
  if (!config.crawl4ai?.baseUrl) {
    throw new Error("Crawl4AI is not configured.");
  }
  const apiUrl = new URL("/crawl", config.crawl4ai.baseUrl);
  const payload = Object.assign({ urls: [url] }, options);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Crawl4AI Variable Crawl failed: ${response.status}`);
  const result = await response.json();
  const data = result.results?.[0] || result;
  const content = data.markdown || data.html || "";
  const title = data.title || "Untitled Page";
  return {
    responseJson: data,
    text: `Crawl4AI Variable: "${title}"\n\n${content.slice(0, 8000)}${content.length > 8000 ? "...\n\n[Content truncated]" : ""}`,
  };
}

async function executeWebSearch(config: AppConfig, query: string) {
  if (config.search.searxngBaseUrl) {
    const url = new URL("/search", config.search.searxngBaseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "en-US");
    url.searchParams.set("safesearch", "1");

    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`SearXNG search failed with ${response.status}.`);
    }

    const payload = (await response.json()) as {
      answers?: string[];
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const topResults = (payload.results ?? []).slice(0, 4).map((result) => ({
      summary: result.content?.trim() || null,
      title: result.title?.trim() || "Untitled result",
      url: result.url?.trim() || null,
    }));

    const lines = [
      ...(payload.answers ?? []).slice(0, 2),
      ...topResults.map((result, index) =>
        `${index + 1}. ${result.title}${result.url ? ` (${result.url})` : ""}${result.summary ? ` - ${shortSnippet(result.summary, 120)}` : ""}`,
      ),
    ].filter(Boolean);

    return {
      responseJson: {
        provider: "searxng",
        query,
        results: topResults,
      },
      text:
        lines.length > 0
          ? `I searched the web for "${query}" through SearXNG. ${lines.join(" ")}`
          : `I searched the web for "${query}" through SearXNG, but it did not return a strong summary.`,
    };
  }

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
      provider: "duckduckgo_fallback",
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
    text: truncated 
      ? `Here's the start of ${pathInput} (truncated):\n\n${preview}`
      : `Here's ${pathInput}:\n\n${preview}`,
  };
}

async function executeFileWrite(pathInput: string, content: string) {
  const filePath = resolveWorkspacePath(pathInput);
  await mkdir(resolve(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return {
    responseJson: {
      bytes: Buffer.byteLength(content, "utf8"),
      path: pathInput,
    },
    text: `I wrote ${pathInput} safely inside the workspace.`,
  };
}

async function executeDocumentCreate(requestJson: Record<string, unknown>) {
  const title =
    typeof requestJson.title === "string" && requestJson.title.trim()
      ? requestJson.title.trim()
      : "Secretary Note";
  const content =
    typeof requestJson.content === "string" && requestJson.content.trim()
      ? requestJson.content.trim()
      : `# ${title}\n`;
  const filename = `${sanitizeFileNamePart(title)}.md`;
  const relativePath = `${GENERATED_DOCUMENTS_DIR}/${filename}`;
  const fullPath = resolveRuntimePath(relativePath);
  await mkdir(resolve(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf8");

  return {
    responseJson: {
      path: relativePath,
      title,
    },
    text: `Created "${title}" — saved to ${relativePath}.`,
  };
}

async function executeDownloadUrl(requestJson: Record<string, unknown>) {
  const url = typeof requestJson.url === "string" ? requestJson.url.trim() : "";
  if (!url) {
    throw new Error("Download URL is required.");
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("Downloaded file exceeded the safe size limit.");
  }

  const customPath =
    typeof requestJson.path === "string" && requestJson.path.trim()
      ? requestJson.path.trim()
      : null;
  const fallbackName = basename(new URL(url).pathname) || `download-${Date.now()}`;
  const filename = sanitizeFileNamePart(customPath ? basename(customPath) : fallbackName);
  const relativePath = customPath ?? `${DOWNLOADS_DIR}/${filename}`;
  const targetPath = resolveWorkspacePath(relativePath);
  await mkdir(resolve(targetPath, ".."), { recursive: true });
  await writeFile(targetPath, bytes);

  return {
    responseJson: {
      bytes: bytes.byteLength,
      path: relativePath,
      url,
    },
    text: `Downloaded ${url} to ${relativePath}.`,
  };
}

function allowedShellCommand(command: string) {
  const normalized = command.trim();
  const allowedPatterns = [
    /^git status$/i,
    /^git diff --stat$/i,
    /^git log --oneline(?:\s+-\d+)?$/i,
    /^git branch(?:\s+--list)?$/i,
    /^git remote -v$/i,
    /^npm run (build|typecheck|lint|test)$/i,
    /^npm ls(?:\s+--depth=\d+)?$/i,
    /^node --version$/i,
    /^Get-ChildItem(?:\s|$)/i,
    /^Get-Content(?:\s|$)/i,
    /^dir(?:\s|$)/i,
    /^ls(?:\s+-[a-zA-Z]+)?(?:\s+[^;|&<>]+)?$/i,
    /^cat\s+[^;|&<>]+$/i,
    /^pwd$/i,
    /^echo\s+[^;|&<>]+$/i,
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
      cwd: repoRoot,
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
    text: `\`${command}\` output:\n\n${(output.stdout || output.stderr || "No output.").slice(0, 1200)}`,
  };
}

async function executeTaskList(dbClient: DbClient, userId: string, requestJson: Record<string, unknown>) {
  const status =
    requestJson.status === "done" || requestJson.status === "all" ? requestJson.status : "open";
  const limit =
    typeof requestJson.limit === "number" && Number.isFinite(requestJson.limit)
      ? Math.max(1, Math.min(20, Math.round(requestJson.limit)))
      : 12;

  const records = await dbClient.db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [asc(tasks.reminderAt), asc(tasks.dueAt), desc(tasks.updatedAt)],
    limit,
  });

  const filtered = records.filter((task) =>
    status === "all"
      ? true
      : status === "done"
        ? task.status === "done"
        : task.status === "open" || task.status === "in_progress",
  );

  return {
    responseJson: {
      status,
      tasks: filtered.map((task) => ({
        dueAt: task.dueAt?.toISOString() ?? null,
        id: task.id,
        reminderAt: task.reminderAt?.toISOString() ?? null,
        status: task.status,
        title: task.title,
      })),
    },
    text:
      filtered.length === 0
        ? status === "done"
          ? "No completed tasks yet."
          : "No open tasks right now."
        : `${filtered.length} task${filtered.length === 1 ? "" : "s"}: ${filtered
            .map((task) => {
              const timing = task.reminderAt
                ? `reminder ${task.reminderAt.toLocaleString()}`
                : task.dueAt
                  ? `due ${task.dueAt.toLocaleString()}`
                  : task.status;
              return `${task.title} (${timing})`;
            })
            .join("; ")}`,
  };
}

async function executeTaskCreate(
  dbClient: DbClient,
  userId: string,
  requestJson: Record<string, unknown>,
  context: { channel: RuntimeChatRequest["channel"]; telegramChatId?: string | null },
) {
  const title = typeof requestJson.title === "string" ? requestJson.title.trim() : "";
  if (!title) {
    throw new Error("Task title is required.");
  }

  const recentTasks = await dbClient.db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [desc(tasks.updatedAt)],
    limit: 40,
  });
  const existing = recentTasks.find(
    (task) =>
      normalizeTaskTitle(task.title) === normalizeTaskTitle(title) &&
      (task.status === "open" || task.status === "in_progress"),
  );

  if (existing) {
    return {
      responseJson: {
        existing: true,
        taskId: existing.id,
        title: existing.title,
      },
      text: `"${existing.title}" is already on your list — I left it as is.`,
    };
  }

  const taskId = createMessageId();
  const detail =
    typeof requestJson.detail === "string" && requestJson.detail.trim()
      ? requestJson.detail.trim()
      : "Created from an explicit secretary task request.";
  const dueAt =
    typeof requestJson.dueAt === "string" && requestJson.dueAt
      ? new Date(requestJson.dueAt)
      : null;
  const reminderAt =
    typeof requestJson.reminderAt === "string" && requestJson.reminderAt
      ? new Date(requestJson.reminderAt)
      : null;
  const deliveryChannelType =
    typeof requestJson.deliveryChannelType === "string" && requestJson.deliveryChannelType.trim()
      ? requestJson.deliveryChannelType.trim()
      : context.channel === "telegram" && context.telegramChatId
        ? "telegram"
        : null;
  const deliveryTargetRef =
    typeof requestJson.deliveryTargetRef === "string" && requestJson.deliveryTargetRef.trim()
      ? requestJson.deliveryTargetRef.trim()
      : context.channel === "telegram" && context.telegramChatId
        ? context.telegramChatId
        : null;

  await dbClient.db.insert(tasks).values({
    id: taskId,
    userId,
    conversationId: null,
    title,
    detail,
    status: "open",
    dueAt,
    reminderAt,
    deliveryChannelType,
    deliveryTargetRef,
    sourceKind: "tool",
    sourceRef: "task_create",
  });

  const taskDraft = {
    title,
    dueAt,
    reminderAt,
  };

  return {
    responseJson: {
      dueAt: dueAt?.toISOString() ?? null,
      deliveryChannelType,
      deliveryTargetRef,
      reminderAt: reminderAt?.toISOString() ?? null,
      taskId,
      title,
    },
    text: summarizeTaskSchedule(taskDraft),
  };
}

async function findTaskByReference(dbClient: DbClient, userId: string, reference: string) {
  const exact = await dbClient.db.query.tasks.findFirst({
    where: eq(tasks.id, reference),
  });

  if (exact && exact.userId === userId) {
    return exact;
  }

  const recent = await dbClient.db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [desc(tasks.updatedAt)],
    limit: 25,
  });

  const normalizedReference = normalizeTaskTitle(reference);
  return (
    recent.find((task) => normalizeTaskTitle(task.title) === normalizedReference) ??
    recent.find((task) => normalizeTaskTitle(task.title).includes(normalizedReference)) ??
    null
  );
}

async function executeTaskUpdate(
  dbClient: DbClient,
  userId: string,
  requestJson: Record<string, unknown>,
) {
  const reference = typeof requestJson.reference === "string" ? requestJson.reference.trim() : "";
  if (!reference) {
    throw new Error("Task reference is required.");
  }

  const task = await findTaskByReference(dbClient, userId, reference);
  if (!task) {
    throw new Error(`No matching task was found for "${reference}".`);
  }

  const nextStatus =
    typeof requestJson.status === "string" && requestJson.status.trim()
      ? requestJson.status.trim()
      : task.status;
  const dueAt =
    typeof requestJson.dueAt === "string" && requestJson.dueAt ? new Date(requestJson.dueAt) : task.dueAt;
  const reminderAt =
    typeof requestJson.reminderAt === "string" && requestJson.reminderAt
      ? new Date(requestJson.reminderAt)
      : task.reminderAt;
  const detail =
    typeof requestJson.detail === "string" && requestJson.detail.trim()
      ? requestJson.detail.trim()
      : task.detail;

  await dbClient.db
    .update(tasks)
    .set({
      detail,
      dueAt,
      reminderAt,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  return {
    responseJson: {
      dueAt: dueAt?.toISOString() ?? null,
      reminderAt: reminderAt?.toISOString() ?? null,
      status: nextStatus,
      taskId: task.id,
      title: task.title,
    },
    text:
      nextStatus === "done"
        ? `I marked "${task.title}" as done.`
        : `I updated "${task.title}"${reminderAt ? ` and set its reminder to ${reminderAt.toLocaleString()}` : dueAt ? ` and set it due ${dueAt.toLocaleString()}` : ""}.`,
  };
}

async function findMemoryByReference(dbClient: DbClient, reference: string) {
  const exact = await dbClient.db.query.memoryEntries.findFirst({
    where: eq(memoryEntries.id, reference),
  });

  if (exact) {
    return exact;
  }

  const recent = await dbClient.db.query.memoryEntries.findMany({
    orderBy: [desc(memoryEntries.updatedAt)],
    limit: 30,
  });
  const normalizedReference = reference.toLowerCase();
  return (
    recent.find((memory) => (memory.title ?? "").toLowerCase() === normalizedReference) ??
    recent.find((memory) => memory.contentText.toLowerCase().includes(normalizedReference)) ??
    null
  );
}

async function executeMemoryWrite(
  dbClient: DbClient,
  requestJson: Record<string, unknown>,
) {
  const operation =
    typeof requestJson.operation === "string" ? requestJson.operation.trim() : "";

  if (operation === "create") {
    const contentText =
      typeof requestJson.contentText === "string" ? requestJson.contentText.trim() : "";
    if (!contentText) {
      throw new Error("Memory content is required.");
    }

    const memoryId = createMessageId();
    const title =
      typeof requestJson.title === "string" && requestJson.title.trim()
        ? requestJson.title.trim()
        : contentText.slice(0, 60);

    await dbClient.db.insert(memoryEntries).values({
      id: memoryId,
      memoryType: "semantic",
      title,
      summary: shortSnippet(contentText, 120),
      contentText,
      contentJson: {},
      tags: ["explicit"],
      sourceKind: "tool",
      sourceRef: "memory_write",
      importanceScore: 70,
      confidenceScore: 90,
      pinned: false,
      suppressed: false,
    });

    return {
      responseJson: {
        memoryId,
        operation,
        title,
      },
      text: `Remembered: "${title}"`,
    };
  }

  const reference = typeof requestJson.reference === "string" ? requestJson.reference.trim() : "";
  if (!reference) {
    throw new Error("Memory reference is required.");
  }

  const memory = await findMemoryByReference(dbClient, reference);
  if (!memory) {
    throw new Error(`No matching memory was found for "${reference}".`);
  }

  await dbClient.db
    .update(memoryEntries)
    .set({
      pinned: operation === "pin" ? true : memory.pinned,
      suppressed:
        operation === "suppress" ? true : operation === "unsuppress" ? false : memory.suppressed,
      updatedAt: new Date(),
    })
    .where(eq(memoryEntries.id, memory.id));

  return {
    responseJson: {
      memoryId: memory.id,
      operation,
      title: memory.title ?? null,
    },
    text:
      operation === "pin"
        ? `Pinned "${memory.title ?? memory.id}".`
        : operation === "suppress"
          ? `Removed "${memory.title ?? memory.id}" from active memory.`
          : `Restored "${memory.title ?? memory.id}".`,
  };
}

async function executeTelegramSend(config: AppConfig, requestJson: Record<string, unknown>) {
  const message = typeof requestJson.message === "string" ? requestJson.message.trim() : "";
  const chatId =
    typeof requestJson.chatId === "string" && requestJson.chatId.trim()
      ? requestJson.chatId.trim()
      : config.telegram.defaultChatId;

  if (!config.telegram.botToken) {
    throw new Error("Telegram bot token is not configured.");
  }

  if (!chatId) {
    throw new Error("No Telegram chat id is configured for proactive sends.");
  }

  if (!message) {
    throw new Error("Telegram message content is required.");
  }

  const client = createTelegramClient({
    apiBaseUrl: config.telegram.apiBaseUrl,
    botToken: config.telegram.botToken,
  });
  const sentMessageIds = await client.sendMessageChunks(chatId, message);

  return {
    responseJson: {
      chatId,
      message,
      sentMessageIds,
    },
    text: `Sent to Telegram.`,
  };
}

async function executeBrowserOpen(requestJson: Record<string, unknown>) {
  const target = typeof requestJson.target === "string" ? requestJson.target.trim() : "";
  if (!target) {
    throw new Error("Browser target is required.");
  }

  const targetDir = await ensureRuntimeGeneratedPath(BROWSER_TARGETS_DIR);
  const createdAt = new Date().toISOString();
  const note = typeof requestJson.note === "string" ? requestJson.note.trim() : "";
  const fileName = `${Date.now()}-${sanitizeFileNamePart(new URL(target).hostname)}.md`;
  const relativePath = `${BROWSER_TARGETS_DIR}/${fileName}`;
  const content = [
    `# Browser follow-up`,
    "",
    `Target: ${target}`,
    `Created: ${createdAt}`,
    note ? `Next action: ${note}` : "Next action: Review this page and continue the follow-up from the Activity history.",
    "",
    "This target was saved by the secretary for follow-through.",
  ].join("\n");

  await writeFile(resolve(targetDir, fileName), content, "utf8");

  return {
    responseJson: {
      createdAt,
      path: relativePath,
      target,
    },
    text: `Saved ${target} to ${relativePath}.`,
  };
}

async function executeCalendarCreate(requestJson: Record<string, unknown>) {
  const title = typeof requestJson.title === "string" ? requestJson.title.trim() : "";
  const startAt = typeof requestJson.startAt === "string" ? new Date(requestJson.startAt) : null;
  const durationMinutes =
    typeof requestJson.durationMinutes === "number" && Number.isFinite(requestJson.durationMinutes)
      ? Math.max(15, Math.round(requestJson.durationMinutes))
      : 60;
  const detail = typeof requestJson.detail === "string" ? requestJson.detail.trim() : "";

  if (!title || !startAt || Number.isNaN(startAt.getTime())) {
    throw new Error("Calendar event title and start time are required.");
  }

  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const targetDir = await ensureRuntimeGeneratedPath(CALENDAR_EXPORTS_DIR);
  const fileName = `${Date.now()}-${sanitizeFileNamePart(title)}.ics`;
  const relativePath = `${CALENDAR_EXPORTS_DIR}/${fileName}`;
  const formatIcsDate = (value: Date) =>
    value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Secretary//Light Work//EN",
    "BEGIN:VEVENT",
    `UID:${createMessageId()}@secretary.local`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startAt)}`,
    `DTEND:${formatIcsDate(endAt)}`,
    `SUMMARY:${title.replace(/[\\,;]/g, "")}`,
    detail ? `DESCRIPTION:${detail.replace(/\n/g, "\\n").replace(/[\\,;]/g, "")}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  await writeFile(resolve(targetDir, fileName), content, "utf8");

  return {
    responseJson: {
      durationMinutes,
      endAt: endAt.toISOString(),
      path: relativePath,
      startAt: startAt.toISOString(),
      title,
    },
    text: `Drafted "${title}" for ${startAt.toLocaleString()} (${durationMinutes} mins) — saved to ${relativePath}.`,
  };
}

async function executeEmailDraft(requestJson: Record<string, unknown>) {
  const to = typeof requestJson.to === "string" ? requestJson.to.trim() : "";
  const subject = typeof requestJson.subject === "string" ? requestJson.subject.trim() : "";
  const body = typeof requestJson.body === "string" ? requestJson.body.trim() : "";

  if (!to || !subject) {
    throw new Error("Email drafts need a recipient and subject.");
  }

  const targetDir = await ensureRuntimeGeneratedPath(EMAIL_DRAFTS_DIR);
  const fileName = `${Date.now()}-${sanitizeFileNamePart(to)}-${sanitizeFileNamePart(subject)}.md`;
  const relativePath = `${EMAIL_DRAFTS_DIR}/${fileName}`;
  const draftBody =
    body ||
    `Hi ${to},\n\n${subject}\n\nBest,\n${defaultSecretaryName}`;
  const content = [
    `# Email Draft`,
    "",
    `To: ${to}`,
    `Subject: ${subject}`,
    `Created: ${new Date().toISOString()}`,
    "",
    draftBody,
    "",
    "_Drafted by the secretary for review before sending._",
  ].join("\n");

  await writeFile(resolve(targetDir, fileName), content, "utf8");

  return {
    responseJson: {
      path: relativePath,
      subject,
      to,
    },
    text: `Drafted email to ${to} — saved to ${relativePath}.`,
  };
}

async function executeEmailSend(
  config: AppConfig,
  dbClient: DbClient,
  requestJson: Record<string, unknown>,
) {
  const to = typeof requestJson.to === "string" ? requestJson.to.trim() : "";
  const subject = typeof requestJson.subject === "string" ? requestJson.subject.trim() : "";
  const body = typeof requestJson.body === "string" ? requestJson.body.trim() : "";

  if (!to || !subject) {
    throw new Error("Email sends need a recipient and subject.");
  }

  const result = await sendConfiguredEmail({
    config,
    dbClient,
    recipient: to,
    subject,
    text: body || subject,
  });

  return {
    responseJson: {
      messageId: result.messageId,
      subject,
      to: result.recipient,
    },
    text: `Email sent to ${result.recipient}.`,
  };
}

async function resolveTaskExecutionContext(
  dbClient: DbClient,
  conversationId: string | null | undefined,
) {
  if (!conversationId) {
    return {
      channel: "web" as const,
      telegramChatId: null,
    };
  }

  const conversation = await dbClient.db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  return {
    channel: conversation?.channelType === "telegram" ? ("telegram" as const) : ("web" as const),
    telegramChatId: conversation?.channelType === "telegram" ? conversation.channelRef : null,
  };
}

async function executeToolRequest(params: {
  config: AppConfig;
  conversationId?: string | null;
  dbClient: DbClient;
  requestJson: Record<string, unknown>;
  requestedBy: string;
  toolKey: string;
}) {
  switch (params.toolKey) {
    case "web_search":
      return executeWebSearch(params.config, String(params.requestJson.query ?? ""));
    case "crawl4ai_light":
      return executeCrawl4aiLight(params.config, String(params.requestJson.url ?? ""));
    case "crawl4ai_deep":
      return executeCrawl4aiDeep(params.config, String(params.requestJson.url ?? ""));
    case "crawl4ai_variable":
      return executeCrawl4aiVariable(
        params.config,
        String(params.requestJson.url ?? ""),
        (params.requestJson.options && typeof params.requestJson.options === "object") ? params.requestJson.options as Record<string, unknown> : {}
      );
    case "file_read":
      return executeFileRead(String(params.requestJson.path ?? ""));
    case "file_write":
      return executeFileWrite(
        String(params.requestJson.path ?? ""),
        String(params.requestJson.content ?? ""),
      );
    case "document_create":
      return executeDocumentCreate(params.requestJson);
    case "download_url":
      return executeDownloadUrl(params.requestJson);
    case "shell_command":
      return executeShellCommand(String(params.requestJson.command ?? ""));
    case "task_create":
      return executeTaskCreate(
        params.dbClient,
        params.requestedBy,
        params.requestJson,
        await resolveTaskExecutionContext(params.dbClient, params.conversationId),
      );
    case "task_list":
      return executeTaskList(params.dbClient, params.requestedBy, params.requestJson);
    case "task_update":
      return executeTaskUpdate(params.dbClient, params.requestedBy, params.requestJson);
    case "memory_write":
      return executeMemoryWrite(params.dbClient, params.requestJson);
    case "telegram_send":
      return executeTelegramSend(params.config, params.requestJson);
    case "browser_open":
      return executeBrowserOpen(params.requestJson);
    case "calendar_create":
      return executeCalendarCreate(params.requestJson);
    case "email_draft":
      return executeEmailDraft(params.requestJson);
    case "email_send":
      return executeEmailSend(params.config, params.dbClient, params.requestJson);
    case "memory_read": {
      const query = String(params.requestJson.query ?? "");
      if (!query) {
        throw new Error("Memory search query is required.");
      }
      const results = await retrieveRelevantMemories(params.dbClient, query);
      const lines = results.map((m) => {
        const body = m.summary || m.contentText || "";
        return m.title ? `[${m.title}] ${body}` : body;
      });
      return {
        responseJson: { query, count: results.length, results },
        text:
          lines.length > 0
            ? `${lines.join(" | ")}`
            : `I don't remember anything about "${query}" yet.`,
      };
    }
    case "note_to_self": {
      const contentText = String(params.requestJson.contentText ?? "").trim();
      if (!contentText) {
        throw new Error("Note content is required.");
      }
      const title = String(params.requestJson.title ?? contentText.slice(0, 60)).trim();
      const memoryId = createMessageId();
      await params.dbClient.db.insert(memoryEntries).values({
        id: memoryId,
        memoryType: "semantic",
        title,
        summary: contentText.slice(0, 140),
        contentText,
        contentJson: { source: "note_to_self" },
        tags: ["note", "proactive"],
        sourceKind: "tool",
        sourceRef: "note_to_self",
        importanceScore: 68,
        confidenceScore: 85,
        pinned: false,
        suppressed: false,
      });
      return {
        responseJson: { memoryId, title },
        text: `Noted: "${title}"`,
      };
    }
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
  config: AppConfig;
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

    const executionStartedAt = performance.now();
    try {
      const result = await executeToolRequest({
        config: params.config,
        conversationId: envelope.conversationId,
        dbClient: params.dbClient,
        requestJson: intent.requestJson,
        requestedBy: envelope.userId,
        toolKey: tool.key,
      });

      logToolExecution({
        toolKey: tool.key,
        durationMs: Math.round(performance.now() - executionStartedAt),
        success: true,
        resultCount: result.responseJson ? 1 : 0,
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logToolExecution({
        toolKey: tool.key,
        durationMs: Math.round(performance.now() - executionStartedAt),
        success: false,
        error: errorMessage,
      });

      await params.dbClient.db
        .update(toolExecutions)
        .set({
          executionStatus: "failed",
          responseJson: null,
          errorText: errorMessage,
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
          error: errorMessage,
          toolKey: tool.key,
        },
        traceId: params.traceId,
      });

      outputText = `${tool.name} failed safely. ${errorMessage}`;
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
  config: AppConfig;
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
      text: `${tool.name} was cancelled.`,
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
      config: params.config,
      conversationId: execution.conversationId,
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
      text: `${tool.name} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });

    return {
      assistantMessage,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(failedExecution ?? execution, tool),
    };
  }
}
