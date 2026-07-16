// Live authorization. The user's role is derived from a FRESH AutoX access token
// on (almost) every request — never trusted from the 12h session cookie, which
// carries identity only. So a role removed in AutoX takes effect in seconds, not
// when the cookie finally expires. AutoX refresh tokens rotate on every use with
// reuse detection, so refreshes are single-flighted per user and the rotated
// token is persisted immediately.
//
// Node-only (openid-client + node:crypto). Import from route handlers / server
// components, never edge middleware.

import type { Role } from "./types";
import { refreshAppRoles } from "./oidc";
import { deriveRole } from "./roles";
import { encryptSecret, decryptSecret } from "./tokenCrypto";
import { getRefreshTokenEnc, storeRefreshToken, clearRefreshToken } from "./users";

export type LiveRole =
  | { role: Role }        // derived from a fresh token (or last-known-good on a transient blip)
  | { revoked: true }     // AutoX killed the grant/account -> force re-auth / 401
  | { noToken: true };    // pre-upgrade session or offline_access not granted -> caller uses cookie role

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
  let enc: string | null;
  try {
    enc = await getRefreshTokenEnc(userId);
  } catch {
    // DB unreachable — can't check live this request. Fall back to the signed
    // cookie role rather than logging everyone out on a DB blip.
    return { noToken: true };
  }
  if (!enc) return { noToken: true }; // no offline_access token stored (pre-upgrade session)

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(enc);
  } catch {
    // Unreadable ciphertext (e.g. AUTH_SECRET was rotated). Can't refresh -> re-auth.
    return { revoked: true };
  }

  try {
    const { appRoles, refreshToken: rotated } = await refreshAppRoles(refreshToken);
    const role = deriveRole(appRoles);
    roleCache.set(userId, { role, at: Date.now() });
    if (rotated !== refreshToken) {
      // Persist immediately — a stale refresh token would trip reuse detection.
      await storeRefreshToken(userId, encryptSecret(rotated)).catch(() => {});
    }
    return { role };
  } catch (err: any) {
    // Distinguish a real revocation from a transient outage: removing an app ROLE
    // still returns a valid token (fewer roles) — this catch only fires when the
    // GRANT itself is gone (suspended/revoked) or AutoX is momentarily down.
    const code = String(err?.error || "");
    if (code === "invalid_grant" || code === "invalid_request") {
      console.warn("[sso] grant revoked — forcing re-auth", { userId, error: code });
      roleCache.delete(userId);
      await clearRefreshToken(userId).catch(() => {});
      return { revoked: true };
    }
    // Transient (network / AutoX 5xx): don't punish the user. Use last-known-good
    // if we have it, else let the caller fall back to the cookie role.
    console.warn("[sso] live role refresh transient error — not revoking", {
      userId,
      error: String(err?.message || err),
    });
    const c = roleCache.get(userId);
    return c ? { role: c.role } : { noToken: true };
  }
}
