import type { ReactNode } from "react";
import { SectionTabs } from "../lib/section-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SectionTabs
      title="Settings"
      description="General runtime controls plus the secretary profile, tools, channels, and voice."
      tabs={[
        { href: "/settings", label: "General" },
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
