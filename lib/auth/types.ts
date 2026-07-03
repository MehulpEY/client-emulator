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
