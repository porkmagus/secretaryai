import { resolve } from "node:path";
import {
  createClient,
  ensureDirectory,
  exportTables,
  resolveRepoPath,
  settingsTables,
  writeJson,
} from "./snapshot-utils.mjs";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputFile =
  process.env.EXPORT_OUTPUT_FILE ??
  resolve(resolveRepoPath("runtime", "exports"), `settings-${stamp}.json`);

const client = await createClient(databaseUrl);

try {
  await ensureDirectory(resolveRepoPath("runtime", "exports"));
  const snapshot = await exportTables(client, settingsTables);
  const payload = {
    exportedAt: new Date().toISOString(),
    format: "secretary-settings-v1",
    snapshot,
  };

  await writeJson(outputFile, payload);
} finally {
  await client.end();
}
