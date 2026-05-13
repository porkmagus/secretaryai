import assert from "node:assert/strict";
import test from "node:test";

const TASK_INTENT_REGEX =
  /\b(task|tasks|todo|to-do|remind|reminder|schedule|scheduled|due|deadline|checklist|meeting|time|when|what do i have)\b/i;

test("TASK_INTENT_REGEX matches various task-oriented phrases", () => {
  const matches = [
    "what are my tasks",
    "show my todo list",
    "remind me to call mom",
    "what is on my schedule",
    "when is my next meeting",
    "what do i have to do today",
    "check my checklist",
    "any deadline today?",
    "to-do items",
    "scheduled events",
  ];

  for (const phrase of matches) {
    assert.ok(TASK_INTENT_REGEX.test(phrase), `Should match: "${phrase}"`);
  }
});

test("TASK_INTENT_REGEX does not match non-task phrases", () => {
  const nonMatches = ["hello how are you", "tell me a joke", "what is the weather", "i like cats"];

  for (const phrase of nonMatches) {
    assert.ok(!TASK_INTENT_REGEX.test(phrase), `Should not match: "${phrase}"`);
  }
});
