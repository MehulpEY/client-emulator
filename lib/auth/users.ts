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

/**
 * Link or JIT-provision the local record for an SSO identity, keyed on the
 * stable `sub`. First login adopts a pre-existing (invite-era) row by *verified*
 * email; thereafter we match on `sub` only (email can change, `sub` never does).
 * The sign-in gate (restrictSignInToApps) upstream decides who reaches here, so
 * an unknown user is created `active`. Returns null if the local row is disabled
 * or the email is claimed by a row we can't safely link.
 */
export async function upsertSsoUser(input: SsoUserInput): Promise<UserRow | null> {
  // 1) Already linked -> refresh display fields + role mirror, bump last login.
  const linked = await getUserByAutoxSub(input.sub);
  if (linked) {
    if (linked.status === "disabled") return null;
    const rows = await q<UserRow>(
      `update ${SCHEMA}.users
          set name = coalesce(nullif($2, ''), name), role = $3,
              status = 'active', last_login_at = now()
        where user_id = $1
      returning ${COLS}`,
      [linked.user_id, input.name, input.role],
    );
    return rows[0] ?? linked;
  }

  // 2) Not linked yet: adopt an existing row by verified email (one-time).
  const byEmail = await getUserByEmail(input.email);
  if (byEmail) {
    if (!input.emailVerified || byEmail.autox_sub) return null; // refuse to hijack
    if (byEmail.status === "disabled") return null;
    const rows = await q<UserRow>(
      `update ${SCHEMA}.users
          set autox_sub = $2, name = coalesce(nullif($3, ''), name), role = $4,
              status = 'active', onboarded_at = coalesce(onboarded_at, now()), last_login_at = now()
        where user_id = $1 and autox_sub is null
      returning ${COLS}`,
      [byEmail.user_id, input.sub, input.name, input.role],
    );
    if (rows[0]) return rows[0];
    return (await getUserByAutoxSub(input.sub)) ?? null; // lost a concurrent link race
  }

  // 3) Brand-new user: JIT provision, active.
  const rows = await q<UserRow>(
    `insert into ${SCHEMA}.users (user_id, email, name, role, status, autox_sub, onboarded_at, last_login_at)
     values ($1, $2, $3, $4, 'active', $5, now(), now())
     returning ${COLS}`,
    [newUserId(), input.email, input.name, input.role, input.sub],
  );
  return rows[0];
}
