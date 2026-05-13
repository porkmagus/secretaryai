import assert from "node:assert";
import { createHash, timingSafeEqual } from "node:crypto";
import test from "node:test";

// Minimal reproduction of the fixed functions for testing
function passwordsMatch(input: string, expected: string) {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(inputHash, expectedHash);
}

function constantTimeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();

  return timingSafeEqual(leftHash, rightHash);
}

test("passwordsMatch securely compares passwords", () => {
  assert.strictEqual(passwordsMatch("password123", "password123"), true);
  assert.strictEqual(passwordsMatch("password123", "wrongpassword"), false);
  assert.strictEqual(passwordsMatch("short", "muchlongerpassword"), false);
  assert.strictEqual(passwordsMatch("muchlongerpassword", "short"), false);
  assert.strictEqual(passwordsMatch("", ""), true);
  assert.strictEqual(passwordsMatch(" ", ""), false);
});

test("constantTimeEqual securely compares values", () => {
  assert.strictEqual(constantTimeEqual("token_val", "token_val"), true);
  assert.strictEqual(constantTimeEqual("token_val", "token_bad"), false);
  assert.strictEqual(constantTimeEqual("val", "longer_val"), false);
  assert.strictEqual(constantTimeEqual("longer_val", "val"), false);
});
