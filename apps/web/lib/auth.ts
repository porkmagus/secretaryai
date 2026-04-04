import { createHash, timingSafeEqual } from "node:crypto";

const AUTH_COOKIE_NAME = "secretary_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function encodeHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signValue(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );

  return encodeHex(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();

  return timingSafeEqual(leftHash, rightHash);
}

export function getAuthCookieName() {
  return AUTH_COOKIE_NAME;
}

export function isSingleUserAuthEnabled() {
  return Boolean(process.env.APP_AUTH_PASSWORD?.trim());
}

export function getSessionLifetimeSeconds() {
  return SESSION_MAX_AGE_SECONDS;
}

export function getAuthPassword() {
  return process.env.APP_AUTH_PASSWORD?.trim() ?? "";
}

export function getSessionSecret() {
  return (
    process.env.APP_SESSION_SECRET?.trim() ||
    process.env.APP_AUTH_PASSWORD?.trim() ||
    ""
  );
}

export function normalizeNextPath(input: string | null | undefined) {
  if (!input || !input.startsWith("/") || input.startsWith("//")) {
    return "/";
  }

  if (input === "/login") {
    return "/";
  }

  return input;
}

export async function createSessionToken(now = Date.now()) {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
  const signature = await signValue(payload, getSessionSecret());
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token: string | undefined | null) {
  if (!token || !isSingleUserAuthEnabled()) {
    return !isSingleUserAuthEnabled();
  }

  const [rawExpiry, signature] = token.split(".");
  const expiry = Number(rawExpiry);

  if (!rawExpiry || !signature || !Number.isFinite(expiry) || expiry <= Date.now()) {
    return false;
  }

  const expected = await signValue(rawExpiry, getSessionSecret());
  return constantTimeEqual(signature, expected);
}
