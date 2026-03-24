import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");

export const fullBackupTables = [
  "users",
  "personas",
  "integrations",
  "tools",
  "voice_profiles",
  "conversations",
  "messages",
  "memory_entries",
  "memory_links",
  "tasks",
  "jobs",
  "speech_artifacts",
  "tool_executions",
  "activity_traces",
];

export const restoreOrder = [
  "users",
  "personas",
  "integrations",
  "tools",
  "voice_profiles",
  "conversations",
  "messages",
  "memory_entries",
  "memory_links",
  "tasks",
  "jobs",
  "speech_artifacts",
  "tool_executions",
  "activity_traces",
];

export const settingsTables = ["personas", "integrations", "tools", "voice_profiles"];

export function resolveRepoPath(...segments) {
  return resolve(root, ...segments);
}

export async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

export async function createClient(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

export async function exportTables(client, tables) {
  const snapshot = {};

  for (const table of tables) {
    const result = await client.query(
      `select coalesce(json_agg(row_to_json(t)), '[]'::json) as rows from (select * from ${table}) t`,
    );
    snapshot[table] = result.rows[0]?.rows ?? [];
  }

  return snapshot;
}

async function insertRows(client, table, rows) {
  if (!rows.length) {
    return;
  }

  const columns = Object.keys(rows[0]);
  const values = [];
  const normalizeValue = (value) => {
    if (value === null || value === undefined) {
      return value ?? null;
    }

    if (Array.isArray(value) || (typeof value === "object" && !(value instanceof Date))) {
      return JSON.stringify(value);
    }

    return value;
  };
  const placeholders = rows.map((row, rowIndex) => {
    const rowPlaceholders = columns.map((column, columnIndex) => {
      values.push(normalizeValue(row[column]));
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });

    return `(${rowPlaceholders.join(", ")})`;
  });

  await client.query(
    `insert into ${table} (${columns.map((column) => `"${column}"`).join(", ")}) values ${placeholders.join(", ")}`,
    values,
  );
}

export async function restoreTables(client, snapshot, tables = restoreOrder) {
  await client.query(`truncate table ${[...fullBackupTables].reverse().join(", ")} cascade`);

  for (const table of tables) {
    await insertRows(client, table, snapshot[table] ?? []);
  }
}

export async function writeJson(path, payload) {
  await ensureDirectory(dirname(path));
  await writeFile(path, JSON.stringify(payload, null, 2));
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function copyTreeIfPresent(source, destination) {
  try {
    await cp(source, destination, {
      recursive: true,
      force: true,
    });
  } catch {
    return false;
  }

  return true;
}
