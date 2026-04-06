import type { ReactNode } from "react";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function AppPage({
  children,
  width = "1220px",
  className,
}: {
  children: ReactNode;
  width?: string;
  className?: string;
}) {
  return (
    <main className={joinClasses("app-page", className)}>
      <section className="page-stack" style={{ width: `min(${width}, 100%)` }}>
        {children}
      </section>
    </main>
  );
}

export function PageHero({
  eyebrow,
  title,
  description,
  meta,
  actions,
  tone = "default",
}: {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "dark";
}) {
  return (
    <header className={joinClasses("hero-card", tone === "dark" && "hero-card--dark")}>
      <div className="hero-header">
        <div className="hero-copy-wrap">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="hero-title">{title}</h1>
          <div className="hero-copy">{description}</div>
          {meta ? <div className="hero-meta">{meta}</div> : null}
        </div>
        {actions ? <div className="hero-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <section className="stat-grid">{children}</section>;
}

export function StatCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "soft" | "dark";
}) {
  return (
    <article
      className={joinClasses(
        "stat-card",
        tone === "soft" && "stat-card--soft",
        tone === "dark" && "stat-card--dark",
      )}
    >
      <p className="stat-label">{label}</p>
      <div className="stat-value">{value}</div>
      {detail ? <div className="stat-detail">{detail}</div> : null}
    </article>
  );
}

export function SurfaceCard({
  children,
  title,
  description,
  tone = "default",
  className,
}: {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  tone?: "default" | "soft" | "dark";
  className?: string;
}) {
  return (
    <article
      className={joinClasses(
        "surface-card",
        tone === "soft" && "surface-card--soft",
        tone === "dark" && "surface-card--dark",
        className,
      )}
    >
      {title || description ? (
        <div className="surface-head">
          {title ? <h2 className="surface-title">{title}</h2> : null}
          {description ? <div className="surface-copy">{description}</div> : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}

export function NoticeBanner({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "error";
}) {
  const role = tone === "error" ? "alert" : "status";

  return (
    <div
      className={joinClasses("notice-banner", `notice-banner--${tone}`)}
      role={role}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actions,
  tone = "default",
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "warm";
}) {
  return (
    <div className={joinClasses("empty-state", tone === "warm" && "empty-state--warm")}>
      <div className="empty-state__copy">
        <h3 className="empty-state__title">{title}</h3>
        <div className="empty-state__description">{description}</div>
      </div>
      {actions ? <div className="empty-state__actions">{actions}</div> : null}
    </div>
  );
}

export function LoadingSurface({
  title,
  description,
  blocks = 3,
}: {
  title: ReactNode;
  description: ReactNode;
  blocks?: number;
}) {
  return (
    <SurfaceCard tone="dark" title={title} description={description}>
      <div className="loading-shell" aria-hidden="true">
        {Array.from({ length: blocks }).map((_, index) => (
          <div key={index} className="loading-shell__block">
            <span className="loading-shell__line loading-shell__line--short" />
            <span className="loading-shell__line" />
            <span className="loading-shell__line loading-shell__line--soft" />
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

export function ActionRow({
  children,
  align = "end",
}: {
  children: ReactNode;
  align?: "start" | "end" | "between";
}) {
  return (
    <div className={joinClasses("action-row", align === "start" && "action-row--start", align === "between" && "action-row--between")}>
      {children}
    </div>
  );
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <span className="field-hint">{children}</span>;
}

export function ToggleField({
  checked,
  label,
  onChange,
  disabled = false,
  hint,
  className,
}: {
  checked: boolean;
  label: ReactNode;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={joinClasses(
        "toggle-field",
        checked && "toggle-field--checked",
        disabled && "toggle-field--disabled",
        className,
      )}
    >
      <span className="toggle-field__control" aria-hidden="true">
        <span className="toggle-field__thumb" />
      </span>
      <span className="toggle-field__copy">
        <span className="toggle-field__label">{label}</span>
        {hint ? <span className="toggle-field__hint">{hint}</span> : null}
      </span>
    </button>
  );
}
