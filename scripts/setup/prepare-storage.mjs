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
]) {
  const fullPath = resolve(root, relativePath);
  await mkdir(fullPath, { recursive: true });
  console.log(`ready:${fullPath}`);
}
