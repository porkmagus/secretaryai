import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

/**
 * Repository root path - resolved once and reused across the codebase.
 *
 * Walks up from this file's real location until it finds the monorepo root
 * (a directory containing both `apps/` and `packages/`). This works correctly
 * from source files (ts-node/esm) and from compiled artifacts (dist/lib/).
 */

function fileExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function computeRepoRoot(): string {
  const fromFile = fileURLToPath(import.meta.url);

  // Walk up at most 8 levels checking for monorepo root markers
  let dir = resolve(fromFile, "..");
  for (let i = 0; i < 8; i++) {
    if (fileExists(resolve(dir, "apps")) && fileExists(resolve(dir, "packages"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }

  // Last-resort fallback: original 4-level heuristic (works for source, breaks for dist)
  return resolve(fromFile, "../../../../");
}

export const repoRoot = computeRepoRoot();

/**
 * Resolve a path relative to the repo root.
 */
export function resolveRepoPath(...segments: string[]): string {
  return resolve(repoRoot, ...segments);
}

/**
 * Sanitize a file name to remove dangerous characters and path traversal attempts.
 */
export function sanitizeFileNamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * Sanitize a path segment for storage keys.
 */
export function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
