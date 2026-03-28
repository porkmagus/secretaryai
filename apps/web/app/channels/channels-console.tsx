"use client";

import { useState } from "react";
import type { OutboundChannelKey } from "@secretary/core-runtime";
import { ActionRow, AppPage, NoticeBanner, SurfaceCard } from "../lib/ui";
import { OutboundChannelSettings } from "./outbound-channel-settings";
import { TelegramSettings } from "./telegram-settings";

type ChannelKey = "telegram" | OutboundChannelKey;

type ChannelTab = {
  key: ChannelKey;
  label: string;
  description: string;
  bestFor: string;
};

const channelTabs: ChannelTab[] = [
  {
    key: "telegram",
    label: "Telegram",
    description:
      "Best for direct personal messaging, voice notes, and keeping the secretary available on your phone without needing the Desk open.",
    bestFor: "Personal mobile messaging, reminders, and voice-note workflows.",
  },
  {
    key: "discord",
    label: "Discord",
    description:
      "Useful when the secretary needs to live inside a private server, a personal workspace, or a small team environment with persistent threaded discussion.",
    bestFor: "Private servers, community-style rooms, and collaborative async work.",
  },
  {
    key: "slack",
    label: "Slack",
    description:
      "A high-value work channel for professional use, handoffs, and team follow-through where the secretary needs to feel native inside an office workflow.",
    bestFor: "Work teams, structured follow-up, and professional notification routing.",
  },
  {
    key: "email",
    label: "Email",
    description:
      "Email makes the secretary materially more useful because it turns drafts, summaries, and follow-through into something that can actually leave the system.",
    bestFor: "Drafting, sending follow-ups, summaries, and external communication.",
  },
  {
    key: "sms",
    label: "SMS",
    description:
      "SMS is less rich, but it matters for urgent reminders and reliable last-mile nudges when a message has to reach you immediately.",
    bestFor: "Urgent reminders, short alerts, and last-mile reach when chat apps are ignored.",
  },
];

export function ChannelsConsole() {
  const [activeChannel, setActiveChannel] = useState<ChannelKey>("telegram");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const selected = channelTabs.find((tab) => tab.key === activeChannel) ?? channelTabs[0];

  async function dispatchDueReminders() {
    setIsDispatching(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/integrations/reminders/deliver", {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to dispatch due reminders.");
      }

      setNotice(
        payload.delivered > 0
          ? `Delivered ${payload.delivered} reminder${payload.delivered === 1 ? "" : "s"} across the active channels.`
          : payload.scanned > 0
            ? "I checked the due reminders, but none were delivered yet."
            : "There are no due reminders waiting to go out right now.",
      );
    } catch (dispatchError) {
      setError(
        dispatchError instanceof Error
          ? dispatchError.message
          : "Unable to dispatch due reminders.",
      );
    } finally {
      setIsDispatching(false);
    }
  }

  return (
    <AppPage>
      <SurfaceCard
        tone="dark"
        title="Channels"
        description={
          <p>
            Choose where the secretary should reach you. Telegram remains the fully conversational
            channel, and the other high-value channels now handle reminders plus important job and
            heartbeat updates once they are enabled.
          </p>
        }
      >
        {notice ? <NoticeBanner tone="success">{notice}</NoticeBanner> : null}
        {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {channelTabs.map((channel) => {
            const active = channel.key === activeChannel;
            return (
              <button
                key={channel.key}
                type="button"
                onClick={() => setActiveChannel(channel.key)}
                className={active ? "button-primary" : "button-secondary"}
              >
                {channel.label}
              </button>
            );
          })}
        </div>
        <ActionRow align="between">
          <p style={{ margin: 0, color: "var(--muted)", maxWidth: 720 }}>
            Use this when you want the secretary to immediately push any due reminders through the
            enabled delivery channels instead of waiting for the next reminder sweep.
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void dispatchDueReminders()}
            disabled={isDispatching}
          >
            {isDispatching ? "Dispatching..." : "Dispatch due reminders"}
          </button>
        </ActionRow>
      </SurfaceCard>

      {selected.key === "telegram" ? (
        <TelegramSettings embedded />
      ) : (
        <OutboundChannelSettings
          descriptor={{
            key: selected.key,
            label: selected.label,
            description: selected.description,
            bestFor: selected.bestFor,
          }}
        />
      )}
    </AppPage>
  );
}
