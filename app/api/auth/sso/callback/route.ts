import { NextRequest, NextResponse } from "next/server";
import { getClient, verifyAccessToken, AUTOX_RESOURCE } from "@/lib/auth/oidc";
import { upsertSsoUser, storeRefreshToken, type SsoDenyReason } from "@/lib/auth/users";
import { signSession, SESSION_COOKIE, sessionCookieOptions, isSecureRequest } from "@/lib/auth/session";
import { deriveRole, extractAppRoles } from "@/lib/auth/roles";
import { encryptSecret } from "@/lib/auth/tokenCrypto";
import { tryQuery, SCHEMA } from "@/lib/db"; // TEMP: refresh-token diagnostic

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
    if (tokenSet.access_token) appRoles = extractAppRoles(await verifyAccessToken(tokenSet.access_token));
  } catch (err: any) {
    console.warn("[sso callback] app_roles access-token verify failed (defaulting role):", err?.message ?? err);
  }
  const role = deriveRole(appRoles);

  const sub = String(idClaims.sub);
  const email = String(idClaims.email ?? "");
  const emailVerified = idClaims.email_verified === true;
  const name = String(idClaims.name ?? idClaims.preferred_username ?? "");

  // TEMP DIAGNOSTIC (remove after refresh-token investigation): record ONLY the
  // shape of the token response — did AutoX return refresh_token? which scopes were
  // granted? — never the token values. Best-effort so it can't affect sign-in.
  try {
    await tryQuery(
      `insert into ${SCHEMA}._sso_debug (sub, has_refresh, has_access, has_id, granted_scope, token_keys)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        sub,
        !!tokenSet.refresh_token,
        !!tokenSet.access_token,
        !!tokenSet.id_token,
        tokenSet.scope ?? null,
        Object.keys(tokenSet).join(","),
      ],
    );
  } catch (e: any) {
    console.warn("[sso callback] debug insert failed:", e?.message ?? e);
  }

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

  // Persist the (encrypted) refresh token so authorization can be re-derived from
  // a fresh token per request — this is what makes a revocation in AutoX bite in
  // seconds. Best-effort: if offline_access wasn't granted, live checks degrade to
  // the cookie role (see getLiveRole), so a missing token must not break sign-in.
  if (tokenSet.refresh_token) {
    try {
      await storeRefreshToken(user.user_id, encryptSecret(tokenSet.refresh_token));
    } catch (e: any) {
      console.warn("[sso callback] could not store refresh token:", e?.message ?? e);
    }
  } else {
    console.warn("[sso callback] no refresh_token returned (offline_access not granted?) — live revocation disabled for this session");
  }

  // Role in the session cookie is only an identity hint now — the authoritative
  // role is re-derived live per request (getLiveRole). We still stamp the current
  // one so the cookie is a usable fallback while a refresh token exists.
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
