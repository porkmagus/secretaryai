import { spawn } from "node:child_process";
import http from "node:http";
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
const verifyDatabaseName = "secretary_phase3_verify";
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

function startFakeTelegramApi(port, token) {
  const state = {
    nextMessageId: 9000,
    sentMessages: [],
    webhookSecret: null,
    webhookUrl: "",
  };

  const server = http.createServer(async (request, response) => {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : {};
    const method = request.url?.replace(`/bot${token}/`, "") ?? "";

    response.setHeader("Content-Type", "application/json");

    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end(JSON.stringify({ ok: false, description: "Method not allowed" }));
      return;
    }

    switch (method) {
      case "getMe":
        response.end(
          JSON.stringify({
            ok: true,
            result: {
              id: 424242,
              is_bot: true,
              first_name: "Secretary",
              username: "secretary_phase3_bot",
            },
          }),
        );
        return;
      case "getWebhookInfo":
        response.end(
          JSON.stringify({
            ok: true,
            result: {
              url: state.webhookUrl,
              pending_update_count: 0,
            },
          }),
        );
        return;
      case "setWebhook":
        state.webhookUrl = body.url ?? "";
        state.webhookSecret = body.secret_token ?? null;
        response.end(JSON.stringify({ ok: true, result: true }));
        return;
      case "deleteWebhook":
        state.webhookUrl = "";
        state.webhookSecret = null;
        response.end(JSON.stringify({ ok: true, result: true }));
        return;
      case "sendMessage":
        state.nextMessageId += 1;
        state.sentMessages.push({
          chatId: String(body.chat_id),
          messageId: String(state.nextMessageId),
          text: String(body.text ?? ""),
        });
        response.end(
          JSON.stringify({
            ok: true,
            result: {
              message_id: state.nextMessageId,
            },
          }),
        );
        return;
      default:
        response.statusCode = 404;
        response.end(JSON.stringify({ ok: false, description: `Unknown method ${method}` }));
    }
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", () => {
      resolvePromise({
        close() {
          return new Promise((resolveClose) => server.close(() => resolveClose(undefined)));
        },
        state,
      });
    });
  });
}

async function patchTelegramSettings(webPort, body) {
  const response = await fetch(`http://127.0.0.1:${webPort}/api/integrations/telegram`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Telegram settings update failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${JSON.stringify(payload)}`);
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

const fakeTelegramPort = await allocatePort();
const workerPort = await allocatePort();
const webPort = await allocatePort();
const telegramToken = "phase3-test-token";
const telegramSecret = "phase3-secret";
const defaultChatId = "551199";
const fakeTelegram = await startFakeTelegramApi(fakeTelegramPort, telegramToken);

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
  TELEGRAM_API_BASE_URL: `http://127.0.0.1:${fakeTelegramPort}`,
  TELEGRAM_BOT_TOKEN: telegramToken,
  TELEGRAM_WEBHOOK_SECRET: telegramSecret,
  TELEGRAM_WEBHOOK_URL: `http://127.0.0.1:${workerPort}`,
  TELEGRAM_DEFAULT_CHAT_ID: defaultChatId,
};

const uniquePreference = `phase3 telegram coffee token ${Date.now()}`;

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
  await waitForUrl(`http://127.0.0.1:${webPort}/`, "web");

  const _channelsPage = await fetch(`http://127.0.0.1:${webPort}/channels`, {
    cache: "no-store",
  });

  await patchTelegramSettings(webPort, {
    enabled: true,
    webhookUrl: `http://127.0.0.1:${workerPort}`,
    defaultChatId,
  });

  const _syncResult = await postJson(
    `http://127.0.0.1:${webPort}/api/integrations/telegram/sync-webhook`,
    {},
  );

  if (!fakeTelegram.state.webhookUrl) {
    throw new Error("Expected Telegram webhook sync to store a webhook URL.");
  }

  const firstWebhook = await fetch(fakeTelegram.state.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": fakeTelegram.state.webhookSecret ?? "",
    },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 101,
        date: Math.floor(Date.now() / 1000),
        text: `Remember that I prefer ${uniquePreference}.`,
        chat: {
          id: Number(defaultChatId),
          type: "private",
          first_name: "Sean",
        },
        from: {
          id: 1,
          is_bot: false,
          first_name: "Sean",
          username: "sean",
        },
      },
    }),
  });
  const firstBody = await firstWebhook.json();

  if (!firstWebhook.ok || firstBody.ignored) {
    throw new Error(`First Telegram webhook failed: ${JSON.stringify(firstBody)}`);
  }

  await waitForMemory(webPort, uniquePreference);
  await delay(1000);

  const secondWebhook = await fetch(fakeTelegram.state.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": fakeTelegram.state.webhookSecret ?? "",
    },
    body: JSON.stringify({
      update_id: 2,
      message: {
        message_id: 102,
        date: Math.floor(Date.now() / 1000),
        text: `What do you remember about ${uniquePreference}?`,
        chat: {
          id: Number(defaultChatId),
          type: "private",
          first_name: "Sean",
        },
        from: {
          id: 1,
          is_bot: false,
          first_name: "Sean",
          username: "sean",
        },
      },
    }),
  });
  const secondBody = await secondWebhook.json();

  if (!secondWebhook.ok || secondBody.ignored) {
    throw new Error(`Second Telegram webhook failed: ${JSON.stringify(secondBody)}`);
  }

  if (secondBody.conversationId !== firstBody.conversationId) {
    throw new Error("Expected repeated Telegram messages to route into the same conversation.");
  }

  const secondReply = fakeTelegram.state.sentMessages.at(-1)?.text ?? "";

  if (!secondReply.includes("Relevant memory in play")) {
    throw new Error(
      `Expected Telegram recall reply to include memory context. Got: ${secondReply}`,
    );
  }

  const reminderWebhook = await fetch(fakeTelegram.state.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": fakeTelegram.state.webhookSecret ?? "",
    },
    body: JSON.stringify({
      update_id: 3,
      message: {
        message_id: 103,
        date: Math.floor(Date.now() / 1000),
        text: "Remind me to verify telegram reminder delivery in 0 minutes.",
        chat: {
          id: Number(defaultChatId),
          type: "private",
          first_name: "Sean",
        },
        from: {
          id: 1,
          is_bot: false,
          first_name: "Sean",
          username: "sean",
        },
      },
    }),
  });
  const reminderBody = await reminderWebhook.json();

  if (!reminderWebhook.ok || reminderBody.ignored) {
    throw new Error(`Reminder Telegram webhook failed: ${JSON.stringify(reminderBody)}`);
  }

  await delay(1000);

  const beforeReminderCount = fakeTelegram.state.sentMessages.length;
  const reminderDispatch = await postJson(
    `http://127.0.0.1:${webPort}/api/integrations/telegram/deliver-reminders`,
    {},
  );
  const afterReminderMessages = fakeTelegram.state.sentMessages.slice(beforeReminderCount);

  if (reminderDispatch.delivered < 1) {
    throw new Error(
      `Expected at least one Telegram reminder delivery. Got: ${JSON.stringify(reminderDispatch)}`,
    );
  }

  if (!afterReminderMessages.some((message) => message.text.includes("Reminder:"))) {
    throw new Error("Expected reminder dispatch to send a Telegram reminder message.");
  }

  const statusResponse = await fetch(`http://127.0.0.1:${webPort}/api/integrations/telegram`, {
    cache: "no-store",
  });
  const statusBody = await statusResponse.json();

  if (!statusResponse.ok) {
    throw new Error(`Telegram status request failed: ${JSON.stringify(statusBody)}`);
  }

  const historyResponse = await fetch(
    `http://127.0.0.1:${webPort}/api/conversations/${firstBody.conversationId}`,
    { cache: "no-store" },
  );
  const historyBody = await historyResponse.json();

  if (!historyResponse.ok) {
    throw new Error(`Conversation history failed: ${JSON.stringify(historyBody)}`);
  }

  await patchTelegramSettings(webPort, {
    enabled: false,
  });
  await postJson(`http://127.0.0.1:${webPort}/api/integrations/telegram/sync-webhook`, {});

  if (fakeTelegram.state.webhookUrl !== "") {
    throw new Error("Expected disabling Telegram to remove the webhook.");
  }
} finally {
  await killTree(web.child);
  await killTree(worker.child);
  await fakeTelegram.close();
}
