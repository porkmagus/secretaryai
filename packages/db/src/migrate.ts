import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, "../migrations");

async function waitForDatabase(pool: Pool) {
  let lastError = "unknown";

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(1000);
    }
  }

  throw new Error(`Database did not become ready in time: ${lastError}`);
}

async function main() {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/secretary";

  const pool = new Pool({ connectionString });

  try {
    await waitForDatabase(pool);

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((_error) => {
  process.exit(1);
});
