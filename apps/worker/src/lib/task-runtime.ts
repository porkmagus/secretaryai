import type { RuntimeChatRequest } from "@secretary/core-runtime";

export type TaskDraft = {
  title: string;
  detail: string | null;
  dueAt: Date | null;
  reminderAt: Date | null;
  deliveryChannelType: string | null;
  deliveryTargetRef: string | null;
};

export function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeHour(hour: number, meridiem?: string) {
  if (!meridiem) {
    return hour;
  }

  const normalized = meridiem.toLowerCase();

  if (normalized === "am") {
    return hour === 12 ? 0 : hour;
  }

  return hour === 12 ? 12 : hour + 12;
}

export function parseReminderTime(text: string, now = new Date()) {
  const inMinutesMatch = text.match(/\bin\s+(\d+)\s+minute(?:s)?\b/i);

  if (inMinutesMatch) {
    return new Date(now.getTime() + Number(inMinutesMatch[1]) * 60_000);
  }

  const inHoursMatch = text.match(/\bin\s+(\d+)\s+hour(?:s)?\b/i);

  if (inHoursMatch) {
    return new Date(now.getTime() + Number(inHoursMatch[1]) * 60 * 60_000);
  }

  const tomorrowMatch = text.match(
    /\btomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/i,
  );

  if (tomorrowMatch) {
    const reminderAt = new Date(now);
    reminderAt.setDate(reminderAt.getDate() + 1);
    reminderAt.setSeconds(0, 0);
    reminderAt.setHours(
      tomorrowMatch[1] ? normalizeHour(Number(tomorrowMatch[1]), tomorrowMatch[3]) : 9,
      tomorrowMatch[2] ? Number(tomorrowMatch[2]) : 0,
      0,
      0,
    );
    return reminderAt;
  }

  const todayTimeMatch = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  if (todayTimeMatch) {
    const reminderAt = new Date(now);
    reminderAt.setSeconds(0, 0);
    reminderAt.setHours(
      normalizeHour(Number(todayTimeMatch[1]), todayTimeMatch[3]),
      todayTimeMatch[2] ? Number(todayTimeMatch[2]) : 0,
      0,
      0,
    );

    if (reminderAt.getTime() <= now.getTime()) {
      reminderAt.setDate(reminderAt.getDate() + 1);
    }

    return reminderAt;
  }

  return null;
}

export function stripReminderTiming(text: string) {
  return cleanText(
    text
      .replace(/\bin\s+\d+\s+minute(?:s)?\b/i, "")
      .replace(/\bin\s+\d+\s+hour(?:s)?\b/i, "")
      .replace(/\btomorrow(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b/i, "")
      .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i, ""),
  );
}

export function normalizeTaskTitle(title: string) {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

export function buildTaskDraft(params: {
  text: string;
  channel?: RuntimeChatRequest["channel"];
  telegramChatId?: string | null;
  fallbackDetail?: string | null;
  now?: Date;
}) {
  const rawTaskText = cleanText(params.text).replace(/[.?!]+$/g, "");
  const reminderAt = parseReminderTime(rawTaskText, params.now);
  const taskText = stripReminderTiming(rawTaskText) || rawTaskText;

  return {
    title: titleCase(taskText).slice(0, 120),
    detail: params.fallbackDetail ?? null,
    dueAt: reminderAt,
    reminderAt,
    deliveryChannelType:
      params.channel === "telegram" && params.telegramChatId ? "telegram" : null,
    deliveryTargetRef:
      params.channel === "telegram" && params.telegramChatId ? params.telegramChatId : null,
  } satisfies TaskDraft;
}

export function summarizeTaskSchedule(task: {
  title: string;
  dueAt?: Date | null;
  reminderAt?: Date | null;
}) {
  if (task.reminderAt) {
    return `I created the task "${task.title}" and scheduled a reminder for ${task.reminderAt.toLocaleString()}.`;
  }

  if (task.dueAt) {
    return `I created the task "${task.title}" due ${task.dueAt.toLocaleString()}.`;
  }

  return `I created the task "${task.title}".`;
}
