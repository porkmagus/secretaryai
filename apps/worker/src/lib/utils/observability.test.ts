import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  logAgentEvent,
  logFallbackTriggered,
  logToolExecution,
  logMemoryRetrieval,
} from "./observability.ts";

test("logAgentEvent logs structured JSON with required fields", () => {
  const consoleMock = mock.method(console, "log", () => {});

  const eventData = {
    type: "test.event",
    reason: "testing",
    customField: 123,
  };

  logAgentEvent(eventData);

  assert.equal(consoleMock.mock.callCount(), 1);
  const logOutput = consoleMock.mock.calls[0].arguments[0];
  const parsed = JSON.parse(logOutput);

  assert.equal(parsed.service, "worker");
  assert.equal(parsed.type, "test.event");
  assert.equal(parsed.reason, "testing");
  assert.equal(parsed.customField, 123);
  assert.ok(parsed.timestamp);
  // Ensure timestamp is a valid ISO string
  assert.doesNotThrow(() => new Date(parsed.timestamp).toISOString());

  consoleMock.mock.restore();
});

test("logFallbackTriggered truncates text preview", () => {
  const consoleMock = mock.method(console, "log", () => {});
  const longText = "a".repeat(200);
  const reason = "context_length";

  logFallbackTriggered(reason, longText);

  assert.equal(consoleMock.mock.callCount(), 1);
  const parsed = JSON.parse(consoleMock.mock.calls[0].arguments[0]);

  assert.equal(parsed.type, "fallback.triggered");
  assert.equal(parsed.reason, reason);
  assert.equal(parsed.textPreview.length, 100);
  assert.equal(parsed.textPreview, "a".repeat(100));

  consoleMock.mock.restore();
});

test("logToolExecution logs tool metrics", () => {
  const consoleMock = mock.method(console, "log", () => {});
  const params = {
    toolKey: "get_weather",
    durationMs: 150,
    success: true,
    resultCount: 1,
  };

  logToolExecution(params);

  assert.equal(consoleMock.mock.callCount(), 1);
  const parsed = JSON.parse(consoleMock.mock.calls[0].arguments[0]);

  assert.equal(parsed.type, "tool.execution");
  assert.equal(parsed.toolKey, params.toolKey);
  assert.equal(parsed.durationMs, params.durationMs);
  assert.equal(parsed.success, params.success);
  assert.equal(parsed.resultCount, params.resultCount);

  consoleMock.mock.restore();
});

test("logMemoryRetrieval logs memory metrics", () => {
  const consoleMock = mock.method(console, "log", () => {});
  const params = {
    query: "search query",
    durationMs: 50,
    resultsCount: 3,
    topScore: 0.95,
  };

  logMemoryRetrieval(params);

  assert.equal(consoleMock.mock.callCount(), 1);
  const parsed = JSON.parse(consoleMock.mock.calls[0].arguments[0]);

  assert.equal(parsed.type, "memory.retrieval");
  assert.equal(parsed.query, params.query);
  assert.equal(parsed.durationMs, params.durationMs);
  assert.equal(parsed.resultsCount, params.resultsCount);
  assert.equal(parsed.topScore, params.topScore);

  consoleMock.mock.restore();
});
