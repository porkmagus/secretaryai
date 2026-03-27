import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
const missingWorkspacePath = resolve(root, "runtime/agent-jobs/qualification-missing");
const scratchWorkspacePath = resolve(root, "runtime/agent-jobs/qualification-scratch");

async function fetchJson(path, init) {
  let lastError = "unknown";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`${workerBaseUrl}${path}`, init);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
      }

      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(500);
    }
  }

  throw new Error(lastError);
}

async function waitFor(predicate, label, attempts = 20, intervalMs = 1000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function postChat(body) {
  return fetchJson("/runtime/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function run() {
  await mkdir(scratchWorkspacePath, { recursive: true });

  const ready = await fetchJson("/health/ready");
  if (!ready.ok) {
    throw new Error(`Worker is not ready: ${JSON.stringify(ready)}`);
  }

  const originalSettings = await fetchJson("/runtime/agent-job-settings");

  try {
    await fetchJson("/runtime/agent-job-settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        defaultWorkspacePath: missingWorkspacePath,
        browserVerificationEnabled: false,
        executionBackend: "host_native",
      }),
    });

    const webLaunch = await postChat({
      channel: "web",
      userId: "local-owner",
      message: {
        text: "Build me a tiny qualification app with a clear README.",
      },
    });

    if (!/larger build job/i.test(webLaunch.outputText)) {
      throw new Error(`Expected conversational launch confirmation. Got: ${webLaunch.outputText}`);
    }

    const webAccepted = await postChat({
      channel: "web",
      userId: "local-owner",
      conversationId: webLaunch.conversationId,
      message: {
        text: "yes",
      },
    });

    if (!/started the agent job/i.test(webAccepted.outputText)) {
      throw new Error(`Expected launch acceptance. Got: ${webAccepted.outputText}`);
    }

    const launchedJob = await waitFor(async () => {
      const jobs = await fetchJson("/runtime/agent-jobs");
      return jobs.jobs.find((job) => job.conversationId === webLaunch.conversationId) ?? null;
    }, "web-launched agent job");

    const blockedDetail = await waitFor(async () => {
      const detail = await fetchJson(`/runtime/agent-jobs/${launchedJob.id}`);
      return detail.requirements.length > 0 ? detail : null;
    }, "runtime-blocked job detail");

    const requirementPrompt = await postChat({
      channel: "web",
      userId: "local-owner",
      conversationId: webLaunch.conversationId,
      message: {
        text: "what do you need?",
      },
    });

    if (!/waiting on/i.test(requirementPrompt.outputText)) {
      throw new Error(`Expected requirement prompt. Got: ${requirementPrompt.outputText}`);
    }

    const deniedRequirement = await postChat({
      channel: "web",
      userId: "local-owner",
      conversationId: webLaunch.conversationId,
      message: {
        text: "no",
      },
    });

    if (!/Denied:/i.test(deniedRequirement.outputText)) {
      throw new Error(`Expected denied requirement response. Got: ${deniedRequirement.outputText}`);
    }

    const telegramLaunch = await postChat({
      channel: "telegram",
      userId: "local-owner",
      message: {
        text: "Create me a simple qualification bot.",
      },
      metadata: {
        telegramChatId: "agent-jobs-qualification",
        telegramChatLabel: "Agent Jobs Qualification",
      },
    });

    if (!/reply yes to start it as an agent job/i.test(telegramLaunch.outputText)) {
      throw new Error(`Expected Telegram launch confirmation. Got: ${telegramLaunch.outputText}`);
    }

    const telegramAccepted = await postChat({
      channel: "telegram",
      userId: "local-owner",
      conversationId: telegramLaunch.conversationId,
      message: {
        text: "yes",
      },
      metadata: {
        telegramChatId: "agent-jobs-qualification",
        telegramChatLabel: "Agent Jobs Qualification",
      },
    });

    if (!/started the agent job/i.test(telegramAccepted.outputText)) {
      throw new Error(`Expected Telegram job launch. Got: ${telegramAccepted.outputText}`);
    }

    const telegramJob = await waitFor(async () => {
      const jobs = await fetchJson("/runtime/agent-jobs");
      return jobs.jobs.find((job) => job.conversationId === telegramLaunch.conversationId) ?? null;
    }, "telegram-launched agent job");

    await fetchJson(`/runtime/agent-jobs/${launchedJob.id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    await fetchJson(`/runtime/agent-jobs/${telegramJob.id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    console.log(
      JSON.stringify(
        {
          webConversationId: webLaunch.conversationId,
          webJobId: launchedJob.id,
          webRequirementCount: blockedDetail.requirements.length,
          telegramConversationId: telegramLaunch.conversationId,
          telegramJobId: telegramJob.id,
          workerReady: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await fetchJson("/runtime/agent-job-settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(originalSettings.settings),
    });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
