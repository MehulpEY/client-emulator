"use client";

import { useEffect } from "react";

// Client-side auth backstop. The server 401s a revoked/expired session on every API
// call, but an already-rendered page won't redirect itself — background polls just
// fail quietly, so a revoked user appears "still in the app" until a manual reload.
//
// This patches fetch to eject to /login the moment a CE-auth 401 comes back. It keys
// off the `x-auth: required` header (set by unauthorized()) rather than the bare 401
// status, so it does NOT fire on a 401 the mock engine returns while emulating an
// adapter's own authentication. Mounted once in the authenticated (app) shell.
export function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;
    let redirecting = false;
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const res = await original.apply(this, args);
      if (!redirecting && res.status === 401 && res.headers.get("x-auth") === "required") {
        redirecting = true;
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}`);
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return null;
}
