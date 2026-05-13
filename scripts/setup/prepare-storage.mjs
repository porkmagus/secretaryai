import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");

for (const relativePath of [
  "runtime/postgres",
  "runtime/postgres/data",
  "runtime/redis",
  "runtime/redis/data",
  "runtime/speech",
  "runtime/speech/inbound",
  "runtime/speech/models",
  "runtime/speech/transcripts",
  "runtime/speech/tts",
  "runtime/speech/profiles",
  "runtime/caddy",
  "runtime/caddy/data",
  "runtime/caddy/config",
  "runtime/backups",
  "runtime/exports",
  "runtime/generated",
  "runtime/generated/documents",
  "runtime/downloads",
  "runtime/venvs",
]) {
  const fullPath = resolve(root, relativePath);
  await mkdir(fullPath, { recursive: true });
}
