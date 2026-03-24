import { z } from "zod";

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
});

export type AppConfig = {
  appBaseUrl: string;
  databaseUrl: string;
  defaultPersonaId: string;
  defaultUserId: string;
  logLevel: "debug" | "info" | "warn" | "error";
  nodeEnv: "development" | "test" | "production";
  redisUrl: string;
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
    redisUrl: parsed.REDIS_URL,
    web: {
      port: parsed.WEB_PORT,
    },
    worker: {
      baseUrl: parsed.WORKER_BASE_URL,
      port: parsed.WORKER_PORT,
    },
  };
}
