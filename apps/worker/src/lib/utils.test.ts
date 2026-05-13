import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeApprovalMode,
  normalizeExecutionBackend,
  pathExists,
} from "./utils";

test("normalizeApprovalMode validates and normalizes values", () => {
  // Valid values
  assert.equal(normalizeApprovalMode("restrictive"), "restrictive");
  assert.equal(normalizeApprovalMode("full_access"), "full_access");

  // Invalid values fallback to "builder"
  assert.equal(normalizeApprovalMode("unknown"), "builder");
  assert.equal(normalizeApprovalMode(null), "builder");
  assert.equal(normalizeApprovalMode(undefined), "builder");
  assert.equal(normalizeApprovalMode(123), "builder");
});

test("normalizeExecutionBackend validates and normalizes values", () => {
  // Valid values
  assert.equal(normalizeExecutionBackend("wsl_bash"), "wsl_bash");
  assert.equal(normalizeExecutionBackend("docker_sandbox"), "docker_sandbox");

  // Invalid values fallback to "host_native"
  assert.equal(normalizeExecutionBackend("unknown"), "host_native");
  assert.equal(normalizeExecutionBackend(null), "host_native");
  assert.equal(normalizeExecutionBackend(undefined), "host_native");
  assert.equal(normalizeExecutionBackend({}), "host_native");
});

test("pathExists correctly identifies if a path exists", async () => {
  // Known existing file (relative to apps/worker/src/lib/utils.test.ts, but pathExists uses process.cwd() or absolute)
  // Wait, pathExists just uses `access(path, fsConstants.F_OK)`.
  // When running tests with `node --test src/**/*.test.ts` from `apps/worker`, CWD is `apps/worker`.

  assert.equal(await pathExists("package.json"), true);
  assert.equal(await pathExists("non-existent-file-xyz.txt"), false);
});
