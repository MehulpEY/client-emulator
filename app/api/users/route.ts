import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/guard";
import { listUsers, toPublicUser } from "@/lib/auth/users";
import { dbAvailable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Users are provisioned automatically on first AutoX SSO login (JIT). There is
// no local create/invite flow — this route only lists the resulting accounts.
export async function GET() {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ reachable: false, users: [] });
  const users = (await listUsers()).map(toPublicUser);
  return NextResponse.json({ reachable: true, users });
}
