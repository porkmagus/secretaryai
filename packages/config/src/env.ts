import { z } from "zod";

function emptyStringToUndefined(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const appConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_BASE_URL: z.string().url(),
  WORKER_BASE_URL: z.string().url(),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DEFAULT_USER_ID: z.string().min(1),
  DEFAULT_PERSONA_ID: z.string().min(1),
  OPENAI_API_KEY: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  OPENAI_BASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  OPENAI_MODEL: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  OPENAI_REASONING_EFFORT: z.preprocess(
    emptyStringToUndefined,
    z.enum(["minimal", "low", "medium", "high"]).optional(),
  ),
  SEARXNG_BASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org"),
  TELEGRAM_BOT_TOKEN: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  TELEGRAM_WEBHOOK_SECRET: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).max(256).optional(),
  ),
  TELEGRAM_WEBHOOK_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  TELEGRAM_DEFAULT_CHAT_ID: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).optional(),
  ),
  STT_BASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  TTS_BASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
});

export type AppConfig = {
  appBaseUrl: string;
  databaseUrl: string;
  defaultPersonaId: string;
  defaultUserId: string;
  logLevel: "debug" | "info" | "warn" | "error";
  nodeEnv: "development" | "test" | "production";
  openai: {
    apiKey: string | null;
    baseUrl: string;
    model: string;
    reasoningEffort: "minimal" | "low" | "medium" | "high";
  };
  redisUrl: string;
  search: {
    searxngBaseUrl: string | null;
  };
  speech: {
    sttBaseUrl: string | null;
    ttsBaseUrl: string | null;
  };
  telegram: {
    apiBaseUrl: string;
    botToken: string | null;
    defaultChatId: string | null;
    webhookSecret: string | null;
    webhookUrl: string | null;
  };
  web: {
    port: number;
  };
  worker: {
    baseUrl: string;
    port: number;
  };
};

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = appConfigSchema.parse(env);

  return {
    appBaseUrl: parsed.APP_BASE_URL,
    databaseUrl: parsed.DATABASE_URL,
    defaultPersonaId: parsed.DEFAULT_PERSONA_ID,
    defaultUserId: parsed.DEFAULT_USER_ID,
    logLevel: parsed.LOG_LEVEL,
    nodeEnv: parsed.NODE_ENV,
    openai: {
      apiKey: parsed.OPENAI_API_KEY ?? null,
      baseUrl: parsed.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: parsed.OPENAI_MODEL ?? "gpt-5",
      reasoningEffort: parsed.OPENAI_REASONING_EFFORT ?? "low",
    },
    redisUrl: parsed.REDIS_URL,
    search: {
      searxngBaseUrl: parsed.SEARXNG_BASE_URL ?? null,
    },
    speech: {
      sttBaseUrl: parsed.STT_BASE_URL ?? null,
      ttsBaseUrl: parsed.TTS_BASE_URL ?? null,
    },
    telegram: {
      apiBaseUrl: parsed.TELEGRAM_API_BASE_URL,
      botToken: parsed.TELEGRAM_BOT_TOKEN ?? null,
      defaultChatId: parsed.TELEGRAM_DEFAULT_CHAT_ID ?? null,
      webhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET ?? null,
      webhookUrl: parsed.TELEGRAM_WEBHOOK_URL ?? null,
    },
    web: {
      port: parsed.WEB_PORT,
    },
    worker: {
      baseUrl: parsed.WORKER_BASE_URL,
      port: parsed.WORKER_PORT,
    },
  };
}
