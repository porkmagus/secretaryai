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
const verifyDatabaseName = "secretary_phase6_verify";
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

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`${url} failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

const workerPort = await allocatePort();
const webPort = await allocatePort();
const backupDir = resolve(root, "runtime", "backups", "phase6-verify");
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
  await waitForUrl(`http://127.0.0.1:${webPort}/onboarding`, "onboarding page");
  await waitForUrl(`http://127.0.0.1:${webPort}/health`, "health page");
  await waitForUrl(`http://127.0.0.1:${webPort}/persona`, "persona page");

  const health = await fetchJson(`http://127.0.0.1:${webPort}/api/system/health`);
  if (!health.storage.some((entry) => entry.label === "Backups" && entry.exists)) {
    throw new Error(`Expected visible backups storage. Got: ${JSON.stringify(health.storage)}`);
  }

  const onboarding = await fetchJson(`http://127.0.0.1:${webPort}/api/onboarding`);
  if (!Array.isArray(onboarding.steps) || onboarding.steps.length < 5) {
    throw new Error(`Expected onboarding steps. Got: ${JSON.stringify(onboarding)}`);
  }

  const originalPersona = await fetchJson(`http://127.0.0.1:${webPort}/api/persona`);
  const patchedPersona = await fetchJson(`http://127.0.0.1:${webPort}/api/persona`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Secretary Prime",
      toneMode: "precise",
      promptTemplate: "Be precise, steady, and transparent.",
      behaviorRules: ["Stay calm", "Be explicit about state"],
    }),
  });

  if (patchedPersona.persona.name !== "Secretary Prime") {
    throw new Error(`Persona patch did not stick: ${JSON.stringify(patchedPersona)}`);
  }

  const exported = await fetchJson(`http://127.0.0.1:${webPort}/api/export/settings`);

  await fetchJson(`http://127.0.0.1:${webPort}/api/persona`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Temporary Divergence",
      toneMode: "sharp",
      promptTemplate: "This should be overwritten by import.",
      behaviorRules: ["Temporary rule"],
    }),
  });

  const imported = await fetchJson(`http://127.0.0.1:${webPort}/api/import/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ snapshot: exported.snapshot }),
  });

  if (imported.persona.name !== "Secretary Prime") {
    throw new Error(`Import did not restore exported persona: ${JSON.stringify(imported)}`);
  }

  await runCommand(npmCommand, ["run", "backup:create"], {
    ...env,
    BACKUP_OUTPUT_DIR: backupDir,
    DATABASE_URL: databaseUrl,
  });

  await fetchJson(`http://127.0.0.1:${webPort}/api/persona`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Needs Restore",
      toneMode: "rough",
      promptTemplate: "This should be replaced by restore.",
      behaviorRules: ["Restore me"],
    }),
  });

  await runCommand(npmCommand, ["run", "backup:restore", "--", backupDir], {
    ...env,
    BACKUP_INPUT_DIR: backupDir,
    DATABASE_URL: databaseUrl,
  });

  const restoredPersona = await fetchJson(`http://127.0.0.1:${webPort}/api/persona`);
  if (restoredPersona.persona.name !== "Secretary Prime") {
    throw new Error(`Backup restore did not restore persona state: ${JSON.stringify(restoredPersona)}`);
  }

  console.log(
    JSON.stringify(
      {
        onboardingSteps: onboarding.steps.length,
        personaNameBefore: originalPersona.persona.name,
        personaNameAfterImport: imported.persona.name,
        personaNameAfterRestore: restoredPersona.persona.name,
        backupDir,
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
