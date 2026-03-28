import type { Metadata } from "next";
import { isSingleUserAuthEnabled } from "../lib/auth";
import { WorkspaceNav } from "./workspace-nav";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Secretary Workspace",
  description: "Desk, onboarding, health, persona, memory, activity, tools, channels, and voice surfaces for the Secretary-first assistant.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const authEnabled = isSingleUserAuthEnabled();

  return (
    <html lang="en">
      <body>
        <WorkspaceNav authEnabled={authEnabled} />
        {children}
      </body>
    </html>
  );
}
