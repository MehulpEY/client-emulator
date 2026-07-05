import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, setResetToken } from "@/lib/auth/users";
import { generateResetToken } from "@/lib/auth/reset";
import { sendPasswordResetEmail } from "@/lib/email/resend";
import { getBaseUrl } from "@/lib/base-url";
import { dbAvailable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Self-service "forgot password". The response is IDENTICAL whether or not the
// account exists (no user enumeration): we only ever say "if that account
// exists, we emailed a link". A token is issued solely for active accounts
// that already have a password — invited users must use their invite link,
// disabled users stay locked out. The email send is awaited (fire-and-forget
// is unreliable on serverless), which leaks a little timing; acceptable for an
// internal tool and preferable to lost emails.
export async function POST(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim();
  const generic = NextResponse.json({
    ok: true,
    message: "If that account exists, we've emailed a password reset link. It expires in 1 hour.",
  });
  if (!email || !email.includes("@")) return generic;

  try {
    const user = await getUserByEmail(email);
    if (user && user.status === "active" && user.password_hash) {
      const { token, hash, expiresAt } = generateResetToken();
      await setResetToken(user.user_id, hash, expiresAt);
      const resetUrl = `${getBaseUrl()}/reset-password?token=${token}`;
      const sent = await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
      if (!sent.ok) {
        // Operator signal only — the caller still gets the generic response.
        console.warn(`[auth] password-reset email to ${user.email} not sent: ${sent.error}`);
      }
    }
  } catch (err: any) {
    console.warn(`[auth] forgot-password processing failed: ${err?.message ?? err}`);
  }
  return generic;
}
