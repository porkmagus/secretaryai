"use client";

import { FormEvent, useState } from "react";

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "Unable to sign in.";
  } catch {
    return "Unable to sign in.";
  }
}

export function LoginScreen({ nextPath }: { nextPath: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password,
          next: nextPath,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as { redirectTo?: string };
      window.location.href = payload.redirectTo ?? "/";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <section
        style={{
          width: "min(520px, 100%)",
          padding: 30,
          borderRadius: 32,
          border: "1px solid rgba(64, 89, 112, 0.12)",
          background:
            "linear-gradient(180deg, rgba(255, 252, 247, 0.98), rgba(248, 241, 232, 0.95))",
          boxShadow: "var(--shadow)",
          display: "grid",
          gap: 18,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-30% auto auto 58%",
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: "rgba(15, 118, 110, 0.14)",
            filter: "blur(8px)",
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "grid", gap: 10 }}>
          <p
            style={{
              margin: 0,
              color: "var(--accent)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Secretary Access
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                borderRadius: 999,
                padding: "6px 10px",
                background: "rgba(15, 118, 110, 0.08)",
                border: "1px solid rgba(15, 118, 110, 0.12)",
                color: "var(--text)",
                fontSize: 12,
              }}
            >
              Single-user gate
            </span>
            <span
              style={{
                borderRadius: 999,
                padding: "6px 10px",
                background: "rgba(198, 123, 42, 0.08)",
                border: "1px solid rgba(198, 123, 42, 0.14)",
                color: "#8f4e11",
                fontSize: 12,
              }}
            >
              Local operator mode
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1 }}>
            Sign in to the workspace
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
            This install is using the single-user access gate. Enter the operator password
            to continue into the Desk, tools, memory, and admin surfaces.
          </p>
        </div>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Operator password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              style={{
                minHeight: 46,
              }}
            />
          </label>
          <p style={{ margin: 0, color: error ? "#b45309" : "var(--muted)", fontSize: 14 }}>
            {error ?? "The session is stored in an HTTP-only cookie on this browser."}
          </p>
          <button
            type="submit"
            disabled={isSubmitting || password.trim().length === 0}
            style={{
              justifySelf: "end",
              border: "none",
              borderRadius: 999,
              padding: "12px 18px",
              font: "inherit",
              fontWeight: 700,
              cursor:
                isSubmitting || password.trim().length === 0 ? "not-allowed" : "pointer",
              color: "#f6fffd",
              background:
                "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
              opacity: isSubmitting || password.trim().length === 0 ? 0.7 : 1,
            }}
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
