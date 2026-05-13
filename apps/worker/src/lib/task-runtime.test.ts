import assert from "node:assert/strict";
import test from "node:test";
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

test("normalizeTaskTitle removes all non-alphanumeric characters except spaces", () => {
  assert.equal(normalizeTaskTitle("Call @Dr. Smith #ASAP!!!"), "call dr smith asap");
  assert.equal(normalizeTaskTitle("Buy milk, eggs & bread"), "buy milk eggs bread");
  assert.equal(normalizeTaskTitle("Email: boss@corp.com"), "email bosscorpcom");
});

test("normalizeTaskTitle trims and collapses whitespace", () => {
  assert.equal(normalizeTaskTitle("  too   much   space  "), "too much space");
  assert.equal(normalizeTaskTitle("\t\tTabs and\n newlines  "), "tabs and newlines");
});

test("normalizeTaskTitle lowercases everything", () => {
  assert.equal(normalizeTaskTitle("IMPORTANT TASK"), "important task");
  assert.equal(normalizeTaskTitle("MiXeD CaSe TeXt"), "mixed case text");
});

test("normalizeTaskTitle handles edge cases", () => {
  assert.equal(normalizeTaskTitle(""), "");
  assert.equal(normalizeTaskTitle("...!!!"), "");
  assert.equal(normalizeTaskTitle("!!remind!!"), "remind");
  assert.equal(normalizeTaskTitle("12345"), "12345");
  assert.equal(normalizeTaskTitle("task #42 v2.0"), "task 42 v20");
});

test("parseReminderTime returns null when no timing is found", () => {
  const now = new Date("2026-01-15T10:00:00.000Z");
  assert.equal(parseReminderTime("remind me to buy milk", now), null);
  assert.equal(parseReminderTime("no timing here", now), null);
  assert.equal(parseReminderTime("at noon", now), null);
});

test("parseReminderTime supports in N minutes", () => {
  const now = new Date("2026-01-15T10:00:00.000Z");
  assert.equal(parseReminderTime("in 1 minute", now)?.toISOString(), "2026-01-15T10:01:00.000Z");
  assert.equal(parseReminderTime("in 5 minutes", now)?.toISOString(), "2026-01-15T10:05:00.000Z");
  assert.equal(parseReminderTime("in 90 minutes", now)?.toISOString(), "2026-01-15T11:30:00.000Z");
});

test("parseReminderTime supports in N hours", () => {
  const now = new Date("2026-01-15T10:00:00.000Z");
  assert.equal(parseReminderTime("in 1 hour", now)?.toISOString(), "2026-01-15T11:00:00.000Z");
  assert.equal(parseReminderTime("in 3 hours", now)?.toISOString(), "2026-01-15T13:00:00.000Z");
  assert.equal(parseReminderTime("in 24 hours", now)?.toISOString(), "2026-01-16T10:00:00.000Z");
});

test("parseReminderTime defaults to 9am for plain tomorrow", () => {
  const now = new Date(2026, 2, 27, 11, 0, 0);
  const result = parseReminderTime("remind me tomorrow", now);
  assert.ok(result);
  assert.equal(result.getDate(), 28);
  assert.equal(result.getHours(), 9);
  assert.equal(result.getMinutes(), 0);
  assert.equal(result.getSeconds(), 0);
});

test("parseReminderTime handles tomorrow with time", () => {
  const now = new Date(2026, 2, 27, 11, 0, 0);

  const r1 = parseReminderTime("tomorrow at 4pm", now);
  assert.equal(r1?.getDate(), 28);
  assert.equal(r1?.getHours(), 16);
  assert.equal(r1?.getMinutes(), 0);

  const r2 = parseReminderTime("tomorrow at 2:30 pm", now);
  assert.equal(r2?.getDate(), 28);
  assert.equal(r2?.getHours(), 14);
  assert.equal(r2?.getMinutes(), 30);

  const r3 = parseReminderTime("tomorrow at 9am", now);
  assert.equal(r3?.getDate(), 28);
  assert.equal(r3?.getHours(), 9);
  assert.equal(r3?.getMinutes(), 0);
});

test("parseReminderTime handles 12am and 12pm edge cases", () => {
  const now = new Date(2026, 0, 15, 10, 0, 0);

  const rAm = parseReminderTime("tomorrow at 12am", now);
  assert.equal(rAm?.getDate(), 16);
  assert.equal(rAm?.getHours(), 0);

  const rPm = parseReminderTime("tomorrow at 12pm", now);
  assert.equal(rPm?.getDate(), 16);
  assert.equal(rPm?.getHours(), 12);
});

test("parseReminderTime handles today at time with am/pm", () => {
  const now = new Date(2026, 0, 15, 10, 0, 0);
  const result = parseReminderTime("at 3pm", now);
  assert.ok(result);
  assert.equal(result.getDate(), 15);
  assert.equal(result.getHours(), 15);
});

test("parseReminderTime rolls to next day when today time has passed", () => {
  const now = new Date(2026, 0, 15, 16, 0, 0);
  const result = parseReminderTime("at 3pm", now);
  assert.ok(result);
  assert.equal(result.getDate(), 16);
  assert.equal(result.getHours(), 15);
});

test("parseReminderTime handles today with minutes", () => {
  const now = new Date(2026, 2, 27, 10, 0, 0);

  const r1 = parseReminderTime("at 4:45 pm", now);
  assert.equal(r1?.getHours(), 16);
  assert.equal(r1?.getMinutes(), 45);

  const r2 = parseReminderTime("at 8:00 am", now);
  assert.equal(r2?.getHours(), 8);
  assert.equal(r2?.getMinutes(), 0);
  assert.equal(r2?.getDate(), 28); // 8am already passed since now is 10am
});

test("buildTaskDraft sets null reminder when no timing is specified", () => {
  const draft = buildTaskDraft({ text: "pick up dry cleaning" });
  assert.equal(draft.title, "Pick Up Dry Cleaning");
  assert.equal(draft.reminderAt, null);
  assert.equal(draft.dueAt, null);
});

test("buildTaskDraft strips trailing sentence punctuation from raw text", () => {
  const draft = buildTaskDraft({ text: "call mom!" });
  assert.equal(draft.title, "Call Mom");

  const draft2 = buildTaskDraft({ text: "finish the report?" });
  assert.equal(draft2.title, "Finish The Report");

  const draft3 = buildTaskDraft({ text: "submit taxes!!!" });
  assert.equal(draft3.title, "Submit Taxes");
});

test("buildTaskDraft truncates title to 120 characters", () => {
  const longText = "a".repeat(200);
  const draft = buildTaskDraft({ text: longText });
  assert.equal(draft.title.length, 120);
});

test("buildTaskDraft uses fallbackDetail when provided", () => {
  const draft = buildTaskDraft({
    text: "buy groceries",
    fallbackDetail: "Weekly shopping list",
  });
  assert.equal(draft.detail, "Weekly shopping list");
});

test("buildTaskDraft sets detail to null when fallbackDetail is omitted", () => {
  const draft = buildTaskDraft({ text: "water the plants" });
  assert.equal(draft.detail, null);
});

test("buildTaskDraft detects sms delivery preference", () => {
  const draft = buildTaskDraft({ text: "text me to call the plumber" });
  assert.equal(draft.deliveryChannelType, "sms");
  assert.equal(draft.deliveryTargetRef, null);
  assert.equal(draft.title, "Call The Plumber");
});

test("buildTaskDraft detects email delivery preference", () => {
  const draft = buildTaskDraft({ text: "email me about the meeting notes" });
  assert.equal(draft.deliveryChannelType, "email");
  assert.equal(draft.title, "About The Meeting Notes");
});

test("buildTaskDraft detects discord delivery preference", () => {
  const draft = buildTaskDraft({ text: "send me on discord the raid schedule" });
  assert.equal(draft.deliveryChannelType, "discord");
  assert.equal(draft.title, "The Raid Schedule");
});

test("buildTaskDraft detects slack delivery preference", () => {
  const draft = buildTaskDraft({ text: "notify me via slack about the deploy" });
  assert.equal(draft.deliveryChannelType, "slack");
  assert.equal(draft.title, "About The Deploy");
});

test("buildTaskDraft detects telegram delivery preference from text with chat id", () => {
  const draft = buildTaskDraft({
    text: "send me on telegram the grocery list",
    telegramChatId: "987654",
  });
  assert.equal(draft.deliveryChannelType, "telegram");
  assert.equal(draft.deliveryTargetRef, "987654");
  assert.equal(draft.title, "The Grocery List");
});

test("buildTaskDraft falls back to telegram when channel is telegram even without text mention", () => {
  const draft = buildTaskDraft({
    text: "pick up milk",
    channel: "telegram",
    telegramChatId: "12345",
  });
  assert.equal(draft.deliveryChannelType, "telegram");
  assert.equal(draft.deliveryTargetRef, "12345");
});

test("buildTaskDraft prefers explicit delivery preference over channel fallback", () => {
  const draft = buildTaskDraft({
    text: "email me to review the invoice",
    channel: "telegram",
    telegramChatId: "12345",
  });
  assert.equal(draft.deliveryChannelType, "email");
  assert.equal(draft.deliveryTargetRef, "12345");
});

test("buildTaskDraft handles empty or whitespace-only text", () => {
  const draft = buildTaskDraft({ text: "   " });
  assert.equal(draft.title, "");
  assert.equal(draft.reminderAt, null);
});
