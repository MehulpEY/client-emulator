// Page/layout guards (server components). Redirect variants of the auth check.
// Import from server components only (pulls in next/navigation).

import { redirect } from "next/navigation";
import { getAuthUser } from "./guard";
import type { SessionUser } from "./types";

export async function getCurrentUser(): Promise<SessionUser | null> {
  return getAuthUser();
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  // Defense-in-depth fallback (middleware is the primary gate and carries the
  // precise `next`): send under-privileged users to the re-authorize surface,
  // not silently to "/", so a role change can be picked up without signing out.
  if (user.role !== "administrator") redirect("/no-access");
  return user;
}
