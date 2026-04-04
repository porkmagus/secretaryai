import test from "node:test";
import assert from "node:assert";
import { createLogger } from "./index.ts";

test("createLogger returns an object with expected methods", () => {
  const logger = createLogger("test-service");
  assert.strictEqual(typeof logger.debug, "function");
  assert.strictEqual(typeof logger.info, "function");
  assert.strictEqual(typeof logger.warn, "function");
  assert.strictEqual(typeof logger.error, "function");
});

test("logger methods call console.log or console.error with JSON string", (t) => {
  const service = "test-service";
  const logger = createLogger(service);
  const event = "test-event";
  const payload = { foo: "bar" };

  // Mock console.log and console.error
  const logMock = t.mock.method(console, "log", () => {});
  const errorMock = t.mock.method(console, "error", () => {});

  const levels = ["debug", "info", "warn", "error"] as const;

  for (const level of levels) {
    const method = logger[level];
    method(event, payload);

    const mock = level === "error" ? errorMock : logMock;
    const call = mock.mock.calls[mock.mock.calls.length - 1];

    assert.ok(call, `Expected console.${level === "error" ? "error" : "log"} to be called for level ${level}`);
    const logLine = call.arguments[0];
    const parsed = JSON.parse(logLine);

    assert.strictEqual(parsed.level, level);
    assert.strictEqual(parsed.service, service);
    assert.strictEqual(parsed.event, event);
    assert.strictEqual(parsed.foo, "bar");
    assert.ok(parsed.timestamp);
    assert.ok(!isNaN(Date.parse(parsed.timestamp)));
  }
});

test("logger methods work without payload", (t) => {
  const service = "test-service";
  const logger = createLogger(service);
  const event = "test-event";

  const logMock = t.mock.method(console, "log", () => {});

  logger.info(event);

  const call = logMock.mock.calls[0];
  const parsed = JSON.parse(call.arguments[0]);

  assert.strictEqual(parsed.level, "info");
  assert.strictEqual(parsed.service, service);
  assert.strictEqual(parsed.event, event);
  assert.ok(parsed.timestamp);
});
