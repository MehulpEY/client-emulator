// Auth types. Two roles: administrator (full control) and consumer (observe the
// emulator + configure pub/sub). See lib/auth for the implementation.

export type Role = "administrator" | "consumer";
export type UserStatus = "invited" | "active" | "disabled";

/** Full DB row (never sent to the client - contains hashes/tokens). */
export interface UserRow {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string | null;
  status: UserStatus;
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  reset_token_hash: string | null;
  reset_expires_at: string | null;
  autox_sub: string | null; // AutoX SSO subject; NULL until first SSO login links it
  created_by: string | null;
  created_at: string;
  onboarded_at: string | null;
  last_login_at: string | null;
}

/** Identity carried inside the signed session cookie. */
export interface SessionUser {
  sub: string; // user_id
  email: string;
  name: string;
  role: Role;
  // True when this session was minted WITH a stored AutoX refresh token (live role
  // re-derivation is armed). If such a session later finds no token, that means the
  // grant was revoked -> deny, rather than falling back to the cookie role. Absent
  // on pre-upgrade sessions, which still fall back to the cookie.
  live?: boolean;
}

/** Safe shape returned to the browser (no secrets). */
export interface PublicUser {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  created_by: string | null;
  created_at: string;
  onboarded_at: string | null;
  last_login_at: string | null;
}
