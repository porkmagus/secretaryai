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
        background: "rgba(14, 11, 9, 0.84)",
        borderBottom: "1px solid rgba(196, 180, 154, 0.08)",
      }}
    >
      <div
        style={{
          width: "min(1220px, calc(100% - 32px))",
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 18,
          padding: "14px 0",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <Link
            href={isLoginRoute ? "/login" : "/"}
            style={{
              textDecoration: "none",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--accent)",
              fontSize: 12,
            }}
          >
            Secretary
          </Link>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Rustic operator workspace for memory, channels, voice, and actions
          </span>
        </div>
        {isLoginRoute ? (
          <div
            style={{
              color: "var(--muted)",
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "7px 10px",
              borderRadius: 999,
              border: "1px solid rgba(196, 180, 154, 0.12)",
              background: "rgba(31, 26, 21, 0.84)",
            }}
          >
            Operator sign-in
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              color: "var(--muted)",
              fontSize: 13,
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
                    padding: "7px 10px",
                    borderRadius: 10,
                    border: active
                      ? "1px solid rgba(164, 141, 100, 0.24)"
                      : "1px solid rgba(196, 180, 154, 0.08)",
                    background: active
                      ? "linear-gradient(135deg, rgba(164, 141, 100, 0.18), rgba(94, 86, 72, 0.18))"
                      : "rgba(30, 24, 19, 0.72)",
                    color: active ? "var(--accent-strong)" : "inherit",
                    fontWeight: active ? 700 : 550,
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
                  padding: "7px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(156, 93, 67, 0.28)",
                  background: "rgba(57, 32, 25, 0.88)",
                  color: "#efc0aa",
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
