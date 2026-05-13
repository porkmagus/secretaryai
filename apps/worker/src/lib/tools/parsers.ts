import { buildTaskDraft, parseReminderTime } from "../task-runtime.js";
import { cleanText as cleanTaskText } from "../utils.js";
import type { ToolIntent } from "./types.js";
import { shortSnippet } from "./utils.js";

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

  const status = /\b(done|completed|finished)\b/i.test(text)
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
  const match = text.match(
    /\b(?:search (?:the )?web for|look up|find latest on|latest on|google)\s+(.+)/i,
  );
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
  const hasScrapeIntent =
    /\b(?:scrape|extract content from|get content of|fetch page|pull content from|read this page|summarize this)\b/i.test(
      text,
    );
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
    text
      .match(/\b(?:write|save|update)\s+(?:a\s+)?file\s+([^\s]+)\s+(?:with|to)\b/i)?.[1]
      ?.trim() ??
    null;

  if (!path || !/\b(?:write|save|update)\b/i.test(text)) {
    return null;
  }

  const contentMatch =
    text.match(/\b(?:with|to)\s+content\s*:\s*(.+)$/i) ?? text.match(/\b(?:with|to)\s+(.+)$/i);
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
    text.match(
      /\b(?:create|draft|write|make)\s+(?:a\s+)?(?:document|note|report|brief|checklist)\s+(?:called|named|titled)\s+["`]?([^"`]+)["`]?/i,
    ) ??
    text.match(
      /\b(?:create|draft|write|make)\s+(?:a\s+)?(?:document|note|report|brief|checklist)\b[:\s-]+(.+)$/i,
    );

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
    text.match(/\bremember(?: this)?[:\s]+(.+)$/i) ?? text.match(/\bstore in memory[:\s]+(.+)$/i);

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
    text.match(
      /\b(?:draft|write|compose|create)\s+(?:an?\s+)?email\s+to\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i,
    ) ??
    text.match(
      /\bemail\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i,
    );

  if (!match?.[1]) {
    return null;
  }

  const to = cleanTaskText(match[1]).replace(/[.?!]+$/, "");
  const subject = cleanTaskText(match[2] ?? "").replace(/[.?!]+$/, "");
  const body = cleanTaskText(match[3] ?? "").replace(/[.?!]+$/, "");

  if (!to || (!subject && !body)) {
    return null;
  }

  const shortSnippet = (t: string, max = 48) =>
    t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;

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
    text.match(
      /\b(?:send)\s+(?:an?\s+)?email\s+to\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i,
    ) ??
    text.match(
      /\bsend\s+email\s+(.+?)(?:\s+(?:about|regarding|subject)\s+(.+?))?(?:\s+(?:saying|that|with body)\s+(.+))?$/i,
    );

  if (!match?.[1]) {
    return null;
  }

  const to = cleanTaskText(match[1]).replace(/[.?!]+$/, "");
  const subject = cleanTaskText(match[2] ?? "").replace(/[.?!]+$/, "");
  const body = cleanTaskText(match[3] ?? "").replace(/[.?!]+$/, "");

  if (!to || (!subject && !body)) {
    return null;
  }

  const shortSnippet = (t: string, max = 48) =>
    t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;

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
    text.match(
      /\b(?:schedule|add|create|draft)\s+(?:an?\s+)?(?:calendar event|event|meeting)\s+(?:for\s+)?(.+)$/i,
    ) ?? text.match(/\bput\s+(.+)\s+on\s+(?:my\s+)?calendar\b/i);

  if (!match?.[1]) {
    return null;
  }

  const raw = cleanTaskText(match[1]).replace(/[.?!]+$/, "");
  const startAt = parseReminderTime(raw);
  const title = cleanTaskText(
    raw
      .replace(
        /\b(?:tomorrow|today|in\s+\d+\s+(?:minutes?|hours?)|at\s+\d+(?::\d{2})?\s*(?:am|pm)?|for\s+\d+\s+(?:minutes?|hours?))\b/gi,
        "",
      )
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

  const hasMemoryPhrase = memoryPhrases.some((pattern) => pattern.test(text));
  if (!hasMemoryPhrase) {
    return null;
  }

  // Extract the query - look for what comes after the trigger phrase
  const queryMatch =
    text.match(
      /\b(?:do you remember|recall|what do you know about|what do you have on|search(?:\s+your)?\s+memory\s+for|check(?:\s+your)?\s+memory\s+for|look(?:\s+in)?(?:\s+your)?\s+memory\s+for)\s+(.+)/i,
    ) ?? text.match(/\b(?:about|regarding|on)\s+(.+)/i);

  // If no specific query found, use the whole text minus common prefixes
  const query =
    queryMatch?.[1]?.trim().replace(/[.?!]+$/, "") ??
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

export function detectToolIntent(text: string): ToolIntent | null {
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
