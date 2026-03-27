"use client";

import { useState } from "react";
import type { OutboundChannelKey } from "@secretary/core-runtime";
import { AppPage, SurfaceCard } from "../lib/ui";
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
  const selected = channelTabs.find((tab) => tab.key === activeChannel) ?? channelTabs[0];

  return (
    <AppPage>
      <SurfaceCard
        tone="dark"
        title="Channels"
        description={
          <p>
            Choose where the secretary should reach you. Telegram remains the fully conversational
            channel, and the other high-value channels now have real outbound setup, readiness,
            and test-send flows here instead of one long setup sheet.
          </p>
        }
      >
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
