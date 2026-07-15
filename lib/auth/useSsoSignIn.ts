"use client";

import { useState } from "react";

// Start (or RE-start) an AutoX SSO authorization from the browser.
//
// `start()` warms the possibly-cold, scale-to-zero IdP through a same-origin
// health proxy (/api/auth/sso/health — the IdP's own /health has no CORS), then
// hands off to /api/auth/sso/login, which ALWAYS mints fresh PKCE/state and
// redirects to /auth. It never reuses a cached session: because a signed-in user
// still holds a live SSO session, that round-trip is silent and returns an
// updated token. This is what makes the same call double as "re-authorize to
// pick up a role change" (integration.md — a retry MUST start a new
// authorization, not reload a session).
export function useSsoSignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(next: string = "/overview") {
    if (pending) return;
    setPending(true);
    setError(null);
    const dest = `/api/auth/sso/login?next=${encodeURIComponent(next)}`;
    const deadline = Date.now() + 60_000; // allow a cold start up to ~60s
    while (Date.now() < deadline) {
      try {
        const r = await fetch("/api/auth/sso/health", { cache: "no-store" });
        if (r.ok) {
          const body = await r.json().catch(() => null);
          if (body && body.status === "ok") {
            window.location.href = dest;
            return;
          }
        }
      } catch {
        /* server momentarily unreachable — retry */
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    setPending(false);
    setError("Sign-in is waking up and didn’t respond in time. Please try again in a moment.");
  }

  return { pending, error, start, setError };
}
