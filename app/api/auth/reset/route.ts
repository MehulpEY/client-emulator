import { NextRequest, NextResponse } from "next/server";
import { getUserByResetHash, resetPassword, recordLogin } from "@/lib/auth/users";
import { hashResetToken } from "@/lib/auth/reset";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { signSession, SESSION_COOKIE, sessionCookieOptions, isSecureRequest } from "@/lib/auth/session";
import { dbAvailable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Redeem a password-reset token (single-use, 1h TTL) and sign the user in —
// mirrors the accept-invite flow.
export async function POST(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const password = String(body.password || "");
  if (!token) return NextResponse.json({ ok: false, error: "invalid reset link" }, { status: 400 });
  const pw = passwordProblem(password);
  if (pw) return NextResponse.json({ ok: false, error: pw }, { status: 400 });

  const user = await getUserByResetHash(hashResetToken(token));
  const invalid = () => NextResponse.json({ ok: false, error: "this reset link is invalid or has expired — request a new one" }, { status: 400 });
  if (!user || user.status !== "active" || !user.reset_expires_at) return invalid();
  if (new Date(user.reset_expires_at).getTime() < Date.now()) return invalid();

  await resetPassword(user.user_id, await hashPassword(password));
  await recordLogin(user.user_id);
  const session = await signSession({ sub: user.user_id, email: user.email, name: user.name, role: user.role });
  const res = NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions(isSecureRequest(req)));
  return res;
}
