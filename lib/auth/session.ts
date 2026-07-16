// Session tokens. Signed with HMAC-SHA256 via Web Crypto so this module works
// in BOTH the edge middleware and Node route handlers. A token is
// `base64url(payload).base64url(hmac)` - a minimal JWT-like envelope with iat/exp.
// No third-party dependency. Passwords are handled separately (node scrypt).

import type { SessionUser, Role } from "./types";

export const SESSION_COOKIE = "emu_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set");
    keyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return keyPromise;
}

async function sign(claims: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...claims, iat: now, exp: now + ttlSeconds };
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

async function verify(token: string | undefined | null): Promise<Record<string, any> | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64urlDecode(sig), encoder.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload: any;
  try {
    payload = JSON.parse(decoder.decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function signSession(user: SessionUser, opts: { live?: boolean } = {}): Promise<string> {
  return sign(
    { t: "session", sub: user.sub, email: user.email, name: user.name, role: user.role, live: opts.live ? 1 : 0 },
    SESSION_TTL_SECONDS,
  );
}

export async function verifySession(token: string | undefined | null): Promise<SessionUser | null> {
  const p = await verify(token);
  if (!p || p.t !== "session" || !p.sub) return null;
  return {
    sub: String(p.sub),
    email: String(p.email ?? ""),
    name: String(p.name ?? ""),
    role: p.role as Role,
    live: p.live === 1,
  };
}

/** True when the request arrived over HTTPS (directly or via a proxy). Used to
 *  decide the cookie `Secure` attribute so login works over http://localhost in
 *  dev/local while staying Secure behind HTTPS in production. */
export function isSecureRequest(req: { headers: { get(name: string): string | null }; nextUrl: { protocol: string } }): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return req.nextUrl.protocol === "https:";
}

/** Cookie attributes for the session. httpOnly so JS can't read it; lax so
 *  top-level navigations carry it; Secure only when served over HTTPS. */
export function sessionCookieOptions(secure: boolean, maxAgeSeconds: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
