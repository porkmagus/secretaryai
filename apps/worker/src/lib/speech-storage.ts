import { mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { repoRoot } from "./utils.js";

// Lazy initialization to avoid circular dependency issues
function getRuntimeRoot() {
  return resolve(repoRoot, "runtime");
}
function getSpeechRoot() {
  return resolve(getRuntimeRoot(), "speech");
}
function getInboundRoot() {
  return resolve(getSpeechRoot(), "inbound");
}
function getTranscriptsRoot() {
  return resolve(getSpeechRoot(), "transcripts");
}
function getTtsRoot() {
  return resolve(getSpeechRoot(), "tts");
}
function getProfilesRoot() {
  return resolve(getSpeechRoot(), "profiles");
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
  return path;
}

export async function ensureSpeechStorageLayout() {
  await Promise.all([
    ensureDir(getSpeechRoot()),
    ensureDir(getInboundRoot()),
    ensureDir(getTranscriptsRoot()),
    ensureDir(getTtsRoot()),
    ensureDir(getProfilesRoot()),
  ]);

  return {
    speechRoot: getSpeechRoot(),
    inboundRoot: getInboundRoot(),
    profilesRoot: getProfilesRoot(),
    transcriptsRoot: getTranscriptsRoot(),
    ttsRoot: getTtsRoot(),
  };
}

export function normalizeSpeechStorageKey(storageKey: string) {
  return storageKey
    .trim()
    .replace(/[\\/]+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.(?:\/|\\)/g, "");
}

function buildSpeechStorageKey(parts: string[]) {
  return normalizeSpeechStorageKey(parts.join("/"));
}

export function createSpeechStorageKey(
  kind: "telegram" | "web" | "tts" | "profile",
  filename: string,
) {
  const normalized = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");

  switch (kind) {
    case "telegram":
      return buildSpeechStorageKey(["speech", "inbound", normalized]);
    case "web":
      return buildSpeechStorageKey(["speech", "inbound", normalized]);
    case "tts":
      return buildSpeechStorageKey(["speech", "tts", normalized]);
    case "profile":
      return buildSpeechStorageKey(["speech", "profiles", normalized]);
  }
}

export function resolveSpeechStoragePath(storageKey: string) {
  return resolve(getRuntimeRoot(), normalizeSpeechStorageKey(storageKey));
}

export function resolveManagedSpeechStoragePath(storageKey: string) {
  const path = resolveSpeechStoragePath(storageKey);
  const normalizedSpeechRoot = `${resolve(getSpeechRoot())}${sep}`;

  if (!path.startsWith(normalizedSpeechRoot)) {
    throw new Error("Invalid speech storage key.");
  }

  return path;
}

export async function ensureSpeechStoragePath(storageKey: string) {
  const path = resolveSpeechStoragePath(storageKey);
  await mkdir(dirname(path), { recursive: true });
  return path;
}
