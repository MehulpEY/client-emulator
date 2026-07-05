# Adapter platform — usage guide

A hands-on walkthrough of the adapter platform with real endpoint paths and the
JSON you should expect back. Written against the shipped code; every route,
field and behavior here is verifiable in the repo (and exercised end-to-end by
`scripts/verify-adapters.mjs`).

Contents:

1. [Before you start](#1-before-you-start)
2. [Create a connection](#2-create-a-connection)
3. [Dry-run test vs full test](#3-dry-run-test-vs-full-test)
4. [The gateway: descriptor + session reuse](#4-the-gateway-descriptor--session-reuse)
5. [Manual fetch + fetch history](#5-manual-fetch--fetch-history)
6. [Assets and correlation](#6-assets-and-correlation)
7. [Simulate faults (per connection)](#7-simulate-faults-per-connection)
8. [Scenarios (tool-level chaos)](#8-scenarios-tool-level-chaos)
9. [Scheduling & serverless notes](#9-scheduling--serverless-notes)

---

## 1. Before you start

```bash
BASE="http://localhost:3002"
```

- **Auth**: the dashboard APIs (`/api/adapters/*`, `/api/fetches`, `/api/assets`,
  `/api/scenarios`, `/api/stats`, …) require a signed-in user; connection
  **create/delete** and scenario **writes** require the administrator role.
  Public surfaces (no session): `/api/mock/*`, `/api/gateway/*`,
  `/api/consumer/*`, `/api/cron/*`.
- **Log in once and keep the cookie** (create the admin at `/setup` on first run):

```bash
curl -s -c /tmp/emu.jar -X POST "$BASE/api/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"<password>"}'
# -> { "ok": true, "user": { "name": "…", "email": "…", "role": "administrator" } }
```

All session-gated examples below pass `-b /tmp/emu.jar`.

- **Catalog first**: `GET /api/adapters` lists all 23 adapters with live
  connection rollups; `GET /api/adapters/crowdstrike` returns one adapter's
  metadata (connection form spec, fetch steps, heartbeat, permissions) plus its
  connections and recent lifecycle events. The catalog is code — both work with
  the database offline (rollups degrade to zeros).

---

## 2. Create a connection

`POST /api/adapters/{tool}/connections` (admin). The body's `params` are
validated against the adapter's `connectionParams` spec
(`lib/adapters/meta.ts`) — missing required keys and unknown keys are 400s that
name the key.

```bash
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/crowdstrike/connections" \
  -H "content-type: application/json" \
  -d '{
    "label": "prod-falcon",
    "notes": "US-1 tenant",
    "params": {
      "domain": "api.crowdstrike.com",
      "client_id": "demo-client",
      "client_secret": "s3cret-demo"
    },
    "saveAndFetch": false
  }'
```

Expected response (camelCase `ConnectionRow`; note the redaction):

```json
{
  "ok": true,
  "connection": {
    "connectionId": "con_9f3d2ab41c6e07b2",
    "toolId": "crowdstrike",
    "label": "prod-falcon",
    "notes": "US-1 tenant",
    "params": { "domain": "api.crowdstrike.com", "client_id": "demo-client", "client_secret": "•••" },
    "status": "pending",
    "statusReason": null,
    "enabled": true,
    "fetchEnabled": true,
    "fetchIntervalMs": 900000,
    "nextFetchAt": "2026-07-05T12:15:00.000Z",
    "heartbeatIntervalMs": 60000,
    "lastHeartbeatAt": null,
    "consecutiveFailures": 0,
    "simulate": "none",
    "totalFetches": 0,
    "totalRecords": 0,
    "sessionsIssued": 0,
    "sessionReuses": 0,
    "createdAt": "2026-07-05T12:00:00.000Z",
    "updatedAt": "2026-07-05T12:00:00.000Z"
  }
}
```

What happened under the hood (PLAN §4.2 — this is what makes the platform real):

- A **real `api_keys` row** was provisioned for the tool (label
  `conn:con_9f3d…`); its secret is what the gateway injects on every call, and
  the engine's genuine auth check validates it.
- Password-typed params come back as `"•••"` and the server-only `__secret`
  never appears in any API response.
- `saveAndFetch: true` would set `nextFetchAt` to *now* (first discovery on the
  next scheduler tick); plain save schedules it one interval out. The first
  heartbeat is always prompt.
- Validation failure example: omitting `client_secret` →
  `400 { "ok": false, "error": "missing required parameter \"client_secret\"", "problems": ["missing required parameter \"client_secret\""] }`.

Other connection operations:

| Call | What it does |
|---|---|
| `GET /api/adapters/connections/{id}` | one connection (redacted) |
| `PATCH /api/adapters/connections/{id}` | update `label` / `notes` / `params` / `enabled` / `fetchEnabled` / `fetchIntervalMs` / `heartbeatIntervalMs` / `simulate` |
| `DELETE /api/adapters/connections/{id}` | delete + remove its provisioned key (admin) |
| `GET /api/adapters/connections/{id}/events?limit=50` | lifecycle trail: `created`, `test`, `heartbeat`, `status_change`, `session_issued`, `fetch_started`, `fetch_finished`, `simulate_changed`, … |

Disabling (`{"enabled": false}`) deactivates the provisioned key and revokes
live sessions; re-enabling goes `disabled → connecting` and probes promptly.
Changing `params` also drops back to `connecting` and re-validates with an
immediate heartbeat.

---

## 3. Dry-run test vs full test

Two different guarantees, mirroring Axonius' "Check Network Connectivity" vs a
real connection test:

**Dry run** — `POST /api/adapters/{tool}/connections/test`. Validates the param
*shape* and that the tool exists in the registry. **No authentication is
performed and nothing is persisted** — it works before any connection exists
and even with the database offline. Used by the Add-connection form's check
button.

```bash
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/crowdstrike/connections/test" \
  -H "content-type: application/json" \
  -d '{"params":{"domain":"api.crowdstrike.com","client_id":"x","client_secret":"y"}}'
# -> { "ok": true, "reachable": true }
# bad shape -> { "ok": false, "reachable": true, "problems": ["unknown parameter \"apikey\""] }
```

**Full test** — `POST /api/adapters/connections/{id}/test`. Runs the state
machine for real (PLAN §4.1): status → `connecting`, then one genuine heartbeat
through the gateway core — the adapter's heartbeat operation is called against
the mock engine with the connection's provisioned credential, so real auth,
scenarios and simulated faults all apply. The connection lands on `connected`
or `error` with a `statusReason`, and `test` + `status_change` events are
written to the trail.

```bash
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/connections/con_9f3d2ab41c6e07b2/test"
# -> { "ok": true, "status": "connected", "latencyMs": 84 }
# with a broken credential:
# -> { "ok": false, "status": "error", "statusReason": "Invalid bearer token", "latencyMs": 41 }
```

---

## 4. The gateway: descriptor + session reuse

Every connection gets **one public URL** that proxies to its tool:

```
GET  /api/gateway/{connection}              -> descriptor
ALL  /api/gateway/{connection}/{tool path}  -> proxy through the connection
```

No vendor auth at the call site — the gateway injects the connection's
credential in the tool's own scheme (Bearer / Basic / API-key header / query)
and reuses the connection's cached vendor session.

**Descriptor**:

```bash
curl -s "$BASE/api/gateway/con_9f3d2ab41c6e07b2"
```

```json
{
  "ok": true,
  "connection": { "connectionId": "con_9f3d2ab41c6e07b2", "status": "connected",
                  "sessionsIssued": 3, "sessionReuses": 41, "…": "…" },
  "tool": { "id": "crowdstrike", "name": "CrowdStrike Falcon", "vendor": "CrowdStrike" },
  "session": {
    "sessionId": "ses_5b8c01d94e22",
    "token": "tok_…",
    "reused": true,
    "issuedAt": "2026-07-05T12:02:11.000Z",
    "expiresAt": "2026-07-05T12:32:11.000Z",
    "useCount": 17
  },
  "exampleCurl": "curl -s \"http://localhost:3002/api/gateway/con_9f3d2ab41c6e07b2/detects/queries/detects/v1\""
}
```

**Reading the reuse counters** (the observable-session-reuse claim, PLAN §1 #3):

- `connection.sessionsIssued` — how many vendor sessions were ever minted.
- `connection.sessionReuses` — how many calls rode an existing live session.
- `session.useCount` / `expiresAt` — the current session's usage and TTL
  (per-adapter `sessionTtlMinutes`, default 30; e.g. Entra ID 60, ZIA 25).
- Heartbeats, fetch steps and gateway calls all share the same session pool, so
  a healthy connection settles into a high reuse ratio; expiry mints a new
  session and `sessionsIssued` ticks up.

**Proxy calls** annotate response headers:

```bash
curl -si "$BASE/api/gateway/con_9f3d2ab41c6e07b2/devices/entities/devices/v2?limit=2" | grep -i x-emu
# x-emu-connection: con_9f3d2ab41c6e07b2
# x-emu-tool: crowdstrike
# x-emu-session-reused: false        <- first call mints; run it again -> true
# x-emu-session-expires: 2026-07-05T12:32:11.000Z
```

The body is the tool's vendor-faithful response (here: CrowdStrike's
`{ meta, resources: [ …full device records… ], errors: [] }`). The engine call
behind the proxy also writes the request trace, so gateway traffic shows up in
`/api/logs` and the dashboard exactly like direct mock calls.

**Gateway status codes**: unknown connection → `404`; disabled → `409` (with a
re-enable hint); connection in `error` status → `503` with the stored
`statusReason` (callers see the broken-vendor reality, not a painted-over
proxy); database offline → `503`.

---

## 5. Manual fetch + fetch history

**Run a discovery cycle now** — `POST /api/adapters/connections/{id}/fetch`.
The response carries the *finished* run (steps execute inline):

```bash
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/connections/con_9f3d2ab41c6e07b2/fetch"
```

```json
{
  "ok": true,
  "run": {
    "runId": "run_b4e19c73da05",
    "connectionId": "con_9f3d2ab41c6e07b2",
    "toolId": "crowdstrike",
    "trigger": "manual",
    "status": "success",
    "startedAt": "2026-07-05T12:05:00.000Z",
    "finishedAt": "2026-07-05T12:05:01.400Z",
    "durationMs": 1400,
    "requestsMade": 2,
    "sessionReused": true,
    "recordsByType": { "device": 60, "vulnerability": 74 },
    "totalRecords": 134,
    "error": null,
    "steps": [
      { "op": "getDeviceEntities", "path": "/devices/entities/devices/v2", "status": 200, "ms": 610, "records": 60 },
      { "op": "listVulnerabilities", "path": "/spotlight/queries/vulnerabilities/v1", "status": 200, "ms": 540, "records": 74 }
    ]
  }
}
```

(Record counts are illustrative — they depend on the seeded fleet projection.)

Field semantics:

- `trigger` — `manual` (this endpoint), `schedule` (the fetch scheduler) or `test`.
- `status` — `success` (all steps ok), `partial` (some steps failed; the step's
  `error` says why), `failed` (every step failed; run-level `error` set).
- `sessionReused` — **one session spans all steps of a run**; `true` means a
  live session already existed when the run started.
- `steps[]` — one entry per `FetchStepSpec` of the adapter: operation, resolved
  path, HTTP status, latency, records extracted at the step's `recordsPath`.
- A step whose *credential* is rejected (engine 401) marks the run and flips
  the connection to `error` immediately; transient step failures (5xx,
  scenario-forced) produce `partial`/`failed` runs without instantly erroring
  the connection.
- `409` responses: connection disabled, or the adapter is enrichment-only
  (`"adapter has no fetch steps (enrichment-only)"` — e.g. VirusTotal,
  Recorded Future, DigiCert).

**Fetch history** — `GET /api/fetches?connection=&tool=&limit=` (newest first,
default 25, max 100):

```bash
curl -s -b /tmp/emu.jar "$BASE/api/fetches?connection=con_9f3d2ab41c6e07b2&limit=5"
# -> { "reachable": true, "runs": [ { …same FetchRunRow shape as above… } ] }
```

Every run also leaves `fetch_started` / `fetch_finished` entries in the
connection's event trail, and updates the connection rollups
(`totalFetches`, `totalRecords`, `lastFetchAt`, `nextFetchAt`).

---

## 6. Assets and correlation

Fetched records are normalized per tool (`lib/adapters/normalize/*`) and merged
into a unified inventory. To see correlation in action, add a second device
source (e.g. Qualys) and fetch it too:

```bash
curl -s -b /tmp/emu.jar -X POST "$BASE/api/adapters/qualys/connections" \
  -H "content-type: application/json" \
  -d '{"label":"prod-qualys","params":{"domain":"qualysapi.qualys.com","username":"demo","password":"s3cret"}}'
# test it, then POST …/fetch as above
```

**Query the inventory** — `GET /api/assets?type=&q=&tool=&limit=`:

```bash
curl -s -b /tmp/emu.jar "$BASE/api/assets?type=device&limit=2"
```

```json
{
  "reachable": true,
  "assets": [
    {
      "assetId": "ast_77d2f0c3b91a",
      "assetType": "device",
      "displayName": "WKS-ANZ-0042",
      "hostname": "wks-anz-0042",
      "mac": "3c:22:fb:1e:88:0a",
      "serial": "5cd1234abc",
      "email": null,
      "externalKeys": {},
      "summary": { "os": "Windows 11", "ip": "10.20.4.42", "…": "…" },
      "firstSeen": "2026-07-05T12:05:01.000Z",
      "lastSeen": "2026-07-05T12:09:12.000Z",
      "sourceCount": 2
    }
  ],
  "total": 60,
  "facets": {
    "byType": { "device": 60, "user": 40, "vulnerability": 118 },
    "byTool": { "crowdstrike": 60, "qualys": 60 }
  }
}
```

Filters: `type` (device/user/vulnerability/software/saas_app/alert), `q`
(matches name/hostname/email/serial), `tool` (only assets with evidence from
that adapter). Facets are computed over the `q`+`type` filter, so the tool
chips act as a narrowing filter without collapsing the facet counts.

**Asset detail (the evidence trail)** — `GET /api/assets/{id}`:

```json
{
  "ok": true,
  "asset": {
    "assetId": "ast_77d2f0c3b91a",
    "…": "…",
    "sources": [
      {
        "toolId": "qualys",
        "connectionId": "con_51aa20cd88f1",
        "externalId": "1042",
        "correlationRule": "serial",
        "normalized": { "hostname": "WKS-ANZ-0042", "os": "Windows 11", "ip": "10.20.4.42" },
        "raw": { "ID": "1042", "DNS": "WKS-ANZ-0042", "SERIAL_NUMBER": "5CD1234ABC", "…": "…" },
        "fetchRunId": "run_0cd2e5b7a913",
        "firstSeen": "2026-07-05T12:09:12.000Z",
        "lastSeen": "2026-07-05T12:09:12.000Z"
      },
      {
        "toolId": "crowdstrike",
        "externalId": "8a1f63e0d9…",
        "correlationRule": "new",
        "…": "…"
      }
    ]
  }
}
```

**The correlation rules** (deterministic, ordered, first hit wins — PLAN §4.5):

- **device**: match an existing device by `serial` → then `mac` → then
  `hostname` (all keys lowercased at write time). No match → a new asset is
  created and the source is recorded with rule `"new"`.
- **user**: match by `email` (UPN); else `"new"`.
- **vulnerability**: no asset-to-asset correlation in v1 — each unique
  `cve/qid + hostname` pair is one asset (identity stored in
  `externalKeys.vulnKey`); a second source reporting the same pair merges into
  it (recorded as rule `"hostname"`, the identity's asset-level component).
- **The rule is recorded per source** (`correlationRule`), with the normalized
  fields and the raw vendor record alongside — every merge is explainable from
  the API/UI, no black box.

Merge semantics on re-fetch: a source's asset assignment is **sticky** (the
original rule is kept, evidence refreshed); sources are upserted on the unique
key `(tool, connection, asset type, external id)` so re-fetching never
duplicates them; asset correlation keys only ever **fill** (never overwrite);
`summary` fields are last-writer-wins; `lastSeen` bumps and `sourceCount` is
recomputed — staleness surfaces via `lastSeen` rather than deletion.

---

## 7. Simulate faults (per connection)

`PATCH /api/adapters/connections/{id}` with `{"simulate": "<mode>"}` — the
"what if the vendor breaks?" switch. Changing it triggers an immediate
heartbeat so the effect is visible within seconds. All four modes:

```bash
curl -s -b /tmp/emu.jar -X PATCH "$BASE/api/adapters/connections/con_9f3d2ab41c6e07b2" \
  -H "content-type: application/json" -d '{"simulate":"revoked_credentials"}'
```

| Mode | Mechanics | What visibly breaks |
|---|---|---|
| `none` | Normal operation; switching back re-activates the provisioned key. | Next heartbeat/test recovers the status to `connected`. |
| `revoked_credentials` | The connection's **real `api_keys` row is deactivated** and live sessions are revoked — the engine genuinely 401s; nothing is faked. | Heartbeat/test → `error` **immediately** (`statusReason` = the engine's auth error). Fetch steps record the 401 and the run fails; gateway calls pass the 401 through until a heartbeat flips the status, after which the gateway answers `503` with the reason. |
| `unreachable` | Every call through the connection short-circuits with a simulated `502` after ~400ms — the engine is never reached. | Heartbeats count a **transient failure streak**: 1–2 → `degraded`, ≥3 → `error` (PLAN §4.1). Fetch runs fail with the 502 per step; the gateway returns the simulated 502 (then 503 once the status is `error`). |
| `slow` | +2500ms latency injected on every call; calls still succeed. | Status stays `connected` — but heartbeat latency, fetch `durationMs`/step `ms` and the request trace balloon. This is the "rate-limited vendor / stale data" demo. |

Recovery is symmetric: `{"simulate":"none"}` then test (or wait a heartbeat) —
`error → connecting → connected`, all recorded as `simulate_changed` /
`status_change` events in `GET /api/adapters/connections/{id}/events`.

---

## 8. Scenarios (tool-level chaos)

Scenarios inject faults at the **engine** level, so they hit ALL traffic to a
tool — direct `/api/mock/*` calls and **every connection** of that adapter.
`GET` is any signed-in user; writes are admin.

```bash
# Create (inactive by default unless "active": true)
curl -s -b /tmp/emu.jar -X POST "$BASE/api/scenarios" \
  -H "content-type: application/json" \
  -d '{
    "tool_id": "crowdstrike",
    "name": "falcon outage",
    "description": "hard 503 for the chaos demo",
    "config": { "force_status": 503, "force_body": { "errors": [{ "code": 503, "message": "service unavailable" }] } },
    "active": true
  }'
# -> { "ok": true, "scenario": { "scenario_id": "scn_…", "active": true, … } }

# List / toggle / delete
curl -s -b /tmp/emu.jar "$BASE/api/scenarios?tool=crowdstrike"
curl -s -b /tmp/emu.jar -X PATCH "$BASE/api/scenarios/scn_…" -H "content-type: application/json" -d '{"active":false}'
curl -s -b /tmp/emu.jar -X DELETE "$BASE/api/scenarios/scn_…"
```

`config` accepts only the keys the engine honors:

| Key | Range | Effect |
|---|---|---|
| `latency_ms` | 0–4000 | added latency on every matched request |
| `failure_rate` | 0–1 | that fraction of requests fail with a 5xx |
| `force_status` | 100–599 | every request returns this status |
| `force_body` | any JSON | response body override (with `force_status`) |

`tool_id: null` makes a scenario **global** (every tool). Writes invalidate the
engine's runtime cache, so changes apply immediately.

**The chaos-demo loop**: activate a `force_status: 503` scenario on a tool →
its connections' next heartbeats see 5xx → transient streak → `degraded`, then
`error` → scheduled fetches stop (only `connected`/`degraded` connections are
claimed) and the gateway starts answering 503 → deactivate the scenario →
heartbeats recover the status and discovery resumes. Watch it live on the
overview's discovery-activity feed.

---

## 9. Scheduling & serverless notes

How the cycles actually run (PLAN §4.6):

- **Long-lived server** (`npm run start` / `npm run dev`): `instrumentation.ts`
  starts two in-process tickers — generators every 1s, adapter cycles
  (heartbeats + fetches) every 5s. Effective resolution ≈ the configured
  intervals.
- **Serverless** (Vercel / Lambda, auto-detected): in-process tickers stay off.
  A cron service calls `GET /api/cron/tick` (auth: `CRON_SECRET` as a Bearer
  header or `?key=`), which runs `generators + heartbeats + fetches` in one
  shot and reports all three:

```bash
curl -s "$BASE/api/cron/tick?key=$CRON_SECRET"
# -> { "ok": true,
#      "generators": { "checked": 2, "fired": 1 },
#      "heartbeats": { "checked": 3, "ran": 3, "transitions": 1 },
#      "fetches":    { "checked": 1, "started": 1 } }
```

- **Cron cadence bounds effective resolution**: interval floors are
  `heartbeatIntervalMs ≥ 30000` and `fetchIntervalMs ≥ 60000`, but on
  serverless a cycle can only fire when a tick arrives — with a 5-minute cron,
  a 60s heartbeat interval effectively probes every 5 minutes. Set the cron
  cadence to the finest resolution you need.
- **Exactly-once, overlap-safe**: every runner claims due rows atomically
  (`UPDATE … WHERE still due RETURNING`, mirroring the generator scheduler) —
  two concurrent ticks (or a cron firing alongside a long-lived server) each
  claim disjoint work; nothing double-fires. Per tick, work is bounded
  (25 heartbeats, 3 fetch runs) to stay inside serverless time budgets.
- **Who gets scheduled**: heartbeats probe enabled, non-disabled connections;
  scheduled fetches claim only fetch-enabled connections in
  `connected`/`degraded` status (an `error` connection stops fetching until it
  recovers). Manual fetch-now works regardless of schedule.
- **Database offline**: cycles no-op cleanly, the gateway answers 503, the
  catalog and docs keep rendering from code, and dry-run tests still work —
  the platform degrades, it never throws.
