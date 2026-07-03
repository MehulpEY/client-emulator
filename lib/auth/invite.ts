// Invite tokens for user onboarding. A random token travels in the emailed link;
// only its sha256 hash is stored in the DB (users.invite_token_hash). Accepting
// an invite matches the hash and then clears it (single-use). Node-only.

import { randomBytes, createHash } from "node:crypto";

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): { token: string; hash: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    hash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  };
}
