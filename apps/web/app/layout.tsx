import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { isSingleUserAuthEnabled } from "../lib/auth";
import { WorkspaceNav } from "./workspace-nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-display" });

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
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body>
        <WorkspaceNav authEnabled={authEnabled} />
        {children}
      </body>
    </html>
  );
}
