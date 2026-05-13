import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectConversationDecision,
  extractWorkspacePathHint,
} from "./conversation-decisions.js";

/**
 * Test: detectConversationDecision
 */

test("detectConversationDecision: returns 'approve' for affirmative inputs", () => {
  const affirmatives = [
    "yes",
    "yep",
    "yeah",
    "sure",
    "okay",
    "ok",
    "absolutely",
    "definitely",
    "please do",
    "go ahead",
    "go for it",
    "do it",
    "sounds good",
    "works for me",
    "that works",
    "continue",
    "proceed",
    "start it",
    "run it",
    "allow it",
    "go ahead with it",
    "sounds good to me",
    "please continue",
    "yes, use this folder",
  ];

  for (const text of affirmatives) {
    const result = detectConversationDecision(text);
    assert.equal(result, "approve", `Expected "approve" for "${text}", got ${result}`);
  }
});

test("detectConversationDecision: returns 'deny' for negative inputs", () => {
  const negatives = [
    "no",
    "nope",
    "not now",
    "don't",
    "do not",
    "stop",
    "cancel",
    "never mind",
    "keep it here",
    "leave it",
    "hold off",
    "not yet",
    "block it",
    "keep this in chat",
    "leave it blocked",
    "don't start that",
    "not this time",
  ];

  for (const text of negatives) {
    const result = detectConversationDecision(text);
    assert.equal(result, "deny", `Expected "deny" for "${text}", got ${result}`);
  }
});

test("detectConversationDecision: returns 'help' when help pattern matches", () => {
  const helpPattern = /\bexplain\b/i;
  assert.equal(detectConversationDecision("explain that", helpPattern), "help");
  assert.equal(detectConversationDecision("can you explain it", helpPattern), "help");
});

test("detectConversationDecision: returns null for neutral inputs", () => {
  const neutrals = [
    "maybe",
    "hmm",
    "what do you mean",
    "tell me more",
    "i don't know",
    "let me think",
    "",
    "   ",
    "...",
  ];

  for (const text of neutrals) {
    const result = detectConversationDecision(text);
    assert.equal(result, null, `Expected null for "${text}", got ${result}`);
  }
});

test("detectConversationDecision: trims whitespace before matching", () => {
  assert.equal(detectConversationDecision("  yes  "), "approve");
  assert.equal(detectConversationDecision("  nope  "), "deny");
});

test("detectConversationDecision: handles empty or whitespace-only input", () => {
  assert.equal(detectConversationDecision(""), null);
  assert.equal(detectConversationDecision("   "), null);
  assert.equal(detectConversationDecision("\t"), null);
});

/**
 * Test: extractWorkspacePathHint
 */

test("extractWorkspacePathHint: finds windows path in backticks", () => {
  assert.equal(
    extractWorkspacePathHint("`C:\\\\Users\\\\sean\\\\repos\\\\foo"),
    "C:\\\\Users\\\\sean\\\\repos\\\\foo",
  );
});

test("extractWorkspacePathHint: finds unix path in backticks", () => {
  assert.equal(
    extractWorkspacePathHint("`\\\\mnt\\\\wsl\\\\projects\\\\bar`"),
    "\\\\mnt\\\\wsl\\\\projects\\\\bar",
  );
});

test("extractWorkspacePathHint: finds relative path in quotes", () => {
  assert.equal(
    extractWorkspacePathHint('"./packages/core/src/index.ts"'),
    "./packages/core/src/index.ts",
  );
});

test("extractWorkspacePathHint: finds parent-relative path in single quotes", () => {
  assert.equal(
    extractWorkspacePathHint("'../shared/lib/helpers.js'"),
    "../shared/lib/helpers.js",
  );
});

test("extractWorkspacePathHint: returns null for plain sentences without paths", () => {
  assert.equal(extractWorkspacePathHint("hello world"), null);
  assert.equal(extractWorkspacePathHint("the file is at my desk"), null);
});

test("extractWorkspacePathHint: returns null for URLs that look like paths", () => {
  assert.equal(extractWorkspacePathHint("https://example.com/path"), null);
  assert.equal(extractWorkspacePathHint("`/api/v1/users`"), "/api/v1/users"); // Actually looks relative
});
