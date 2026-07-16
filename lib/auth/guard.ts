// Auth resolution + API-route guards. Reads the session cookie, verifies it,
// and RE-VALIDATES against the DB every request (so disabled/deleted accounts
// and role changes take effect immediately - the cookie alone is never trusted).
// Safe to import from route handlers and server components (no next/navigation).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./session";
import { getUserById } from "./users";
import { getLiveRole, invalidateLiveRole } from "./liveRole";
import type { Role, SessionUser } from "./types";

// Short-lived cache of the DB-validated IDENTITY (existence + status + email/name).
// Without it the guard runs a user lookup on EVERY request - and each dashboard
// panel polls every few seconds, so a single page load would fire a burst of
// identical queries at Postgres. ROLE is deliberately NOT cached here: it is
// re-derived live from a fresh AutoX token (getLiveRole) so a revocation takes
// effect in seconds, not at the 12h session's expiry.
type DbIdentity = { sub: string; email: string; name: string };
const identityCache = new Map<string, { identity: DbIdentity | null; at: number }>();
const IDENTITY_TTL_MS = 10_000;

/** Drop a user's cached auth so a status/role change takes effect immediately. */
export function invalidateAuthUser(userId: string): void {
  identityCache.delete(userId);
  invalidateLiveRole(userId);
}

/** Current user or null. Identity + local kill switch come from the DB (short
 *  cached); ROLE is derived live from a fresh AutoX token. `live: true` forces a
 *  no-cache refresh — use for critical mutations so revocation bites instantly. */
export async function getAuthUser(opts: { live?: boolean } = {}): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;

  // 1) Identity + local kill switch (existence / disabled / deleted), short-cached.
  let identity: DbIdentity | null;
  const cached = identityCache.get(session.sub);
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) {
    identity = cached.identity;
  } else {
    try {
      const row = await getUserById(session.sub);
      identity = row && row.status === "active" ? { sub: row.user_id, email: row.email, name: row.name } : null;
      identityCache.set(session.sub, { identity, at: Date.now() });
    } catch {
      // DB momentarily unreachable: the session is signed and valid, so trust its
      // claims (role included) for this request rather than flipping every panel to
      // "offline". Not cached, so validation resumes once the DB is back.
      return { sub: session.sub, email: session.email, name: session.name, role: session.role };
    }
  }
  if (!identity) return null; // deleted / disabled / invited -> local kill switch (≤10s)

  // 2) Live authorization: role from a fresh AutoX token, never the cookie.
  const live = await getLiveRole(session.sub, { force: !!opts.live });
  let role: Role;
  if ("role" in live) {
    role = live.role;
  } else if ("revoked" in live) {
    return null; // AutoX killed the grant/account -> re-auth
  } else if ("noToken" in live) {
    // No live token. For a session that was minted WITH one (live-managed), that
    // means the grant was revoked and the token cleared -> deny (fail-closed). For a
    // genuine pre-upgrade session (never had a token) -> fall back to the cookie role.
    if (session.live) return null;
    role = session.role;
  } else {
    // unavailable: transient DB/AutoX blip -> trust the signed cookie for this request
    // rather than logging everyone out on a hiccup.
    role = session.role;
  }

  return { sub: identity.sub, email: identity.email, name: identity.name, role };
}

export function unauthorized() {
  // `x-auth: required` marks this as a CE authentication failure (session expired /
  // revoked) so the client-side SessionGuard can eject to /login — WITHOUT reacting
  // to a 401 that the mock engine returns while emulating an adapter's own auth.
  return NextResponse.json({ ok: false, error: "authentication required" }, { status: 401, headers: { "x-auth": "required" } });
}
export function forbidden() {
  return NextResponse.json({ ok: false, error: "administrator role required" }, { status: 403 });
}

/** Route-handler guard. Usage:
 *    const auth = await requireApiUser(); if ("res" in auth) return auth.res;
 *    const user = auth.user;
 */
export async function requireApiUser(): Promise<{ user: SessionUser } | { res: NextResponse }> {
  const user = await getAuthUser();
  return user ? { user } : { res: unauthorized() };
}

export async function requireApiAdmin(): Promise<{ user: SessionUser } | { res: NextResponse }> {
  // Admin API surface is the critical path: force a live (no-cache) role check so a
  // role removed in AutoX blocks the very next admin action, not up to ~5s later.
  const user = await getAuthUser({ live: true });
  if (!user) return { res: unauthorized() };
  if (user.role !== "administrator") return { res: forbidden() };
  return { user };
}
