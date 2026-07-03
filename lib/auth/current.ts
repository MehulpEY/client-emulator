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
  if (user.role !== "administrator") redirect("/");
  return user;
}
