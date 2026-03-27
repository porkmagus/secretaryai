import type { ReactNode } from "react";
import { SectionTabs } from "../lib/section-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SectionTabs
      title="Settings"
      description="General runtime controls plus secretary, agent, tool, channel, and voice configuration."
      tabs={[
        { href: "/settings", label: "General" },
        { href: "/settings/agent", label: "Agent" },
        { href: "/settings/secretary", label: "Secretary" },
        { href: "/settings/tools", label: "Tools" },
        { href: "/settings/channels", label: "Channels" },
        { href: "/settings/voice", label: "Voice" },
      ]}
    >
      {children}
    </SectionTabs>
  );
}
