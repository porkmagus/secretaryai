import { resolve } from "node:path";
import {
  copyTreeIfPresent,
  createClient,
  readJson,
  resolveRepoPath,
  restoreTables,
} from "../admin/snapshot-utils.mjs";

const databaseUrl = process.env.DATABASE_URL;
const inputDir = process.env.BACKUP_INPUT_DIR ?? process.argv[2];

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!inputDir) {
  throw new Error("Provide BACKUP_INPUT_DIR or a backup directory argument.");
}

const client = await createClient(databaseUrl);

try {
  const database = await readJson(resolve(inputDir, "database.json"));
  await restoreTables(client, database);
  await copyTreeIfPresent(
    resolve(inputDir, "runtime", "speech", "profiles"),
    resolveRepoPath("runtime", "speech", "profiles"),
  );

  console.log(JSON.stringify({ restoredFrom: inputDir }, null, 2));
} finally {
  await client.end();
}
