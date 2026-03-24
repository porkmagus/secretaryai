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
const databaseUrl = "postgres://postgres:postgres@127.0.0.1:5432/secretary";
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

async function runCommand(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
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

async function waitForDatabase() {
  let lastError = "unknown";

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client({ connectionString: databaseUrl });

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
await waitForDatabase();
await runCommand(npmCommand, ["run", "build"]);
await runCommand(npmCommand, ["run", "db:migrate"]);

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

  const deskPage = await fetch(`http://127.0.0.1:${webPort}/`, {
    cache: "no-store",
  });

  const chatResponse = await fetch(`http://127.0.0.1:${webPort}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "Phase 1 verification message",
    }),
  });
  const chatBody = await chatResponse.json();

  if (!chatResponse.ok) {
    throw new Error(`Chat failed: ${JSON.stringify(chatBody)}`);
  }

  const historyResponse = await fetch(
    `http://127.0.0.1:${webPort}/api/conversations/${chatBody.conversationId}`,
    { cache: "no-store" },
  );
  const historyBody = await historyResponse.json();

  if (!historyResponse.ok) {
    throw new Error(`History failed: ${JSON.stringify(historyBody)}`);
  }

  await killTree(web.child);
  await killTree(worker.child);
  await delay(2000);

  const restartedWorker = startProcess(nodeCommand, ["apps/worker/dist/index.js"], env);
  const restartedWeb = startWebProcess(
    webPort,
    {
      WORKER_BASE_URL: env.WORKER_BASE_URL,
      DEFAULT_USER_ID: env.DEFAULT_USER_ID,
    },
  );

  try {
    await waitForUrl(`http://127.0.0.1:${workerPort}/health/live`, "worker restart");
    await waitForUrl(`http://127.0.0.1:${webPort}/`, "web restart");

    const historyAfterRestartResponse = await fetch(
      `http://127.0.0.1:${webPort}/api/conversations/${chatBody.conversationId}`,
      { cache: "no-store" },
    );
    const historyAfterRestart = await historyAfterRestartResponse.json();

    if (!historyAfterRestartResponse.ok) {
      throw new Error(
        `History after restart failed: ${JSON.stringify(historyAfterRestart)}`,
      );
    }

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const counts = await client.query(
      `
        select
          (select count(*)::int from messages where conversation_id = $1) as messages,
          (select count(*)::int from jobs where payload_json->>'conversationId' = $1) as jobs,
          (select count(*)::int from activity_traces where conversation_id = $1) as traces
      `,
      [chatBody.conversationId],
    );
    await client.end();

    console.log(
      JSON.stringify(
        {
          deskPageStatus: deskPage.status,
          chatStatus: chatResponse.status,
          conversationId: chatBody.conversationId,
          historyStatus: historyResponse.status,
          historyAfterRestartStatus: historyAfterRestartResponse.status,
          counts: counts.rows[0],
          runtimeStorage: [
            "runtime/postgres",
            "runtime/redis",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await killTree(restartedWeb.child);
    await killTree(restartedWorker.child);
  }
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
