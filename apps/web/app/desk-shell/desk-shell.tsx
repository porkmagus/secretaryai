"use client";

import { useChat } from "@ai-sdk/react";
import type {
  ConversationHistoryResponse,
  ConversationListItem,
  ConversationListResponse,
  DeskChatMessageMetadata,
  PersonaSettingsResponse,
  ToolApprovalDecisionResponse,
  ToolExecutionListResponse,
  ToolExecutionRecord,
} from "@secretary/core-runtime";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { fetchJson } from "../lib/fetch-json";
import { snippet } from "../lib/presenters";
import { SecretaryPortraitField } from "../lib/secretary-portrait-field";
import { AppPage, EmptyState, StatCard, StatGrid, ToggleField } from "../lib/ui";

type DeskChatMessage = UIMessage<DeskChatMessageMetadata>;

const starterMessages: DeskChatMessage[] = [
  {
    id: "assistant-intro",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Good evening. I'm ready to help you plan, build, follow through, and keep the work moving. Tell me what you need, and I'll take it from there.",
      },
    ],
  },
];

const deskVoicePreferenceKey = "secretary.desk.autoSpeak";

function extractText(message: DeskChatMessage | undefined) {
  if (!message) {
    return "";
  }

  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function extractMetadata(message: DeskChatMessage | undefined) {
  return (message?.metadata ?? null) as DeskChatMessageMetadata | null;
}

function toDeskChatMessage(
  message: ConversationHistoryResponse["messages"][number],
): DeskChatMessage {
  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    parts: [
      {
        type: "text",
        text: message.text,
      },
    ],
    metadata: undefined,
  };
}

function formatModelBadge(metadata: DeskChatMessageMetadata | null) {
  if (!metadata) {
    return null;
  }

  if (metadata.replyMode === "fallback") {
    return "fallback";
  }

  if (metadata.model) {
    return metadata.model.replace(/^.*:/, "");
  }

  return "streaming";
}

function followUpSuggestions(message: DeskChatMessage | undefined) {
  const text = extractText(message);

  if (!text) {
    return ["Give me the short version", "What should we do next?", "Turn that into a task"];
  }

  if (/\b(task|reminder|schedule|deadline)\b/i.test(text)) {
    return ["Turn that into a task", "What should happen next?", "Give me the short version"];
  }

  return ["Go one level deeper", "Give me the short version", "What should we do next?"];
}

function isAgentJobLaunchPrompt(message: DeskChatMessage | undefined) {
  const text = extractText(message);
  return /reply yes to start it as an agent job, or no to keep this/i.test(text);
}

type DeskConversationPaneProps = {
  activeConversationId?: string;
  conversationTitle?: string;
  approvalBusyId: string | null;
  deskPortraitError: string | null;
  deskVoiceError: string | null;
  initialMessages: DeskChatMessage[];
  isRefreshing: boolean;
  pendingApproval: ToolExecutionRecord | null;
  onDecideApproval: (executionId: string, approve: boolean) => void;
  onConversationLinked: (conversationId: string) => void;
  onReplyMetadata: (metadata: DeskChatMessageMetadata) => void;
  onReplyReady: (message: DeskChatMessage) => void;
  onSpeakMessage: (message: DeskChatMessage) => void;
  secretaryName: string;
  speakingMessageId: string | null;
};

function DeskConversationPane(props: DeskConversationPaneProps) {
  const [input, setInput] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationIdRef = useRef<string | undefined>(props.activeConversationId);
  const secretaryName = props.secretaryName.trim() || "Secretary";
  const secretaryReference = secretaryName === "SetAgentName" ? "the secretary" : secretaryName;
  const secretarySentenceReference =
    secretaryName === "SetAgentName" ? "The secretary" : secretaryName;
  const composerTarget = secretaryName === "SetAgentName" ? "your secretary" : secretaryName;

  const copyToClipboard = useCallback((message: DeskChatMessage) => {
    const text = extractText(message);
    if (!text) return;

    void navigator.clipboard.writeText(text);
    setCopiedMessageId(message.id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  }, []);

  useEffect(() => {
    conversationIdRef.current = props.activeConversationId;
  }, [props.activeConversationId]);

  const { messages, sendMessage, status, stop, error, clearError } = useChat<DeskChatMessage>({
    messages: props.initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => {
        const latestMessage = messages[messages.length - 1] as DeskChatMessage | undefined;

        return {
          body: {
            conversationId: conversationIdRef.current,
            messageId: latestMessage?.id,
            text: extractText(latestMessage),
          },
        };
      },
    }),
    experimental_throttle: 50,
    onData: (part) => {
      if (part.type !== "data-runtime-context") {
        return;
      }

      const metadata = part.data as DeskChatMessageMetadata;
      props.onReplyMetadata(metadata);
      props.onConversationLinked(metadata.conversationId);
    },
    onFinish: ({ message }) => {
      const metadata = extractMetadata(message);

      if (metadata) {
        props.onReplyMetadata(metadata);
        props.onConversationLinked(metadata.conversationId);
      }

      props.onReplyReady(message);
    },
    onError: () => {
      // Render a generic message in the composer footer.
    },
  });

  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const suggestionOptions = followUpSuggestions(latestAssistantMessage);
  const composerStatus =
    props.deskVoiceError ??
    (error ? "The Desk could not reach the worker. Check the worker and try again." : null) ??
    (status === "submitted"
      ? `Sending to ${secretaryReference}...`
      : status === "streaming"
        ? `${secretaryReference} is replying...`
        : props.isRefreshing
          ? "Refreshing saved correspondence..."
          : props.activeConversationId
            ? "This correspondence is saved and ready."
            : `${secretarySentenceReference} is ready when you are.`);

  useEffect(() => {
    const nextFrame = window.requestAnimationFrame(() => {
      const node = streamRef.current;

      if (!node) {
        return;
      }

      // Only auto-scroll if we are near the bottom or it is a new message from user
      const isNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 150;
      if (isNearBottom || status === "submitted") {
        node.scrollTo({
          top: node.scrollHeight,
          behavior: status === "ready" ? "smooth" : "auto",
        });
      }
    });

    return () => window.cancelAnimationFrame(nextFrame);
  }, [status, messages]);

  useEffect(() => {
    const node = streamRef.current;
    if (!node) return;

    const handleScroll = () => {
      const isFarFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight > 300;
      setShowScrollButton(isFarFromBottom);
    };

    node.addEventListener("scroll", handleScroll);
    return () => node.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToBottom = () => {
    const node = streamRef.current;
    if (node) {
      node.scrollTo({
        top: node.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();

    if (!text || status === "submitted" || status === "streaming") {
      return;
    }

    clearError();
    await sendMessage({
      text,
    });
    setInput("");
  }

  async function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();

      if (status === "submitted" || status === "streaming" || input.trim().length === 0) {
        return;
      }

      clearError();
      await sendMessage({
        text: input.trim(),
      });
      setInput("");
    }
  }

  async function respondToAgentJobPrompt(decision: "yes" | "no") {
    if (status === "submitted" || status === "streaming") {
      return;
    }

    clearError();
    await sendMessage({
      text: decision,
    });
  }

  const stageTitle =
    props.conversationTitle ??
    (props.activeConversationId ? "Open correspondence" : "New correspondence");
  const stageDescription =
    status === "streaming"
      ? `${secretaryReference} is working through the reply now.`
      : props.activeConversationId
        ? "This conversation stays linked to its history, approvals, and follow-through as you work."
        : `Start anywhere. ${secretarySentenceReference} will turn this into a working thread as context builds.`;

  const activeNotice = props.pendingApproval
    ? {
        title: `${props.pendingApproval.toolName} needs approval`,
        copy: props.pendingApproval.summary,
      }
    : props.deskVoiceError
      ? {
          title: "Voice playback needs attention",
          copy: props.deskVoiceError,
        }
      : props.deskPortraitError
        ? {
            title: "Portrait update needs attention",
            copy: props.deskPortraitError,
          }
        : null;

  return (
    <div className="desk-chat-shell">
      <header className="desk-stage-head">
        <div className="desk-stage-copy">
          <p className="desk-stage-eyebrow">Desk</p>
          <h1 className="desk-stage-title">{stageTitle}</h1>
          <p className="desk-stage-description">{stageDescription}</p>
        </div>
        <div className="desk-stage-glance">
          <span className="desk-stage-pill">
            {props.activeConversationId ? "Open thread" : "Fresh start"}
          </span>
          <span className="desk-stage-pill desk-stage-pill--accent">
            {status === "streaming" ? "Reply in motion" : "Listening"}
          </span>
        </div>
      </header>

      <div style={{ position: "relative", minHeight: 0, display: "grid" }}>
        <div className="desk-message-stream" ref={streamRef}>
          {messages.map((message) => {
            const _text = extractText(message);
            const metadata = extractMetadata(message);
            const isUser = message.role === "user";
            const reasoningParts = message.parts.filter((part) => part.type === "reasoning");
            const sourceParts = message.parts.filter(
              (part) => part.type === "source-url" || part.type === "source-document",
            );
            const textParts = message.parts.filter((part) => part.type === "text");
            const showLaunchPromptActions =
              !isUser &&
              isAgentJobLaunchPrompt(message) &&
              status !== "submitted" &&
              status !== "streaming";
            const isStreamingAssistant =
              !isUser &&
              (message.parts.some(
                (part) =>
                  (part.type === "text" || part.type === "reasoning") && part.state === "streaming",
              ) ||
                (status === "streaming" && latestAssistantMessage?.id === message.id));

            return (
              <article
                key={message.id}
                className={`desk-message ${isUser ? "desk-message--user" : "desk-message--assistant"}`}
              >
                <div className="desk-message-head">
                  <p
                    className={`desk-message-speaker ${isUser ? "desk-message-speaker--user" : ""}`}
                  >
                    {isUser ? "you" : secretaryName}
                  </p>
                  {!isUser && metadata ? (
                    <div className="desk-message-meta">
                      <span className="desk-model-chip">{formatModelBadge(metadata)}</span>
                      {metadata.totalTokens ? (
                        <span className="desk-token-chip">{metadata.totalTokens} tokens</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="desk-message-body">
                  {textParts.map((part, index) => (
                    <p
                      key={`${message.id}-text-${index}`}
                      className={`desk-message-text ${
                        part.state === "streaming" ? "desk-message-text--streaming" : ""
                      }`}
                    >
                      {part.text}
                    </p>
                  ))}
                  {reasoningParts.length > 0 ? (
                    <details className="desk-reasoning">
                      <summary
                        title="View thinking process"
                        aria-label={
                          reasoningParts.some((part) => part.state === "streaming")
                            ? "Secretary is thinking"
                            : "View secretary's reasoning"
                        }
                      >
                        Thinking
                        {reasoningParts.some((part) => part.state === "streaming") ? "..." : ""}
                      </summary>
                      <div className="desk-reasoning-copy">
                        {reasoningParts.map((part, index) => (
                          <p key={`${message.id}-reasoning-${index}`}>{part.text}</p>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {sourceParts.length > 0 ? (
                    <div className="desk-sources">
                      {sourceParts.map((part, index) =>
                        part.type === "source-url" ? (
                          <a
                            key={`${message.id}-source-${index}`}
                            href={part.url}
                            target="_blank"
                            rel="noreferrer"
                            className="desk-source-chip"
                          >
                            {part.title ?? new URL(part.url).hostname}
                          </a>
                        ) : (
                          <span key={`${message.id}-source-${index}`} className="desk-source-chip">
                            {part.title ?? part.filename ?? "Document"}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
                {isStreamingAssistant ? (
                  <div
                    className="desk-streaming-indicator"
                    role="status"
                    aria-label={`${secretaryName} is typing...`}
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}
                <div className="desk-message-actions">
                  {showLaunchPromptActions ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void respondToAgentJobPrompt("yes")}
                        className="button-primary"
                        aria-label="Start as an automated agent job"
                        title="Start as an automated agent job"
                        style={{ padding: "6px 10px", fontSize: 11 }}
                      >
                        Start job
                      </button>
                      <button
                        type="button"
                        onClick={() => void respondToAgentJobPrompt("no")}
                        className="button-secondary"
                        aria-label="Keep this conversation in the chat interface"
                        title="Keep this conversation in the chat interface"
                        style={{ padding: "6px 10px", fontSize: 11 }}
                      >
                        Keep in chat
                      </button>
                    </>
                  ) : null}
                  {!isUser ? (
                    <button
                      type="button"
                      onClick={() => props.onSpeakMessage(message)}
                      aria-label={
                        props.speakingMessageId === message.id
                          ? "Stop reading message aloud"
                          : "Read message aloud"
                      }
                      title={
                        props.speakingMessageId === message.id
                          ? "Stop reading message aloud"
                          : "Read message aloud"
                      }
                      className="button-secondary"
                      style={{ padding: "6px 10px", fontSize: 11 }}
                    >
                      {props.speakingMessageId === message.id ? "Stop" : "Speak"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => copyToClipboard(message)}
                    aria-label={
                      copiedMessageId === message.id ? "Message copied" : "Copy message text"
                    }
                    title={copiedMessageId === message.id ? "Message copied" : "Copy message text"}
                    className="button-secondary"
                    style={{ padding: "6px 10px", fontSize: 11 }}
                  >
                    {copiedMessageId === message.id ? "Copied!" : "Copy"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {showScrollButton && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="button-secondary"
            aria-label="Scroll to latest messages"
            title="Scroll to bottom"
            style={{
              position: "absolute",
              bottom: "20px",
              right: "20px",
              zIndex: 10,
              borderRadius: "999px",
              padding: "8px 12px",
              fontSize: "11px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            }}
          >
            ↓ Latest
          </button>
        )}
      </div>

      <form onSubmit={onSubmit} className="desk-composer">
        <div className="desk-composer-halo" aria-hidden="true" />
        <div className="desk-composer-head">
          <div className="desk-composer-copy">
            <p className="desk-composer-eyebrow">Compose</p>
            <label htmlFor="composer-input" className="desk-composer-title">
              Write to {composerTarget}
            </label>
          </div>
          <p id="composer-note" className="desk-composer-note">
            Ctrl+Enter to send
          </p>
        </div>
        <textarea
          id="composer-input"
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            void onComposerKeyDown(event);
          }}
          aria-describedby="composer-note"
          placeholder={`Ask ${composerTarget} something...`}
          rows={4}
        />
        {activeNotice ? (
          <div className="desk-stage-notice desk-stage-notice--composer">
            <div className="desk-stage-notice__copy">
              <p className="desk-stage-notice__title">{activeNotice.title}</p>
              <p className="desk-stage-notice__text">{activeNotice.copy}</p>
            </div>
            {props.pendingApproval ? (
              <div className="desk-stage-notice__actions">
                <button
                  type="button"
                  onClick={() => props.onDecideApproval(props.pendingApproval!.id, true)}
                  disabled={props.approvalBusyId === props.pendingApproval.id}
                  className="button-primary"
                  aria-label={`Approve tool execution: ${props.pendingApproval.toolName}`}
                  title={`Approve tool execution: ${props.pendingApproval.toolName}`}
                >
                  {props.approvalBusyId === props.pendingApproval.id ? "Working..." : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => props.onDecideApproval(props.pendingApproval!.id, false)}
                  disabled={props.approvalBusyId === props.pendingApproval.id}
                  className="button-danger"
                  aria-label={`Deny tool execution: ${props.pendingApproval.toolName}`}
                  title={`Deny tool execution: ${props.pendingApproval.toolName}`}
                >
                  Deny
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="desk-composer-foot">
          <p className="desk-composer-status" role="status" aria-live="polite">
            {composerStatus}
          </p>
          <div className="desk-composer-actions">
            {status === "submitted" || status === "streaming" ? (
              <button
                type="button"
                onClick={() => stop()}
                aria-label={`Stop ${secretaryReference}`}
                title={`Stop ${secretaryReference}`}
                className="button-secondary"
              >
                Stop
              </button>
            ) : null}
            <button
              type="submit"
              disabled={
                status === "submitted" || status === "streaming" || input.trim().length === 0
              }
              className="button-primary"
              aria-label="Send message"
              title="Send message (Ctrl+Enter)"
            >
              {status === "submitted" || status === "streaming" ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
        {status === "ready" && latestAssistantMessage && messages.length > 1 ? (
          <div className="desk-followups">
            {suggestionOptions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="desk-followup-chip"
                onClick={() => {
                  setInput(suggestion);
                  textareaRef.current?.focus();
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </form>
    </div>
  );
}

export function DeskShell() {
  const [conversationSeedMessages, setConversationSeedMessages] =
    useState<DeskChatMessage[]>(starterMessages);
  const [conversationSeedKey, setConversationSeedKey] = useState(0);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ToolExecutionRecord[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [autoSpeakReplies, setAutoSpeakReplies] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [deskPortraitError, setDeskPortraitError] = useState<string | null>(null);
  const [deskVoiceError, setDeskVoiceError] = useState<string | null>(null);
  const [secretaryProfile, setSecretaryProfile] = useState<{
    name: string;
    avatar: PersonaSettingsResponse["persona"]["avatar"];
  }>({
    name: "SetAgentName",
    avatar: null,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const hasLoadedHistory = useRef<string | null>(null);
  const lastPresencePingAtRef = useRef(0);
  const selectedConversation = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const primaryPendingApproval = pendingApprovals[0] ?? null;

  const stopMessagePlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }

    setSpeakingMessageId(null);
  }, []);

  const playAssistantMessage = useCallback(
    async (message: DeskChatMessage) => {
      const text = extractText(message);

      if (!text) {
        return;
      }

      if (speakingMessageId === message.id) {
        stopMessagePlayback();
        return;
      }

      stopMessagePlayback();
      setDeskVoiceError(null);
      setSpeakingMessageId(message.id);

      try {
        const response = await fetch("/api/voice/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Desk voice preview failed.");
        }

        const audioBlob = await response.blob();
        const objectUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(objectUrl);

        audioRef.current = audio;
        audioObjectUrlRef.current = objectUrl;

        audio.onended = () => {
          stopMessagePlayback();
        };
        audio.onerror = () => {
          stopMessagePlayback();
          setDeskVoiceError("Desk voice playback ran into an audio error.");
        };

        await audio.play();
      } catch (playbackError) {
        stopMessagePlayback();
        setDeskVoiceError(
          playbackError instanceof Error
            ? playbackError.message
            : "Desk voice playback is unavailable right now.",
        );
      }
    },
    [speakingMessageId, stopMessagePlayback],
  );

  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchJson<ConversationListResponse>("/api/conversations", {
        cache: "no-store",
      });
      setConversations(data.conversations);
      setSidebarError(null);
    } catch {
      setSidebarError("Recent conversations are unavailable.");
    }
  }, []);

  const loadSecretaryProfile = useCallback(async () => {
    try {
      const data = await fetchJson<PersonaSettingsResponse>("/api/persona", {
        cache: "no-store",
      });
      setSecretaryProfile({
        name: data.persona.name || "SetAgentName",
        avatar: data.persona.avatar,
      });
    } catch {
      // Keep the local default if the worker is unavailable.
    }
  }, []);

  const reportDeskPresence = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    const now = Date.now();
    if (now - lastPresencePingAtRef.current < 15_000) {
      return;
    }

    lastPresencePingAtRef.current = now;

    try {
      await fetch("/api/integrations/telegram/presence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          surface: "desk",
        }),
      });
    } catch {
      // Presence is best-effort.
    }
  }, []);

  const loadPendingApprovals = useCallback(async (nextConversationId: string) => {
    try {
      const data = await fetchJson<ToolExecutionListResponse>(
        `/api/tool-executions?conversationId=${encodeURIComponent(nextConversationId)}&approvalState=pending`,
        {
          cache: "no-store",
        },
      );
      setPendingApprovals(data.executions);
    } catch {
      setPendingApprovals([]);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    void loadSecretaryProfile();
  }, [loadConversations, loadSecretaryProfile]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedPreference = window.localStorage.getItem(deskVoicePreferenceKey);
    setAutoSpeakReplies(savedPreference === "true");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(deskVoicePreferenceKey, String(autoSpeakReplies));
  }, [autoSpeakReplies]);

  useEffect(() => {
    return () => {
      stopMessagePlayback();
    };
  }, [stopMessagePlayback]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    void reportDeskPresence();

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void reportDeskPresence();
      }
    };
    const handleFocus = () => {
      void reportDeskPresence();
    };
    const handlePointer = () => {
      void reportDeskPresence();
    };
    const interval = window.setInterval(() => {
      void reportDeskPresence();
    }, 45_000);

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handlePointer);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handlePointer);
    };
  }, [reportDeskPresence]);

  useEffect(() => {
    if (!conversationId || hasLoadedHistory.current === conversationId) {
      return;
    }

    let cancelled = false;

    async function loadConversationHistory() {
      setIsRefreshing(true);

      try {
        const data = await fetchJson<ConversationHistoryResponse>(
          `/api/conversations/${conversationId}`,
          {
            cache: "no-store",
          },
        );

        if (cancelled) {
          return;
        }

        setConversationSeedMessages(
          data.messages.length > 0 ? data.messages.map(toDeskChatMessage) : starterMessages,
        );
        setConversationSeedKey((current) => current + 1);
        hasLoadedHistory.current = data.conversationId;
        void loadPendingApprovals(data.conversationId);
      } catch {
        if (!cancelled) {
          setConversationSeedMessages(starterMessages);
          setConversationSeedKey((current) => current + 1);
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    void loadConversationHistory();

    return () => {
      cancelled = true;
    };
  }, [conversationId, loadPendingApprovals]);

  const resetConversationContext = useCallback(() => {
    setDeskPortraitError(null);
    setDeskVoiceError(null);
  }, []);

  const startFreshConversation = useCallback(() => {
    stopMessagePlayback();
    setConversationId(undefined);
    setConversationSeedMessages(starterMessages);
    setConversationSeedKey((current) => current + 1);
    setPendingApprovals([]);
    hasLoadedHistory.current = null;
    resetConversationContext();
  }, [stopMessagePlayback, starterMessages, resetConversationContext]);

  const openConversation = useCallback(
    async (nextConversationId: string) => {
      stopMessagePlayback();
      setConversationId(nextConversationId);
      setPendingApprovals([]);
      hasLoadedHistory.current = null;
      resetConversationContext();
    },
    [stopMessagePlayback, resetConversationContext],
  );

  const decideApproval = useCallback(
    async (executionId: string, approve: boolean) => {
      setApprovalBusyId(executionId);

      try {
        const data = await fetchJson<ToolApprovalDecisionResponse>(
          `/api/tool-executions/${executionId}/${approve ? "approve" : "deny"}`,
          {
            method: "POST",
          },
        );

        if (data.assistantMessage && autoSpeakReplies) {
          void playAssistantMessage({
            id: data.assistantMessage.id,
            role: "assistant",
            parts: [
              {
                type: "text",
                text: data.assistantMessage.text,
              },
            ],
          });
        }

        if (data.conversationId) {
          await loadPendingApprovals(data.conversationId);
          setConversationId(data.conversationId);
        } else {
          setPendingApprovals((current) =>
            current.filter((execution) => execution.id !== executionId),
          );
        }

        void loadConversations();
      } finally {
        setApprovalBusyId(null);
      }
    },
    [autoSpeakReplies, loadPendingApprovals, loadConversations, playAssistantMessage],
  );

  const handleReplyMetadata = useCallback((metadata: DeskChatMessageMetadata) => {
    setConversationId(metadata.conversationId);
  }, []);

  const handleReplyReady = useCallback(
    (message: DeskChatMessage) => {
      const metadata = extractMetadata(message);

      if (metadata?.conversationId) {
        void loadPendingApprovals(metadata.conversationId);
      }

      if (autoSpeakReplies) {
        void playAssistantMessage(message);
      }

      void loadConversations();
    },
    [autoSpeakReplies, loadPendingApprovals, loadConversations, playAssistantMessage],
  );

  return (
    <AppPage width="100%" className="app-page--desk">
      <section className="desk-grid desk-grid--workspace">
        <aside className="desk-rail desk-rail--sticky">
          <article className="desk-panel desk-panel--session">
            <div className="desk-session-intro">
              <div className="desk-panel-head desk-panel-head--stacked">
                <p className="desk-panel-title-line">Secretary: {secretaryProfile.name}</p>
              </div>
              <SecretaryPortraitField
                avatar={secretaryProfile.avatar}
                name={secretaryProfile.name}
                variant="desk"
                onUploaded={(next) => {
                  setSecretaryProfile({
                    name: next.persona.name || "SetAgentName",
                    avatar: next.persona.avatar,
                  });
                }}
                onStatusChange={(message, tone) => {
                  if (message && tone === "error") {
                    setDeskPortraitError(message);
                    return;
                  }

                  if (tone === "success") {
                    setDeskPortraitError(null);
                  }
                }}
              />
            </div>
            <ToggleField
              checked={autoSpeakReplies}
              onChange={setAutoSpeakReplies}
              label="Auto-voice replies"
              hint="Speak new secretary messages through the active voice profile."
            />
          </article>
        </aside>

        <div key={conversationSeedKey} className="desk-stage-column">
          <DeskConversationPane
            activeConversationId={conversationId}
            approvalBusyId={approvalBusyId}
            conversationTitle={selectedConversation?.title ?? undefined}
            deskPortraitError={deskPortraitError}
            deskVoiceError={deskVoiceError}
            initialMessages={conversationSeedMessages}
            isRefreshing={isRefreshing}
            pendingApproval={primaryPendingApproval}
            onDecideApproval={(executionId, approve) => {
              void decideApproval(executionId, approve);
            }}
            onConversationLinked={(nextConversationId) => {
              if (conversationId !== nextConversationId) {
                setConversationId(nextConversationId);
              }
            }}
            onReplyMetadata={handleReplyMetadata}
            onReplyReady={handleReplyReady}
            onSpeakMessage={playAssistantMessage}
            secretaryName={secretaryProfile.name}
            speakingMessageId={speakingMessageId}
          />
        </div>

        <aside className="desk-rail desk-rail--sticky">
          <article className="desk-panel desk-panel--drawer">
            <div className="desk-panel-head">
              <div>
                <p className="desk-panel-eyebrow">Correspondence</p>
                <h2 className="desk-panel-title">Recent correspondence</h2>
              </div>
              <button
                type="button"
                onClick={startFreshConversation}
                className="button-secondary"
                aria-label="Start a new correspondence"
                title="Start a new correspondence"
              >
                New
              </button>
            </div>
            <p className="desk-panel-copy">
              {sidebarError ?? "Pick back up where you left off, or begin a fresh exchange."}
            </p>
            <StatGrid>
              <StatCard
                label="Saved threads"
                value={String(conversations.length)}
                detail="Recent correspondence available to reopen here"
                tone="soft"
              />
              <StatCard
                label="Current focus"
                value={selectedConversation ? "open thread" : "new desk"}
                detail={
                  selectedConversation
                    ? (selectedConversation.title ?? "Untitled conversation")
                    : "Nothing selected from history yet"
                }
                tone="soft"
              />
            </StatGrid>
            <div className="desk-list">
              {conversations.length === 0 ? (
                <EmptyState
                  tone="warm"
                  title="No recent correspondence yet"
                  description={
                    <p>
                      Your first working thread will appear here once you begin talking with the
                      secretary.
                    </p>
                  }
                  actions={
                    <button
                      type="button"
                      onClick={startFreshConversation}
                      className="button-primary"
                    >
                      Begin a conversation
                    </button>
                  }
                />
              ) : (
                conversations.slice(0, 3).map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => void openConversation(conversation.id)}
                    aria-current={conversationId === conversation.id ? "page" : undefined}
                    aria-label={`Reopen correspondence: ${conversation.title ?? "Untitled conversation"}`}
                    title={`Reopen correspondence: ${conversation.title ?? "Untitled conversation"}`}
                    className={`desk-correspondence-item ${
                      conversationId === conversation.id ? "is-active" : ""
                    }`}
                  >
                    <p className="desk-correspondence-title">
                      {conversation.title ?? "Untitled conversation"}
                    </p>
                    <p className="desk-correspondence-copy">
                      {snippet(conversation.lastMessagePreview).slice(0, 72)}
                    </p>
                    <p className="desk-correspondence-meta">
                      {conversation.channelType} · {conversation.messageCount} messages
                    </p>
                  </button>
                ))
              )}
            </div>
          </article>
        </aside>
      </section>
    </AppPage>
  );
}
