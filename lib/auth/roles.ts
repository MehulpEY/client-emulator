import type { Role } from "./types";

// One place that maps AutoX app-scoped roles to our two roles, shared by the SSO
// callback (login) and the live-role refresh path (every request). Keeping it here
// means "administrator" is matched identically in both — a drift here would let a
// revoked user keep admin on one path but not the other.

/** `autox:app_roles` is authoritative for "their roles in THIS app": administrator
 *  if the array contains "administrator" (the guide's canonical value), else
 *  consumer. Least privilege by default (empty/absent -> consumer). */
export function deriveRole(appRoles: string[]): Role {
  return appRoles.includes("administrator") ? "administrator" : "consumer";
}

/** Pull the `autox:app_roles` string[] out of verified JWT access-token claims. */
export function extractAppRoles(claims: Record<string, unknown>): string[] {
  const v = claims["autox:app_roles"];
  return Array.isArray(v) ? v.filter((r): r is string => typeof r === "string") : [];
}
