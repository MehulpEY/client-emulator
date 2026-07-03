import { NextRequest, NextResponse } from "next/server";
import { countUsers, createUser } from "@/lib/auth/users";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { signSession, SESSION_COOKIE, sessionCookieOptions, isSecureRequest } from "@/lib/auth/session";
import { dbAvailable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Creates the FIRST administrator. Only works while the users table is empty;
// once any user exists this is permanently closed.
export async function POST(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  if ((await countUsers()) > 0) return NextResponse.json({ ok: false, error: "setup has already been completed" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: "a valid email is required" }, { status: 400 });
  const pw = passwordProblem(password, { requireNumber: false });
  if (pw) return NextResponse.json({ ok: false, error: pw }, { status: 400 });

  let user;
  try {
    user = await createUser({ email, name, role: "administrator", status: "active", passwordHash: await hashPassword(password) });
  } catch (e: any) {
    const dup = e?.code === "23505" || /unique/i.test(e?.message || "");
    return NextResponse.json({ ok: false, error: dup ? "that email is already registered" : e?.message || "could not create account" }, { status: 400 });
  }

  const token = await signSession({ sub: user.user_id, email: user.email, name: user.name, role: user.role });
  const res = NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(isSecureRequest(req)));
  return res;
}
