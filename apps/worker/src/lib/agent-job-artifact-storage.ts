import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const artifactRoot = resolve(repoRoot, "runtime/agent-jobs/artifacts");

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function createAgentJobArtifactStorageKey(jobId: string, fileName: string) {
  const timestamp = Date.now();
  return `${sanitizeSegment(jobId)}/${timestamp}-${sanitizeSegment(fileName)}`;
}

export async function ensureAgentJobArtifactStoragePath(storageKey: string) {
  const targetPath = resolve(artifactRoot, storageKey);
  await mkdir(dirname(targetPath), { recursive: true });
  return targetPath;
}

export function resolveManagedAgentJobArtifactPath(storageKey: string) {
  return resolve(artifactRoot, storageKey);
}
