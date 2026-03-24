import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, "../migrations");

async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/secretary";

  const pool = new Pool({ connectionString });

  try {
    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migrations found.");
      return;
    }

    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      console.log(`Applying ${file}`);
      await pool.query(sql);
    }

    console.log("Migrations applied successfully.");
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error("Migration failed.");
  console.error(error);
  process.exit(1);
});
