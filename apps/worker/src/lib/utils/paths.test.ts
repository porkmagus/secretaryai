import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { repoRoot, resolveRepoPath, sanitizeFileNamePart, sanitizeSegment } from "./paths.js";

test("repoRoot resolves to an existing directory", () => {
  // Should not throw — statSync throws if path doesn't exist
  const stat = statSync(repoRoot);
  assert.ok(stat.isDirectory(), `${repoRoot} should be a directory`);
});

test("repoRoot is the monorepo root (contains apps/ and packages/)", () => {
  const appsDir = resolve(repoRoot, "apps");
  const packagesDir = resolve(repoRoot, "packages");
  assert.ok(statSync(appsDir).isDirectory(), `${appsDir} should exist`);
  assert.ok(statSync(packagesDir).isDirectory(), `${packagesDir} should exist`);
});

test("resolveRepoPath joins segments relative to repoRoot", () => {
  const result = resolveRepoPath("runtime", "config", "settings.json");
  assert.equal(result, resolve(repoRoot, "runtime", "config", "settings.json"));
  assert.ok(result.startsWith(repoRoot), "result should be under repoRoot");
});

test("resolveRepoPath with no segments returns repoRoot itself", () => {
  assert.equal(resolveRepoPath(), repoRoot);
});

test("sanitizeFileNamePart collapses dangerous characters", () => {
  // Path traversal sequences: dots are NOT hyphens so they survive strip,
  // but slashes and backslashes become hyphens
  assert.equal(sanitizeFileNamePart("../../../etc/passwd"), "..-..-..-etc-passwd");
  assert.equal(sanitizeFileNamePart("..\\..\\windows\\system32"), "..-..-windows-system32");
  assert.equal(
    sanitizeFileNamePart("file<name>with\"special'chars"),
    "file-name-with-special-chars",
  );
});

test("sanitizeFileNamePart strips leading/trailing hyphens", () => {
  assert.equal(sanitizeFileNamePart("---valid-name---"), "valid-name");
});

test("sanitizeFileNamePart limits length to 100 characters", () => {
  const long = "a".repeat(120);
  assert.equal(sanitizeFileNamePart(long).length, 100);
  assert.ok(sanitizeFileNamePart(long).endsWith("aaa"), "should end with truncated content");
});

test("sanitizeFileNamePart preserves alphanumeric, dot, underscore, hyphen", () => {
  assert.equal(sanitizeFileNamePart("file_v1.0-beta.tar.gz"), "file_v1.0-beta.tar.gz");
});

test("sanitizeSegment replaces non-alphanumeric chars with hyphens", () => {
  assert.equal(sanitizeSegment("my provider/v2 (1)"), "my-provider-v2-1-");
});

test("sanitizeSegment strips sequences of separators to single hyphen", () => {
  assert.equal(sanitizeSegment("foo///bar///baz"), "foo-bar-baz");
});

test("sanitizeSegment is idempotent", () => {
  const input = "provider (v2) [special]";
  assert.equal(sanitizeSegment(sanitizeSegment(input)), sanitizeSegment(input));
});
