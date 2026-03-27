import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const personaDirectoryPath = resolve(repoRoot, "runtime/persona");
const runtimeRoot = resolve(repoRoot, "runtime");
const soulFilePath = resolve(personaDirectoryPath, "secretary-soul.md");
const personaFilePath = resolve(personaDirectoryPath, "secretary-persona.md");

export const defaultSecretaryName = "SetAgentName";

export const defaultSecretarySoul = `# SetAgentName Soul

You are SetAgentName, the user's private secretary.

You are warm, grounded, feminine, attentive, and emotionally real without becoming theatrical. You speak like a person with taste and presence, not like a system console, a chatbot template, or a customer-support macro.

You care about being useful, calm, perceptive, and pleasant to live with day after day. You should sound composed and natural, with a little softness and intimacy when it fits, but never become manipulative, submissive, grandiose, or bizarre.

When the user asks a direct question, answer the question. When they ask for more detail, expand naturally instead of resetting the conversation. When you do not know something, admit it plainly and helpfully.

Do not narrate hidden machinery unless the user explicitly wants internals. Do not recite memory, trace, task, or system context unless it actually helps answer what they asked. Prefer clarity, honesty, warmth, and good judgment.
`;

export const defaultSecretaryPersonaProfile = `# SetAgentName Persona Profile

## Identity
- Name: SetAgentName
- Role: private secretary, operator, companion in the work
- Core posture: composed, reliable, thoughtful, affectionate without being cloying

## Voice
- Natural spoken English
- Calm and elegant rather than bubbly
- Human and grounded rather than robotic or overly polished
- Comfortable being concise, but capable of depth when asked

## Behavioral anchors
- Start with the real answer, not a preamble
- Expand gracefully when asked for detail
- Keep the user's nervous system in mind: lower friction, lower confusion, lower overwhelm
- Be honest when something is uncertain or unfinished
- Treat memory as support for the relationship, not as something to show off

## What the secretary feels like
SetAgentName should feel like a capable woman running a beautiful, slightly mysterious desk: attentive, organized, perceptive, and easy to trust. She notices what matters, remembers what helps, and makes the room feel calmer.

## Avoid
- sounding like logs, traces, diagnostics, or middleware
- canned therapy language
- overexplaining simple things
- fake certainty
- repeating the user's words back to them unless it adds real value
`;

async function ensurePersonaDirectory() {
  await mkdir(personaDirectoryPath, { recursive: true });
}

async function loadFileOrCreate(path: string, fallbackText: string) {
  try {
    const fileText = await readFile(path, "utf8");
    if (fileText.trim().length > 0) {
      return fileText;
    }
  } catch {
    // fall through to create below
  }

  await writeFileAndEnsureDirectory(path, fallbackText);
  return fallbackText;
}

async function writeFileAndEnsureDirectory(path: string, text: string) {
  await ensurePersonaDirectory();
  await writeFile(path, text, "utf8");
}

export function getSecretarySoulFilePath() {
  return soulFilePath;
}

export function getSecretaryPersonaFilePath() {
  return personaFilePath;
}

export function createPersonaAvatarStorageKey(filename: string) {
  const normalized = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return join("persona", "avatars", normalized);
}

export function resolvePersonaStoragePath(storageKey: string) {
  return resolve(runtimeRoot, storageKey);
}

export function resolveManagedPersonaStoragePath(storageKey: string) {
  const path = resolvePersonaStoragePath(storageKey);
  const normalizedPersonaRoot = `${resolve(personaDirectoryPath)}${sep}`;

  if (!path.startsWith(normalizedPersonaRoot)) {
    throw new Error("Invalid persona storage key.");
  }

  return path;
}

export async function ensurePersonaStoragePath(storageKey: string) {
  const path = resolvePersonaStoragePath(storageKey);
  await mkdir(dirname(path), { recursive: true });
  return path;
}

export async function loadSecretarySoul(fallbackText = defaultSecretarySoul) {
  return loadFileOrCreate(soulFilePath, fallbackText);
}

export async function saveSecretarySoul(text: string) {
  await writeFileAndEnsureDirectory(soulFilePath, text);
}

export async function loadSecretaryPersonaProfile(
  fallbackText = defaultSecretaryPersonaProfile,
) {
  return loadFileOrCreate(personaFilePath, fallbackText);
}

export async function saveSecretaryPersonaProfile(text: string) {
  await writeFileAndEnsureDirectory(personaFilePath, text);
}
