// Password-reset tokens. Mirrors the invite-token pattern (lib/auth/invite.ts):
// a random token travels in the emailed link; only its sha256 hash is stored
// (users.reset_token_hash). Redeeming a reset matches the hash and clears it
// (single-use). Short-lived — 1 hour. Node-only.

import { randomBytes, createHash } from "node:crypto";

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): { token: string; hash: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    hash: hashResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
  };
}
