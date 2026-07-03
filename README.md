# Client Tool Emulator

A sandbox that **stands in for the cybersecurity tools a client runs** - VirusTotal, CrowdStrike Falcon, Microsoft Entra ID, Zscaler (ZPA/ZIA/RBA/AI Guard), Forcepoint DLP, Cisco Meraki & Umbrella, DigiCert, Recorded Future, Trellix ePO, Qualys VMDR and AppOmni AgentGuard - so our agents can be exercised end-to-end against realistic, logged mock APIs instead of touching production systems (or paying per call).

Point an agent's tool integration at the emulator's base URL, and every request returns a believable response and is captured in a live request trace. Built as a single Next.js 14 app with a polished dashboard, backed by Supabase Postgres.

---

## What it does

- **15 high-fidelity emulated tools** across 10 categories (threat-intel, EDR, network, DLP, identity, AI-security, vuln-management, PKI, monitoring, forensics), each at a stable base path with documentation-grade, real-vendor-shaped endpoints (167 endpoints total).
- **Every tool is hand-authored** to mirror its real vendor API - real paths, auth schemes, and response field names - with deterministic, input-seeded responses (the same hash / IP / user / order always yields the same result, like the real service). Catalog: **VirusTotal, CrowdStrike Falcon, Qualys VMDR, Microsoft Entra ID, Forcepoint DLP, Recorded Future, Trellix ePO, Cisco Meraki, Cisco Umbrella, DigiCert CertCentral, Zscaler ZPA, Zscaler ZIA, Zscaler RBA (Risk360), Zscaler AI Guard, AppOmni AgentGuard**.
- **Stateful tools**: several persist created/generated records so normal GET calls return the same data - Forcepoint DLP incidents, Entra ID risky users, DigiCert certificate orders, Cisco Umbrella destination lists, Zscaler ZIA denylist, Recorded Future alerts, AppOmni posture findings (see below).
- **Mock engine**: path-template matching, per-tool auth (API-key header/query, Bearer, Basic), simulated latency, and scenario-driven fault injection.
- **Request trace**: every agent call is logged to Supabase (method, path, status, latency, redacted headers, request/response bodies) and shown live in the dashboard.
- **API keys**: issue a master key (all tools) or scoped keys (one tool). With no keys, endpoints stay open for quick testing.
- **Pub/sub webhooks**: register a consumer (an agent's URL) to receive a tool's events - fired automatically when an agent mutates data through a tool, or emitted manually - each delivery HMAC-signed and logged, with a built-in demo consumer for testing.
- **Automation (generators)**: configure a tool to auto-emit events at a fixed or random interval (e.g. random Forcepoint DLP incidents) to mock real-world activity - configured per-tool, never hardcoded.

The **code registry (`lib/tools/`) is the source of truth** for the catalog - the dashboard always renders from it, so browsing works even if the database is offline. Supabase mirrors the catalog and stores runtime data (logs, keys, scenarios).

---

## Architecture

```
 Agent / n8n workflow                 Next.js 14 app (this repo)                 Supabase Postgres
 --------------------                 --------------------------                 -----------------
 calls  --HTTP-->  /api/mock/<tool>/<path>  ->  mock engine  ->  response     +- emulator schema
                                            |  match | auth | latency |        |    tools, endpoints
                                            |  fault inject | respond          |    api_keys, scenarios
                                            +- best-effort log ----------------+->  request_logs
 Dashboard  <--  catalog from code registry | logs/stats/keys from Postgres
```

- **Frontend + backend**: one Next.js app (App Router, TypeScript, Tailwind). API routes serve both the mock endpoints and the dashboard data.
- **Design system**: a "confident/enterprise" design language - squared, hairline, electric-yellow `#FFE600` accent, frosted glass + aurora, dark/light - shared with the reference projects, with skeleton loaders on every data-backed view.
- **Database**: `emulator` schema (never `public`). See `db/schema.sql`.

---

## Setup

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL (see note below)
npm run db:apply            # create the emulator schema in Supabase
npm run build && npm run start   # or: npm run dev   (port 3002)
npm run db:seed             # mirror the catalog into Supabase + mint a master key
```

Open **http://localhost:3002**.

### Supabase connection - use the pooler, not the direct host

The direct host `db.<ref>.supabase.co:5432` resolves **IPv6-only** and is unreachable on IPv4-only networks (you'll see connection timeouts). Use the **Session pooler** string instead (Supabase -> Connect -> Session pooler):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

This project resolved to cluster/region **`aws-1-ap-southeast-1`**. The first connection through the pooler can take ~10s (the app's pool timeout accounts for this); subsequent calls reuse the warm connection.

---

## How agents consume the emulator

Every tool is reachable at:

```
http://localhost:3002/api/mock/<tool-id>/<endpoint-path>
```

Swap a client integration's base URL for `.../api/mock/<tool-id>` and send the configured credential. Examples:

```bash
KEY="emu_master_xxx"   # from `npm run db:seed`, or the API Keys page

# VirusTotal - file reputation (auth: x-apikey header)
curl "http://localhost:3002/api/mock/virustotal/files/44d88612fea8a8f36de82e1278abb02f" \
  -H "x-apikey: $KEY"

# Recorded Future - IP enrichment / risk score (auth: X-RFToken header)
curl "http://localhost:3002/api/mock/recorded-future/v2/ip/198.51.100.7" \
  -H "X-RFToken: $KEY"

# CrowdStrike - OAuth token, then list detections (auth: Bearer)
curl -X POST "http://localhost:3002/api/mock/crowdstrike/oauth2/token" -d '{}'
curl "http://localhost:3002/api/mock/crowdstrike/detects/queries/detects/v1?limit=5" \
  -H "Authorization: Bearer $KEY"

# Forcepoint DLP - search incidents (stateful; auth: Bearer)
curl -X POST "http://localhost:3002/api/mock/forcepoint-dlp/dlp/rest/v1/incidents" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"type":"INCIDENTS","severity":"HIGH"}'

# Microsoft Entra ID - list directory users (Microsoft Graph; auth: Bearer)
curl "http://localhost:3002/api/mock/entra-id/users?\$top=5" \
  -H "Authorization: Bearer $KEY"
```

Hitting a tool's base path with no sub-path (`/api/mock/virustotal`) returns a descriptor listing its endpoints.

### Auth model
- A tool's auth scheme is defined in its registry entry (`api_key_header` / `api_key_query` / `bearer` / `basic` / `none`).
- **If any key exists for a tool (or a master key exists), that tool requires a valid key** -> otherwise `401`.
- **If no keys are seeded, endpoints are open** (dev mode) so you can test immediately.
- Manage keys on the **API Keys** page or via `POST /api/keys`.

---

## Dashboard

| Page | What it shows |
|------|---------------|
| **Overview** | Catalog + traffic stats, recent agent traffic, quick-start, category breakdown |
| **Tool Catalog** | Searchable/filterable grid of all 15 tools |
| **Tool detail** | Endpoints, an interactive **try-it console**, per-tool keys and a live request trace |
| **Subscriptions** | Create/manage pub-sub subscriptions, emit test events, and watch the delivery log + built-in demo-consumer inbox |
| **Request Trace** | The full call log with filters (tool / status / search), expandable request+response payloads, live tail |
| **API Keys** | Issue master or per-tool keys |

---

## Pub/Sub & webhooks

Real security tools push events (new detections, offenses, scan results). The emulator does the same: a **consumer** registers a **subscription** (`tool` + `event type` -> its webhook URL), and matching events are delivered there to **trigger the consumer's agent**.

**Subscribe** (or use the Subscriptions page):

```bash
curl -X POST http://localhost:3002/api/subscriptions -H "content-type: application/json" -d '{
  "tool_id": "crowdstrike",      # null / omit = every tool
  "event_type": "*",             # "*" = every event, or e.g. "host.contained"
  "target_url": "https://your-agent.example/webhook",
  "description": "SOC triage agent"
}'
# -> returns a signing secret (whsec_...)
```

**Events fire from two sources:**
- **Activity** - any successful *mutating* (non-GET) call to a tool publishes an event (`<operation>`, or a domain name like `host.contained`). So when an agent contains a host, blocks an IP, or opens an incident through the emulator, subscribers are notified.
- **Manual** - `POST /api/events/publish {tool_id, event_type}` (or the **Emit** buttons in the UI) sends a realistic sample payload. Useful to simulate tool-originated events (a new detection appearing).

**Delivery contract** - each event is `POST`ed to the consumer URL:

```http
POST <target_url>
x-emulator-event: host.contained
x-emulator-tool: crowdstrike
x-emulator-delivery: dlv_...
x-emulator-signature: sha256=<HMAC-SHA256(secret, rawBody)>

{ "id": "evt_...", "type": "host.contained", "tool": "crowdstrike",
  "source": "activity", "created_at": "...", "data": { ... } }
```

Verify the signature on the consumer side:

```js
import crypto from "node:crypto";
const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
```

Delivery uses a 5s timeout with one retry on network/5xx; every attempt is recorded in `emulator.event_deliveries`. A **built-in demo consumer** lives at `/api/consumer/demo` - set it as a subscription's `target_url` to watch events arrive in the dashboard without standing up your own endpoint.

---

## Automation (generators / scheduled simulators)

To mock real-world activity, configure a **generator** that auto-emits a tool's events at a **fixed** or **random** interval - no per-tool scheduling code. The classic example: random **Forcepoint DLP incidents** every 15-60s.

Configure it from a tool's **Automation** box on its detail page, or via the API:

```bash
# random Forcepoint DLP incidents every 15-60 seconds
curl -X POST http://localhost:3002/api/generators -H "content-type: application/json" -d '{
  "tool_id": "forcepoint-dlp",
  "event_type": "incident.created",
  "mode": "random",            # or "fixed" with "interval_ms"
  "min_ms": 15000,
  "max_ms": 60000
}'
```

Each tick fires `publishEvent(... source:"simulator")`, so generated events flow through the same pub/sub path - delivered to any matching subscription (e.g. a SOC agent), recorded in the delivery log, and visible in the demo inbox. Generators support **pause/resume**, **run-now**, and show live **run count / next-fire countdown**.

How it runs: an in-process scheduler (started by `instrumentation.ts` on server boot) keeps generators in memory and fires due ones on a 1s tick - no database polling. The minimum interval is 2s. *Note: this assumes a single long-lived server (`next start`); running multiple instances would multiply firings.*

---

## Stateful tools (persisted data)

A generated or created event isn't just delivered to subscribers - it can also be **persisted as durable tool state**, so when an agent calls the tool's normal `GET` API it sees the same records. This closes the loop: the pub/sub webhook *triggers* the agent, and the tool's read API *reflects* what happened.

**Reference: Forcepoint DLP incidents.**
- The `incident.created` event declares `persist: { collection: "incidents", idOf: d => d.id }`.
- When it fires (a generator, a manual **Emit**, or a subscriber flow), the incident is upserted into the resource store - **whether or not any subscription matches** (so nothing fires "into the void").
- `GET /dlp/rest/v1/incidents` reads from that store (with `?status=`, `?limit`, `?offset`), `GET /dlp/rest/v1/incidents/{id}` fetches one, and `POST .../incidents/{id}/status` patches the stored record and emits `incident.updated`.
- On first read the collection is **seeded** with a handful of incidents, so a fresh tenant already has history.

```bash
# Generate a few incidents (or run a generator), then read them back:
curl -X POST http://localhost:3002/api/events/publish -H "content-type: application/json" \
  -d '{"tool_id":"forcepoint-dlp","event_type":"incident.created"}'

curl "http://localhost:3002/api/mock/forcepoint-dlp/dlp/rest/v1/incidents" -H "Authorization: Bearer $KEY"
# -> includes the incident that was just created

# Escalate one - the stored record is updated and incident.updated is published:
curl -X POST "http://localhost:3002/api/mock/forcepoint-dlp/dlp/rest/v1/incidents/INC-349605/status" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" -d '{"status":"ESCALATED"}'
```

Inspect (or clear) a tool's state on its detail page (**Persisted State** panel) or via the API:

```
GET    /api/resources/<tool>                       collections summary + recent records
GET    /api/resources/<tool>?collection=incidents  items in one collection
DELETE /api/resources/<tool>[?collection=...]         clear state
```

**Wire another tool to be stateful** - no new infrastructure:
1. Give the create event a `persist: { collection, idOf }` mapping (`lib/tools/...`).
2. Point the tool's list/get/update endpoints at the store helpers in `lib/engine/store.ts` (`listResources` / `getResource` / `patchResource`, `ensureSeeded` for initial history).

State lives in the `emulator.resources` table (`tool_id` + `collection` + `resource_id` -> `jsonb`).

---

## Fault injection (scenarios)

Insert a row into `emulator.scenarios` to override a tool's behaviour (or set `tool_id = NULL` for all tools):

```sql
insert into emulator.scenarios (scenario_id, tool_id, name, config, active) values
  ('s1', 'virustotal', 'slow + flaky',
   '{"latency_ms": 1500, "failure_rate": 0.3}'::jsonb, true);
-- force a specific status/body:
--   '{"force_status": 429, "force_body": {"error":"rate limited"}}'
```

Changes apply within ~10s (the engine caches runtime config briefly).

---

## Project layout

```
app/
  api/mock/[tool]/[[...path]]/  the endpoint agents call (all methods)
  api/{health,stats,logs,keys}/ dashboard data
  api/subscriptions/ | api/events/ | api/consumer/demo/   pub/sub
  api/generators/               scheduled simulators (CRUD + run-now)
  api/admin/seed/               mirror catalog -> Supabase (idempotent, bulk)
  page.tsx | tools/ | events/ | logs/ | keys/   dashboard pages
instrumentation.ts              starts the event scheduler on boot
lib/
  tools/registry.ts             the catalog (source of truth): 15 tools
  tools/crafted/*               15 hand-authored, documentation-grade tools
  tools/events.ts               event types + sample payloads
  engine/                       match | auth | scenarios | templating | log
  engine/events.ts              pub/sub publisher (sign | deliver | log)
  engine/scheduler.ts           in-process generator scheduler
  db.ts                         resilient pg pool (circuit breaker)
components/                     design system + dashboard UI
db/schema.sql                   the emulator schema
scripts/apply-schema.mjs | seed.mjs
```

## Scripts
- `npm run dev` / `start` - run the app (port 3001)
- `npm run db:apply` - apply `db/schema.sql` to Supabase
- `npm run db:seed` - mirror the catalog + mint a master key (app must be running)
