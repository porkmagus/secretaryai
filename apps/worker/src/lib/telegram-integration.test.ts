import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  extractTelegramCommand,
  parseTelegramMessageText,
  sanitizeTelegramMessageText,
  stripTelegramBotMention,
} from "./telegram-integration.js";

test("extractTelegramCommand parses start, help, and task commands", () => {
  assert.deepEqual(extractTelegramCommand("/start"), {
    command: "start",
    mention: null,
    text: "",
  });
  assert.deepEqual(extractTelegramCommand("/help please"), {
    command: "help",
    mention: null,
    text: "please",
  });
  assert.deepEqual(extractTelegramCommand("/task buy milk tomorrow"), {
    command: "task",
    mention: null,
    text: "buy milk tomorrow",
  });
});

test("extractTelegramCommand handles bot mentions", () => {
  assert.deepEqual(extractTelegramCommand("/task@SecretaryBot call Sam", "SecretaryBot"), {
    command: "task",
    mention: "SecretaryBot",
    text: "call Sam",
  });
  assert.equal(extractTelegramCommand("/task@OtherBot call Sam", "SecretaryBot"), null);
});

test("sanitizeTelegramMessageText trims and collapses whitespace", () => {
  assert.equal(sanitizeTelegramMessageText("  hello\n\nthere\t "), "hello there");
  assert.equal(sanitizeTelegramMessageText("  "), null);
});

test("stripTelegramBotMention removes configured mention only", () => {
  assert.equal(stripTelegramBotMention("@SecretaryBot hello", "SecretaryBot"), "hello");
  assert.equal(stripTelegramBotMention("@OtherBot hello", "SecretaryBot"), "@OtherBot hello");
});

test("parseTelegramMessageText returns sanitized text and command details", () => {
  assert.deepEqual(parseTelegramMessageText(" /help@SecretaryBot   now ", "SecretaryBot"), {
    command: {
      command: "help",
      mention: "SecretaryBot",
      text: "now",
    },
    text: "/help now",
  });
  assert.deepEqual(parseTelegramMessageText(" @SecretaryBot hello ", "SecretaryBot"), {
    command: null,
    text: "hello",
  });
});
