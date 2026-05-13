import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  createTelegramClient,
  createTelegramWebhookUrl,
  normalizeTelegramUpdate,
  splitTelegramMessage,
  type TelegramChat,
  type TelegramMessage,
  type TelegramUpdate,
  type TelegramUser,
} from "./index";

describe("normalizeTelegramUpdate", () => {
  function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
    return {
      message_id: 1,
      date: 1700000000,
      chat: { id: 123, type: "private" },
      text: "hello",
      ...overrides,
    };
  }

  function makeUpdate(overrides: Partial<TelegramUpdate> = {}): TelegramUpdate {
    return {
      update_id: 1,
      message: makeMessage(),
      ...overrides,
    };
  }

  test("normalizes a basic message update", () => {
    const result = normalizeTelegramUpdate(makeUpdate());
    assert.ok(result);
    assert.strictEqual(result.updateId, "1");
    assert.strictEqual(result.messageId, "1");
    assert.strictEqual(result.chatId, "123");
    assert.strictEqual(result.text, "hello");
    assert.strictEqual(result.hasVoice, false);
    assert.strictEqual(result.voice, null);
  });

  test("normalizes an edited_message update", () => {
    const result = normalizeTelegramUpdate({
      update_id: 2,
      edited_message: makeMessage({ message_id: 5 }),
    });
    assert.ok(result);
    assert.strictEqual(result.messageId, "5");
  });

  test("returns null when no message or edited_message", () => {
    const result = normalizeTelegramUpdate({ update_id: 3 });
    assert.strictEqual(result, null);
  });

  test("prefers message over edited_message when both present", () => {
    const result = normalizeTelegramUpdate({
      update_id: 4,
      message: makeMessage({ message_id: 10 }),
      edited_message: makeMessage({ message_id: 20 }),
    });
    assert.ok(result);
    assert.strictEqual(result.messageId, "10");
  });

  test("formats user display name from first/last name", () => {
    const from: TelegramUser = {
      id: 99,
      is_bot: false,
      first_name: "John",
      last_name: "Doe",
    };
    const result = normalizeTelegramUpdate(makeUpdate({ message: makeMessage({ from }) }));
    assert.ok(result);
    assert.strictEqual(result.userDisplayName, "John Doe");
  });

  test("uses first_name over username when available", () => {
    const from: TelegramUser = {
      id: 99,
      is_bot: false,
      first_name: "John",
      username: "johndoe",
    };
    const result = normalizeTelegramUpdate(makeUpdate({ message: makeMessage({ from }) }));
    assert.ok(result);
    // first_name takes priority over username
    assert.strictEqual(result.userDisplayName, "John");
  });

  test("falls back to username when no first_name available", () => {
    const from: TelegramUser = {
      id: 99,
      is_bot: false,
      first_name: "",
      username: "johndoe",
    };
    const result = normalizeTelegramUpdate(makeUpdate({ message: makeMessage({ from }) }));
    assert.ok(result);
    assert.strictEqual(result.userDisplayName, "johndoe");
  });

  test("falls back to default when no user info at all", () => {
    const result = normalizeTelegramUpdate(makeUpdate());
    assert.ok(result);
    assert.strictEqual(result.userDisplayName, "Telegram user");
  });

  test("formats chat label from title", () => {
    const chat: TelegramChat = {
      id: 123,
      type: "group",
      title: "My Group",
    };
    const result = normalizeTelegramUpdate(makeUpdate({ message: makeMessage({ chat }) }));
    assert.ok(result);
    assert.strictEqual(result.chatLabel, "My Group");
  });

  test("formats chat label from user name for private chats", () => {
    const chat: TelegramChat = {
      id: 123,
      type: "private",
      first_name: "Jane",
      username: "jane",
    };
    const result = normalizeTelegramUpdate(makeUpdate({ message: makeMessage({ chat }) }));
    assert.ok(result);
    assert.strictEqual(result.chatLabel, "Jane");
  });

  test("handles voice messages", () => {
    const msg = makeMessage({
      voice: {
        file_id: "voice-123",
        mime_type: "audio/ogg",
        duration: 5,
      },
    });
    const result = normalizeTelegramUpdate(makeUpdate({ message: msg }));
    assert.ok(result);
    assert.strictEqual(result.hasVoice, true);
    assert.ok(result.voice);
    assert.strictEqual(result.voice.fileId, "voice-123");
    assert.strictEqual(result.voice.mimeType, "audio/ogg");
    assert.strictEqual(result.voice.durationMs, 5000);
  });

  test("converts caption to text when no text present", () => {
    const msg = makeMessage({ text: undefined, caption: "photo caption" });
    const result = normalizeTelegramUpdate(makeUpdate({ message: msg }));
    assert.ok(result);
    assert.strictEqual(result.text, "photo caption");
  });

  test("whitespace-only text becomes null", () => {
    const msg = makeMessage({ text: "   " });
    const result = normalizeTelegramUpdate(makeUpdate({ message: msg }));
    assert.ok(result);
    assert.strictEqual(result.text, null);
  });

  test("uses chat id as userId when from is missing", () => {
    const result = normalizeTelegramUpdate(makeUpdate());
    assert.ok(result);
    assert.strictEqual(result.userId, "123");
  });
});

describe("splitTelegramMessage", () => {
  test("returns single chunk for short message", () => {
    const result = splitTelegramMessage("hello world");
    assert.deepStrictEqual(result, ["hello world"]);
  });

  test("returns single chunk for message exactly at maxLength", () => {
    const text = "a".repeat(4000);
    const result = splitTelegramMessage(text);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].length, 4000);
  });

  test("splits message at newline boundary", () => {
    const text = `${"a".repeat(2000)}\n${"b".repeat(3000)}`;
    const result = splitTelegramMessage(text);
    assert.strictEqual(result.length, 2);
    assert.ok(result[0].length <= 4000);
    assert.ok(result[1].length <= 4000);
  });

  test("splits message at space boundary", () => {
    const text = "word ".repeat(1000);
    const result = splitTelegramMessage(text);
    assert.strictEqual(result.length, 2);
    assert.ok(result[0].length <= 4000);
    assert.ok(result[1].length <= 4000);
  });

  test("hard splits when no good boundary exists", () => {
    const text = "a".repeat(9000);
    const result = splitTelegramMessage(text);
    assert.ok(result.length >= 3);
    for (const chunk of result) {
      assert.ok(chunk.length <= 4000);
    }
  });

  test("respects custom maxLength", () => {
    const text = "a".repeat(3000);
    const result = splitTelegramMessage(text, 1000);
    assert.ok(result.length >= 3);
    for (const chunk of result) {
      assert.ok(chunk.length <= 1000);
    }
  });

  test("trims input text", () => {
    const result = splitTelegramMessage("  hello  ");
    assert.deepStrictEqual(result, ["hello"]);
  });
});

describe("createTelegramWebhookUrl", () => {
  test("appends webhook path to base URL", () => {
    const url = createTelegramWebhookUrl("https://example.com");
    assert.strictEqual(url, "https://example.com/integrations/telegram/webhook");
  });

  test("strips trailing slash from base URL", () => {
    const url = createTelegramWebhookUrl("https://example.com/");
    assert.strictEqual(url, "https://example.com/integrations/telegram/webhook");
  });

  test("strips multiple trailing slashes", () => {
    const url = createTelegramWebhookUrl("https://example.com///");
    assert.strictEqual(url, "https://example.com/integrations/telegram/webhook");
  });
});

describe("createTelegramClient", () => {
  test("creates client with correct method shape", () => {
    const client = createTelegramClient({
      apiBaseUrl: "https://api.telegram.org",
      botToken: "test-token",
    });
    assert.strictEqual(typeof client.getMe, "function");
    assert.strictEqual(typeof client.getWebhookInfo, "function");
    assert.strictEqual(typeof client.getFile, "function");
    assert.strictEqual(typeof client.setWebhook, "function");
    assert.strictEqual(typeof client.deleteWebhook, "function");
    assert.strictEqual(typeof client.getUpdates, "function");
    assert.strictEqual(typeof client.sendMessage, "function");
    assert.strictEqual(typeof client.sendMessageChunks, "function");
    assert.strictEqual(typeof client.sendVoice, "function");
    assert.strictEqual(typeof client.sendAudio, "function");
    assert.strictEqual(typeof client.downloadFile, "function");
  });

  test("strips trailing slashes from API base URL", () => {
    const client = createTelegramClient({
      apiBaseUrl: "https://api.telegram.org/",
      botToken: "test-token",
    });
    assert.strictEqual(typeof client.getMe, "function");
  });
});
