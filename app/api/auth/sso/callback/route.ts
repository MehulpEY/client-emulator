import { NextRequest, NextResponse } from "next/server";
import { getClient, verifyAccessToken, AUTOX_RESOURCE } from "@/lib/auth/oidc";
import { upsertSsoUser, type SsoDenyReason } from "@/lib/auth/users";
import { signSession, SESSION_COOKIE, sessionCookieOptions, isSecureRequest } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/types";

// Complete the SSO login: exchange the code (PKCE), verify the ID token, read
// the app-scoped role from the JWT access token, then link/create the local
// user by `sub` and mint our own session cookie. openid-client verifies the ID
// token signature (JWKS/ES256) plus iss/aud/exp/nonce during callback().

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSO_ID_TOKEN_COOKIE = "sso_id_token";
const TMP_COOKIES = ["sso_cv", "sso_state", "sso_nonce", "sso_next"];

// The three explicit reasons CE (not AutoX) refuses a validly-authenticated user,
// each with its own actionable message instead of one opaque "not permitted".
const DENY_MESSAGES: Record<SsoDenyReason, string> = {
  disabled: "your account has been disabled in this app — ask an administrator to re-enable it",
  email_conflict: "this email is already linked to a different AutoX identity — please contact an administrator",
  email_unverified: "your AutoX email isn’t verified yet — verify it in AutoX and sign in again",
};

function clearTmp(res: NextResponse, secure: boolean) {
  for (const n of TMP_COOKIES) {
    res.cookies.set(n, "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
  }
}

function fail(req: NextRequest, msg: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?sso_error=${encodeURIComponent(msg)}`;
  const res = NextResponse.redirect(url);
  clearTmp(res, isSecureRequest(req));
  return res;
}

function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/overview";
}

/** Map the AutoX app-scoped roles to our two roles. `autox:app_roles` (an array
 *  in the JWT access token) is authoritative for "their roles in THIS app":
 *  administrator if it contains "administrator", else consumer. Least privilege
 *  by default (empty/absent -> consumer). Per integration.md we do NOT fall back
 *  to the global `autox:roles` for this app-specific decision. */
function deriveRole(appRoles: string[]): Role {
  return appRoles.includes("administrator") ? "administrator" : "consumer";
}

export async function GET(req: NextRequest) {
  const secure = isSecureRequest(req);

  // Guard against the IdP redirecting back an error (e.g. access_denied).
  const oauthError = req.nextUrl.searchParams.get("error");
  if (oauthError) {
    return fail(req, req.nextUrl.searchParams.get("error_description") || oauthError);
  }

  const cv = req.cookies.get("sso_cv")?.value;
  const state = req.cookies.get("sso_state")?.value;
  const nonce = req.cookies.get("sso_nonce")?.value;
  const next = safeNext(req.cookies.get("sso_next")?.value);
  if (!cv || !state || !nonce) return fail(req, "your sign-in session expired — please try again");

  let client;
  try {
    client = await getClient();
  } catch (err: any) {
    console.error("[sso callback] OIDC client init failed:", err?.message ?? err);
    return fail(req, "sign-in service is unavailable — please try again");
  }

  const redirectUri = process.env.AUTOX_REDIRECT_URI!;
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());

  let tokenSet;
  try {
    // `resource` must be sent at the token endpoint too (it was requested at
    // /auth): this is what makes the provider mint a *JWT* access token for
    // aud=AUTOX_RESOURCE carrying autox:app_roles, instead of an opaque token.
    tokenSet = await client.callback(
      redirectUri,
      params,
      { code_verifier: cv, state, nonce },
      { exchangeBody: { resource: AUTOX_RESOURCE } },
    );
  } catch (err: any) {
    console.error("[sso callback] token exchange / id_token verification failed:", {
      name: err?.name,
      message: err?.message,
      error: err?.error,
      error_description: err?.error_description,
    });
    return fail(req, "we could not verify your sign-in — please try again");
  }

  const idClaims = tokenSet.claims();

  // App-scoped roles ride the JWT access token (aud=AUTOX_RESOURCE) as an array.
  // A throw here (opaque token / verification failure) just means "no app roles".
  let appRoles: string[] = [];
  try {
    if (tokenSet.access_token) {
      const at = await verifyAccessToken(tokenSet.access_token);
      const v = at["autox:app_roles"];
      if (Array.isArray(v)) appRoles = v.filter((r): r is string => typeof r === "string");
    }
  } catch (err: any) {
    console.warn("[sso callback] app_roles access-token verify failed (defaulting role):", err?.message ?? err);
  }
  const role = deriveRole(appRoles);

  const sub = String(idClaims.sub);
  const email = String(idClaims.email ?? "");
  const emailVerified = idClaims.email_verified === true;
  const name = String(idClaims.name ?? idClaims.preferred_username ?? "");

  let result;
  try {
    result = await upsertSsoUser({ sub, email, emailVerified, name, role });
  } catch {
    return fail(req, "we could not provision your account — please contact an administrator");
  }
  if (!result.ok) {
    // Legible, not a black box: the exact reason goes to the logs and a distinct
    // message goes to the user, so a disabled account is never mistaken for a
    // role/token problem again (the whole point of splitting this out).
    console.warn("[sso callback] sign-in refused by local user policy:", { reason: result.reason, sub, email });
    return fail(req, DENY_MESSAGES[result.reason]);
  }
  const user = result.user;

  // Role in the session is token-derived (source of truth), not read back from
  // the DB (integration.md "Do not copy ... roles ... as the source of truth").
  const session = await signSession({ sub: user.user_id, email: user.email, name: user.name, role });

  const url = req.nextUrl.clone();
  url.pathname = next;
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions(secure));
  // Retain the id_token for RP-initiated logout (id_token_hint).
  if (tokenSet.id_token) {
    res.cookies.set(SSO_ID_TOKEN_COOKIE, tokenSet.id_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
  clearTmp(res, secure);
  return res;
}
