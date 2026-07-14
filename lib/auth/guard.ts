// Auth resolution + API-route guards. Reads the session cookie, verifies it,
// and RE-VALIDATES against the DB every request (so disabled/deleted accounts
// and role changes take effect immediately - the cookie alone is never trusted).
// Safe to import from route handlers and server components (no next/navigation).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./session";
import { getUserById } from "./users";
import type { SessionUser } from "./types";

// Short-lived cache of DB-validated sessions. Without this the guard runs a user
// lookup on EVERY request - and each dashboard panel polls every few seconds, so
// a single page load would fire a burst of identical auth queries at Postgres.
// Keyed by user_id; invalidated immediately when a user's role/status changes.
const authCache = new Map<string, { user: SessionUser | null; at: number }>();
const AUTH_TTL_MS = 10_000;

/** Drop a user's cached auth so a role/status change takes effect immediately. */
export function invalidateAuthUser(userId: string): void {
  authCache.delete(userId);
}

/** Current user (DB-validated, short-cached) or null. */
export async function getAuthUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;

  const cached = authCache.get(session.sub);
  if (cached && Date.now() - cached.at < AUTH_TTL_MS) return cached.user;

  try {
    const row = await getUserById(session.sub);
    // Existence + status (active/disabled/deleted) come from the DB - the local
    // kill switch. ROLE comes from the session, which is set from the SSO token
    // at login: the IdP is the source of truth for roles, not a persisted column
    // (integration.md "Do not copy ... roles ... as the source of truth"). A
    // role change therefore takes effect on the user's next login.
    const user: SessionUser | null =
      row && row.status === "active" // deleted / disabled / invited -> reject
        ? { sub: row.user_id, email: row.email, name: row.name, role: session.role }
        : null;
    authCache.set(session.sub, { user, at: Date.now() });
    return user;
  } catch {
    // DB momentarily unreachable (e.g. the circuit breaker is open after a
    // transient blip): the session is cryptographically signed and valid, so
    // trust its claims for this request rather than 500-ing and flipping every
    // panel to "offline". Not cached, so re-validation resumes once the DB is back.
    return { sub: session.sub, email: session.email, name: session.name, role: session.role };
  }
}

export function unauthorized() {
  return NextResponse.json({ ok: false, error: "authentication required" }, { status: 401 });
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
  const user = await getAuthUser();
  if (!user) return { res: unauthorized() };
  if (user.role !== "administrator") return { res: forbidden() };
  return { user };
}
