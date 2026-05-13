export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  voice?: {
    file_id: string;
    mime_type?: string;
    duration: number;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export type TelegramWebhookInfo = {
  url: string;
  pending_update_count?: number;
  last_error_message?: string;
};

export type TelegramGetUpdatesResult = TelegramUpdate[];

export type TelegramFile = {
  file_id: string;
  file_unique_id?: string;
  file_path?: string;
  file_size?: number;
};

export type TelegramSendMessageResult = {
  message_id: number;
};

export type TelegramSendVoiceResult = {
  message_id: number;
};

export type TelegramSendAudioResult = {
  message_id: number;
};

export type NormalizedTelegramInboundMessage = {
  updateId: string;
  messageId: string;
  chatId: string;
  chatLabel: string;
  userId: string;
  userDisplayName: string;
  text: string | null;
  hasVoice: boolean;
  voice: {
    fileId: string;
    mimeType: string | null;
    durationMs: number | null;
  } | null;
};

type TelegramMethodResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

function trimToNull(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function formatTelegramDisplayName(firstName?: string, lastName?: string, username?: string) {
  return trimToNull([firstName, lastName].filter(Boolean).join(" ")) ?? username ?? "Telegram user";
}

function formatTelegramChatLabel(chat: TelegramChat) {
  return (
    trimToNull(chat.title) ??
    formatTelegramDisplayName(chat.first_name, chat.last_name, chat.username)
  );
}

export function normalizeTelegramUpdate(update: TelegramUpdate) {
  const message = update.message ?? update.edited_message;

  if (!message) {
    return null;
  }

  return {
    updateId: String(update.update_id),
    messageId: String(message.message_id),
    chatId: String(message.chat.id),
    chatLabel: formatTelegramChatLabel(message.chat),
    userId: String(message.from?.id ?? message.chat.id),
    userDisplayName: formatTelegramDisplayName(
      message.from?.first_name,
      message.from?.last_name,
      message.from?.username,
    ),
    text: trimToNull(message.text ?? message.caption),
    hasVoice: Boolean(message.voice),
    voice: message.voice
      ? {
          fileId: message.voice.file_id,
          mimeType: trimToNull(message.voice.mime_type),
          durationMs:
            typeof message.voice.duration === "number" ? message.voice.duration * 1000 : null,
        }
      : null,
  } satisfies NormalizedTelegramInboundMessage;
}

export function splitTelegramMessage(text: string, maxLength = 4000) {
  const trimmed = text.trim();

  if (trimmed.length <= maxLength) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxLength) {
    let boundary = remaining.lastIndexOf("\n", maxLength);

    if (boundary < maxLength * 0.5) {
      boundary = remaining.lastIndexOf(" ", maxLength);
    }

    if (boundary < maxLength * 0.5) {
      boundary = maxLength;
    }

    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export function createTelegramWebhookUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/g, "")}/integrations/telegram/webhook`;
}

export function createTelegramClient(options: { apiBaseUrl: string; botToken: string }) {
  const apiRoot = options.apiBaseUrl.replace(/\/+$/g, "");
  const baseUrl = `${apiRoot}/bot${options.botToken}`;
  const fileBaseUrl = `${apiRoot}/file/bot${options.botToken}`;

  async function callMethod<T>(method: string, body?: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });

    const payload = (await response.json()) as TelegramMethodResponse<T>;

    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram ${method} failed with ${response.status}`);
    }

    return payload.result;
  }

  async function callMultipartMethod<T>(method: string, body: FormData) {
    const response = await fetch(`${baseUrl}/${method}`, {
      method: "POST",
      body,
    });

    const payload = (await response.json()) as TelegramMethodResponse<T>;

    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram ${method} failed with ${response.status}`);
    }

    return payload.result;
  }

  return {
    async getMe() {
      return callMethod<TelegramUser>("getMe");
    },
    async getWebhookInfo() {
      return callMethod<TelegramWebhookInfo>("getWebhookInfo");
    },
    async getFile(fileId: string) {
      return callMethod<TelegramFile>("getFile", {
        file_id: fileId,
      });
    },
    async setWebhook(url: string, secretToken?: string | null) {
      return callMethod<boolean>("setWebhook", {
        url,
        allowed_updates: ["message", "edited_message"],
        secret_token: secretToken ?? undefined,
      });
    },
    async deleteWebhook() {
      return callMethod<boolean>("deleteWebhook", {
        drop_pending_updates: false,
      });
    },
    async getUpdates(params?: {
      offset?: number;
      timeoutSeconds?: number;
      limit?: number;
      allowedUpdates?: string[];
    }) {
      return callMethod<TelegramGetUpdatesResult>("getUpdates", {
        offset: params?.offset,
        timeout: params?.timeoutSeconds,
        limit: params?.limit,
        allowed_updates: params?.allowedUpdates,
      });
    },
    async sendMessage(chatId: string, text: string) {
      return callMethod<TelegramSendMessageResult>("sendMessage", {
        chat_id: chatId,
        text,
      });
    },
    async sendMessageChunks(chatId: string, text: string) {
      const sentMessageIds: string[] = [];

      for (const chunk of splitTelegramMessage(text)) {
        const result = await callMethod<TelegramSendMessageResult>("sendMessage", {
          chat_id: chatId,
          text: chunk,
        });
        sentMessageIds.push(String(result.message_id));
      }

      return sentMessageIds;
    },
    async sendVoice(params: {
      audio: Buffer;
      chatId: string;
      filename?: string;
      mimeType?: string;
    }) {
      const audioBytes = params.audio.buffer.slice(
        params.audio.byteOffset,
        params.audio.byteOffset + params.audio.byteLength,
      ) as ArrayBuffer;
      const form = new FormData();
      form.set("chat_id", params.chatId);
      form.set(
        "voice",
        new Blob([audioBytes], { type: params.mimeType ?? "audio/ogg" }),
        params.filename ?? "voice.ogg",
      );

      return callMultipartMethod<TelegramSendVoiceResult>("sendVoice", form);
    },
    async sendAudio(params: {
      audio: Buffer;
      chatId: string;
      filename?: string;
      mimeType?: string;
    }) {
      const audioBytes = params.audio.buffer.slice(
        params.audio.byteOffset,
        params.audio.byteOffset + params.audio.byteLength,
      ) as ArrayBuffer;
      const form = new FormData();
      form.set("chat_id", params.chatId);
      form.set(
        "audio",
        new Blob([audioBytes], { type: params.mimeType ?? "audio/wav" }),
        params.filename ?? "reply.wav",
      );

      return callMultipartMethod<TelegramSendAudioResult>("sendAudio", form);
    },
    async downloadFile(filePath: string) {
      const response = await fetch(`${fileBaseUrl}/${filePath.replace(/^\/+/g, "")}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Telegram file download failed with ${response.status}.`);
      }

      return {
        contentType: response.headers.get("content-type"),
        data: Buffer.from(await response.arrayBuffer()),
      };
    },
  };
}
