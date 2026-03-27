import { mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const runtimeRoot = resolve(repoRoot, "runtime");
const speechRoot = resolve(runtimeRoot, "speech");
const inboundRoot = resolve(speechRoot, "inbound");
const transcriptsRoot = resolve(speechRoot, "transcripts");
const ttsRoot = resolve(speechRoot, "tts");
const profilesRoot = resolve(speechRoot, "profiles");

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
  return path;
}

export async function ensureSpeechStorageLayout() {
  await Promise.all([
    ensureDir(speechRoot),
    ensureDir(inboundRoot),
    ensureDir(transcriptsRoot),
    ensureDir(ttsRoot),
    ensureDir(profilesRoot),
  ]);

  return {
    speechRoot,
    inboundRoot,
    profilesRoot,
    transcriptsRoot,
    ttsRoot,
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

export function createSpeechStorageKey(kind: "telegram" | "web" | "tts" | "profile", filename: string) {
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
  return resolve(runtimeRoot, normalizeSpeechStorageKey(storageKey));
}

export function resolveManagedSpeechStoragePath(storageKey: string) {
  const path = resolveSpeechStoragePath(storageKey);
  const normalizedSpeechRoot = `${resolve(speechRoot)}${sep}`;

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
