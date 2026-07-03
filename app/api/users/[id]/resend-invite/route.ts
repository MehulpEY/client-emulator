import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/guard";
import { getUserById, setInvite } from "@/lib/auth/users";
import { generateInviteToken } from "@/lib/auth/invite";
import { sendInviteEmail } from "@/lib/email/resend";
import { dbAvailable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });

  const target = await getUserById(params.id);
  if (!target) return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
  if (target.status !== "invited") return NextResponse.json({ ok: false, error: "user has already onboarded" }, { status: 400 });

  const { token, hash, expiresAt } = generateInviteToken();
  await setInvite(target.user_id, hash, expiresAt);
  const inviteUrl = `${req.nextUrl.origin}/accept-invite?token=${token}`;
  const sent = await sendInviteEmail({ to: target.email, name: target.name, role: target.role, inviteUrl, invitedBy: auth.user.name || auth.user.email });
  return NextResponse.json({ ok: true, invite: { url: inviteUrl, emailed: sent.ok, error: sent.ok ? undefined : sent.error } });
}
