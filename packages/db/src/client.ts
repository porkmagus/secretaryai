import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDbClient(connectionString: string) {
  const pool = new Pool({
    connectionString,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async checkHealth() {
      await pool.query("select 1");
    },
    async close() {
      await pool.end();
    },
  };
}

export type DbClient = ReturnType<typeof createDbClient>;
