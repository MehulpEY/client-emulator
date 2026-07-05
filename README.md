# Client Tool Emulator

A sandbox that **stands in for the cybersecurity tools a client runs** — and an **Axonius-style adapter platform** built on top of them. 23 hand-crafted mock vendor APIs (CrowdStrike, Qualys, Entra ID, Okta, Meraki, Tenable, SentinelOne, Intune, Jamf, ServiceNow, Wiz, Rapid7, Zscaler and more) become **adapters**: you configure credentialed **connections** with a live lifecycle, scheduled **discovery fetches** pull inventory through a **singular gateway endpoint** with observable session reuse, and the records are normalized and **correlated into a unified asset inventory** — with the rule that merged every source recorded and explainable.

Point an agent's tool integration at the emulator (directly at a mock API, or through a connection's gateway URL) and every request returns a believable, vendor-shaped response, captured in a live request trace. One Next.js 14 app backed by Supabase Postgres.

---

## What it does

**Adapter platform**
- **23 adapters, 198 endpoints** with adapter-grade metadata: connection form specs, asset types fetched, "APIs used" fetch steps, heartbeat probes and vendor permission requirements (`lib/adapters/meta.ts`).
- **Connections with a real lifecycle** — `pending → connecting → connected / degraded / error / disabled`, driven by scheduled heartbeats that genuinely call the tool. Creating a connection **provisions a real API key** for that tool; revoking it makes the engine genuinely 401. Nothing is painted on.
- **Discovery cycles** — per-connection scheduled fetches (plus fetch-now), with a full fetch history: status (`success/partial/failed`), duration, per-step results, records by asset type.
- **Correlated assets** — fetched records are normalized per tool and merged deterministically: devices by `serial → mac → hostname`, users by `email`. Every source shows *which rule* merged it, with the raw vendor evidence alongside.
- **The gateway** — `/api/gateway/<connection>/<tool path>`: one URL per connection, any tool. The connection's credential is injected in the tool's own auth scheme, and a cached vendor session is reused across heartbeats, fetches and gateway calls (issued-vs-reused counters exposed in the descriptor).
- **Chaos you can demo** — per-connection `simulate` faults (revoked credentials / unreachable / slow) and tool-level scenarios (latency, failure rate, forced status) propagate visibly into connection status, fetch history and asset staleness.

**Emulator core** (unchanged and still first-class)
- **Every tool is hand-authored** to mirror its real vendor API — real paths, auth schemes and response field names — with deterministic, input-seeded responses. Inventory endpoints project a **canonical fleet** (60 devices, 40 users), so the same machine appears in CrowdStrike, Qualys, Tenable and Intune with consistent serials/MACs — which is what makes correlation real.
- **Mock engine**: path-template matching, per-tool auth (API-key header/query, Bearer, Basic), simulated latency, scenario fault injection.
- **Request trace**: every call (direct or via gateway) is logged — method, path, status, latency, redacted headers, bodies.
- **Pub/sub webhooks**: subscribe an agent's URL to a tool's events; deliveries are HMAC-signed and logged. See [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md).
- **Automation (generators)**: auto-emit tool events at fixed/random intervals; **stateful tools** persist created records so GET APIs reflect what happened.

The **code registry (`lib/tools/` + `lib/adapters/meta.ts`) is the source of truth** for the catalog — the dashboard renders from it even with the database offline. Supabase stores runtime data: connections, sessions, fetch runs, assets, logs, keys, subscriptions.

---

## Architecture

```
            dashboard  /adapters · /assets · /logs · /events · overview
                │
                ▼                          the adapter platform
   /api/adapters/**  ──────  connections CRUD · test · lifecycle · rollups
                │                       │
                │              heartbeats (liveness)          fetch cycles (discovery)
                │                       │                              │
                ▼                       ▼                              ▼
        adapter_connections ──► lib/adapters/sessions.ts  ◄── lib/adapters/fetch.ts
        (+ provisioned api_key)   mint / REUSE / expire         per-step records
                │                       │                              │
                ▼                       ▼                              ▼
   /api/gateway/<connection>/<path> ──► gateway-core ── inject tool auth · simulate faults
                                            │
                                            ▼
                                   mock engine (lib/engine)  ── match · auth · scenarios
                                            │                    latency · log · events
                                            ▼
                              23 vendor-faithful tools (lib/tools/crafted)
                                    inventory projected from lib/fleet
                                            │
                     fetch → normalize (per tool) → correlate → assets + asset_sources
                                                                   │
                                                          /api/assets · /assets UI
```

- **Frontend + backend**: one Next.js app (App Router, TypeScript, Tailwind). API routes serve the mock endpoints, the gateway and the dashboard data.
- **Design system**: calm-enterprise — Inter type, soft radii, hairline borders, EY electric-yellow accent, dark/light, WCAG AA-verified tokens (`app/globals.css`).
- **Database**: `emulator` schema (never `public`). See `db/schema.sql` — adapter tables at the bottom: `adapter_connections`, `connection_sessions`, `connection_events`, `fetch_runs`, `assets`, `asset_sources`.

---

## Setup

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL (see note below)
npm run db:apply            # create/upgrade the emulator schema in Supabase
npm run build && npm run start   # or: npm run dev   (port 3002)
npm run db:seed             # mirror the catalog into Supabase + mint a master key
```

Open **http://localhost:3002** — unauthenticated visitors land on the public landing page (every number on it is derived from the code registry at request time). First run: visit `/setup` to create the administrator account (the dashboard and its APIs require a signed-in user; `/api/mock/*`, `/api/gateway/*`, `/api/consumer/*` and `/api/cron/*` are public surfaces). Onboarding is invitation-only (Resend email or a manually shared link), and active users can self-serve password resets via **/forgot-password** (single-use, 1-hour emailed link — requires `RESEND_API_KEY`/`EMAIL_FROM`).

Environment variables are unchanged from the pre-adapter era — see `.env.example` (`DATABASE_URL`, `DB_SCHEMA`, `NEXT_PUBLIC_EMULATOR_BASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM`, `CRON_SECRET`).

### Supabase connection — use the pooler, not the direct host

The direct host `db.<ref>.supabase.co:5432` resolves **IPv6-only** and is unreachable on IPv4-only networks (you'll see connection timeouts). Use the **Session pooler** string instead (Supabase → Connect → Session pooler):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

This project resolved to cluster/region **`aws-1-ap-southeast-1`**. The first connection through the pooler can take ~10s (the app's pool timeout accounts for this); subsequent calls reuse the warm connection. On serverless the app automatically upgrades a recognized Supabase pooler URL to the **transaction pooler** (port 6543) so concurrent function instances don't exhaust the session pool.

---

## Adapters quick start

The loop the platform is built around — copy-paste ready. Dashboard APIs need a session cookie (log in once and reuse the cookie jar); the gateway itself is public because the connection embodies the credential.

```bash
BASE="http://localhost:3002"

# 0) Log in (dashboard APIs are session-gated; create the admin at /setup first)
curl -s -c /tmp/emu.jar -X POST "$BASE/api/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"<password>"}'

# 1) Create a CrowdStrike connection (admin) — provisions a real per-tool API key
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/crowdstrike/connections" \
  -H "content-type: application/json" \
  -d '{"label":"prod","params":{"domain":"api.crowdstrike.com","client_id":"demo","client_secret":"s3cret"}}'
# -> { "ok": true, "connection": { "connectionId": "con_...", "status": "pending", ... } }
CON="con_..."   # from the response

# 2) Test it — a real heartbeat runs through the engine; status lands on "connected"
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/connections/$CON/test"

# 3) Call the gateway — one URL, credential injected, session minted then REUSED
curl -si "$BASE/api/gateway/$CON/devices/entities/devices/v2" | grep -i x-emu
# x-emu-session-reused: false   (first call) ... true on the second call
curl -s "$BASE/api/gateway/$CON"          # descriptor: status, session, reuse counters

# 4) Run a discovery fetch now, then read the fetch history
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/connections/$CON/fetch"
curl -s -b /tmp/emu.jar "$BASE/api/fetches?connection=$CON&limit=5"

# 5) Query the correlated inventory (add a Qualys connection + fetch to see
#    the same devices merge across adapters by serial/mac/hostname)
curl -s -b /tmp/emu.jar "$BASE/api/assets?type=device&limit=10"
```

Or do the whole loop in the UI: **Adapters → pick an adapter → Add connection → Test → Fetch now → Assets**. The full walkthrough with response shapes, fault simulation and scenarios lives in [docs/adapter-platform/USAGE.md](docs/adapter-platform/USAGE.md).

---

## Adapter catalog (23)

| Adapter | `tool id` | Categories | Assets fetched | Endpoints |
|---|---|---|---|---|
| AppOmni AgentGuard | `appomni-agentguard` | ai-security, data-security | saas_app, alert | 12 |
| Cisco Meraki | `cisco-meraki` | network, device-mgmt | device | 11 |
| Cisco Umbrella | `cisco-umbrella` | network | — (enrichment) | 11 |
| CrowdStrike Falcon | `crowdstrike` | edr, vuln-mgmt | device, vulnerability, alert | 15 |
| DigiCert CertCentral | `digicert` | pki | — (enrichment) | 12 |
| Forcepoint DLP | `forcepoint-dlp` | dlp, data-security | — (enrichment) | 9 |
| Jamf Pro | `jamf` | device-mgmt | device | 4 |
| Microsoft Entra ID | `entra-id` | identity | user | 16 |
| Microsoft Intune | `intune` | device-mgmt | device | 4 |
| Okta | `okta` | identity | user | 4 |
| Qualys VMDR | `qualys` | vuln-mgmt | device, vulnerability | 8 |
| Rapid7 InsightVM | `rapid7` | vuln-mgmt | device | 3 |
| Recorded Future | `recorded-future` | threat-intel | — (enrichment) | 9 |
| SentinelOne Singularity | `sentinelone` | edr | device | 4 |
| ServiceNow CMDB | `servicenow` | itam, device-mgmt | device | 3 |
| Tenable Vulnerability Management | `tenable` | vuln-mgmt | device, vulnerability | 4 |
| Trellix ePolicy Orchestrator (ePO) | `trellix-epo` | edr, device-mgmt | device | 11 |
| VirusTotal | `virustotal` | forensics, threat-intel | — (enrichment) | 10 |
| Wiz | `wiz` | cloud-security, vuln-mgmt | device, alert | 4 |
| Zscaler AI Guard | `zscaler-ai-guard` | ai-security | — (enrichment) | 9 |
| Zscaler Internet Access (ZIA) | `zscaler-zia` | network, identity | user | 14 |
| Zscaler Private Access | `zscaler-zpa` | network | — (enrichment) | 12 |
| Zscaler RBA (Risk360) | `zscaler-rba` | monitoring | — (enrichment) | 9 |

Enrichment adapters support connect/heartbeat/gateway but have no scheduled fetch steps. Every tool's base path is `/api/mock/<tool id>`; a bare `GET` on it returns a descriptor listing its endpoints.

---

## How agents consume the emulator

Two ways in:

**1. Directly, like the real vendor API** — swap a client integration's base URL for `.../api/mock/<tool-id>` and send the configured credential:

```bash
KEY="emu_master_xxx"   # from `npm run db:seed`, or the API Keys page

# VirusTotal — file reputation (auth: x-apikey header)
curl "http://localhost:3002/api/mock/virustotal/files/44d88612fea8a8f36de82e1278abb02f" \
  -H "x-apikey: $KEY"

# CrowdStrike — full device records (auth: Bearer)
curl "http://localhost:3002/api/mock/crowdstrike/devices/entities/devices/v2?limit=5" \
  -H "Authorization: Bearer $KEY"

# Microsoft Entra ID — list directory users (Microsoft Graph; auth: Bearer)
curl "http://localhost:3002/api/mock/entra-id/users?\$top=5" \
  -H "Authorization: Bearer $KEY"
```

**2. Through a connection's gateway** — no vendor-specific auth at the call site; the connection injects it:

```bash
curl -s "http://localhost:3002/api/gateway/<connection-id>/users?\$top=5"
```

### Auth model
- A tool's auth scheme is defined in its registry entry (`api_key_header` / `api_key_query` / `bearer` / `basic` / `none`).
- **If any key exists for a tool (or a master key exists), that tool requires a valid key** → otherwise `401`.
- **If no keys are seeded, endpoints are open** (dev mode). Note: creating a **connection** provisions a per-tool key, which ends that tool's open mode — the master key from `npm run db:seed` keeps ad-hoc calls working.
- Manage keys on the **API Keys** page or via `POST /api/keys` (admin).

---

## Dashboard

| Page | What it shows |
|------|---------------|
| **Overview** | Adapter/connection/asset/fetch stat tiles, discovery activity feed, request trace, quick start |
| **Adapters** | Searchable catalog of all 23 adapters with connection status rollups; detail pages with connections, fetch history, endpoints + try-it console, events, automation, state |
| **Assets** | The correlated inventory: type tabs, search, source filters, per-source evidence drawer with correlation rules |
| **Subscriptions** | Create/manage pub-sub subscriptions, emit test events, watch the delivery log + demo-consumer inbox |
| **Request Trace** | The full call log with filters, expandable request+response payloads, live tail |
| **Automation** | Event generators across all tools (fixed/random intervals, run-now, bulk start/stop) |
| **API Keys / Users** | Admin: issue master or per-tool keys; invite and manage dashboard users |

---

## Pub/sub & webhooks

Real security tools push events (new detections, offenses, scan results). The emulator does the same: a **consumer** registers a **subscription** (`tool` + `event type` → its webhook URL), and matching events are delivered there to **trigger the consumer's agent**.

```bash
curl -X POST http://localhost:3002/api/subscriptions -H "content-type: application/json" -d '{
  "tool_id": "crowdstrike",
  "event_type": "*",
  "target_url": "https://your-agent.example/webhook",
  "description": "SOC triage agent"
}'
# -> returns a signing secret (whsec_...)
```

Events fire from **activity** (successful mutating calls — direct or through the gateway), **manual publishes**, and **generators**. Each delivery is `POST`ed with `x-emulator-event`, `x-emulator-tool`, `x-emulator-delivery` and an `x-emulator-signature` HMAC-SHA256 header; verify it server-side and use the built-in demo consumer (`/api/consumer/demo`) to watch events arrive without standing up an endpoint. Full architecture: [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md).

---

## Automation (generators)

Configure a **generator** to auto-emit a tool's events at a **fixed** or **random** interval — e.g. random Forcepoint DLP incidents every 15–60s — from a tool's Automation tab, the Automation page, or the API:

```bash
curl -X POST http://localhost:3002/api/generators -H "content-type: application/json" -d '{
  "tool_id": "forcepoint-dlp",
  "event_type": "incident.created",
  "mode": "random",
  "min_ms": 15000,
  "max_ms": 60000
}'
```

Generated events flow through the same pub/sub path (delivered, logged, visible in the demo inbox) and can persist durable tool state (below). Generators support pause/resume, run-now, bulk start/stop, and show live run counts and next-fire countdowns.

---

## Stateful tools (persisted data)

A generated or created event can also be **persisted as durable tool state**, so the tool's normal `GET` API returns the same records — the webhook *triggers* the agent, the read API *reflects* what happened. Reference: Forcepoint DLP incidents (`incident.created` upserts into the resource store; `GET /dlp/rest/v1/incidents` reads it back; status updates emit `incident.updated`).

```
GET    /api/resources/<tool>                       collections summary + recent records
GET    /api/resources/<tool>?collection=incidents  items in one collection
DELETE /api/resources/<tool>[?collection=...]      clear state
```

To make another tool stateful: give its create-event a `persist: { collection, idOf }` mapping and point its read endpoints at `lib/engine/store.ts` helpers. State lives in `emulator.resources`.

---

## Fault injection

Two layers, both demo-friendly:

- **Connection-level (`simulate`)** — patch a connection with `revoked_credentials` (its provisioned key is deactivated; the engine genuinely 401s; status → `error`), `unreachable` (calls short-circuit 502; degraded → error as the failure streak grows) or `slow` (+2.5s on every call). Recovery is one `{"simulate":"none"}` away.
- **Tool-level (scenarios)** — `POST /api/scenarios` (admin) with `{ "tool_id": "virustotal", "name": "slow + flaky", "config": { "latency_ms": 1500, "failure_rate": 0.3 } }` (or `force_status` / `force_body`). Applies to ALL traffic to that tool — direct calls and every connection — so a `force_status: 503` visibly drives that tool's connections to `degraded`/`error` on the next heartbeats. Changes apply immediately (cache invalidated on write).

Both are documented end-to-end in [docs/adapter-platform/USAGE.md](docs/adapter-platform/USAGE.md).

---

## Deployment & serverless

The app runs unchanged on a long-lived server (`next start`) or serverless (Vercel):

- **Long-lived server**: `instrumentation.ts` starts two in-process schedulers on boot — the 1s generator tick and a 5s adapter tick (heartbeats + fetches). No external cron needed.
- **Serverless** (detected via `VERCEL` / AWS env): in-process schedulers stay off. A cron service calls **`GET /api/cron/tick`** instead, which drives all three cycles — **generators + heartbeats + fetches** — and returns their results. Protect it with `CRON_SECRET` (Vercel Cron sends it as a Bearer header; external crons can pass `?key=`).
- **Exactly-once by construction**: every cycle claims its due rows atomically (`UPDATE … WHERE still due RETURNING`), so overlapping cron calls or parallel instances never double-fire.
- **Cadence bounds resolution**: heartbeat intervals floor at 30s and fetch intervals at 60s, but on serverless the *effective* resolution is your cron cadence (a 5-minute cron means cycles fire at most every 5 minutes, regardless of shorter intervals).
- **DB offline**: everything degrades gracefully — the catalog renders from code, DB-backed panels show empty states, and a circuit breaker stops hammering an unreachable database.

---

## Project layout

```
app/
  api/mock/[tool]/[[...path]]/       the endpoint agents call (all methods)
  api/gateway/[connection]/[[...path]]/  the singular gateway (descriptor + proxy)
  api/adapters/**                    catalog rollups, connection CRUD, test, events, fetch-now
  api/{fetches,assets}/              fetch history + correlated inventory
  api/scenarios/                     tool-level fault injection (CRUD)
  api/{health,stats,logs,keys}/      dashboard data
  api/subscriptions/ | api/events/ | api/consumer/demo/   pub/sub
  api/generators/                    scheduled simulators (CRUD + run-now)
  api/cron/tick/                     serverless tick: generators + heartbeats + fetches
  (app)/                             dashboard pages (overview, adapters, assets, logs, ...)
instrumentation.ts                   starts the in-process schedulers on boot
lib/
  tools/registry.ts                  the catalog (source of truth): 23 tools
  tools/crafted/*                    hand-authored, documentation-grade tools
  adapters/                          the platform: meta, connections, heartbeat, sessions,
                                     gateway-core, fetch, fetch-scheduler, normalize/*, assets
  fleet/fleet.ts                     canonical fleet (60 devices, 40 users) projected by tools
  engine/                            match | auth | scenarios | templating | log | events
  db.ts                              resilient pg pool (circuit breaker)
components/                          design system + dashboard UI
db/schema.sql                        the emulator schema (adapter tables at the bottom)
scripts/                             apply-schema | seed | verify-adapters
```

## Scripts
- `npm run dev` / `start` — run the app (port 3002)
- `npm run db:apply` — apply `db/schema.sql` to Supabase (idempotent)
- `npm run db:seed` — mirror the catalog + mint a master key (app must be running)
- `node scripts/verify-adapters.mjs` — end-to-end adapter acceptance (create → test → gateway reuse → fetch → correlation → revocation → cleanup; needs `EMU_ADMIN_EMAIL`/`EMU_ADMIN_PASSWORD`)

## Docs
- [docs/adapter-platform/PLAN.md](docs/adapter-platform/PLAN.md) — the platform contract: architecture, state machine, API surface, workstreams
- [docs/adapter-platform/USAGE.md](docs/adapter-platform/USAGE.md) — hands-on walkthrough with real requests and responses
- [docs/adapter-platform/VERIFICATION.md](docs/adapter-platform/VERIFICATION.md) — the acceptance checklist
- [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md) — pub/sub & webhook architecture
