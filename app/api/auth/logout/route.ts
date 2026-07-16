import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isSecureRequest, verifySession } from "@/lib/auth/session";
import { getClient } from "@/lib/auth/oidc";
import { clearRefreshToken } from "@/lib/auth/users";
import { invalidateAuthUser } from "@/lib/auth/guard";

// RP-initiated logout. The browser navigates here (top-level GET) so the
// redirect to the IdP's end_session_endpoint actually ends the SSO session.
// If there's no SSO id_token (a legacy password session), we just clear our
// cookie and bounce to /login. POST is kept for any programmatic callers.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSO_ID_TOKEN_COOKIE = "sso_id_token";

async function endSession(req: NextRequest): Promise<NextResponse> {
  const secure = isSecureRequest(req);
  const idToken = req.cookies.get(SSO_ID_TOKEN_COOKIE)?.value;

  // Drop the stored refresh token so the grant can't be used to re-derive a role
  // after logout, and evict the live-role cache immediately.
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    invalidateAuthUser(session.sub);
    await clearRefreshToken(session.sub).catch(() => {});
  }

  let target = new URL("/login", req.nextUrl.origin).toString();
  if (idToken) {
    try {
      const client = await getClient();
      target = client.endSessionUrl({
        id_token_hint: idToken,
        post_logout_redirect_uri: process.env.AUTOX_POST_LOGOUT_REDIRECT_URI,
      });
    } catch {
      /* IdP unreachable: still clear locally and land on /login */
    }
  }

  const res = NextResponse.redirect(target);
  const kill = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 0 };
  res.cookies.set(SESSION_COOKIE, "", kill);
  res.cookies.set(SSO_ID_TOKEN_COOKIE, "", kill);
  return res;
}

export async function GET(req: NextRequest) {
  return endSession(req);
}

export async function POST(req: NextRequest) {
  return endSession(req);
}
