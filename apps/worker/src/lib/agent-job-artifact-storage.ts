import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { repoRoot, sanitizeSegment } from "./utils.js";

// Lazy initialization to avoid circular dependency issues
function getArtifactRoot() {
  return resolve(repoRoot, "runtime/agent-jobs/artifacts");
}

export function createAgentJobArtifactStorageKey(jobId: string, fileName: string) {
  const timestamp = Date.now();
  return `${sanitizeSegment(jobId)}/${timestamp}-${sanitizeSegment(fileName)}`;
}

export async function ensureAgentJobArtifactStoragePath(storageKey: string) {
  const targetPath = resolve(getArtifactRoot(), storageKey);
  await mkdir(dirname(targetPath), { recursive: true });
  return targetPath;
}

export function resolveManagedAgentJobArtifactPath(storageKey: string) {
  return resolve(getArtifactRoot(), storageKey);
}
