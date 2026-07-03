import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, invalidateAuthUser } from "@/lib/auth/guard";
import { getUserById, updateUser, deleteUser, toPublicUser, countAdmins } from "@/lib/auth/users";
import { dbAvailable } from "@/lib/db";
import type { Role, UserRow, UserStatus } from "@/lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True if the change would leave zero active administrators. */
async function wouldRemoveLastAdmin(target: UserRow, nextRole?: Role, nextStatus?: UserStatus): Promise<boolean> {
  const wasActiveAdmin = target.role === "administrator" && target.status !== "disabled";
  const staysActiveAdmin = (nextRole ?? target.role) === "administrator" && (nextStatus ?? target.status) !== "disabled";
  if (wasActiveAdmin && !staysActiveAdmin) return (await countAdmins()) <= 1;
  return false;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });

  const target = await getUserById(params.id);
  if (!target) return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const role: Role | undefined = body.role === "administrator" || body.role === "consumer" ? body.role : undefined;
  const status: UserStatus | undefined = body.status === "active" || body.status === "disabled" ? body.status : undefined;
  if (!role && !status) return NextResponse.json({ ok: false, error: "nothing to update (role or status)" }, { status: 400 });
  if (await wouldRemoveLastAdmin(target, role, status)) {
    return NextResponse.json({ ok: false, error: "cannot demote or disable the last administrator" }, { status: 400 });
  }

  const updated = await updateUser(params.id, { role, status });
  invalidateAuthUser(params.id);
  return NextResponse.json({ ok: true, user: updated ? toPublicUser(updated) : null });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  if (params.id === auth.user.sub) return NextResponse.json({ ok: false, error: "you cannot delete your own account" }, { status: 400 });

  const target = await getUserById(params.id);
  if (!target) return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
  if (await wouldRemoveLastAdmin(target, undefined, "disabled")) {
    return NextResponse.json({ ok: false, error: "cannot delete the last administrator" }, { status: 400 });
  }

  await deleteUser(params.id);
  invalidateAuthUser(params.id);
  return NextResponse.json({ ok: true, deleted: params.id });
}
