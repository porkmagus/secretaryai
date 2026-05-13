import { createClient, readJson } from "./snapshot-utils.mjs";

const databaseUrl = process.env.DATABASE_URL;
const inputFile = process.env.IMPORT_INPUT_FILE ?? process.argv[2];

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!inputFile) {
  throw new Error("Provide IMPORT_INPUT_FILE or a settings file path argument.");
}

const client = await createClient(databaseUrl);
const toJson = (value) => JSON.stringify(value ?? null);

try {
  const payload = await readJson(inputFile);
  const snapshot = payload.snapshot ?? payload;

  await client.query("begin");

  for (const row of snapshot.personas ?? []) {
    await client.query(
      `
        insert into personas (id, name, tone_profile, behavior_rules, voice_profile_id, prompt_template, is_default, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id) do update set
          name = excluded.name,
          tone_profile = excluded.tone_profile,
          behavior_rules = excluded.behavior_rules,
          voice_profile_id = excluded.voice_profile_id,
          prompt_template = excluded.prompt_template,
          is_default = excluded.is_default,
          updated_at = excluded.updated_at
      `,
      [
        row.id,
        row.name,
        toJson(row.tone_profile),
        toJson(row.behavior_rules),
        row.voice_profile_id,
        row.prompt_template,
        row.is_default,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  for (const row of snapshot.integrations ?? []) {
    const existing = await client.query(
      "select id from integrations where integration_type = $1 limit 1",
      [row.integration_type],
    );

    if (existing.rowCount > 0) {
      await client.query(
        `
          update integrations
          set enabled = $2, config_json = $3, health_status = $4, last_checked_at = $5, last_error_text = $6, updated_at = $7
          where id = $1
        `,
        [
          existing.rows[0].id,
          row.enabled,
          toJson(row.config_json),
          row.health_status,
          row.last_checked_at,
          row.last_error_text,
          row.updated_at,
        ],
      );
    } else {
      await client.query(
        `
          insert into integrations (id, integration_type, enabled, config_json, health_status, last_checked_at, last_error_text, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          row.id,
          row.integration_type,
          row.enabled,
          toJson(row.config_json),
          row.health_status,
          row.last_checked_at,
          row.last_error_text,
          row.created_at,
          row.updated_at,
        ],
      );
    }
  }

  for (const row of snapshot.tools ?? []) {
    await client.query(
      `
        insert into tools (id, key, name, description, enabled, approval_mode, config_schema_json, health_status, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (key) do update set
          enabled = excluded.enabled,
          approval_mode = excluded.approval_mode,
          updated_at = excluded.updated_at
      `,
      [
        row.id,
        row.key,
        row.name,
        row.description,
        row.enabled,
        row.approval_mode,
        toJson(row.config_schema_json),
        row.health_status,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  for (const row of snapshot.voice_profiles ?? []) {
    await client.query(
      `
        insert into voice_profiles (id, name, engine_id, sample_storage_key, sample_mime_type, sample_duration_ms, quality_preset, speaking_style, is_active, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (id) do update set
          name = excluded.name,
          engine_id = excluded.engine_id,
          sample_storage_key = excluded.sample_storage_key,
          sample_mime_type = excluded.sample_mime_type,
          sample_duration_ms = excluded.sample_duration_ms,
          quality_preset = excluded.quality_preset,
          speaking_style = excluded.speaking_style,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `,
      [
        row.id,
        row.name,
        row.engine_id,
        row.sample_storage_key,
        row.sample_mime_type,
        row.sample_duration_ms,
        row.quality_preset,
        row.speaking_style,
        row.is_active,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
