import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, cleanTextPreserveCase } from "./clean.ts";

test("cleanText: collapses multiple whitespaces", () => {
  assert.equal(cleanText("hello    world"), "hello world");
});

test("cleanText: trims leading and trailing whitespace", () => {
  assert.equal(cleanText("   hello world   "), "hello world");
});

test("cleanText: lowercases text", () => {
  assert.equal(cleanText("Hello World"), "hello world");
});

test("cleanText: handles multiple whitespace types (tabs, newlines)", () => {
  assert.equal(cleanText("hello\t\n  world"), "hello world");
});

test("cleanText: handles empty string", () => {
  assert.equal(cleanText(""), "");
});

test("cleanText: handles whitespace-only string", () => {
  assert.equal(cleanText("   \n\t  "), "");
});

test("cleanTextPreserveCase: collapses multiple whitespaces", () => {
  assert.equal(cleanTextPreserveCase("Hello    World"), "Hello World");
});

test("cleanTextPreserveCase: trims leading and trailing whitespace", () => {
  assert.equal(cleanTextPreserveCase("   Hello World   "), "Hello World");
});

test("cleanTextPreserveCase: preserves case", () => {
  assert.equal(cleanTextPreserveCase("Hello World"), "Hello World");
});

test("cleanTextPreserveCase: handles multiple whitespace types (tabs, newlines)", () => {
  assert.equal(cleanTextPreserveCase("Hello\t\n  World"), "Hello World");
});

test("cleanTextPreserveCase: handles empty string", () => {
  assert.equal(cleanTextPreserveCase(""), "");
});

test("cleanTextPreserveCase: handles whitespace-only string", () => {
  assert.equal(cleanTextPreserveCase("   \n\t  "), "");
});
