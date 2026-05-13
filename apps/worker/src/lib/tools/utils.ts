import { resolve } from "node:path";
import { repoRoot } from "../utils.js";

export function shortSnippet(text: string, max = 96) {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

export function isWindowsPlatform() {
  return process.platform === "win32";
}

export function isPathInsideWorkspace(root: string, candidate: string) {
  const normalizedRoot = isWindowsPlatform() ? root.toLowerCase() : root;
  const normalizedCandidate = isWindowsPlatform() ? candidate.toLowerCase() : candidate;

  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${isWindowsPlatform() ? "\\" : "/"}`)
  );
}

export function hasBinaryLikeContent(buffer: Buffer) {
  if (buffer.includes(0)) {
    return true;
  }

  const sample = buffer.subarray(0, 2048);
  let suspiciousBytes = 0;

  for (const value of sample) {
    const isTabOrNewLine = value === 9 || value === 10 || value === 13;
    const isPrintableAscii = value >= 32 && value <= 126;

    if (!isTabOrNewLine && !isPrintableAscii) {
      suspiciousBytes += 1;
    }
  }

  return sample.length > 0 && suspiciousBytes / sample.length > 0.3;
}

export function resolveRuntimePath(relativePath: string) {
  return resolveWorkspacePath(relativePath);
}

export async function ensureRuntimeGeneratedPath(relativeDir: string) {
  const { mkdir } = await import("node:fs/promises");
  const directory = resolveRuntimePath(relativeDir);
  await mkdir(directory, { recursive: true });
  return directory;
}

export function resolveWorkspacePath(inputPath: string) {
  const root = repoRoot;
  const candidate = resolve(root, inputPath);

  if (!isPathInsideWorkspace(root, candidate)) {
    throw new Error("Requested path is outside the workspace.");
  }

  return candidate;
}
