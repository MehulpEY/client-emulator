import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/guard";
import { listUsers, toPublicUser, getUserByEmail, createUser } from "@/lib/auth/users";
import { generateInviteToken } from "@/lib/auth/invite";
import { sendInviteEmail } from "@/lib/email/resend";
import { dbAvailable } from "@/lib/db";
import type { Role } from "@/lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function GET() {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ reachable: false, users: [] });
  const users = (await listUsers()).map(toPublicUser);
  return NextResponse.json({ reachable: true, users });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const role: Role = body.role === "administrator" ? "administrator" : "consumer";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: "a valid email is required" }, { status: 400 });
  if (await getUserByEmail(email)) return NextResponse.json({ ok: false, error: "a user with that email already exists" }, { status: 400 });

  const { token, hash, expiresAt } = generateInviteToken();
  let user;
  try {
    user = await createUser({ email, name, role, status: "invited", inviteHash: hash, inviteExpiresAt: expiresAt, createdBy: auth.user.sub });
  } catch (e: any) {
    const dup = e?.code === "23505" || /unique/i.test(e?.message || "");
    return NextResponse.json({ ok: false, error: dup ? "a user with that email already exists" : e?.message || "could not create user" }, { status: 400 });
  }

  const inviteUrl = `${req.nextUrl.origin}/accept-invite?token=${token}`;
  const sent = await sendInviteEmail({ to: email, name, role, inviteUrl, invitedBy: auth.user.name || auth.user.email });
  return NextResponse.json({
    ok: true,
    user: toPublicUser(user),
    invite: { url: inviteUrl, emailed: sent.ok, error: sent.ok ? undefined : sent.error },
  });
}
