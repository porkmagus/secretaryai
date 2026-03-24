import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const runtimeRoot = resolve(process.cwd(), "runtime");
const speechRoot = join(runtimeRoot, "speech");
const inboundRoot = join(speechRoot, "inbound");
const transcriptsRoot = join(speechRoot, "transcripts");
const ttsRoot = join(speechRoot, "tts");
const profilesRoot = join(speechRoot, "profiles");

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

export function createSpeechStorageKey(kind: "telegram" | "web" | "tts" | "profile", filename: string) {
  const normalized = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");

  switch (kind) {
    case "telegram":
      return join("speech", "inbound", normalized);
    case "web":
      return join("speech", "inbound", normalized);
    case "tts":
      return join("speech", "tts", normalized);
    case "profile":
      return join("speech", "profiles", normalized);
  }
}

export function resolveSpeechStoragePath(storageKey: string) {
  return resolve(runtimeRoot, storageKey);
}

export async function ensureSpeechStoragePath(storageKey: string) {
  const path = resolveSpeechStoragePath(storageKey);
  await mkdir(dirname(path), { recursive: true });
  return path;
}
