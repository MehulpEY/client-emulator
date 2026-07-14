// AutoX SSO (OIDC) client. Authorization Code + PKCE (S256), ES256 tokens.
// Node-only (openid-client uses node http/crypto) - import from route handlers
// with `export const runtime = "nodejs"`. The discovered client is cached; a
// failed discovery is NOT cached, so a retry after an IdP cold start succeeds.
//
// The IdP is the source of truth for endpoints - we discover them, never
// hardcode paths (integration.md "The protocol contract").

import { Issuer, generators, type Client } from "openid-client";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const ISSUER_URL = process.env.AUTOX_ISSUER || "https://sso.autogrc.cloud";

/** Audience of the opt-in JWT access token that carries the app-scoped
 *  `autox:app_roles` claim. Requesting this `resource` upgrades the otherwise
 *  opaque access token to a verifiable ES256 JWT (integration.md "Tokens"). */
export const AUTOX_RESOURCE = process.env.AUTOX_RESOURCE || `${ISSUER_URL}/api`;

export { generators };

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let clientPromise: Promise<Client> | null = null;

export function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const issuer = await Issuer.discover(ISSUER_URL);
      return new issuer.Client({
        client_id: reqEnv("AUTOX_CLIENT_ID"),
        client_secret: reqEnv("AUTOX_CLIENT_SECRET"),
        redirect_uris: [reqEnv("AUTOX_REDIRECT_URI")],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        // The IdP signs ID tokens with ES256; openid-client otherwise defaults to
        // expecting RS256 and rejects the token ("unexpected JWT alg").
        id_token_signed_response_alg: "ES256",
      });
    })().catch((err) => {
      // Don't cache a cold-start / network failure - let the next call re-discover.
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function getJwks() {
  const client = await getClient();
  if (!jwks) jwks = createRemoteJWKSet(new URL(client.issuer.metadata.jwks_uri!));
  return jwks;
}

/** Verify a JWT access token offline (ES256, aud=AUTOX_RESOURCE) and return its
 *  claims - notably `autox:app_role`. Throws if the token is opaque/invalid, so
 *  callers treat a throw as "no app role" and fall back accordingly. */
export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const client = await getClient();
  const { payload } = await jwtVerify(token, await getJwks(), {
    issuer: client.issuer.metadata.issuer,
    audience: AUTOX_RESOURCE,
    algorithms: ["ES256"],
  });
  return payload;
}
