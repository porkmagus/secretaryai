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
const verifyDatabaseName = "secretary_phase2_verify";
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

async function postChat(webPort, body) {
  const response = await fetch(`http://127.0.0.1:${webPort}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Chat failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function waitForMemory(webPort, searchText) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `http://127.0.0.1:${webPort}/api/memories?search=${encodeURIComponent(searchText)}`,
      { cache: "no-store" },
    );

    if (response.ok) {
      const payload = await response.json();

      if (payload.memories?.length > 0) {
        return payload.memories[0];
      }
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for memory matching "${searchText}".`);
}

async function listMemories(webPort, searchText, includeSuppressed = false) {
  const response = await fetch(
    `http://127.0.0.1:${webPort}/api/memories?search=${encodeURIComponent(searchText)}${
      includeSuppressed ? "&includeSuppressed=true" : ""
    }`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`Memory listing failed with ${response.status}.`);
  }

  return response.json();
}

async function patchMemory(webPort, memoryId, body) {
  const response = await fetch(`http://127.0.0.1:${webPort}/api/memories/${memoryId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Memory patch failed: ${JSON.stringify(payload)}`);
  }

  return payload.memory;
}

async function waitForTask(webPort, taskFragment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${webPort}/api/tasks`, {
      cache: "no-store",
    });

    if (response.ok) {
      const payload = await response.json();
      const task = payload.tasks?.find((entry) =>
        String(entry.title).toLowerCase().includes(taskFragment.toLowerCase()),
      );

      if (task) {
        return task;
      }
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for task matching "${taskFragment}".`);
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
const uniquePreference = `amber lantern coffee token ${Date.now()}`;

await runCommand(npmCommand, ["run", "storage:prepare"]);
await waitForDatabase(postgresAdminUrl);
await ensureVerificationDatabase();
await waitForDatabase(databaseUrl);
await runCommand(npmCommand, ["run", "build"]);
await runCommand(npmCommand, ["run", "db:migrate"], {
  DATABASE_URL: databaseUrl,
});

const worker = startProcess(nodeCommand, ["apps/worker/dist/index.js"], env);
const web = startWebProcess(
  webPort,
  {
    WORKER_BASE_URL: env.WORKER_BASE_URL,
    DEFAULT_USER_ID: env.DEFAULT_USER_ID,
  },
);

try {
  await waitForUrl(`http://127.0.0.1:${workerPort}/health/live`, "worker");
  await waitForUrl(`http://127.0.0.1:${webPort}/`, "web");

  const memoryTurn = await postChat(webPort, {
    text: `Remember that I prefer ${uniquePreference}.`,
  });
  const memory = await waitForMemory(webPort, uniquePreference);
  const pinnedMemory = await patchMemory(webPort, memory.id, {
    pinned: true,
    suppressed: false,
  });

  const recallTurn = await postChat(webPort, {
    conversationId: memoryTurn.conversationId,
    text: `What do you remember about ${uniquePreference}?`,
  });

  const suppressedMemory = await patchMemory(webPort, memory.id, {
    pinned: false,
    suppressed: true,
  });
  const relatedMemories = await listMemories(webPort, uniquePreference, true);

  for (const relatedMemory of relatedMemories.memories) {
    if (relatedMemory.id !== memory.id && !relatedMemory.suppressed) {
      await patchMemory(webPort, relatedMemory.id, {
        suppressed: true,
        pinned: false,
      });
    }
  }

  const suppressedRecallTurn = await postChat(webPort, {
    conversationId: memoryTurn.conversationId,
    text: `What do you remember about ${uniquePreference} now?`,
  });

  await postChat(webPort, {
    conversationId: memoryTurn.conversationId,
    text: "Remind me to verify the phase two checkpoint tomorrow.",
  });
  const task = await waitForTask(webPort, "verify the phase two checkpoint");

  const researchTurn = await postChat(webPort, {
    conversationId: memoryTurn.conversationId,
    text: "Compare Docker and Podman for this project.",
  });

  const activityResponse = await fetch(
    `http://127.0.0.1:${webPort}/api/activity/${memoryTurn.conversationId}`,
    { cache: "no-store" },
  );
  const activity = await activityResponse.json();

  if (!activityResponse.ok) {
    throw new Error(`Activity failed: ${JSON.stringify(activity)}`);
  }

  const activityNames = activity.traces.map((trace) => trace.eventName);

  if (!recallTurn.outputText.includes("Relevant memory in play")) {
    throw new Error("Expected memory recall response to include retrieved memory.");
  }

  if (
    !suppressedRecallTurn.outputText.includes("I don't have a strong stored memory match")
  ) {
    throw new Error(
      `Expected suppressed memory to stop appearing in recall response. Output: ${suppressedRecallTurn.outputText}`,
    );
  }

  if (!researchTurn.outputText.includes("delegated an internal research pass")) {
    throw new Error("Expected research-shaped prompt to use the research specialist.");
  }

  if (!activityNames.includes("runtime.chat.context_assembled")) {
    throw new Error("Expected activity traces to include context assembly.");
  }

  if (!activityNames.includes("memory.specialist.completed")) {
    throw new Error("Expected activity traces to include memory specialist completion.");
  }

  if (!activityNames.includes("research.specialist.completed")) {
    throw new Error("Expected activity traces to include research specialist completion.");
  }

  console.log(
    JSON.stringify(
      {
        conversationId: memoryTurn.conversationId,
        memoryId: memory.id,
        pinnedMemory: pinnedMemory.pinned,
        suppressedMemory: suppressedMemory.suppressed,
        taskId: task.id,
        recallTraceId: recallTurn.traceId,
        researchTraceId: researchTurn.traceId,
        activityEvents: activityNames,
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
