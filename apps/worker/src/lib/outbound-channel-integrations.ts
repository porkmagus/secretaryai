import type { AppConfig } from "@secretary/config";
import type {
  DiscordTestMessageRequest,
  DiscordTestMessageResponse,
  EmailTestMessageRequest,
  EmailTestMessageResponse,
  OutboundChannelKey,
  OutboundChannelStatusRecord,
  OutboundChannelStatusResponse,
  SlackTestMessageRequest,
  SlackTestMessageResponse,
  SmsTestMessageRequest,
  SmsTestMessageResponse,
  UpdateDiscordIntegrationRequest,
  UpdateEmailIntegrationRequest,
  UpdateSlackIntegrationRequest,
  UpdateSmsIntegrationRequest,
} from "@secretary/core-runtime";
import { type DbClient, integrations } from "@secretary/db";
import { eq } from "drizzle-orm";

type DiscordIntegrationConfig = {
  targetLabel: string | null;
};

type SlackIntegrationConfig = {
  targetLabel: string | null;
};

type EmailIntegrationConfig = {
  defaultRecipient: string | null;
};

type SmsIntegrationConfig = {
  defaultRecipient: string | null;
  senderLabel: string | null;
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseDiscordConfig(
  value: Record<string, unknown> | null | undefined,
): DiscordIntegrationConfig {
  return {
    targetLabel: cleanString(value?.targetLabel),
  };
}

function parseSlackConfig(
  value: Record<string, unknown> | null | undefined,
): SlackIntegrationConfig {
  return {
    targetLabel: cleanString(value?.targetLabel),
  };
}

function parseEmailConfig(
  value: Record<string, unknown> | null | undefined,
): EmailIntegrationConfig {
  return {
    defaultRecipient: cleanString(value?.defaultRecipient),
  };
}

function parseSmsConfig(value: Record<string, unknown> | null | undefined): SmsIntegrationConfig {
  return {
    defaultRecipient: cleanString(value?.defaultRecipient),
    senderLabel: cleanString(value?.senderLabel),
  };
}

async function ensureIntegrationRecord(
  dbClient: DbClient,
  channelKey: OutboundChannelKey,
  defaultConfig: Record<string, unknown>,
) {
  await dbClient.db
    .insert(integrations)
    .values({
      id: channelKey,
      integrationType: channelKey,
      enabled: false,
      configJson: defaultConfig,
      healthStatus: "not_configured",
    })
    .onConflictDoNothing();

  const record = await dbClient.db.query.integrations.findFirst({
    where: eq(integrations.id, channelKey),
  });

  if (!record) {
    throw new Error(`${channelKey} integration record could not be created.`);
  }

  return record;
}

async function saveIntegrationRecord(params: {
  dbClient: DbClient;
  channelKey: OutboundChannelKey;
  configJson?: Record<string, unknown>;
  enabled?: boolean;
  healthStatus?: string;
  lastCheckedAt?: Date | null;
  lastErrorText?: string | null;
}) {
  await params.dbClient.db
    .update(integrations)
    .set({
      ...(params.configJson ? { configJson: params.configJson } : {}),
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      ...(params.healthStatus !== undefined ? { healthStatus: params.healthStatus } : {}),
      ...(params.lastCheckedAt !== undefined ? { lastCheckedAt: params.lastCheckedAt } : {}),
      ...(params.lastErrorText !== undefined ? { lastErrorText: params.lastErrorText } : {}),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, params.channelKey));
}

function buildStatus(params: {
  channelKey: OutboundChannelKey;
  label: string;
  enabled: boolean;
  envConfigured: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
  providerLabel: string;
  supportsSubject: boolean;
  supportsRichText: boolean;
  targetLabel: string | null;
  defaultRecipient: string | null;
  senderIdentity: string | null;
  configuredSummary: string;
  missingSummary: string;
}) {
  let healthStatus: OutboundChannelStatusRecord["healthStatus"];
  let healthSummary: string;

  if (!params.envConfigured) {
    healthStatus = "not_configured";
    healthSummary = params.missingSummary;
  } else if (!params.enabled) {
    healthStatus = "disabled";
    healthSummary = `${params.label} credentials are present, but the channel is disabled.`;
  } else if (params.lastError) {
    healthStatus = "degraded";
    healthSummary = `${params.label} hit an error recently. Review the latest send result below.`;
  } else {
    healthStatus = "ok";
    healthSummary = params.configuredSummary;
  }

  return {
    integration: {
      channelKey: params.channelKey,
      label: params.label,
      enabled: params.enabled,
      envConfigured: params.envConfigured,
      healthStatus,
      healthSummary,
      lastCheckedAt: params.lastCheckedAt?.toISOString() ?? null,
      lastError: params.lastError,
      providerLabel: params.providerLabel,
      supportsSubject: params.supportsSubject,
      supportsRichText: params.supportsRichText,
      targetLabel: params.targetLabel,
      defaultRecipient: params.defaultRecipient,
      senderIdentity: params.senderIdentity,
      deliverySummary: params.configuredSummary,
    },
  } satisfies OutboundChannelStatusResponse;
}

async function handleSendResult(params: {
  dbClient: DbClient;
  channelKey: OutboundChannelKey;
  result: Promise<void>;
}) {
  try {
    await params.result;
    await saveIntegrationRecord({
      dbClient: params.dbClient,
      channelKey: params.channelKey,
      healthStatus: "ok",
      lastCheckedAt: new Date(),
      lastErrorText: null,
    });
  } catch (error) {
    const lastErrorText = error instanceof Error ? error.message : String(error);
    await saveIntegrationRecord({
      dbClient: params.dbClient,
      channelKey: params.channelKey,
      healthStatus: "degraded",
      lastCheckedAt: new Date(),
      lastErrorText,
    });
    throw error;
  }
}

async function postJson(url: string, body: Record<string, unknown>, init?: RequestInit) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  });

  if (!response.ok) {
    const payloadText = await response.text();
    throw new Error(payloadText || `Request failed with status ${response.status}.`);
  }

  return response;
}

async function postForm(url: string, body: URLSearchParams, init?: RequestInit) {
  const response = await fetch(url, {
    method: "POST",
    body,
    ...init,
  });

  if (!response.ok) {
    const payloadText = await response.text();
    throw new Error(payloadText || `Request failed with status ${response.status}.`);
  }

  return response;
}

export async function getDiscordIntegrationStatus(dbClient: DbClient, config: AppConfig) {
  const record = await ensureIntegrationRecord(dbClient, "discord", {
    targetLabel: null,
  });
  const stored = parseDiscordConfig(record.configJson);

  return buildStatus({
    channelKey: "discord",
    label: "Discord",
    enabled: record.enabled,
    envConfigured: Boolean(config.channels.discord.webhookUrl),
    lastCheckedAt: record.lastCheckedAt,
    lastError: record.lastErrorText ?? null,
    providerLabel: "Discord webhook",
    supportsSubject: false,
    supportsRichText: true,
    targetLabel: stored.targetLabel,
    defaultRecipient: null,
    senderIdentity: config.channels.discord.webhookUrl ? "Configured webhook endpoint" : null,
    configuredSummary: "Ready to send notifications into the configured Discord channel.",
    missingSummary: "Add DISCORD_WEBHOOK_URL to enable Discord delivery.",
  });
}

export async function updateDiscordIntegrationSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  patch: UpdateDiscordIntegrationRequest;
}) {
  const record = await ensureIntegrationRecord(params.dbClient, "discord", {
    targetLabel: null,
  });
  const stored = parseDiscordConfig(record.configJson);
  await saveIntegrationRecord({
    dbClient: params.dbClient,
    channelKey: "discord",
    enabled: params.patch.enabled ?? record.enabled,
    configJson: {
      targetLabel:
        params.patch.targetLabel !== undefined
          ? cleanString(params.patch.targetLabel)
          : stored.targetLabel,
    },
  });

  return getDiscordIntegrationStatus(params.dbClient, params.config);
}

export async function sendDiscordTestMessage(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: DiscordTestMessageRequest;
}) {
  const status = await getDiscordIntegrationStatus(params.dbClient, params.config);
  const deliveredTo = status.integration.targetLabel ?? "Configured Discord webhook";
  const text =
    params.request.text?.trim() ||
    "Secretary Discord test message: the outbound channel is connected and ready.";

  await sendConfiguredDiscordMessage({
    config: params.config,
    dbClient: params.dbClient,
    text,
  });

  return {
    ok: true,
    deliveredTo,
  } satisfies DiscordTestMessageResponse;
}

export async function getSlackIntegrationStatus(dbClient: DbClient, config: AppConfig) {
  const record = await ensureIntegrationRecord(dbClient, "slack", {
    targetLabel: null,
  });
  const stored = parseSlackConfig(record.configJson);

  return buildStatus({
    channelKey: "slack",
    label: "Slack",
    enabled: record.enabled,
    envConfigured: Boolean(config.channels.slack.webhookUrl),
    lastCheckedAt: record.lastCheckedAt,
    lastError: record.lastErrorText ?? null,
    providerLabel: "Slack incoming webhook",
    supportsSubject: false,
    supportsRichText: true,
    targetLabel: stored.targetLabel,
    defaultRecipient: null,
    senderIdentity: config.channels.slack.webhookUrl ? "Configured Slack webhook" : null,
    configuredSummary: "Ready to send updates into the configured Slack channel.",
    missingSummary: "Add SLACK_WEBHOOK_URL to enable Slack delivery.",
  });
}

export async function updateSlackIntegrationSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  patch: UpdateSlackIntegrationRequest;
}) {
  const record = await ensureIntegrationRecord(params.dbClient, "slack", {
    targetLabel: null,
  });
  const stored = parseSlackConfig(record.configJson);
  await saveIntegrationRecord({
    dbClient: params.dbClient,
    channelKey: "slack",
    enabled: params.patch.enabled ?? record.enabled,
    configJson: {
      targetLabel:
        params.patch.targetLabel !== undefined
          ? cleanString(params.patch.targetLabel)
          : stored.targetLabel,
    },
  });

  return getSlackIntegrationStatus(params.dbClient, params.config);
}

export async function sendSlackTestMessage(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: SlackTestMessageRequest;
}) {
  const status = await getSlackIntegrationStatus(params.dbClient, params.config);
  const deliveredTo = status.integration.targetLabel ?? "Configured Slack webhook";
  const text =
    params.request.text?.trim() ||
    "Secretary Slack test message: the outbound channel is connected and ready.";

  await sendConfiguredSlackMessage({
    config: params.config,
    dbClient: params.dbClient,
    text,
  });

  return {
    ok: true,
    deliveredTo,
  } satisfies SlackTestMessageResponse;
}

export async function getEmailIntegrationStatus(dbClient: DbClient, config: AppConfig) {
  const record = await ensureIntegrationRecord(dbClient, "email", {
    defaultRecipient: null,
  });
  const stored = parseEmailConfig(record.configJson);

  return buildStatus({
    channelKey: "email",
    label: "Email",
    enabled: record.enabled,
    envConfigured: Boolean(config.channels.email.apiKey && config.channels.email.fromAddress),
    lastCheckedAt: record.lastCheckedAt,
    lastError: record.lastErrorText ?? null,
    providerLabel: "Resend",
    supportsSubject: true,
    supportsRichText: true,
    targetLabel: null,
    defaultRecipient: stored.defaultRecipient ?? config.channels.email.defaultTo,
    senderIdentity: config.channels.email.fromAddress,
    configuredSummary: "Ready to draft and send outbound email through Resend.",
    missingSummary: "Add RESEND_API_KEY and EMAIL_FROM_ADDRESS to enable email delivery.",
  });
}

export async function updateEmailIntegrationSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  patch: UpdateEmailIntegrationRequest;
}) {
  const record = await ensureIntegrationRecord(params.dbClient, "email", {
    defaultRecipient: null,
  });
  const stored = parseEmailConfig(record.configJson);
  await saveIntegrationRecord({
    dbClient: params.dbClient,
    channelKey: "email",
    enabled: params.patch.enabled ?? record.enabled,
    configJson: {
      defaultRecipient:
        params.patch.defaultRecipient !== undefined
          ? cleanString(params.patch.defaultRecipient)
          : stored.defaultRecipient,
    },
  });

  return getEmailIntegrationStatus(params.dbClient, params.config);
}

export async function sendEmailTestMessage(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: EmailTestMessageRequest;
}) {
  const record = await ensureIntegrationRecord(params.dbClient, "email", {
    defaultRecipient: null,
  });
  const stored = parseEmailConfig(record.configJson);
  const response = await sendConfiguredEmail({
    config: params.config,
    dbClient: params.dbClient,
    recipient:
      cleanString(params.request.to) ??
      stored.defaultRecipient ??
      params.config.channels.email.defaultTo,
    subject: cleanString(params.request.subject) ?? "Secretary email test",
    text:
      params.request.text?.trim() ||
      "Secretary email test message: the outbound email channel is connected and ready.",
  });

  return {
    ok: true,
    messageId: response.messageId,
    recipient: response.recipient,
  } satisfies EmailTestMessageResponse;
}

export async function sendConfiguredEmail(params: {
  config: AppConfig;
  dbClient: DbClient;
  recipient: string | null;
  subject: string;
  text: string;
}) {
  const apiKey = params.config.channels.email.apiKey;
  const fromAddress = params.config.channels.email.fromAddress;
  if (!apiKey || !fromAddress) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM_ADDRESS are required.");
  }

  if (!params.recipient) {
    throw new Error("No email recipient is configured for delivery.");
  }

  let messageId: string | null = null;
  await handleSendResult({
    dbClient: params.dbClient,
    channelKey: "email",
    result: (async () => {
      const response = await postJson(
        `${params.config.channels.email.apiBaseUrl.replace(/\/$/, "")}/emails`,
        {
          from: fromAddress,
          to: [params.recipient],
          subject: params.subject,
          text: params.text,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );
      const payload = (await response.json()) as { id?: string };
      messageId = payload.id ?? null;
    })(),
  });

  return {
    messageId,
    recipient: params.recipient,
  };
}

export async function sendConfiguredDiscordMessage(params: {
  config: AppConfig;
  dbClient: DbClient;
  text: string;
}) {
  const webhookUrl = params.config.channels.discord.webhookUrl;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured.");
  }

  await handleSendResult({
    dbClient: params.dbClient,
    channelKey: "discord",
    result: (async () => {
      await postJson(webhookUrl, { content: params.text });
    })(),
  });
}

export async function sendConfiguredSlackMessage(params: {
  config: AppConfig;
  dbClient: DbClient;
  text: string;
}) {
  const webhookUrl = params.config.channels.slack.webhookUrl;
  if (!webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is not configured.");
  }

  await handleSendResult({
    dbClient: params.dbClient,
    channelKey: "slack",
    result: (async () => {
      await postJson(webhookUrl, { text: params.text });
    })(),
  });
}

export async function getSmsIntegrationStatus(dbClient: DbClient, config: AppConfig) {
  const record = await ensureIntegrationRecord(dbClient, "sms", {
    defaultRecipient: null,
    senderLabel: null,
  });
  const stored = parseSmsConfig(record.configJson);

  return buildStatus({
    channelKey: "sms",
    label: "SMS",
    enabled: record.enabled,
    envConfigured: Boolean(
      config.channels.sms.accountSid &&
        config.channels.sms.authToken &&
        config.channels.sms.fromNumber,
    ),
    lastCheckedAt: record.lastCheckedAt,
    lastError: record.lastErrorText ?? null,
    providerLabel: "Twilio SMS",
    supportsSubject: false,
    supportsRichText: false,
    targetLabel: null,
    defaultRecipient: stored.defaultRecipient ?? config.channels.sms.defaultTo,
    senderIdentity: stored.senderLabel ?? config.channels.sms.fromNumber,
    configuredSummary: "Ready to send urgent SMS updates through Twilio.",
    missingSummary:
      "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable SMS delivery.",
  });
}

export async function updateSmsIntegrationSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  patch: UpdateSmsIntegrationRequest;
}) {
  const record = await ensureIntegrationRecord(params.dbClient, "sms", {
    defaultRecipient: null,
    senderLabel: null,
  });
  const stored = parseSmsConfig(record.configJson);
  await saveIntegrationRecord({
    dbClient: params.dbClient,
    channelKey: "sms",
    enabled: params.patch.enabled ?? record.enabled,
    configJson: {
      defaultRecipient:
        params.patch.defaultRecipient !== undefined
          ? cleanString(params.patch.defaultRecipient)
          : stored.defaultRecipient,
      senderLabel:
        params.patch.senderLabel !== undefined
          ? cleanString(params.patch.senderLabel)
          : stored.senderLabel,
    },
  });

  return getSmsIntegrationStatus(params.dbClient, params.config);
}

export async function sendSmsTestMessage(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: SmsTestMessageRequest;
}) {
  const record = await ensureIntegrationRecord(params.dbClient, "sms", {
    defaultRecipient: null,
    senderLabel: null,
  });
  const stored = parseSmsConfig(record.configJson);
  const recipient =
    cleanString(params.request.to) ??
    stored.defaultRecipient ??
    params.config.channels.sms.defaultTo;

  if (!recipient) {
    throw new Error("No SMS recipient is configured for test delivery.");
  }

  const result = await sendConfiguredSmsMessage({
    config: params.config,
    dbClient: params.dbClient,
    recipient,
    text:
      params.request.text?.trim() ||
      "Secretary SMS test: the outbound SMS channel is connected and ready.",
  });
  return { ok: true, recipient, sid: result.sid } satisfies SmsTestMessageResponse;
}

export async function sendConfiguredSmsMessage(params: {
  config: AppConfig;
  dbClient: DbClient;
  recipient: string | null;
  text: string;
}) {
  const accountSid = params.config.channels.sms.accountSid;
  const authToken = params.config.channels.sms.authToken;
  const fromNumber = params.config.channels.sms.fromNumber;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are required.");
  }

  if (!params.recipient) {
    throw new Error("No SMS recipient is configured for delivery.");
  }

  let sid: string | null = null;
  await handleSendResult({
    dbClient: params.dbClient,
    channelKey: "sms",
    result: (async () => {
      const response = await postForm(
        `${params.config.channels.sms.apiBaseUrl.replace(/\/$/, "")}/2010-04-01/Accounts/${accountSid}/Messages.json`,
        new URLSearchParams({
          Body: params.text,
          From: fromNumber,
          To: params.recipient ?? "",
        }),
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          },
        },
      );
      const payload = (await response.json()) as { sid?: string };
      sid = payload.sid ?? null;
    })(),
  });

  return {
    recipient: params.recipient,
    sid,
  };
}
