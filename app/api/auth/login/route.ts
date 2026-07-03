import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, recordLogin } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import { signSession, SESSION_COOKIE, sessionCookieOptions, isSecureRequest } from "@/lib/auth/session";
import { dbAvailable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return NextResponse.json({ ok: false, error: "email and password are required" }, { status: 400 });

  const user = await getUserByEmail(email);
  const invalid = () => NextResponse.json({ ok: false, error: "invalid email or password" }, { status: 401 });
  if (!user || !user.password_hash) return invalid();
  if (user.status === "disabled") return NextResponse.json({ ok: false, error: "this account has been disabled" }, { status: 403 });
  if (user.status !== "active") return invalid();
  if (!(await verifyPassword(password, user.password_hash))) return invalid();

  await recordLogin(user.user_id);
  const token = await signSession({ sub: user.user_id, email: user.email, name: user.name, role: user.role });
  const res = NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(isSecureRequest(req)));
  return res;
}
