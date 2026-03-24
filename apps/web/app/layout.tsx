import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Secretary Workspace",
  description: "Desk, onboarding, health, persona, memory, activity, tools, channels, and voice surfaces for the Secretary-first assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <nav
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            backdropFilter: "blur(16px)",
            background: "rgba(2, 6, 23, 0.72)",
            borderBottom: "1px solid rgba(125, 211, 252, 0.12)",
          }}
        >
          <div
            style={{
              width: "min(1220px, calc(100% - 32px))",
              margin: "0 auto",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              padding: "14px 0",
            }}
          >
            <Link
              href="/"
              style={{
                textDecoration: "none",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--accent)",
                fontSize: 13,
              }}
            >
              Secretary
            </Link>
            <div
              style={{
                display: "flex",
                gap: 16,
                color: "var(--muted)",
                fontSize: 14,
              }}
            >
              <Link href="/" style={{ textDecoration: "none" }}>
                Desk
              </Link>
              <Link href="/onboarding" style={{ textDecoration: "none" }}>
                Onboarding
              </Link>
              <Link href="/health" style={{ textDecoration: "none" }}>
                Health
              </Link>
              <Link href="/persona" style={{ textDecoration: "none" }}>
                Persona
              </Link>
              <Link href="/memory" style={{ textDecoration: "none" }}>
                Memory
              </Link>
              <Link href="/activity" style={{ textDecoration: "none" }}>
                Activity
              </Link>
              <Link href="/tools" style={{ textDecoration: "none" }}>
                Tools
              </Link>
              <Link href="/channels" style={{ textDecoration: "none" }}>
                Channels
              </Link>
              <Link href="/voice" style={{ textDecoration: "none" }}>
                Voice
              </Link>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
