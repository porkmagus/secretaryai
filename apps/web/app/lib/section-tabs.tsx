"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type SectionTab = {
  href: string;
  label: string;
};

function isCurrentPath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SectionTabs({
  title,
  description,
  tabs,
  children,
}: {
  title: string;
  description: string;
  tabs: SectionTab[];
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const tones = ["sand", "sage", "rust", "ink"] as const;

  return (
    <section className="folder-shell">
      <div className="folder-shell__frame">
        <div className="folder-shell__intro">
          <p className="folder-shell__title">{title}</p>
          <p className="folder-shell__description">{description}</p>
        </div>

        <div className="folder-shell__tabs">
          {tabs.map((tab) => {
            const active = pathname ? isCurrentPath(pathname, tab.href) : false;
            const tone = tones[tabs.indexOf(tab) % tones.length];

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`folder-shell__tab folder-shell__tab--${tone}${active ? " is-active" : ""}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {children ? <div className="folder-shell__body">{children}</div> : null}
      </div>
    </section>
  );
}
