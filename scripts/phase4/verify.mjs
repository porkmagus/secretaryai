import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const useShell = process.platform === "win32";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCommand = process.execPath;
const verifyDatabaseName = "secretary_phase4_verify";
const postgresAdminUrl = "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:5432/${verifyDatabaseName}`;
const redisUrl = "redis://127.0.0.1:6379";

function startProcess(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    logs() {
      return { stdout, stderr };
    },
  };
}

function startWebProcess(port, env) {
  if (process.platform === "win32") {
    return startProcess(
      "cmd.exe",
      ["/d", "/s", "/c", `npm run start --workspace @secretary/web -- --port ${port}`],
      env,
    );
  }

  return startProcess(
    npmCommand,
    ["run", "start", "--workspace", "@secretary/web", "--", "--port", String(port)],
    env,
  );
}

async function runCommand(command, args, env = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: useShell,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function allocatePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        rejectPromise(new Error("Unable to allocate port."));
        return;
      }

      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForUrl(url, label) {
  let lastError = "unknown";

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });

      if (response.ok || response.status < 500) {
        return;
      }

      lastError = `${label} returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for ${label}: ${lastError}`);
}

async function waitForDatabase(connectionString) {
  let lastError = "unknown";

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client({ connectionString });

    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await client.end().catch(() => undefined);
      await delay(1000);
    }
  }

  throw new Error(`Timed out waiting for Postgres: ${lastError}`);
}

async function ensureVerificationDatabase() {
  const client = new Client({ connectionString: postgresAdminUrl });
  await client.connect();

  try {
    await client.query(
      `
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()
      `,
      [verifyDatabaseName],
    );
    await client.query(`drop database if exists ${verifyDatabaseName}`);
    await client.query(`create database ${verifyDatabaseName}`);
  } finally {
    await client.end();
  }
}

async function killTree(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
      });

      killer.on("exit", () => resolvePromise(undefined));
    });

    return;
  }

  child.kill("SIGTERM");
}

async function waitForVoiceProfile(connectionString) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const client = new Client({ connectionString });

    try {
      await client.connect();
      const result = await client.query(
        "select id, name, engine_id from voice_profiles order by updated_at desc limit 1",
      );
      await client.end();

      if (result.rows[0]) {
        return result.rows[0];
      }
    } catch {
      await client.end().catch(() => undefined);
    }

    await delay(1000);
  }

  throw new Error("Timed out waiting for seeded voice profile.");
}

async function insertSpeechArtifact(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();

  const artifact = {
    id: `speech_${randomUUID()}`,
    storageKey: `transcripts/${Date.now()}-${randomUUID()}.txt`,
    transcriptText: "Phase four verification transcript from seeded speech artifact.",
  };

  try {
    await client.query(
      `
        insert into speech_artifacts (
          id,
          conversation_id,
          message_id,
          artifact_kind,
          status,
          storage_key,
          mime_type,
          duration_ms,
          transcript_text,
          source_channel,
          source_ref
        )
        values ($1, null, null, 'stt_transcript', 'transcribed', $2, 'text/plain', 4200, $3, 'web', 'phase4-verify')
      `,
      [artifact.id, artifact.storageKey, artifact.transcriptText],
    );
  } finally {
    await client.end();
  }

  return artifact;
}

const workerPort = await allocatePort();
const webPort = await allocatePort();
const env = {
  NODE_ENV: "development",
  APP_BASE_URL: `http://127.0.0.1:${webPort}`,
  WORKER_BASE_URL: `http://127.0.0.1:${workerPort}`,
  WEB_PORT: String(webPort),
  WORKER_PORT: String(workerPort),
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  LOG_LEVEL: "info",
  DEFAULT_USER_ID: "local-owner",
  DEFAULT_PERSONA_ID: "secretary-default",
};

await runCommand(npmCommand, ["run", "storage:prepare"]);
await waitForDatabase(postgresAdminUrl);
await ensureVerificationDatabase();
await waitForDatabase(databaseUrl);
await runCommand(npmCommand, ["run", "build"]);
await runCommand(npmCommand, ["run", "db:migrate"], {
  DATABASE_URL: databaseUrl,
});

const worker = startProcess(nodeCommand, ["apps/worker/dist/index.js"], env);
const web = startWebProcess(webPort, {
  WORKER_BASE_URL: env.WORKER_BASE_URL,
  DEFAULT_USER_ID: env.DEFAULT_USER_ID,
});

try {
  await waitForUrl(`http://127.0.0.1:${workerPort}/health/live`, "worker");
  await waitForUrl(`http://127.0.0.1:${webPort}/voice`, "voice page");

  const seededProfile = await waitForVoiceProfile(databaseUrl);
  const insertedArtifact = await insertSpeechArtifact(databaseUrl);

  const voicePage = await fetch(`http://127.0.0.1:${webPort}/voice`, {
    cache: "no-store",
  });
  const profilesResponse = await fetch(`http://127.0.0.1:${webPort}/api/voice/profiles`, {
    cache: "no-store",
  });
  const artifactsResponse = await fetch(`http://127.0.0.1:${webPort}/api/speech/artifacts`, {
    cache: "no-store",
  });

  const profilesBody = await profilesResponse.json();
  const artifactsBody = await artifactsResponse.json();

  if (!profilesResponse.ok) {
    throw new Error(`Voice profiles request failed: ${JSON.stringify(profilesBody)}`);
  }

  if (!artifactsResponse.ok) {
    throw new Error(`Speech artifacts request failed: ${JSON.stringify(artifactsBody)}`);
  }

  const profile = profilesBody.profiles?.[0];
  const artifact = artifactsBody.artifacts?.find((entry) => entry.id === insertedArtifact.id);

  if (!profile) {
    throw new Error("Expected at least one voice profile from the worker.");
  }

  if (!artifact) {
    throw new Error("Expected inserted speech artifact to be returned through the web API.");
  }

  if (!artifact.transcriptText?.includes("Phase four verification transcript")) {
    throw new Error("Expected speech artifact transcript text to round-trip through the API.");
  }

  console.log(
    JSON.stringify(
      {
        voicePageStatus: voicePage.status,
        seededProfile,
        profileCount: profilesBody.profiles.length,
        artifactCount: artifactsBody.artifacts.length,
        verifiedArtifactId: artifact.id,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
        workerLogs: worker.logs(),
        webLogs: web.logs(),
      },
      null,
      2,
    ),
  );

  throw error;
} finally {
  await killTree(web.child);
  await killTree(worker.child);
}
