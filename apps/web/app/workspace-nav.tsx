"use client";

import Link from "next/link";
import { Great_Vibes } from "next/font/google";
import { usePathname } from "next/navigation";

const primaryLinks = [
  { href: "/overview", label: "Overview" },
  { href: "/", label: "Desk" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

const greatVibes = Great_Vibes({
  weight: "400",
  subsets: ["latin"],
});

function SecretaryWordmark() {
  return (
    <span className="workspace-brand__lockup">
      <span className="workspace-brand__wordmark">
        <span className={`workspace-brand__title ${greatVibes.className}`}>Secretary</span>
        <span className="workspace-brand__flourish" aria-hidden="true" />
      </span>
    </span>
  );
}

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
    <nav className="workspace-nav">
      <div className="workspace-nav__inner">
        <div className="workspace-nav__brand">
          <Link href={isLoginRoute ? "/login" : "/"} className="workspace-brand">
            <SecretaryWordmark />
          </Link>
          <span className="workspace-nav__tagline">
            A calm home for your secretary, follow-through, and active work
          </span>
        </div>
        {isLoginRoute ? (
          <div className="workspace-nav__operator">
            Operator sign-in
          </div>
        ) : (
          <div className="workspace-nav__links">
            {primaryLinks.map((link) => {
              const active = pathname ? isCurrentPath(pathname, link.href) : false;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`workspace-nav__link ${active ? "is-active" : ""}`}
                >
                  {link.label}
                </Link>
              );
            })}
            {authEnabled ? (
              <a href="/api/auth/logout" className="workspace-nav__logout">
                Log Out
              </a>
            ) : null}
          </div>
        )}
      </div>
    </nav>
  );
}
