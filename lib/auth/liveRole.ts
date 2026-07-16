// Live authorization. The user's role is derived from a FRESH AutoX access token
// on (almost) every request — never trusted from the 12h session cookie, which
// carries identity only. So a role removed in AutoX takes effect in seconds, not
// when the cookie finally expires.
//
// AutoX rotates the refresh token on EVERY use and kills the whole grant family if
// an already-rotated token is presented again (reuse detection). On serverless,
// concurrent requests land on different instances that each read the same stored
// token and refresh at once — tripping that detection and destroying the grant. So
// the read-refresh-store cycle is serialized across instances with a Postgres
// advisory lock, and the token is RE-READ inside the lock so every refresh uses the
// newest rotated value.
//
// Node-only (openid-client + node:crypto + pg). Import from route handlers / server
// components, never edge middleware.

import type { Role } from "./types";
import { refreshAppRoles } from "./oidc";
import { deriveRole } from "./roles";
import { encryptSecret, decryptSecret } from "./tokenCrypto";
import { withAdvisoryLock, SCHEMA } from "../db";

export type LiveRole =
  | { role: Role }         // derived from a fresh token (or last-known-good on a transient blip)
  | { revoked: true }      // AutoX killed the grant/account -> force re-auth / 401
  | { noToken: true }      // no refresh token stored (pre-upgrade session, or it was cleared)
  | { unavailable: true }; // DB/AutoX momentarily unreachable -> caller trusts the cookie this request

// A tiny shared-staleness window so a burst of requests doesn't refresh per call.
// `force` (critical mutations) bypasses it entirely. Per-instance on serverless;
// the in-flight map still dedupes concurrent refreshes within an instance.
const WINDOW_MS = 5000;
const roleCache = new Map<string, { role: Role; at: number }>();
const inflight = new Map<string, Promise<LiveRole>>();

export function invalidateLiveRole(userId: string): void {
  roleCache.delete(userId);
}

/** Current role from a fresh AutoX token. `force: true` skips the staleness
 *  window (use for critical mutations) but still joins an in-flight refresh. */
export async function getLiveRole(userId: string, opts: { force?: boolean } = {}): Promise<LiveRole> {
  if (!opts.force) {
    const c = roleCache.get(userId);
    if (c && Date.now() - c.at < WINDOW_MS) return { role: c.role };
  }
  let p = inflight.get(userId);
  if (!p) {
    p = deriveLive(userId).finally(() => inflight.delete(userId));
    inflight.set(userId, p);
  }
  return p;
}

async function deriveLive(userId: string): Promise<LiveRole> {
  try {
    return await withAdvisoryLock(`sso-refresh:${userId}`, async (client) => {
      // Re-read the CURRENT token INSIDE the lock — another instance may have rotated
      // it while we waited, and presenting a stale token trips AutoX reuse detection.
      const sel = await client.query(
        `select sso_refresh_token_enc as enc from ${SCHEMA}.users where user_id = $1 limit 1`,
        [userId],
      );
      const enc: string | null = sel.rows[0]?.enc ?? null;
      if (!enc) return { noToken: true } as LiveRole; // no offline_access token stored

      let refreshToken: string;
      try {
        refreshToken = decryptSecret(enc);
      } catch {
        // Unreadable ciphertext (e.g. AUTH_SECRET rotated). Can't refresh -> re-auth.
        return { revoked: true } as LiveRole;
      }

      try {
        const { appRoles, refreshToken: rotated } = await refreshAppRoles(refreshToken);
        const role = deriveRole(appRoles);
        roleCache.set(userId, { role, at: Date.now() });
        if (rotated !== refreshToken) {
          // Persist the rotated token immediately (same locked connection), so the
          // next holder re-reads the fresh value.
          await client.query(
            `update ${SCHEMA}.users set sso_refresh_token_enc = $2, sso_refresh_at = now() where user_id = $1`,
            [userId, encryptSecret(rotated)],
          );
        }
        return { role } as LiveRole;
      } catch (err: any) {
        // Removing an app ROLE still returns a valid token (fewer roles); this only
        // fires when the GRANT itself is gone (suspended/revoked) or AutoX is down.
        const code = String(err?.error || "");
        if (code === "invalid_grant" || code === "invalid_request") {
          console.warn("[sso] grant revoked — forcing re-auth", { userId, error: code });
          roleCache.delete(userId);
          await client.query(
            `update ${SCHEMA}.users set sso_refresh_token_enc = null, sso_refresh_at = null where user_id = $1`,
            [userId],
          );
          return { revoked: true } as LiveRole;
        }
        // Transient (network / AutoX 5xx): don't punish. Use last-known-good if we
        // have it, else tell the caller it's unavailable (trust the cookie once).
        console.warn("[sso] live role refresh transient error — not revoking", {
          userId,
          error: String(err?.message || err),
        });
        const c = roleCache.get(userId);
        return (c ? { role: c.role } : { unavailable: true }) as LiveRole;
      }
    });
  } catch {
    // Couldn't acquire the lock / DB unreachable this request. Don't log anyone out
    // on a DB blip — report unavailable so the caller trusts the signed cookie once.
    return { unavailable: true };
  }
}
