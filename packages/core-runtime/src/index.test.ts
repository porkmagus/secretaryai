import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  createConversationId,
  createMessageId,
  createTraceId,
  createTurnResponseFromText,
  generateSecretaryReply,
  type RuntimeChatRequest,
  type RuntimeTurnContext,
} from "./index";

describe("ID generators", () => {
  test("createTraceId returns trace_ prefixed UUID", () => {
    const id = createTraceId();
    assert.ok(id.startsWith("trace_"), "trace id should start with trace_");
    const uuid = id.slice(6);
    assert.ok(uuid.length === 36, "UUID portion should be 36 chars");
  });

  test("createConversationId returns conv_ prefixed UUID", () => {
    const id = createConversationId();
    assert.ok(id.startsWith("conv_"), "conversation id should start with conv_");
  });

  test("createMessageId returns msg_ prefixed UUID", () => {
    const id = createMessageId();
    assert.ok(id.startsWith("msg_"), "message id should start with msg_");
  });

  test("each call produces unique IDs", () => {
    const ids = new Set([createTraceId(), createTraceId(), createTraceId()]);
    assert.strictEqual(ids.size, 3, "all generated IDs should be unique");
  });
});

describe("generateSecretaryReply", () => {
  const baseRequest: RuntimeChatRequest = {
    channel: "web",
    userId: "user-1",
    message: { text: "hello" },
  };

  const baseContext: RuntimeTurnContext = {
    conversationId: "conv-1",
    recentMessages: [],
    relevantMemories: [],
    activeTasks: [],
  };

  test("returns guarded message for guarded_output reason", () => {
    const reply = generateSecretaryReply(baseRequest, baseContext, {
      reason: "guarded_output",
    });
    assert.ok(reply.includes("safety guard"));
  });

  test("returns provider unavailable message for provider_error reason", () => {
    const reply = generateSecretaryReply(baseRequest, baseContext, {
      reason: "provider_error",
      providerError: "timeout",
    });
    assert.ok(reply.includes("Inference provider unavailable"));
  });

  test("returns provider unavailable message for no_inference reason", () => {
    const reply = generateSecretaryReply(baseRequest, baseContext, {
      reason: "no_inference",
    });
    assert.ok(reply.includes("Inference provider unavailable"));
  });

  test("returns provider unavailable message for unknown reason", () => {
    const reply = generateSecretaryReply(baseRequest, baseContext);
    assert.ok(reply.includes("Inference provider unavailable"));
  });

  test("fallback message includes current time", () => {
    const reply = generateSecretaryReply(baseRequest, baseContext, { reason: "unknown" });
    // Contains a time pattern like "12:34:56 PM" or "12:34:56"
    assert.ok(/\d{1,2}:\d{2}:\d{2}/.test(reply), "should include a timestamp");
  });
});

describe("createTurnResponseFromText", () => {
  const baseRequest: RuntimeChatRequest = {
    conversationId: "conv-1",
    channel: "web",
    userId: "user-1",
    message: { text: "hello" },
  };

  const baseContext: RuntimeTurnContext = {
    conversationId: "conv-1",
    recentMessages: [],
    relevantMemories: [],
    activeTasks: [],
  };

  test("returns response with correct structure", () => {
    const response = createTurnResponseFromText({
      request: baseRequest,
      context: baseContext,
      outputText: "Hello there!",
    });

    assert.strictEqual(response.conversationId, "conv-1");
    assert.strictEqual(response.outputText, "Hello there!");
    assert.ok(response.messageId.startsWith("msg_"));
    assert.ok(response.traceId.startsWith("trace_"));
    assert.ok(response.contextSummary);
    assert.strictEqual(response.contextSummary.memories.length, 0);
    assert.strictEqual(response.contextSummary.tasks.length, 0);
    assert.ok(response.actions);
    assert.ok(response.actions?.length >= 1);
  });

  test("includes memory_candidate_queued action", () => {
    const response = createTurnResponseFromText({
      request: { ...baseRequest, channel: "telegram" },
      context: baseContext,
      outputText: "test",
    });

    const memoryAction = response.actions?.find((a) => a.kind === "memory_candidate_queued");
    assert.ok(memoryAction);
    assert.strictEqual(memoryAction?.payload.source, "telegram");
    assert.strictEqual(memoryAction?.payload.status, "queued");
  });

  test("includes research_specialist_used action when context has research", () => {
    const contextWithResearch: RuntimeTurnContext = {
      ...baseContext,
      researchResult: {
        specialist: "research",
        mode: "research_brief",
        summary: "Research summary",
        focusAreas: ["area1"],
        suggestedNextStep: "next",
      },
    };

    const response = createTurnResponseFromText({
      request: baseRequest,
      context: contextWithResearch,
      outputText: "test",
    });

    const researchAction = response.actions?.find((a) => a.kind === "research_specialist_used");
    assert.ok(researchAction);
    assert.strictEqual(researchAction?.payload.specialist, "research");
    assert.strictEqual(researchAction?.payload.mode, "research_brief");
  });

  test("no research action when context has no research", () => {
    const response = createTurnResponseFromText({
      request: baseRequest,
      context: baseContext,
      outputText: "test",
    });

    const researchAction = response.actions?.find((a) => a.kind === "research_specialist_used");
    assert.strictEqual(researchAction, undefined);
  });

  test("uses provided traceId when given", () => {
    const response = createTurnResponseFromText({
      request: baseRequest,
      context: baseContext,
      outputText: "test",
      traceId: "trace_custom-123",
    });

    assert.strictEqual(response.traceId, "trace_custom-123");
  });

  test("contextSummary includes memories and tasks from context", () => {
    const contextWithData: RuntimeTurnContext = {
      ...baseContext,
      relevantMemories: [
        {
          id: "mem-1",
          memoryType: "semantic",
          title: "Test memory",
          summary: null,
          contentText: "content",
          importanceScore: 5,
          confidenceScore: 3,
          pinned: false,
          sourceRef: null,
          tags: ["test"],
        },
      ],
      activeTasks: [
        {
          id: "task-1",
          title: "Test task",
          detail: null,
          status: "open",
          dueAt: null,
          reminderAt: null,
        },
      ],
    };

    const response = createTurnResponseFromText({
      request: baseRequest,
      context: contextWithData,
      outputText: "test",
    });

    assert.strictEqual(response.contextSummary?.memories.length, 1);
    assert.strictEqual(response.contextSummary?.memories[0].id, "mem-1");
    assert.strictEqual(response.contextSummary?.tasks.length, 1);
    assert.strictEqual(response.contextSummary?.tasks[0].id, "task-1");
  });

  test("falls back to context conversationId when request has none", () => {
    const requestWithoutConv: RuntimeChatRequest = {
      channel: "web",
      userId: "user-1",
      message: { text: "hello" },
    };

    const response = createTurnResponseFromText({
      request: requestWithoutConv,
      context: baseContext,
      outputText: "test",
    });

    assert.strictEqual(response.conversationId, "conv-1");
  });
});
