import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const useShell = process.platform === "win32";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCommand = process.execPath;
const verifyDatabaseName = "secretary_phase4_voice_verify";
const postgresAdminUrl = "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:5432/${verifyDatabaseName}`;
const redisUrl = "redis://127.0.0.1:6379";
const sttPort = 5001;
const sampleAudioPath = resolve(root, "runtime/speech/transcripts/phase4-voice-verify.wav");

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

async function waitForUrl(url, label, timeoutMs = 60000) {
  const attempts = Math.ceil(timeoutMs / 1000);
  let lastError = "unknown";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });

      if (response.ok || response.status < 500) {
        return response;
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
  if (!child?.pid) {
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

function startFakeTelegramApi(port, token, sampleAudioBuffer) {
  const state = {
    nextMessageId: 9000,
    sentMessages: [],
    sentAudioReplies: [],
    sentVoices: [],
    webhookSecret: null,
    webhookUrl: "",
  };

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (
      request.method === "GET" &&
      requestUrl.pathname === `/file/bot${token}/voice/phase4-voice-verify.wav`
    ) {
      response.statusCode = 200;
      response.setHeader("Content-Type", "audio/wav");
      response.end(sampleAudioBuffer);
      return;
    }

    const chunks = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBuffer = Buffer.concat(chunks);
    const rawBody = rawBuffer.toString("utf8");
    const contentType = request.headers["content-type"] ?? "";
    const body =
      typeof contentType === "string" && contentType.includes("application/json")
        ? rawBody
          ? JSON.parse(rawBody)
          : {}
        : {};
    const method = requestUrl.pathname.replace(`/bot${token}/`, "");

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
              username: "secretary_phase4_voice_bot",
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
      case "sendVoice": {
        state.nextMessageId += 1;
        const chatIdMatch = rawBody.match(/\r\n\r\n([0-9-]+)\r\n/);

        state.sentVoices.push({
          chatId: chatIdMatch?.[1] ?? "unknown",
          messageId: String(state.nextMessageId),
          size: rawBuffer.length,
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
      }
      case "sendAudio": {
        state.nextMessageId += 1;
        const chatIdMatch = rawBody.match(/\r\n\r\n([0-9-]+)\r\n/);

        state.sentAudioReplies.push({
          chatId: chatIdMatch?.[1] ?? "unknown",
          messageId: String(state.nextMessageId),
          size: rawBuffer.length,
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
      }
      case "getFile":
        response.end(
          JSON.stringify({
            ok: true,
            result: {
              file_id: body.file_id,
              file_path: "voice/phase4-voice-verify.wav",
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

async function waitForSpeechArtifact(webPort) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${webPort}/api/speech/artifacts`, {
      cache: "no-store",
    });

    if (response.ok) {
      const payload = await response.json();
      const artifact = payload.artifacts?.find(
        (entry) =>
          entry.artifactKind === "telegram_voice_note" &&
          entry.status === "transcribed" &&
          String(entry.transcriptText ?? "").includes("coffee over tea"),
      );

      if (artifact) {
        return artifact;
      }
    }

    await delay(1000);
  }

  throw new Error("Timed out waiting for transcribed Telegram voice artifact.");
}

async function waitForTtsArtifact(webPort, conversationId) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${webPort}/api/speech/artifacts`, {
      cache: "no-store",
    });

    if (response.ok) {
      const payload = await response.json();
      const artifact = payload.artifacts?.find(
        (entry) =>
          entry.conversationId === conversationId &&
          entry.artifactKind === "tts_output" &&
          entry.status === "synthesized",
      );

      if (artifact) {
        return artifact;
      }
    }

    await delay(1000);
  }

  throw new Error("Timed out waiting for synthesized TTS artifact.");
}

async function ensureSampleAudio() {
  if (process.platform !== "win32") {
    throw new Error("Phase 4 voice verification currently expects Windows speech synthesis.");
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        [
          "Add-Type -AssemblyName System.Speech",
          `$path = '${sampleAudioPath.replace(/\\/g, "\\\\")}'`,
          "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
          "$synth.SetOutputToWaveFile($path)",
          "$synth.Speak('Remember that I prefer coffee over tea.')",
          "$synth.Dispose()",
        ].join("; "),
      ],
      {
        cwd: root,
        stdio: "inherit",
        shell: false,
      },
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      rejectPromise(new Error(`Sample audio generation exited with ${code}`));
    });
  });

  return readFile(sampleAudioPath);
}

async function ensureSttService() {
  try {
    await waitForUrl(`http://127.0.0.1:${sttPort}/health/ready`, "stt service", 3000);
    return { process: null, reused: true };
  } catch {
    const sttProcess = startProcess(nodeCommand, ["scripts/speech/run-stt.mjs"], {
      STT_PORT: String(sttPort),
      STT_MODEL_SIZE: "base",
      STT_DEVICE: "cpu",
      STT_COMPUTE_TYPE: "int8",
    });

    await waitForUrl(`http://127.0.0.1:${sttPort}/health/ready`, "stt service", 180000);
    return { process: sttProcess, reused: false };
  }
}

async function ensureTtsService() {
  const ttsPort = 5002;

  try {
    await waitForUrl(`http://127.0.0.1:${ttsPort}/health/ready`, "tts service", 3000);
    return { process: null, reused: true, port: ttsPort };
  } catch {
    const ttsProcess = startProcess(nodeCommand, ["scripts/speech/run-tts.mjs"], {
      TTS_PORT: String(ttsPort),
      TTS_DEVICE: "cpu",
      TTS_DEFAULT_ENGINE: "chatterbox",
      TTS_DEFAULT_LANGUAGE: "en",
    });

    await waitForUrl(`http://127.0.0.1:${ttsPort}/health/ready`, "tts service", 600000);
    return { process: ttsProcess, reused: false, port: ttsPort };
  }
}

const fakeTelegramPort = await allocatePort();
const workerPort = await allocatePort();
const webPort = await allocatePort();
const telegramToken = "phase4-voice-test-token";
const telegramSecret = "phase4-voice-secret";
const defaultChatId = "551199";

await runCommand(npmCommand, ["run", "storage:prepare"]);
await waitForDatabase(postgresAdminUrl);
await ensureVerificationDatabase();
await waitForDatabase(databaseUrl);
await runCommand(npmCommand, ["run", "build"]);
await runCommand(npmCommand, ["run", "db:migrate"], {
  DATABASE_URL: databaseUrl,
});

const sampleAudioBuffer = await ensureSampleAudio();
const sttService = await ensureSttService();
const ttsService = await ensureTtsService();
const fakeTelegram = await startFakeTelegramApi(fakeTelegramPort, telegramToken, sampleAudioBuffer);

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
  STT_BASE_URL: `http://127.0.0.1:${sttPort}`,
  TTS_BASE_URL: `http://127.0.0.1:${ttsService.port}`,
};

const worker = startProcess(nodeCommand, ["apps/worker/dist/index.js"], env);
const web = startWebProcess(webPort, {
  WORKER_BASE_URL: env.WORKER_BASE_URL,
  DEFAULT_USER_ID: env.DEFAULT_USER_ID,
});

try {
  await waitForUrl(`http://127.0.0.1:${workerPort}/health/live`, "worker");
  await waitForUrl(`http://127.0.0.1:${webPort}/voice`, "voice page");

  await patchTelegramSettings(webPort, {
    enabled: true,
    webhookUrl: `http://127.0.0.1:${workerPort}`,
    defaultChatId,
  });

  await postJson(`http://127.0.0.1:${webPort}/api/integrations/telegram/sync-webhook`, {});

  const webhookResponse = await fetch(fakeTelegram.state.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": fakeTelegram.state.webhookSecret ?? "",
    },
    body: JSON.stringify({
      update_id: 41,
      message: {
        message_id: 401,
        date: Math.floor(Date.now() / 1000),
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
        voice: {
          file_id: "voice-phase4-test",
          mime_type: "audio/wav",
          duration: 2,
        },
      },
    }),
  });
  const webhookBody = await webhookResponse.json();

  if (!webhookResponse.ok || webhookBody.ignored) {
    throw new Error(`Telegram voice webhook failed: ${JSON.stringify(webhookBody)}`);
  }

  const artifact = await waitForSpeechArtifact(webPort);
  const ttsArtifact = await waitForTtsArtifact(webPort, artifact.conversationId);
  const historyResponse = await fetch(
    `http://127.0.0.1:${webPort}/api/conversations/${artifact.conversationId}`,
    { cache: "no-store" },
  );
  const historyBody = await historyResponse.json();

  if (!historyResponse.ok) {
    throw new Error(`Conversation history failed: ${JSON.stringify(historyBody)}`);
  }

  const assistantReply = fakeTelegram.state.sentMessages.at(-1)?.text ?? "";
  const userTranscript = historyBody.messages?.find((entry) => entry.role === "user")?.text ?? "";

  if (!userTranscript.includes("coffee over tea")) {
    throw new Error(`Expected user transcript in conversation history. Got: ${userTranscript}`);
  }

  if (!assistantReply.includes("marked this as something worth carrying forward")) {
    throw new Error(`Expected assistant reply to be based on STT transcript. Got: ${assistantReply}`);
  }

  if (
    fakeTelegram.state.sentVoices.length < 1 &&
    fakeTelegram.state.sentAudioReplies.length < 1
  ) {
    throw new Error("Expected Telegram voice-note flow to send a synthesized audio reply.");
  }

  console.log(
    JSON.stringify(
      {
        conversationId: artifact.conversationId,
        artifactId: artifact.id,
        transcriptText: artifact.transcriptText,
        assistantReply,
        reusedSttService: sttService.reused,
        reusedTtsService: ttsService.reused,
        sentAudioReplies: fakeTelegram.state.sentAudioReplies.length,
        sentVoices: fakeTelegram.state.sentVoices.length,
        ttsArtifactId: ttsArtifact.id,
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
        fakeTelegramState: fakeTelegram.state,
        sttLogs: sttService.process?.logs?.(),
        ttsLogs: ttsService.process?.logs?.(),
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
  await fakeTelegram.close();
  if (sttService.process) {
    await killTree(sttService.process.child);
  }
  if (ttsService.process) {
    await killTree(ttsService.process.child);
  }
}
