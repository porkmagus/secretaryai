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
const verifyDatabaseName = "secretary_phase5_verify";
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

async function postApproval(webPort, executionId, decision) {
  const response = await fetch(
    `http://127.0.0.1:${webPort}/api/tool-executions/${executionId}/${decision}`,
    {
      method: "POST",
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Approval decision failed: ${JSON.stringify(payload)}`);
  }

  return payload;
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
  await waitForUrl(`http://127.0.0.1:${webPort}/tools`, "tools page");

  const toolsResponse = await fetch(`http://127.0.0.1:${webPort}/api/tools`, {
    cache: "no-store",
  });
  const toolsBody = await toolsResponse.json();

  if (!toolsResponse.ok) {
    throw new Error(`Tools API failed: ${JSON.stringify(toolsBody)}`);
  }

  const toolKeys = toolsBody.tools.map((tool) => tool.key).sort();

  const searchTurn = await postChat(webPort, {
    text: "search the web for secretary assistant architecture",
  });

  if (!String(searchTurn.outputText).includes("I searched the web for")) {
    throw new Error(`Expected web search tool output. Got: ${JSON.stringify(searchTurn)}`);
  }

  const approvalTurn = await postChat(webPort, {
    conversationId: searchTurn.conversationId,
    text: "run git status",
  });

  if (!approvalTurn.pendingApproval?.executionId) {
    throw new Error(`Expected shell command approval request. Got: ${JSON.stringify(approvalTurn)}`);
  }

  const approvedExecution = await postApproval(
    webPort,
    approvalTurn.pendingApproval.executionId,
    "approve",
  );

  if (approvedExecution.execution.executionStatus !== "completed") {
    throw new Error(`Expected approved execution to complete. Got: ${JSON.stringify(approvedExecution)}`);
  }

  const deniedTurn = await postChat(webPort, {
    conversationId: searchTurn.conversationId,
    text: "read file README.md",
  });

  if (!deniedTurn.pendingApproval?.executionId) {
    throw new Error(`Expected file read approval request. Got: ${JSON.stringify(deniedTurn)}`);
  }

  const deniedExecution = await postApproval(
    webPort,
    deniedTurn.pendingApproval.executionId,
    "deny",
  );

  if (deniedExecution.execution.executionStatus !== "denied") {
    throw new Error(`Expected denied execution to stay denied. Got: ${JSON.stringify(deniedExecution)}`);
  }

  const executionResponse = await fetch(
    `http://127.0.0.1:${webPort}/api/tool-executions?conversationId=${encodeURIComponent(searchTurn.conversationId)}`,
    {
      cache: "no-store",
    },
  );
  const executionBody = await executionResponse.json();

  if (!executionResponse.ok) {
    throw new Error(`Tool executions API failed: ${JSON.stringify(executionBody)}`);
  }

  const statuses = executionBody.executions.map((execution) => ({
    key: execution.toolKey,
    status: execution.executionStatus,
    approval: execution.approvalState,
  }));

  console.log(
    JSON.stringify(
      {
        conversationId: searchTurn.conversationId,
        toolKeys,
        approvedExecutionId: approvedExecution.execution.id,
        deniedExecutionId: deniedExecution.execution.id,
        executionStatuses: statuses,
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
