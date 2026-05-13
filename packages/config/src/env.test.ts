import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { loadAppConfig } from "./env";

function makeMinimalEnv(overrides: Record<string, unknown> = {}): NodeJS.ProcessEnv {
  return {
    APP_BASE_URL: "http://localhost:3000",
    WORKER_BASE_URL: "http://localhost:4000",
    DATABASE_URL: "postgres://localhost/secretary",
    REDIS_URL: "redis://localhost:6379",
    DEFAULT_USER_ID: "user-1",
    DEFAULT_PERSONA_ID: "persona-1",
    ...overrides,
  };
}

describe("loadAppConfig - required fields", () => {
  test("parses minimal valid config", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.appBaseUrl, "http://localhost:3000");
    assert.strictEqual(config.databaseUrl, "postgres://localhost/secretary");
    assert.strictEqual(config.redisUrl, "redis://localhost:6379");
    assert.strictEqual(config.defaultUserId, "user-1");
    assert.strictEqual(config.defaultPersonaId, "persona-1");
  });

  test("throws when APP_BASE_URL is missing", () => {
    const env = makeMinimalEnv();
    delete env.APP_BASE_URL;
    assert.throws(() => loadAppConfig(env), /APP_BASE_URL/);
  });

  test("throws when WORKER_BASE_URL is missing", () => {
    const env = makeMinimalEnv();
    delete env.WORKER_BASE_URL;
    assert.throws(() => loadAppConfig(env), /WORKER_BASE_URL/);
  });

  test("throws when DATABASE_URL is missing", () => {
    const env = makeMinimalEnv();
    delete env.DATABASE_URL;
    assert.throws(() => loadAppConfig(env), /DATABASE_URL/);
  });

  test("throws when REDIS_URL is missing", () => {
    const env = makeMinimalEnv();
    delete env.REDIS_URL;
    assert.throws(() => loadAppConfig(env), /REDIS_URL/);
  });

  test("throws when APP_BASE_URL is not a valid URL", () => {
    assert.throws(
      () => loadAppConfig(makeMinimalEnv({ APP_BASE_URL: "not-a-url" })),
      /APP_BASE_URL/,
    );
  });

  test("throws when DEFAULT_USER_ID is empty", () => {
    assert.throws(() => loadAppConfig(makeMinimalEnv({ DEFAULT_USER_ID: "" })), /DEFAULT_USER_ID/);
  });

  test("treats empty string as missing for required fields", () => {
    assert.throws(() => loadAppConfig(makeMinimalEnv({ DATABASE_URL: "" })), /DATABASE_URL/);
  });
});

describe("loadAppConfig - defaults", () => {
  test("defaults NODE_ENV to development", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.nodeEnv, "development");
  });

  test("defaults WEB_PORT to 3000", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.web.port, 3000);
  });

  test("defaults WORKER_PORT to 4000", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.worker.port, 4000);
  });

  test("defaults LOG_LEVEL to info", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.logLevel, "info");
  });

  test("respects explicit NODE_ENV", () => {
    const config = loadAppConfig(makeMinimalEnv({ NODE_ENV: "production" }));
    assert.strictEqual(config.nodeEnv, "production");
  });

  test("respects custom ports", () => {
    const config = loadAppConfig(makeMinimalEnv({ WEB_PORT: "8080", WORKER_PORT: "9090" }));
    assert.strictEqual(config.web.port, 8080);
    assert.strictEqual(config.worker.port, 9090);
  });

  test("defaults OpenAI model to gpt-5", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.openai.model, "gpt-5");
  });

  test("defaults OpenAI reasoning effort to low", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.openai.reasoningEffort, "low");
  });

  test("defaults Telegram API base URL", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.telegram.apiBaseUrl, "https://api.telegram.org");
  });
});

describe("loadAppConfig - optional fields with defaults", () => {
  test("OpenAI defaults use standard base URL", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.openai.baseUrl, "https://api.openai.com/v1");
    assert.strictEqual(config.openai.apiKey, null);
  });

  test("sets OpenAI values from env", () => {
    const config = loadAppConfig(
      makeMinimalEnv({
        OPENAI_API_KEY: "sk-test123",
        OPENAI_BASE_URL: "https://custom.ai/v1",
        OPENAI_MODEL: "gpt-4o",
        OPENAI_REASONING_EFFORT: "high",
      }),
    );
    assert.strictEqual(config.openai.apiKey, "sk-test123");
    assert.strictEqual(config.openai.baseUrl, "https://custom.ai/v1");
    assert.strictEqual(config.openai.model, "gpt-4o");
    assert.strictEqual(config.openai.reasoningEffort, "high");
  });

  test("nulls optional fields when not provided", () => {
    const config = loadAppConfig(makeMinimalEnv());
    assert.strictEqual(config.search.searxngBaseUrl, null);
    assert.strictEqual(config.speech.sttBaseUrl, null);
    assert.strictEqual(config.speech.ttsBaseUrl, null);
    assert.strictEqual(config.telegram.botToken, null);
    assert.strictEqual(config.channels.discord.webhookUrl, null);
    assert.strictEqual(config.channels.slack.webhookUrl, null);
    assert.strictEqual(config.channels.email.apiKey, null);
    assert.strictEqual(config.channels.sms.accountSid, null);
  });

  test("sets search and speech URLs from env", () => {
    const config = loadAppConfig(
      makeMinimalEnv({
        SEARXNG_BASE_URL: "http://localhost:8080",
        CRAWL4AI_BASE_URL: "http://localhost:11235",
        STT_BASE_URL: "http://localhost:5001",
        TTS_BASE_URL: "http://localhost:5002",
      }),
    );
    assert.strictEqual(config.search.searxngBaseUrl, "http://localhost:8080");
    assert.strictEqual(config.crawl4ai.baseUrl, "http://localhost:11235");
    assert.strictEqual(config.speech.sttBaseUrl, "http://localhost:5001");
    assert.strictEqual(config.speech.ttsBaseUrl, "http://localhost:5002");
  });

  test("sets email defaults from env", () => {
    const config = loadAppConfig(
      makeMinimalEnv({
        RESEND_API_KEY: "re-test",
        EMAIL_FROM_ADDRESS: "test@example.com",
        EMAIL_DEFAULT_TO: "me@example.com",
      }),
    );
    assert.strictEqual(config.channels.email.apiKey, "re-test");
    assert.strictEqual(config.channels.email.fromAddress, "test@example.com");
    assert.strictEqual(config.channels.email.defaultTo, "me@example.com");
    assert.strictEqual(config.channels.email.apiBaseUrl, "https://api.resend.com");
  });

  test("sets SMS defaults from env", () => {
    const config = loadAppConfig(
      makeMinimalEnv({
        TWILIO_ACCOUNT_SID: "AC-test",
        TWILIO_AUTH_TOKEN: "auth-token",
        TWILIO_FROM_NUMBER: "+15551234567",
      }),
    );
    assert.strictEqual(config.channels.sms.accountSid, "AC-test");
    assert.strictEqual(config.channels.sms.authToken, "auth-token");
    assert.strictEqual(config.channels.sms.fromNumber, "+15551234567");
    assert.strictEqual(config.channels.sms.apiBaseUrl, "https://api.twilio.com");
  });

  test("sets Telegram config from env", () => {
    const config = loadAppConfig(
      makeMinimalEnv({
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_WEBHOOK_SECRET: "secret",
        TELEGRAM_WEBHOOK_URL: "https://example.com/hook",
        TELEGRAM_DEFAULT_CHAT_ID: "12345",
      }),
    );
    assert.strictEqual(config.telegram.botToken, "bot-token");
    assert.strictEqual(config.telegram.webhookSecret, "secret");
    assert.strictEqual(config.telegram.webhookUrl, "https://example.com/hook");
    assert.strictEqual(config.telegram.defaultChatId, "12345");
  });
});

describe("loadAppConfig - validation edge cases", () => {
  test("rejects invalid NODE_ENV", () => {
    assert.throws(() => loadAppConfig(makeMinimalEnv({ NODE_ENV: "staging" })), /NODE_ENV/);
  });

  test("rejects invalid LOG_LEVEL", () => {
    assert.throws(() => loadAppConfig(makeMinimalEnv({ LOG_LEVEL: "verbose" })), /LOG_LEVEL/);
  });

  test("accepts valid LOG_LEVEL values", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      const config = loadAppConfig(makeMinimalEnv({ LOG_LEVEL: level }));
      assert.strictEqual(config.logLevel, level);
    }
  });

  test("accepts valid reasoning effort values", () => {
    for (const effort of ["minimal", "low", "medium", "high"] as const) {
      const config = loadAppConfig(makeMinimalEnv({ OPENAI_REASONING_EFFORT: effort }));
      assert.strictEqual(config.openai.reasoningEffort, effort);
    }
  });

  test("coerces WEB_PORT from string to number", () => {
    const config = loadAppConfig(makeMinimalEnv({ WEB_PORT: "5000" }));
    assert.strictEqual(config.web.port, 5000);
    assert.strictEqual(typeof config.web.port, "number");
  });

  test("rejects non-positive WEB_PORT", () => {
    assert.throws(() => loadAppConfig(makeMinimalEnv({ WEB_PORT: "0" })), /WEB_PORT/);
    assert.throws(() => loadAppConfig(makeMinimalEnv({ WEB_PORT: "-1" })), /WEB_PORT/);
  });

  test("rejects non-integer WEB_PORT", () => {
    assert.throws(() => loadAppConfig(makeMinimalEnv({ WEB_PORT: "3.5" })), /WEB_PORT/);
  });
});

describe("emptyStringToUndefined behavior", () => {
  test("empty string OPENAI_API_KEY becomes null", () => {
    const config = loadAppConfig(makeMinimalEnv({ OPENAI_API_KEY: "" }));
    assert.strictEqual(config.openai.apiKey, null);
  });

  test("whitespace-only OPENAI_API_KEY becomes null", () => {
    const config = loadAppConfig(makeMinimalEnv({ OPENAI_API_KEY: "   " }));
    assert.strictEqual(config.openai.apiKey, null);
  });

  test("trims string values", () => {
    const config = loadAppConfig(makeMinimalEnv({ OPENAI_MODEL: "  gpt-4o-mini  " }));
    assert.strictEqual(config.openai.model, "gpt-4o-mini");
  });

  test("whitespace-only optional URLs become null", () => {
    const config = loadAppConfig(makeMinimalEnv({ STT_BASE_URL: "  " }));
    assert.strictEqual(config.speech.sttBaseUrl, null);
  });
});
