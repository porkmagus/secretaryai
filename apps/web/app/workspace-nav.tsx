"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const primaryLinks = [
  { href: "/", label: "Desk" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/health", label: "Health" },
  { href: "/persona", label: "Persona" },
  { href: "/memory", label: "Memory" },
  { href: "/activity", label: "Activity" },
  { href: "/tools", label: "Tools" },
  { href: "/channels", label: "Channels" },
  { href: "/voice", label: "Voice" },
];

function isCurrentPath(currentPath: string, href: string) {
  if (href === "/") {
    return currentPath === "/";
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export function WorkspaceNav({ authEnabled }: { authEnabled: boolean }) {
  const pathname = usePathname();
  const isLoginRoute = pathname === "/login";

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        backdropFilter: "blur(18px)",
        background: "rgba(247, 241, 231, 0.84)",
        borderBottom: "1px solid rgba(64, 89, 112, 0.1)",
      }}
    >
      <div
        style={{
          width: "min(1220px, calc(100% - 32px))",
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 18,
          padding: "16px 0",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <Link
            href={isLoginRoute ? "/login" : "/"}
            style={{
              textDecoration: "none",
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--accent)",
              fontSize: 13,
            }}
          >
            Secretary
          </Link>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            Operator studio for memory, channels, voice, and action review
          </span>
        </div>
        {isLoginRoute ? (
          <div
            style={{
              color: "var(--muted)",
              fontSize: 13,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid rgba(64, 89, 112, 0.12)",
              background: "rgba(255, 255, 255, 0.58)",
            }}
          >
            Operator sign-in
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              color: "var(--muted)",
              fontSize: 14,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {primaryLinks.map((link) => {
              const active = pathname ? isCurrentPath(pathname, link.href) : false;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{
                    textDecoration: "none",
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: active
                      ? "1px solid rgba(15, 118, 110, 0.18)"
                      : "1px solid rgba(64, 89, 112, 0.08)",
                    background: active
                      ? "linear-gradient(135deg, rgba(15, 118, 110, 0.12), rgba(15, 118, 110, 0.06))"
                      : "rgba(255, 255, 255, 0.42)",
                    color: active ? "var(--accent-strong)" : "inherit",
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
            {authEnabled ? (
              <a
                href="/api/auth/logout"
                style={{
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(180, 83, 9, 0.2)",
                  background: "rgba(255, 247, 237, 0.82)",
                  color: "#9a3412",
                }}
              >
                Log Out
              </a>
            ) : null}
          </div>
        )}
      </div>
    </nav>
  );
}
