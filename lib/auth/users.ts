// Users data-access. Node-only (imported from route handlers / server components).

import { randomBytes } from "node:crypto";
import { q, tryQuery, SCHEMA } from "../db";
import type { UserRow, Role, UserStatus, PublicUser } from "./types";

const COLS =
  "user_id, email, name, role, password_hash, status, invite_token_hash, invite_expires_at, reset_token_hash, reset_expires_at, autox_sub, created_by, created_at, onboarded_at, last_login_at";

export function newUserId(): string {
  return `usr_${randomBytes(9).toString("hex")}`;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    user_id: u.user_id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    created_by: u.created_by,
    created_at: u.created_at,
    onboarded_at: u.onboarded_at,
    last_login_at: u.last_login_at,
  };
}

export async function countUsers(): Promise<number> {
  const rows = await tryQuery<{ n: number }>(`select count(*)::int as n from ${SCHEMA}.users`);
  return rows[0] ? Number(rows[0].n) : 0;
}

export async function countAdmins(): Promise<number> {
  const rows = await tryQuery<{ n: number }>(
    `select count(*)::int as n from ${SCHEMA}.users where role = 'administrator' and status <> 'disabled'`,
  );
  return rows[0] ? Number(rows[0].n) : 0;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await q<UserRow>(`select ${COLS} from ${SCHEMA}.users where lower(email) = lower($1) limit 1`, [email]);
  return rows[0] ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await q<UserRow>(`select ${COLS} from ${SCHEMA}.users where user_id = $1 limit 1`, [id]);
  return rows[0] ?? null;
}

export async function getUserByAutoxSub(sub: string): Promise<UserRow | null> {
  const rows = await q<UserRow>(`select ${COLS} from ${SCHEMA}.users where autox_sub = $1 limit 1`, [sub]);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<UserRow[]> {
  return tryQuery<UserRow>(`select ${COLS} from ${SCHEMA}.users order by created_at desc`);
}

export async function recordLogin(userId: string): Promise<void> {
  await tryQuery(`update ${SCHEMA}.users set last_login_at = now() where user_id = $1`, [userId]);
}

export async function updateUser(userId: string, patch: { role?: Role; status?: UserStatus }): Promise<UserRow | null> {
  const sets: string[] = [];
  const vals: any[] = [userId];
  if (patch.role) {
    vals.push(patch.role);
    sets.push(`role = $${vals.length}`);
  }
  if (patch.status) {
    vals.push(patch.status);
    sets.push(`status = $${vals.length}`);
  }
  if (sets.length === 0) return getUserById(userId);
  const rows = await q<UserRow>(
    `update ${SCHEMA}.users set ${sets.join(", ")} where user_id = $1 returning ${COLS}`,
    vals,
  );
  return rows[0] ?? null;
}

export async function deleteUser(userId: string): Promise<void> {
  await q(`delete from ${SCHEMA}.users where user_id = $1`, [userId]);
}

export interface SsoUserInput {
  sub: string; // AutoX stable subject
  email: string;
  emailVerified: boolean;
  name: string;
  role: Role; // token-derived; stored only as a refreshed-at-login display mirror
}

/** Why a valid AutoX identity was refused a local row. These are the ONLY reasons
 *  CE overrides AutoX's "may sign in" decision — each is an explicit, rare policy
 *  choice, not a black box, so the callback can name it to the user and the logs:
 *   - `disabled`         local kill switch: an admin disabled this account here.
 *   - `email_conflict`   the email is linked to a DIFFERENT AutoX `sub` and can't
 *                        be safely re-linked (only an *unverified* email is refused;
 *                        a verified one re-links — see the safety net in step 2a).
 *   - `email_unverified` one-time adoption of a legacy row needs a verified email
 *                        (anti-takeover guard; AutoX sends email_verified=true for
 *                        managed accounts, so this is a corner case). */
export type SsoDenyReason = "disabled" | "email_conflict" | "email_unverified";

export type SsoUpsertResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: SsoDenyReason };

/**
 * Link or JIT-provision the local record for an SSO identity, keyed on the stable
 * `sub`. AutoX owns authentication; this row is a projection, not a second gate —
 * a validly-authenticated user is provisioned `active` and signed in. First login
 * adopts a pre-existing (invite-era) row by *verified* email as a ONE-TIME
 * migration step; thereafter we match on `sub` only (email can change, `sub`
 * never does). If AutoX re-issues a NEW `sub` for a known verified email
 * (delete+recreate), we re-link the row to it as a safety net (step 2a). The only
 * refusals are the explicit `SsoDenyReason` cases above.
 */
export async function upsertSsoUser(input: SsoUserInput): Promise<SsoUpsertResult> {
  // 1) Already linked -> refresh display fields + role mirror, bump last login.
  const linked = await getUserByAutoxSub(input.sub);
  if (linked) {
    if (linked.status === "disabled") return { ok: false, reason: "disabled" };
    const rows = await q<UserRow>(
      `update ${SCHEMA}.users
          set name = coalesce(nullif($2, ''), name), role = $3,
              status = 'active', last_login_at = now()
        where user_id = $1
      returning ${COLS}`,
      [linked.user_id, input.name, input.role],
    );
    return { ok: true, user: rows[0] ?? linked };
  }

  // 2) A row exists for this email but wasn't matched by `sub` above.
  const byEmail = await getUserByEmail(input.email);
  if (byEmail) {
    // 2a) The email is linked to a DIFFERENT AutoX identity (an old `sub`). This is
    //     the delete+recreate-in-AutoX case: AutoX minted a fresh `sub` for the same
    //     person. Re-link to the new one instead of dead-ending.
    //
    //     This is a SAFETY NET, not the primary path — the primary fix is
    //     operational: admins Reset access (which keeps the `sub` stable), not
    //     delete+re-invite; when they do, this branch never fires.
    //
    //     Safe because AutoX is the sole verifying issuer, enforces
    //     one-email-one-live-account, and this row holds nothing sensitive. The one
    //     thing this trades away is protection against an email being reassigned to a
    //     different person — which AutoX does NOT guarantee across delete+recreate.
    //     Revisit this if a second IdP is added, or if this row ever starts holding
    //     sensitive / FK-referenced data. The verified-email gate plus the loud audit
    //     log below are what keep a wrong re-link detectable and reversible.
    if (byEmail.autox_sub && byEmail.autox_sub !== input.sub) {
      if (byEmail.status === "disabled") return { ok: false, reason: "disabled" }; // kill switch still holds
      if (!input.emailVerified) return { ok: false, reason: "email_conflict" }; // won't re-link on an unverified email
      console.warn("[sso] re-linking local user to a new AutoX sub", {
        user_id: byEmail.user_id,
        email: byEmail.email,
        old_sub: byEmail.autox_sub,
        new_sub: input.sub,
        at: new Date().toISOString(),
      });
      const rows = await q<UserRow>(
        `update ${SCHEMA}.users
            set autox_sub = $2, name = coalesce(nullif($3, ''), name), role = $4,
                status = 'active', last_login_at = now()
          where user_id = $1
        returning ${COLS}`,
        [byEmail.user_id, input.sub, input.name, input.role],
      );
      return rows[0] ? { ok: true, user: rows[0] } : { ok: false, reason: "email_conflict" };
    }

    // 2b) Unlinked row (autox_sub is null): one-time adoption of a legacy/invited row.
    if (!input.emailVerified) return { ok: false, reason: "email_unverified" }; // anti-takeover guard
    if (byEmail.status === "disabled") return { ok: false, reason: "disabled" };
    const rows = await q<UserRow>(
      `update ${SCHEMA}.users
          set autox_sub = $2, name = coalesce(nullif($3, ''), name), role = $4,
              status = 'active', onboarded_at = coalesce(onboarded_at, now()), last_login_at = now()
        where user_id = $1 and autox_sub is null
      returning ${COLS}`,
      [byEmail.user_id, input.sub, input.name, input.role],
    );
    if (rows[0]) return { ok: true, user: rows[0] };
    // Lost a concurrent link race: the row was linked between our read and write.
    const now = await getUserByAutoxSub(input.sub);
    return now ? { ok: true, user: now } : { ok: false, reason: "email_conflict" };
  }

  // 3) Brand-new user: JIT provision, active.
  const rows = await q<UserRow>(
    `insert into ${SCHEMA}.users (user_id, email, name, role, status, autox_sub, onboarded_at, last_login_at)
     values ($1, $2, $3, $4, 'active', $5, now(), now())
     returning ${COLS}`,
    [newUserId(), input.email, input.name, input.role, input.sub],
  );
  return { ok: true, user: rows[0] };
}
