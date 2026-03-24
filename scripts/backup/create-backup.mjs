import { resolve } from "node:path";
import {
  copyTreeIfPresent,
  createClient,
  ensureDirectory,
  exportTables,
  fullBackupTables,
  resolveRepoPath,
  writeJson,
} from "../admin/snapshot-utils.mjs";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir =
  process.env.BACKUP_OUTPUT_DIR ?? resolve(resolveRepoPath("runtime", "backups"), `backup-${stamp}`);
const client = await createClient(databaseUrl);

try {
  await ensureDirectory(outputDir);
  const database = await exportTables(client, fullBackupTables);

  await writeJson(resolve(outputDir, "manifest.json"), {
    createdAt: new Date().toISOString(),
    format: "secretary-backup-v1",
    includes: {
      database: fullBackupTables,
      speechProfiles: true,
    },
  });
  await writeJson(resolve(outputDir, "database.json"), database);
  await copyTreeIfPresent(
    resolveRepoPath("runtime", "speech", "profiles"),
    resolve(outputDir, "runtime", "speech", "profiles"),
  );

  console.log(JSON.stringify({ backupDir: outputDir }, null, 2));
} finally {
  await client.end();
}
