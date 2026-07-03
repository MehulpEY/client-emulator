// Users data-access. Node-only (imported from route handlers / server components).

import { randomBytes } from "node:crypto";
import { q, tryQuery, SCHEMA } from "../db";
import type { UserRow, Role, UserStatus, PublicUser } from "./types";

const COLS =
  "user_id, email, name, role, password_hash, status, invite_token_hash, invite_expires_at, created_by, created_at, onboarded_at, last_login_at";

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

export async function getUserByInviteHash(hash: string): Promise<UserRow | null> {
  const rows = await q<UserRow>(`select ${COLS} from ${SCHEMA}.users where invite_token_hash = $1 limit 1`, [hash]);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<UserRow[]> {
  return tryQuery<UserRow>(`select ${COLS} from ${SCHEMA}.users order by created_at desc`);
}

export interface CreateUserInput {
  email: string;
  name?: string;
  role: Role;
  status: UserStatus;
  passwordHash?: string | null;
  inviteHash?: string | null;
  inviteExpiresAt?: string | null;
  createdBy?: string | null;
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const id = newUserId();
  const rows = await q<UserRow>(
    `insert into ${SCHEMA}.users
       (user_id, email, name, role, password_hash, status, invite_token_hash, invite_expires_at, created_by, onboarded_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning ${COLS}`,
    [
      id,
      input.email,
      input.name ?? "",
      input.role,
      input.passwordHash ?? null,
      input.status,
      input.inviteHash ?? null,
      input.inviteExpiresAt ?? null,
      input.createdBy ?? null,
      input.status === "active" ? new Date().toISOString() : null,
    ],
  );
  return rows[0];
}

/** Store a fresh invite token hash + expiry (invite / resend). */
export async function setInvite(userId: string, inviteHash: string, expiresAt: string): Promise<void> {
  await q(
    `update ${SCHEMA}.users set invite_token_hash = $2, invite_expires_at = $3 where user_id = $1`,
    [userId, inviteHash, expiresAt],
  );
}

/** Complete onboarding: set the password, activate, and burn the invite token. */
export async function activateWithPassword(userId: string, passwordHash: string): Promise<void> {
  await q(
    `update ${SCHEMA}.users
        set password_hash = $2, status = 'active', onboarded_at = now(),
            invite_token_hash = null, invite_expires_at = null
      where user_id = $1`,
    [userId, passwordHash],
  );
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
