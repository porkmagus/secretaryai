import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildContextSummary,
  toDeskChatMessage,
  toDeskChatRole,
  toRuntimeContextMessage,
  validateMessageInsert,
} from "./chat-persistence.js";

const persistedMessage = {
  id: "msg_1",
  role: "user",
  contentText: "Hello",
};

test("toRuntimeContextMessage maps persisted message role and text", () => {
  assert.deepEqual(toRuntimeContextMessage(persistedMessage as never), {
    role: "user",
    text: "Hello",
  });
});

test("toDeskChatRole maps user to user and other roles to assistant", () => {
  assert.equal(toDeskChatRole("user"), "user");
  assert.equal(toDeskChatRole("assistant"), "assistant");
  assert.equal(toDeskChatRole("tool"), "assistant");
});

test("toDeskChatMessage preserves id and text part", () => {
  assert.deepEqual(toDeskChatMessage(persistedMessage as never), {
    id: "msg_1",
    role: "user",
    parts: [{ type: "text", text: "Hello" }],
  });
});

test("buildContextSummary returns memory, task, and optional research slices", () => {
  const summary = buildContextSummary({
    relevantMemories: [{ id: "mem_1" }],
    activeTasks: [{ id: "task_1" }],
    researchResult: null,
  } as never);

  assert.deepEqual(summary, {
    memories: [{ id: "mem_1" }],
    tasks: [{ id: "task_1" }],
    research: undefined,
  });
});

test("validateMessageInsert trims text and channel message id", () => {
  assert.deepEqual(
    validateMessageInsert({
      channelMessageId: " ext_1 ",
      contentText: " hello ",
      role: "assistant",
    }),
    {
      ok: true,
      value: {
        channelMessageId: "ext_1",
        contentText: "hello",
        role: "assistant",
      },
    },
  );
});

test("validateMessageInsert rejects empty text and invalid roles", () => {
  assert.deepEqual(
    validateMessageInsert({ contentText: " ", role: "user" }),
    { ok: false, reason: "empty_content" },
  );
  assert.deepEqual(
    validateMessageInsert({ contentText: "hello", role: "owner" }),
    { ok: false, reason: "invalid_role" },
  );
});
