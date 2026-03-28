import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskDraft, normalizeTaskTitle, parseReminderTime } from "./task-runtime.js";

test("buildTaskDraft extracts reminder timing and trims title", () => {
  const now = new Date("2026-03-27T09:00:00.000Z");
  const draft = buildTaskDraft({
    text: "follow up with the electrician tomorrow at 4 pm",
    fallbackDetail: "Created from a test.",
    now,
  });

  assert.equal(draft.title, "Follow Up With The Electrician");
  assert.equal(draft.detail, "Created from a test.");
  assert.ok(draft.reminderAt instanceof Date);
  assert.equal(draft.reminderAt?.toISOString(), "2026-03-28T21:00:00.000Z");
  assert.equal(draft.dueAt?.toISOString(), "2026-03-28T21:00:00.000Z");
});

test("buildTaskDraft assigns telegram delivery when the request came from telegram", () => {
  const draft = buildTaskDraft({
    text: "pick up milk",
    channel: "telegram",
    telegramChatId: "12345",
  });

  assert.equal(draft.deliveryChannelType, "telegram");
  assert.equal(draft.deliveryTargetRef, "12345");
});

test("buildTaskDraft extracts explicit delivery preferences from the request text", () => {
  const draft = buildTaskDraft({
    text: "text me to review the launch checklist tomorrow at 9am",
    now: new Date("2026-03-27T16:00:00.000Z"),
  });

  assert.equal(draft.title, "Review The Launch Checklist");
  assert.equal(draft.deliveryChannelType, "sms");
  assert.equal(draft.deliveryTargetRef, null);
});

test("parseReminderTime supports relative timings", () => {
  const now = new Date("2026-03-27T09:00:00.000Z");
  const inHours = parseReminderTime("in 2 hours", now);

  assert.equal(inHours?.toISOString(), "2026-03-27T11:00:00.000Z");
});

test("normalizeTaskTitle collapses punctuation and spacing for dedupe", () => {
  assert.equal(normalizeTaskTitle("Buy   milk!!!"), "buy milk");
});
