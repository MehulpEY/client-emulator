import { NextRequest, NextResponse } from "next/server";
import { getClient, generators, AUTOX_RESOURCE } from "@/lib/auth/oidc";
import { isSecureRequest } from "@/lib/auth/session";

// Begin an AutoX SSO login. Mints PKCE + state + nonce, stashes them in
// short-lived httpOnly cookies (SameSite=Lax so they survive the top-level
// redirect back to /callback), then redirects to the authorization endpoint.
// The IdP is warmed by the client-side health gate before this route is hit.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMP_MAX_AGE = 600; // 10 min to complete the round-trip

function tmpCookie(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: TMP_MAX_AGE };
}

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/overview";
}

export async function GET(req: NextRequest) {
  let client;
  try {
    client = await getClient();
  } catch (err: any) {
    // Cold start / discovery failure. The client-side gate should have warmed
    // the IdP; surface a retryable error rather than a hang.
    return NextResponse.json(
      { ok: false, error: `sign-in service unavailable: ${err?.message ?? err}` },
      { status: 503 },
    );
  }

  const code_verifier = generators.codeVerifier();
  const code_challenge = generators.codeChallenge(code_verifier);
  const state = generators.state();
  const nonce = generators.nonce();
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  const url = client.authorizationUrl({
    // `offline_access` issues a (rotating) refresh token — CE uses it to re-derive
    // the role from a fresh access token per request, so a revocation in AutoX
    // takes effect in seconds rather than at the 12h session's expiry.
    scope: "openid profile email roles offline_access",
    code_challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    resource: AUTOX_RESOURCE, // opt-in JWT access token carrying autox:app_role
    // Force AutoX to (re)run consent so the newly-added `offline_access` scope is
    // actually granted and a refresh_token is minted. Without this, AutoX silently
    // auto-approves the user's PREVIOUS consent set — which predates offline_access
    // — and drops it, so no refresh token comes back and live revocation can't run.
    // First-party apps are auto-approved, so this adds no visible consent screen.
    prompt: "consent",
  });

  const res = NextResponse.redirect(url);
  const secure = isSecureRequest(req);
  res.cookies.set("sso_cv", code_verifier, tmpCookie(secure));
  res.cookies.set("sso_state", state, tmpCookie(secure));
  res.cookies.set("sso_nonce", nonce, tmpCookie(secure));
  res.cookies.set("sso_next", next, tmpCookie(secure));
  return res;
}
