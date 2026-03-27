import type { ReactNode } from "react";
import { SectionTabs } from "../lib/section-tabs";

export default function ActivityLayout({ children }: { children: ReactNode }) {
  return (
    <SectionTabs
      title="Activity"
      description="Inspect what happened, what the secretary retained, and which follow-through items still need attention."
      tabs={[
        { href: "/activity", label: "Timeline" },
        { href: "/activity/memory", label: "Memory" },
        { href: "/activity/tasks", label: "Tasks" },
      ]}
    >
      {children}
    </SectionTabs>
  );
}
