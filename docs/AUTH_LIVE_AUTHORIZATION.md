# Live Authorization with AutoX SSO — Integration Guide

How this app keeps a signed-in user's **authorization** in sync with AutoX in
near-real-time, so that removing a role or disabling an account in AutoX takes
effect in **seconds** — not whenever the session cookie finally expires.

Written so another app can reproduce this integration without re-hitting the
traps we hit. Read the **Gotchas** section — that is where the real cost was.

---

## 1. The goal

AutoX (OIDC IdP, `https://sso.autogrc.cloud`) is the source of truth for both
**authentication** (who you are) and **authorization** (what app roles you have,
via the `autox:app_roles` claim). The app must honor an authorization change made
in AutoX *during* a live session:

- Remove a user's `administrator` app role → they lose admin in the app within seconds.
- Disable / revoke the user in AutoX → they are ejected from the app within seconds.

## 2. Why the obvious approach fails

The naive design stamps the role into the session cookie at login and reads it
from the cookie on every request. That **freezes** authorization for the life of
the cookie (here, 12h). Revoking in AutoX does nothing until the cookie expires.

So authorization must be **re-derived from AutoX per request**, not read from the
cookie. The cookie proves *identity* (it's HMAC-signed); it is **not** an
authorization source.

To re-derive the role mid-session without bouncing the user through a full
redirect on every click, the app needs a credential it can use to ask AutoX
"what are this user's roles right now?" — a **refresh token** (`offline_access`).
That single fact drives the whole design.

## 3. The end-to-end mechanism

```
                         ┌─────────── login (once) ───────────┐
  Browser ──/auth──▶ AutoX ──code──▶ callback:
     scope=openid profile email roles offline_access
     resource=https://sso.autogrc.cloud/api      (JWT access token w/ app_roles)
     prompt=consent                              (force offline_access to be granted)
                                                 │
                                                 ├─ verify id_token (ES256/JWKS)
                                                 ├─ read autox:app_roles from JWT access token
                                                 ├─ upsert local user (keyed by sub)
                                                 ├─ STORE the rotating refresh token, ENCRYPTED
                                                 └─ mint session cookie  { sub, role, live:true }
                                                 
                       ┌──────── every request ────────┐
  Browser ──req──▶ getAuthUser():
     1. verify session cookie                    (identity only)
     2. identity/kill-switch from DB (10s cache) (deleted/disabled locally?)
     3. getLiveRole(sub):                        (AUTHORITATIVE role)
          - advisory-lock per user (cross-instance)
          - re-read refresh token INSIDE the lock
          - refresh at AutoX (rotates!) → read fresh autox:app_roles → role
          - persist the rotated token
     → role=administrator | consumer | (revoked → 401) | (noToken → fail closed)
```

### Login (`/api/auth/sso/login` + `/callback`)
- Request `scope: "openid profile email roles offline_access"`.
- Request `resource: <issuer>/api` at **both** the authorize and token endpoints —
  this upgrades the access token to a verifiable ES256 **JWT** carrying
  `autox:app_roles` (otherwise it's opaque).
- Request `prompt: "consent"` — see Gotcha #2.
- On callback: verify the id_token, read app roles, upsert the local user by `sub`,
  then **store the refresh token encrypted** and mint the session with `live: true`.

### Per-request role derivation (`getLiveRole`, `lib/auth/liveRole.ts`)
- Fast path: a per-instance 5s staleness window + per-user single-flight, so a burst
  of requests doesn't refresh once per call.
- Slow path: **serialize the read-refresh-store across instances with a Postgres
  advisory lock**, re-read the token inside the lock, refresh (which rotates the
  token), derive the role, persist the rotated token. See Gotcha #3 — this is the
  crux.
- `force: true` (used for admin mutations) skips the window so a revoke bites on the
  very next admin action, not up to 5s later.

### The guard (`getAuthUser`, `lib/auth/guard.ts`)
Role comes **only** from `getLiveRole`, never the cookie. Outcomes:
- `role` → use it (administrator/consumer).
- `revoked` → return `null` (grant/account killed → re-auth).
- `noToken` → **fail closed for live sessions** (token was cleared by a revoke) →
  return `null`; only a genuine pre-upgrade session (never had a token) falls back to
  the cookie role.
- `unavailable` → transient DB/AutoX blip → trust the signed cookie for this one
  request (never log everyone out on a hiccup).

### Client-side eject (`components/auth/SessionGuard.tsx`)
The server 401s a dead session on every API call, but an already-rendered SPA
won't redirect itself — background polls just fail quietly. A small client guard
patches `fetch` and, on a **CE-auth 401** (marked `x-auth: required`), redirects to
`/login`. See Gotcha #6.

### Logout (`/api/auth/logout`)
Clears the stored refresh token and evicts the live-role cache, then RP-initiated
logout at AutoX (`end_session_endpoint`).

---

## 4. Gotchas (the expensive part)

### #1 — AutoX has **no per-app "allowed scopes"** setting; the per-app control is the refresh-token grant
`offline_access` is globally available to any client. The only per-app toggle that
matters is **"Allow refresh tokens" (the `refresh_token` grant)** on the app. If it
is off, you request `offline_access`, AutoX returns access + id tokens but **no
`refresh_token`**, and live authorization silently can't run. Enable that grant on
the app in the AutoX admin console.

### #2 — A scope added *after* the user already consented needs `prompt=consent`
If the user consented to the app **before** you added `offline_access`, AutoX
auto-approves the *previously* consented scope set and silently drops the new scope
— so no refresh token comes back. Adding `prompt: "consent"` forces AutoX to re-run
consent (frictionless for a first-party auto-approved app) so `offline_access` is
actually granted. Symptom without it: login succeeds, `last_login` updates, but no
refresh token is ever stored.

### #3 — Rotating refresh tokens + serverless concurrency = reuse detection kills the grant
**This was the root cause of "revocation doesn't work."** AutoX rotates the refresh
token on **every** use and, on reuse of an already-rotated token, invalidates the
**whole token family**. On serverless (Vercel), one page load fires several
concurrent requests (page + polling panels) across **different instances**; each
reads the *same* stored token and refreshes at once. The first rotates it; the
second presents the now-consumed token → `invalid_grant` → AutoX revokes the grant
→ the app clears the token. Net effect: the refresh token self-destructs within
seconds of every login, and the app silently degrades to the (frozen) cookie role.

A per-process single-flight does **not** fix this — it only dedupes within one
instance. The fix is a **cross-instance lock**:
- Wrap read → refresh → store in a **Postgres transaction advisory lock**
  (`pg_advisory_xact_lock`) keyed by user, so only one refresh per user happens at a
  time across the whole fleet.
- **Re-read the token inside the lock** so every refresh uses the newest rotated
  value (the waiter must not use a token it read before the holder rotated it).

### #4 — On serverless the pool is 1 connection; don't check out a second inside the lock
The lock holds one pooled connection for its transaction. If the work inside the
lock calls the pool again (a second checkout), it **deadlocks** (pool max = 1). Pass
the **locked client** into the callback and run all its queries on that same client.
(See `withAdvisoryLock` in `lib/db.ts`.)

### #5 — Fail closed, but distinguish "revoked" from "transient" from "pre-upgrade"
When a refresh legitimately fails (`invalid_grant`), you clear the token and return
`revoked`. But if the *next* request then sees "no token" and falls back to the
cookie role, the revoke only blocks for **one request** and access flips back. So:
mark sessions minted **with** a token as `live: true`; a live session that later
finds no token must **deny** (fail closed), not fall back. Separately, never conflate
a transient DB/AutoX outage with a real revoke — return a distinct `unavailable`
result and trust the signed cookie for that one request, so a blip doesn't log
everyone out.

### #6 — The SPA won't self-eject; back it with a 401 handler keyed on a header
A revoked session's API calls 401 correctly, but the rendered page stays put until a
manual reload (edge middleware only sees the still-valid *cookie*, not the live
role). Add a client backstop that redirects to `/login` on a 401 — but key it on a
**custom header** (`x-auth: required`) set by *your* auth guard, not the bare 401
status, or it will misfire on any 401 your app legitimately produces (e.g. this app
emulates adapters that return 401).

### #7 — `AUTH_SECRET` must be present in every environment
Both the session HMAC and the refresh-token encryption derive from `AUTH_SECRET`.
If it's missing in an environment, sessions may still appear to work while token
encryption throws and is swallowed — tokens silently never persist. Set it
everywhere (and rotating it invalidates stored refresh tokens → users re-auth once).

---

## 5. Configuration checklist

**AutoX admin console (the app / client):**
- [ ] `refresh_token` grant enabled ("Allow refresh tokens"). *(Gotcha #1)*
- [ ] Redirect URI registered for each environment.
- [ ] (If applicable) a policy that revokes the grant on user disable, so `invalid_grant` fires.

**Environment variables:**
- [ ] `AUTOX_ISSUER`, `AUTOX_CLIENT_ID`, `AUTOX_CLIENT_SECRET`
- [ ] `AUTOX_REDIRECT_URI`, `AUTOX_POST_LOGOUT_REDIRECT_URI`
- [ ] `AUTOX_RESOURCE` (defaults to `<issuer>/api`)
- [ ] `AUTH_SECRET` (session HMAC **and** refresh-token encryption key) *(Gotcha #7)*
- [ ] `DATABASE_URL`

**Database (additive columns on the users table):**
- [ ] `sso_refresh_token_enc text` — encrypted rotating refresh token
- [ ] `sso_refresh_at timestamptz` — last rotation/store time

**Request parameters at login:**
- [ ] `scope` includes `offline_access`
- [ ] `resource=<issuer>/api` at authorize **and** token endpoints
- [ ] `prompt=consent` *(Gotcha #2)*

## 6. How to verify (end-to-end)

1. **Token survives concurrency.** Log in fresh, then rapidly click several pages.
   The stored refresh token must remain set and keep rotating — no grant-revocation
   from reuse detection. *(Gotcha #3)*
2. **Role removal downgrades.** Remove the `administrator` app role in AutoX. Within
   ~5s the admin surface closes (403s / redirect) and the user is a consumer; the
   token stays valid (fewer roles, not revoked).
3. **Full revoke sticks.** Disable the user in AutoX. Within a poll cycle the app
   ejects to `/login` and stays out — the `live` flag prevents a cookie fallback.
   *(Gotchas #5, #6)*

## 7. Key files (this app)

| Concern | File |
| --- | --- |
| OIDC client, token verify, refresh | `lib/auth/oidc.ts` |
| Login / callback | `app/api/auth/sso/login/route.ts`, `.../callback/route.ts` |
| Refresh-token encryption (AES-256-GCM) | `lib/auth/tokenCrypto.ts` |
| Live role derivation (lock + rotation) | `lib/auth/liveRole.ts` |
| Cross-instance advisory lock | `lib/db.ts` (`withAdvisoryLock`) |
| Request guard / fail-closed | `lib/auth/guard.ts` |
| Session sign/verify (`live` flag) | `lib/auth/session.ts` |
| Client-side eject on 401 | `components/auth/SessionGuard.tsx` |
| Logout (clear token + RP logout) | `app/api/auth/logout/route.ts` |

## 8. Known residuals / future work

- The advisory lock holds a pooled connection across the AutoX refresh HTTP call.
  Fine at this scale; at higher throughput, cache the derived role in the DB with a
  short TTL (double-checked locking) so most requests skip the refresh entirely.
- Role changes are picked up within the 5s window (instantly on forced admin
  actions). If you need sub-second propagation everywhere, add token introspection
  on protected routes in addition to the refresh path.
