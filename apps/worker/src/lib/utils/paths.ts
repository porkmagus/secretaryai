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
  try {
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
  } catch {
    // Defensive: this should NEVER throw, but if it does, return cwd as last resort
    // to avoid leaving repoRoot in the TDZ and crashing the entire worker startup.
    return resolve();
  }
}

// Evaluate eagerly so any thrown error surfaces immediately at module load time,
// not later when a consumer tries to access repoRoot (which would cause
// "Cannot access 'repoRoot' before initialization").
const _computedRepoRoot = computeRepoRoot();

// Guard: verify we got a valid, accessible directory.
try {
  if (!fileExists(_computedRepoRoot)) {
    throw new Error(`repoRoot fallback path does not exist: ${_computedRepoRoot}`);
  }
} catch (err) {
  // Re-throw at module load so the crash is loud and immediate, not silent TDZ corruption.
  throw new Error(`Failed to initialize repoRoot: ${err instanceof Error ? err.message : String(err)}`);
}

export const repoRoot = _computedRepoRoot;

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
