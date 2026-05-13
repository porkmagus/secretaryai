import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
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

async function postChat(workerPort, body, overrides = {}) {
  const response = await fetch(`http://127.0.0.1:${workerPort}/runtime/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "web",
      conversationId: body.conversationId,
      message: {
        text: body.text,
      },
      userId: env.DEFAULT_USER_ID,
      ...overrides,
    }),
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

async function getAgentJobs(workerPort) {
  const response = await fetch(`http://127.0.0.1:${workerPort}/runtime/agent-jobs`, {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Agent jobs fetch failed: ${JSON.stringify(payload)}`);
  }

  return payload.jobs;
}

async function _getAgentJobDetail(workerPort, jobId) {
  const response = await fetch(`http://127.0.0.1:${workerPort}/runtime/agent-jobs/${jobId}`, {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Agent job detail failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function cancelAgentJob(workerPort, jobId) {
  const response = await fetch(
    `http://127.0.0.1:${workerPort}/runtime/agent-jobs/${jobId}/cancel`,
    {
      method: "POST",
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Agent job cancel failed: ${JSON.stringify(payload)}`);
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

const verificationWorkspace = resolve(root, "runtime", "agent-jobs", "phase5-verify-workspace");
const fakeRequirementJobId = "msg_phase5_requirement_job";
const fakeRequirementId = "msg_phase5_requirement";

await runCommand(npmCommand, ["run", "storage:prepare"]);
await mkdir(verificationWorkspace, { recursive: true });
await writeFile(
  resolve(verificationWorkspace, "package.json"),
  JSON.stringify(
    {
      name: "phase5-verify-workspace",
      private: true,
      scripts: {
        verify: "echo verify",
      },
    },
    null,
    2,
  ),
  "utf8",
);
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

  const _toolKeys = toolsBody.tools.map((tool) => tool.key).sort();
  const searchTurn = await postChat(workerPort, {
    text: "search the web for secretary assistant architecture",
  });

  if (!String(searchTurn.outputText).includes("I searched the web for")) {
    throw new Error(`Expected web search tool output. Got: ${JSON.stringify(searchTurn)}`);
  }

  const approvalTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "run git status",
  });

  if (!approvalTurn.pendingApproval?.executionId) {
    throw new Error(
      `Expected shell command approval request. Got: ${JSON.stringify(approvalTurn)}`,
    );
  }

  const approvedExecution = await postApproval(
    webPort,
    approvalTurn.pendingApproval.executionId,
    "approve",
  );

  if (approvedExecution.execution.executionStatus !== "completed") {
    throw new Error(
      `Expected approved execution to complete. Got: ${JSON.stringify(approvedExecution)}`,
    );
  }

  const deniedTurn = await postChat(workerPort, {
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
    throw new Error(
      `Expected denied execution to stay denied. Got: ${JSON.stringify(deniedExecution)}`,
    );
  }

  const taskCreateTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "remind me to send the invoice tomorrow at 4 pm",
  });

  if (!String(taskCreateTurn.outputText).includes("Send The Invoice")) {
    throw new Error(`Expected task creation output. Got: ${JSON.stringify(taskCreateTurn)}`);
  }

  const taskListTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "what's on my list",
  });

  if (!String(taskListTurn.outputText).includes("Send The Invoice")) {
    throw new Error(`Expected task list output. Got: ${JSON.stringify(taskListTurn)}`);
  }

  const taskDoneTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "mark send the invoice done",
  });

  if (!String(taskDoneTurn.outputText).includes('marked "Send The Invoice" as done')) {
    throw new Error(`Expected task completion output. Got: ${JSON.stringify(taskDoneTurn)}`);
  }

  const telegramTaskTurn = await postChat(
    workerPort,
    {
      text: "remind me to ping the contractor tomorrow at 9 am",
    },
    {
      channel: "telegram",
      metadata: {
        telegramChatId: "tg-chat-1",
        telegramChatLabel: "Verification Thread",
        telegramUserDisplayName: "Verifier",
      },
    },
  );

  if (!String(telegramTaskTurn.outputText).includes("Ping The Contractor")) {
    throw new Error(
      `Expected telegram task creation output. Got: ${JSON.stringify(telegramTaskTurn)}`,
    );
  }

  const telegramApprovalPrompt = await postChat(
    workerPort,
    {
      conversationId: telegramTaskTurn.conversationId,
      text: "run git status",
    },
    {
      channel: "telegram",
      metadata: {
        telegramChatId: "tg-chat-1",
        telegramChatLabel: "Verification Thread",
        telegramUserDisplayName: "Verifier",
      },
    },
  );

  if (!String(telegramApprovalPrompt.outputText).includes("needs approval")) {
    throw new Error(
      `Expected telegram approval prompt. Got: ${JSON.stringify(telegramApprovalPrompt)}`,
    );
  }

  const telegramApprovalDecision = await postChat(
    workerPort,
    {
      conversationId: telegramTaskTurn.conversationId,
      text: "yes",
    },
    {
      channel: "telegram",
      metadata: {
        telegramChatId: "tg-chat-1",
        telegramChatLabel: "Verification Thread",
        telegramUserDisplayName: "Verifier",
      },
    },
  );

  if (!String(telegramApprovalDecision.outputText).includes("approved")) {
    throw new Error(
      `Expected telegram approval execution output. Got: ${JSON.stringify(telegramApprovalDecision)}`,
    );
  }

  const emailDraftTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "draft an email to Alex about the launch checklist saying we are ready for review tomorrow morning",
  });

  if (!String(emailDraftTurn.outputText).includes("email to Alex")) {
    throw new Error(`Expected email draft output. Got: ${JSON.stringify(emailDraftTurn)}`);
  }

  const calendarTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "schedule event launch checklist review tomorrow at 3 pm for 30 minutes",
  });

  if (!String(calendarTurn.outputText).includes("calendar event")) {
    throw new Error(`Expected calendar draft output. Got: ${JSON.stringify(calendarTurn)}`);
  }

  const browserTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "open https://example.com/launch-plan in the browser",
  });

  if (!String(browserTurn.outputText).includes("browser follow-up")) {
    throw new Error(`Expected browser target output. Got: ${JSON.stringify(browserTurn)}`);
  }

  const launchPromptTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: `build me a tiny checklist app in \`${verificationWorkspace}\``,
  });

  if (!String(launchPromptTurn.outputText).includes("agent job")) {
    throw new Error(`Expected build job confirmation. Got: ${JSON.stringify(launchPromptTurn)}`);
  }

  const launchApprovedTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "go for it, use this folder",
  });

  if (!String(launchApprovedTurn.outputText).includes("started the agent job")) {
    throw new Error(`Expected agent job launch output. Got: ${JSON.stringify(launchApprovedTurn)}`);
  }

  const launchedJobs = await getAgentJobs(workerPort);
  const launchedJobRecord = launchedJobs.find(
    (job) => job.conversationId === searchTurn.conversationId,
  );

  if (!launchedJobRecord) {
    throw new Error(`Expected launched agent job record. Got: ${JSON.stringify(launchedJobs)}`);
  }

  const dbClient = new Client({ connectionString: databaseUrl });
  await dbClient.connect();
  try {
    await dbClient.query(
      `insert into jobs (id, job_type, status, payload_json, scheduled_for, created_at, updated_at)
       values ($1, 'agent.build', 'waiting_for_runtime', '{}'::jsonb, now(), now(), now())`,
      [fakeRequirementJobId],
    );
    await dbClient.query(
      `insert into agent_jobs (job_id, requested_by_user_id, conversation_id, title, goal, workspace_path, approval_mode, blocker_summary)
       values ($1, $2, $3, $4, $5, $6, 'builder', 'Waiting on verification approval')`,
      [
        fakeRequirementJobId,
        env.DEFAULT_USER_ID,
        searchTurn.conversationId,
        "Verification requirement job",
        "Verify conversational requirement approvals",
        verificationWorkspace,
      ],
    );
    await dbClient.query(
      `insert into agent_job_requirements (id, job_id, requirement_kind, label, detail, status, metadata_json, created_at, updated_at)
       values ($1, $2, 'network', 'Network access is disabled', 'Enable network access before continuing.', 'pending', '{}'::jsonb, now(), now())`,
      [fakeRequirementId, fakeRequirementJobId],
    );
  } finally {
    await dbClient.end();
  }

  const requirementApprovalTurn = await postChat(workerPort, {
    conversationId: searchTurn.conversationId,
    text: "yes, continue with that",
  });

  if (!String(requirementApprovalTurn.outputText).includes("continuing the build job")) {
    throw new Error(
      `Expected requirement approval output. Got: ${JSON.stringify(requirementApprovalTurn)}`,
    );
  }

  await cancelAgentJob(workerPort, launchedJobRecord.id);

  const tasksResponse = await fetch(`http://127.0.0.1:${workerPort}/runtime/tasks`, {
    cache: "no-store",
  });
  const tasksBody = await tasksResponse.json();

  if (!tasksResponse.ok) {
    throw new Error(`Tasks API failed: ${JSON.stringify(tasksBody)}`);
  }

  const telegramTask = tasksBody.tasks.find((task) => task.title === "Ping The Contractor");
  if (
    !telegramTask ||
    telegramTask.deliveryChannelType !== "telegram" ||
    telegramTask.deliveryTargetRef !== "tg-chat-1"
  ) {
    throw new Error(
      `Expected telegram task delivery metadata. Got: ${JSON.stringify(telegramTask ?? null)}`,
    );
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

  const _statuses = executionBody.executions.map((execution) => ({
    key: execution.toolKey,
    status: execution.executionStatus,
    approval: execution.approvalState,
  }));
} finally {
  await killTree(web.child);
  await killTree(worker.child);
}
