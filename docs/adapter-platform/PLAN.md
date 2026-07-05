# Adapter Platform — Coordination Plan

> **THE common file.** Every implementation agent reads this before writing code and
> treats it as the contract. If code and this file disagree, this file wins; if you
> must deviate, record the deviation in your PR description. Acceptance criteria for
> every workstream live in [VERIFICATION.md](./VERIFICATION.md).

**Mission.** Evolve the Client Tool Emulator from a catalog of standalone mock vendor
APIs into an **adapter platform** modeled on — and in demonstrable ways better than —
[Axonius adapters](https://www.axonius.com/adapters): first-class *connections* with a
live lifecycle, scheduled *discovery/fetch cycles* with history, a *singular gateway
endpoint* that maintains and reuses sessions per connection, adapter-grade catalog
metadata, and a *normalized, correlated asset inventory* fed by the fetches.

---

## 1. Where we are vs Axonius (gap analysis)

| Axonius concept | Their implementation | We have today | Verdict |
|---|---|---|---|
| Adapter catalog | 1,200+ adapters, category filters, per-adapter docs (params, APIs used, permissions) | 15 vendor-faithful mock tools, 168 endpoints, categories, per-endpoint docs + try-it console | Strong base, missing adapter-grade metadata |
| Connections | Per-adapter credentialed connections; test-before-save; status (success/error/inactive); tunnel selection | **Nothing** — `api_keys` is inbound-only | Build (W1) |
| Live connection reuse | Persistent sessions/token reuse per connection; all traffic via uniform internal plugin API + Tunnel single endpoint | **Nothing** — each tool has its own base path + auth | Build (foundation + W2) |
| Discovery cycles | Global + per-adapter/per-connection scheduled fetches; fetch history page (duration, records) | `generators` push synthetic events on schedule (inverse direction); serverless-safe atomic-claim scheduler | Repurpose the scheduler skeleton (W3) |
| Asset pipeline | Fetch → parse → normalize → **correlate** into unified devices/users/etc. | `resources` store keeps vendor-shaped records per tool | Build (W3 + W4) — our differentiator: deterministic, explainable correlation |
| UI | Calm enterprise SPA; adapters grid with status; connection dialogs; fetch history | "Edgy" chassis: Arial, zero radius, neon keylines, heavy glass | Reskin (W5) + new pages (W7/W8) |

**What we already do better** (keep): vendor-faithful request/response shapes with
seeded determinism, executable docs (try-it console), fault-injection scenarios,
pub/sub webhooks with HMAC, per-tool durable state, serverless-safe scheduling.

**Being better than Axonius — the five claims this build makes real:**
1. **Chaos you can demo**: scenarios + per-connection `simulate` faults (revoked
   credentials / unreachable / slow) propagate visibly into connection status, fetch
   history, and asset staleness. Axonius cannot demo its failure modes on demand.
2. **Explainable correlation**: every correlated asset shows *which rule* merged each
   source (serial/mac/hostname/email) with the raw evidence. Their engine is a black box.
3. **Observable session reuse**: Axonius re-authenticates per fetch and keeps no
   vendor sessions alive between cycles (research §2) — we cache per-connection
   sessions with TTL, reuse them across heartbeats/fetches/gateway calls, and
   expose issued-vs-reused counters in the descriptor and UI.
4. **Executable adapter docs**: "APIs used" links to live endpoints with a try-it
   console, not static docs.
5. **Serverless-safe by construction**: every cycle (heartbeat/fetch) uses the
   atomic-claim pattern proven in `lib/engine/scheduler.ts`; the whole platform
   degrades gracefully with the DB offline.

## 2. Axonius research digest (what we are mirroring)

*Filled from four research reports (adapter architecture; catalog model; connection
mechanics; UI system) — summarized so agents don't need the sources.*

- **Adapter =** a connector to one product that fetches asset data on a schedule,
  parses it into a normalized schema, and feeds correlation. Users configure N
  *connections* per adapter (one per tenant/instance). Catalog reality: **1,315
  adapters** in their public registry (`adapters.json`: name, docs href, description,
  `solutionCategories[]`, `assetsFetched[]`) — our `AdapterMeta` mirrors that shape.
- **Connection form conventions** (every adapter): *Connection Label*, *Notes*
  (≤250 chars), *gateway/tunnel* selector, *Active* toggle, and in Optional
  Parameters *Verify SSL* + *HTTPS Proxy*. Buttons: **Check Network Connectivity**
  (reachability only — explicitly "no authentication or fetch is performed"),
  **Save**, and **Save and Fetch** (save + immediate first discovery).
- **Statuses**: two-level — connection status (*Active and connected* green /
  *Active with errors* red, error message stored on the connection / *Partially
  connected* orange / *Inactive* gray; wire values `success`/`error` + `error`
  string + `active` bool) plus a per-run *last fetch status* (`fetch started`,
  `ended successfully`, `ended with errors`, `failed`, `skipped`, `terminated`,
  `connection failed`). Optional breaker: "Set as inactive after X failed
  attempts". Our state machine (§4.1) is a superset: `degraded` ≈ their
  "partially connected", `error` ≈ "active with errors", `disabled` ≈ "inactive".
- **Discovery**: global cycle (default "every 12 hours" style, from midnight UTC)
  → per-adapter custom schedule → per-connection schedule; max 20 adapters fetch
  in parallel; retry up to 5 attempts at 5-minute intervals. **Fetch history**
  (last 100k rows): status, start/end, duration, total assets fetched with
  per-asset-type breakdown, ignored counts, error details, config-drift flag.
  Rate-limited vendors are their notorious weak spot (stale/partial data) — our
  `simulate: slow` + `partial` run status exists to demo exactly this.
- **Sessions: Axonius does NOT keep live vendor sessions between fetches** — they
  store connection config (+ OAuth refresh tokens as params), re-authenticate per
  fetch, and re-check status only during cycles (optional global 90-min status
  sweep, default off). Their only persistent live connection is the **Tunnel/
  Gateway**: one outbound OpenVPN channel per site that multiplexes ALL adapter
  traffic, with its own health states (Pending/Healthy/Unhealthy-Connectivity/
  Disconnected). → Our design goes further on purpose: per-connection cached
  sessions with TTL + reuse counters (like a real client SDK), always-on
  heartbeats, and `/api/gateway/{connection}/…` as the single multiplexed
  endpoint — the emulator-side homage to the Tunnel + their uniform internal
  plugin REST surface (`api/adapters/{name}/connections`, `…/connections/test`).
- **Discovery cycle phases** (theirs, 7): Fetch Adapter Assets → Fetch Scanner
  Assets (VA tools, weak IP-correlation) → Clean Assets (delete not-seen-in-X-hours)
  → Pre-Correlation → Correlation (rules-based, confidence-weighted, source-trust
  hierarchies: AD/ITAM high-trust, scanners low-trust) → Post-Correlation → Save
  Historical. Ours collapses to fetch→normalize→correlate per connection; staleness
  surfaces via `last_seen` rather than a delete phase (v1).
- **Their documented weaknesses** (G2/PeerSpot/their own docs) our build answers:
  batch staleness between cycles (→ our webhooks/generators already push events
  continuously alongside fetches), over/under-merge correlation complaints (→ our
  §4.5 rules are deterministic + explained per source), adapter fixes ride platform
  release trains (→ our registry is code-first, an adapter is a file), closed
  ecosystem, no public SDK (→ `ToolDef` + `AdapterMeta` are the SDK).
- **Asset taxonomy** (top of their 57-value list, which we subset): Devices (991
  adapters), Users (554), SaaS applications (332), Vulnerabilities (184),
  Software (154) + Alerts.
- **UI**: adapter tiles show logo + name, up to 4 asset-type labels, up to 3
  category chips (+N overflow), status dots (green connected / red error / gray
  inactive) with counts, description on hover; searchable grid with category +
  asset-type filters; connection drawer shows the error reason. Calm enterprise
  chrome; muted neutrals, one restrained accent, soft radii, readable 13–14px type.

## 3. Target architecture

```
            ┌────────────────────────  dashboard UI (W7/W8) ────────────────────────┐
            │  /adapters (catalog) · /adapters/[tool] (connections, fetch history,   │
            │  endpoints, events, automation) · /assets (correlated inventory)       │
            └──────────────┬─────────────────────────────────────────────────────────┘
                           │ lib/api-adapters.ts (typed client, foundation)
┌─────────────── app/api/adapters/** (W1) ───────────────┐   ┌── app/api/assets, /api/fetches (W3) ──┐
│ catalog rollups · connection CRUD · test · lifecycle    │   │ inventory queries · fetch history      │
└──────────────┬──────────────────────────────────────────┘   └───────────────┬────────────────────────┘
               ▼                                                              ▼
        lib/adapters/connections.ts (W1)                             lib/adapters/assets.ts (W3)
        lib/adapters/heartbeat.ts (W1)                               lib/adapters/fetch.ts + normalize/* (W3)
               │        ▲ scheduled by /api/cron/tick + lib/adapters/scheduler.ts (foundation)
               ▼        │
        lib/adapters/sessions.ts (foundation) ── session mint/reuse/expiry/revoke
               │
               ▼
        lib/adapters/gateway-core.ts (foundation) ── resolve connection → inject tool auth
               │                                      → honor simulate faults → runEngine()
               ▼
        lib/engine/* (existing, untouched)  ← tools serve fleet-projected inventory (W4/W6)
               ▲
        app/api/gateway/[connection]/[[...path]] (W2) — the singular public endpoint
```

**The loop that makes it real:** creating a connection **provisions an actual
`api_keys` row** for the tool (the connection's credential). Heartbeats and fetches
go through gateway-core → `runEngine()`, so the engine's real auth check, scenario
faults, latency, and request logging all apply. `simulate: revoked_credentials`
deactivates that key row → the engine genuinely 401s → the connection goes `error`.
Nothing is painted on.

## 4. Shared contracts (source of truth files)

All shipped in the foundation commit — **read them, import them, never redefine them**:

| Contract | File |
|---|---|
| All TS types (statuses, specs, rows, gateway, fleet) | `lib/adapters/types.ts` |
| Adapter metadata for all 15 tools (params, fetchSteps, TTLs) | `lib/adapters/meta.ts` |
| DB tables: `adapter_connections`, `connection_sessions`, `connection_events`, `fetch_runs`, `assets`, `asset_sources` | `db/schema.sql` (bottom section) |
| Gateway core (auth injection, simulate faults, engine call) | `lib/adapters/gateway-core.ts` |
| Session mint/reuse/expiry/revoke + counters | `lib/adapters/sessions.ts` |
| Canonical fleet: 60 devices + 40 users, deterministic; per-tool projection helpers | `lib/fleet/fleet.ts` |
| Cycle stubs wired into cron + instrumentation | `lib/adapters/heartbeat.ts`, `lib/adapters/fetch-scheduler.ts`, `lib/adapters/scheduler.ts` |
| Typed client helpers for every new API below | `lib/api-adapters.ts` |
| ID helpers (`conId() → con_…`, `runId() → run_…`, `astId() → ast_…`) | `lib/adapters/ids.ts` |
| End-to-end acceptance script | `scripts/verify-adapters.mjs` |

### 4.1 Connection lifecycle state machine

```
            create
              │            test/heartbeat OK
              ▼          ┌──────────────────┐
           pending ──► connecting ──► connected ◄──┐
                           │  ▲            │       │ heartbeat OK (streak reset)
        hard fail (401/    │  │ retest     │ transient fail (streak 1..2)
        revoked/unreach-   │  │            ▼       │
        able ×3)           │  └───────── degraded ─┘
              ▼            ▼               │ transient fail streak ≥ 3
            error ◄────────┴───────────────┘
              │  enabled=false (any state)
              ▼
           disabled ──(re-enable)──► connecting
```

Transition rules (implemented in W1 `lib/adapters/connections.ts`):
- `test` action: → `connecting`, run one heartbeat immediately, land on
  `connected` or `error` with `status_reason`.
- Heartbeat OK → `connected`, `consecutive_failures = 0`.
- Transient failure (5xx/timeout/`simulate: unreachable|slow` beyond threshold):
  `consecutive_failures++`; 1–2 → `degraded`, ≥3 → `error`.
- Auth failure (401, `simulate: revoked_credentials`): → `error` immediately,
  `status_reason` = the engine's error message.
- Every transition inserts a `connection_events` row (`kind: 'status_change'`,
  `from_status`, `to_status`, `detail`).
- `disabled` connections are skipped by heartbeat + fetch schedulers.

### 4.2 Credential provisioning rule (W1 owns; W2/W3 rely on)

- **Create connection** → also `INSERT INTO api_keys (key_id, tool_id, secret, label)`
  with `label = 'conn:' || connection_id`, `secret = 'emu_conn_' + 32 hex`. Store the
  secret in `adapter_connections.params.__secret` (server-side only; API layer strips
  `__secret` and any param whose spec type is `password` — replaced with `"•••"`).
- **Delete connection** → delete that `api_keys` row. **Disable** → key `active=false`.
  **`simulate: revoked_credentials`** → key `active=false` while simulate is on
  (restore on `none`). Always call `invalidateRuntimeCache()` after key writes.
- Gateway-core injects this secret per the tool's auth scheme (`bearer` → the session
  token, which IS this secret; `basic` → password part; `api_key_header`/`api_key_query`
  → the value). The engine's existing `checkAuth` validates it for real.

### 4.3 API routes (who serves what)

| Route | Methods | Auth | Owner |
|---|---|---|---|
| `/api/adapters` | GET (AdapterSummary[] rollup) | user | W1 |
| `/api/adapters/[tool]` | GET (meta + connections + recent events) | user | W1 |
| `/api/adapters/[tool]/connections` | POST (create; validate against `connectionParams`; `saveAndFetch?: boolean` sets `next_fetch_at = now()`) | admin | W1 |
| `/api/adapters/[tool]/connections/test` | POST (dry-run: validate param shape + tool reachability, **no auth, nothing persisted** — Axonius "Check Network Connectivity" semantics) | user | W1 |
| `/api/adapters/connections/[id]` | GET, PATCH (label/notes/params/enabled/fetch settings/simulate), DELETE | user / admin / admin | W1 |
| `/api/adapters/connections/[id]/test` | POST (test now) | user | W1 |
| `/api/adapters/connections/[id]/events` | GET (lifecycle trail, `?limit=`) | user | W1 |
| `/api/adapters/connections/[id]/fetch` | POST (manual discovery run) | user | W3 |
| `/api/fetches` | GET (`?connection=&tool=&limit=` fetch history) | user | W3 |
| `/api/assets` | GET (`?type=&q=&tool=&limit=` + facet counts) | user | W3 |
| `/api/assets/[id]` | GET (asset + sources + raw evidence) | user | W3 |
| `/api/scenarios` | GET, POST; `/api/scenarios/[id]` PATCH, DELETE | admin | W2 |
| `/api/gateway/[connection]` | GET (descriptor: status, session, reuse metrics) | public* | W2 |
| `/api/gateway/[connection]/[[...path]]` | ALL (proxy through connection) | public* | W2 |

\* public like `/api/mock/*` (middleware-exempted in foundation); the connection's own
provisioned credential is what the engine validates. Next.js resolves the static
`connections` segment before `[tool]` — the route split above is safe.

Response envelope conventions: match existing routes (`lib/api.ts` style) — success
returns the resource or `{ items, total }`; errors `{ error: string }` with 4xx/5xx.
JSON casing: **camelCase** in API responses (map from snake_case columns), matching
`lib/adapters/types.ts` row interfaces exactly.

### 4.4 Fetch endpoints contract (W4 provides ⇄ W3 consumes)

W4 rewires these tools' inventory endpoints to project from `lib/fleet/fleet.ts`
(same fleet devices/users appear across tools ⇒ correlation works). **Response
shapes stay vendor-faithful and stable** — W3 normalizers parse exactly these:

| Tool (`toolId`) | Operation | Asset | `recordsPath` | Key fields the normalizer maps |
|---|---|---|---|---|
| `crowdstrike` | `getDeviceEntities` (**new** GET `/devices/entities/devices/v2`, `ids` optional ⇒ all) | device | `resources` | `device_id`, `hostname`, `mac_address` (dash-separated — normalize to `:`), `serial_number`, `os_version`, `platform_name`, `local_ip`, `last_seen`, `tags` |
| `crowdstrike` | `listVulnerabilities` (existing GET `/spotlight/queries/vulnerabilities/v1` → **W4 makes it return full records**: keep envelope, add `resources[]` objects) | vulnerability | `resources` | `id`, `cve_id`, `severity`, `host_info.hostname`, `status`, `score` |
| `qualys` | `listHosts` (existing) | device | `HOST_LIST_OUTPUT.RESPONSE.HOST_LIST` | `ID`, `DNS` (hostname), `IP`, `OS`, `NETBIOS`, `LAST_VULN_SCAN_DATETIME`; W4 adds `SERIAL_NUMBER`, `MAC_ADDRESS` |
| `qualys` | `listDetections` (existing) | vulnerability | `HOST_LIST_VM_DETECTION_OUTPUT.RESPONSE.HOST_LIST` | per host `DETECTION_LIST[]`: `QID`, `SEVERITY`, `STATUS`; host `DNS` for correlation |
| `cisco-meraki` | `getOrganizationDevices` (existing GET `/organizations/{organizationId}/devices`, use `organizationId = "org-emu-1"`) | device | `$` (root array) | `serial`, `mac`, `name` (hostname), `model`, `lanIp`, `firmware`, `productType` |
| `entra-id` | `listUsers` (existing GET `/v1.0/users`) | user | `value` | `id`, `userPrincipalName`, `displayName`, `department`, `jobTitle`, `accountEnabled`, `officeLocation` |
| `trellix-epo` | `systemFind` (existing) | device | `$` (root array) | `EPOComputerProperties.ComputerName`, `.IPAddress`, `.OSType`, `.SystemSerialNumber`, `.NetAddress` (mac, no separators), `EPOLeafNode.LastUpdate` |
| `zscaler-zia` | `listUsers` (existing GET `/users`) | user | `$` (root array) | `id`, `name` (display), `email`, `department.name`, `groups[].name` |

`FetchStepSpec.pathParams` supplies concrete values for `{param}` templates
(e.g. Meraki's `organizationId`). Fleet canonical IDs: org `org-emu-1`, network
`net-emu-1`, site names from `fleet.ts`. Normalizers: `mac` lowercased
`aa:bb:cc:dd:ee:ff`; `hostname` lowercased for the correlation key but original
casing kept in `fields`; every record keeps `raw`.

### 4.5 Correlation rules (W3)

Deterministic, ordered — first hit wins, recorded on `asset_sources.correlation_rule`:
- **device**: match existing asset by `serial` → `mac` → `hostname` (all lowercased); else create (`rule: 'new'`).
- **user**: `email` (UPN) ; else create.
- **vulnerability**: correlate to nothing asset-to-asset in v1; each unique
  `cve/qid + hostname` is one asset with per-source rows (`external_keys.cve`).
- On merge: update `assets.summary` (last-writer per field), bump `last_seen`,
  recompute `source_count`; never delete sources on re-fetch — upsert on the
  `UNIQUE (tool_id, connection_id, asset_type, external_id)` key.

### 4.6 Scheduling + serverless rules

- All cycles are DB-claimed exactly like `runDueGenerators` (`UPDATE … WHERE due
  RETURNING`) — see `lib/engine/scheduler.ts:122` as the reference implementation.
- `/api/cron/tick` (foundation-wired) calls `runDueGenerators()` +
  `runDueHeartbeats()` + `runDueFetches()` and returns all three results.
- In-process (non-serverless) ticking: `lib/adapters/scheduler.ts`
  `startAdapterScheduler()` (foundation) — 5s interval; W1/W3 only fill the runner
  bodies (`heartbeat.ts`, `fetch-scheduler.ts`), never touch the wiring.
- Floors: `heartbeat_interval_ms ≥ 30000`, `fetch_interval_ms ≥ 60000`; serverless
  effective resolution = cron cadence (document, don't fight it).
- Everything must behave with the DB offline: `tryQuery` degrade, no throws into
  request paths (mirror existing engine discipline).

### 4.7 UI contracts (wave 2 consumes wave 1)

- Client calls **only** through `lib/api-adapters.ts` helpers (foundation) — no ad-hoc
  fetch URLs in components.
- New pages live under `app/(app)/adapters/*` and `app/(app)/assets/*`; new components
  under `components/adapters/*` and `components/assets/*`.
- Reuse existing primitives (`components/ui/*`) and tool components
  (`EndpointConsole`, `EndpointDocs`, `ToolEvents`, `ToolAutomation`, `ToolState`,
  `ToolKeys`, `ToolLogs`) inside adapter detail tabs — do not fork them.
- Status colors: `connected → ok`, `degraded → warn`, `error → danger`,
  `pending/connecting → info`, `disabled → muted` (Chip/StatusDot variants).
- `/tools` and `/tools/[tool]` become redirects to `/adapters` equivalents (W7).

## 5. Design direction (W5 tokens, applied app-wide via CSS vars)

Keep the EY identity (yellow accent, dark-first) but move from "edgy" to
**calm-enterprise readable**. Research facts we exploit: the real Axonius product is
border-driven and flat (no card shadows), ~8px card radii, chips = tint bg + status
border + status text, dots ALWAYS paired with a text label, 40–44px table rows,
Roboto-class 12–13px type (their weak spot — we go 14px Inter), and their success
dot `#39B881` actually FAILS WCAG non-text contrast (2.52:1) — ours must not.

- **Typography**: replace Arial with **Inter** via `next/font/google` (subset latin,
  `variable: --font-sans`, fallback to the current stack) + **JetBrains Mono** for
  `.mono` (via `next/font`, fallback current mono stack). Type scale (document in the
  `globals.css` header): h1 24/32 · h2 20/28 · h3 16/24 · h4 14/20 weight 600;
  body **14/22**; small 13/18; caption 12/16; overline 11/16 weight 600 uppercase
  ≤0.06em tracking. Nothing interactive below 13px; `tabular-nums` on all metric/
  timestamp/count cells. Sentence-case labels everywhere; the panel eyebrow is the
  only surviving uppercase element.
- **Radius**: un-zero the scale — `xs 4, sm 6, DEFAULT 8, md 10, lg 12, xl 16,
  pill 999` (`tailwind.config.ts`) and apply in component classes: `.chip` sm,
  `.btn*/.field` DEFAULT, `.panel/.card` lg, `.popover/modals` xl. Nested radius =
  parent − padding. Status dots stay `full`.
- **Calm the chrome**: delete `.spectrum-line` neon (yellow→magenta→cyan) — replace
  usages with a single `--accent` 2px rule; reduce aurora opacities ~40%; halve
  glass blur (`--blur: 8px`); shadows only on overlays (popover/modal), panels rely
  on border + subtle 1px inset.
- **Contrast (WCAG AA, verify with the relative-luminance formula)**: body + secondary
  text ≥ 4.5:1 on their surfaces (light: `--text-2:#4A4A55`, `--text-3:#5E6877`;
  dark: `--text-2:#B4B4C0`, `--text-3:#8A8A96`); status **dots** ≥ 3:1 on their
  surface (light ok-dot `#12855A`-class, not pastel); interactive control borders
  ≥ 3:1 (`--border-strong` darkened accordingly). Status chips keep tint bg + 1px
  status-line border + status text in both themes (already the pattern).
- **Interaction conventions**: `:focus-visible` → 2px accent outline + 2px offset
  (never remove outlines in tables); hover = background tint (`--surface-hover`),
  never border-color-only; selected nav = `--surface-hover` + 2px accent left bar
  (exists) + weight 600.
- **Density**: buttons 34px, inputs 36px, `.chip` 22–24px; table rows ≥ 40px with
  13–14px cell type; card padding 20px; page gutter 24px; 4px spacing grid.
- **Semantics stay**: ok/info/warn/danger + severity ramps keep their roles; yellow
  reserved for brand/primary actions/active states (meaning still carried by state
  color + icon, never yellow).
- No new npm dependencies (fonts come through `next/font`, built into Next 14).

## 6. Workstreams (independent by construction)

Rules that make them independent: every workstream **only edits files it owns** (table
below), imports shared code from the foundation, and codes to the contracts in §4 —
never to another workstream's implementation. If you need something from a peer
workstream at runtime, it is behind a foundation-owned interface already.

| WS | Title | Wave | Owned files (exclusive) |
|---|---|---|---|
| W1 | Connections domain + lifecycle + adapters API | 1 | `lib/adapters/connections.ts`, `lib/adapters/heartbeat.ts` (fill stub), `app/api/adapters/**` **except** `connections/[id]/fetch` |
| W2 | Gateway HTTP surface + scenarios API | 1 | `app/api/gateway/**`, `app/api/scenarios/**` |
| W3 | Fetch cycles, normalizers, assets + their APIs | 1 | `lib/adapters/fetch.ts`, `lib/adapters/fetch-scheduler.ts` (fill stub), `lib/adapters/normalize/**`, `lib/adapters/assets.ts`, `app/api/adapters/connections/[id]/fetch/route.ts`, `app/api/fetches/**`, `app/api/assets/**` |
| W4 | Fleet projection rewires in crafted tools | 1 | `lib/tools/crafted/{crowdstrike,qualys,meraki,entra,trellix,zscaler-zia}.ts` (only the operations in §4.4 + new endpoint additions) |
| W5 | Design-system overhaul (tokens/typography/primitives) | 1 | `app/globals.css`, `tailwind.config.ts`, `app/layout.tsx`, `components/ui/**`, `components/{Sidebar,Topbar,PageHeader,DbStatus,ThemeToggle,UserMenu}.tsx` (style-only edits) |
| W6 | Scaffold adapters ×8 (Okta, Tenable, SentinelOne, Intune, Jamf, ServiceNow CMDB, Wiz, Rapid7) | 1 | `lib/tools/crafted/{okta,tenable,sentinelone,intune,jamf,servicenow,wiz,rapid7}.ts` (new), `lib/tools/registry.ts` (imports+list only), `lib/adapters/meta.ts` (append entries only), `lib/tools/types.ts` + `lib/tools/categories.ts` (add CategoryId values/labels only if needed) |
| W7 | Adapters UI (catalog, detail tabs, add-connection, fetch history) | 2 | `app/(app)/adapters/**`, `components/adapters/**`, `components/Sidebar.tsx` (nav item edit), `app/(app)/tools/**` (convert to redirects) |
| W8 | Assets inventory UI | 2 | `app/(app)/assets/**`, `components/assets/**` |
| W9 | Overview refresh + docs (README, usage guide) | 2 | `app/(app)/page.tsx`, `components/overview/**`, `README.md`, `docs/adapter-platform/USAGE.md`, `app/api/stats/route.ts` (extend) |

Conflict notes: W5 edits shell components for **style only** in wave 1; W7 edits
`Sidebar.tsx` for the **nav entry** in wave 2 (after W5 merged) — no overlap in time.
W6 is the only wave-1 stream touching `registry.ts`/`meta.ts`. Foundation files are
frozen for everyone except where a workstream "fills a stub" (the stub file is listed
as owned).

### Per-workstream specs

**W1 — Connections domain.** Implement `connections.ts` (CRUD + validation against
`meta.connectionParams`, provisioning per §4.2, state machine per §4.1, redaction),
`heartbeat.ts` (`runDueHeartbeats()`: claim due enabled connections, heartbeat =
sessions.getOrCreateSession + gateway-core call of the adapter's
`heartbeatOperation` — default first GET fetchStep, else first GET endpoint —
evaluate per §4.1, write metrics + `connection_events`), and the `/api/adapters`
routes (§4.3) with rollups for the catalog (connection counts by status, last fetch,
total records). Emit platform events through the existing pub/sub as tool-less
deliveries is **out of scope** — lifecycle history lives in `connection_events`.

**W2 — Gateway.** `app/api/gateway/[connection]/[[...path]]/route.ts`: resolve
connection (404 unknown, 409 disabled, 503 when `status='error'` with
`status_reason`), acquire session via `sessions.ts`, call `gateway-core`, stream back
status/body/headers + `x-emu-connection`, `x-emu-session-reused`, `x-emu-tool`
headers; log to `request_logs` (the engine call inside gateway-core already logs the
mock-side request — gateway adds no duplicate row, it only annotates response
headers). Bare `GET /api/gateway/[connection]` returns the **descriptor**: connection
status, tool, session (id, expiresAt, reused count), lifetime metrics, example curl.
Plus `/api/scenarios` CRUD (list/create/toggle/delete; validate config keys
`latency_ms|failure_rate|force_status|force_body`; `invalidateRuntimeCache()` on
writes).

**W3 — Fetch + assets.** `fetch.ts` `executeFetch(connectionId, trigger)`: create
`fetch_runs` row, for each `FetchStepSpec` call gateway-core (reusing one session —
record `session_reused`), extract `recordsPath`, run the tool's normalizer, upsert
assets per §4.5, finish run (`success`/`partial` if some steps failed/`failed`),
update connection rollups (`total_fetches`, `total_records`, `last_fetch_at`,
`next_fetch_at`), insert `connection_events` fetch rows. `fetch-scheduler.ts`
`runDueFetches()`: atomic-claim due fetch-enabled connected/degraded connections →
`executeFetch(trigger:'schedule')`. Normalizers per §4.4 in `normalize/<toolId>.ts`
with a registry `normalize/index.ts`. Assets APIs per §4.3 (list with facets:
counts by type and by source tool; detail with sources + raw).

**W4 — Fleet rewires.** For each §4.4 operation: replace the standalone seeded
generator with a projection of `lib/fleet/fleet.ts` records into the tool's existing
vendor shape (keep envelope fields, pagination params, casing EXACTLY as today; add
the named missing fields e.g. Qualys `SERIAL_NUMBER`). Honor existing `limit`/filter
params. Add CrowdStrike `getDeviceEntities` as a new endpoint with authored `params`
docs (follow the file's authoring style, incl. `aiTool` flags where the family has
them). Non-inventory endpoints and event samples stay untouched. Determinism rule:
same fleet member ⇒ same vendor IDs across calls (seed with `fleetId`).

**W5 — Design system.** Apply §5 exactly. The app re-skins through CSS vars +
component classes — do not edit feature components/pages; if a page hardcodes a
sharp-corner or spectrum-line class, that page keeps it until its own workstream
(exception: shell components listed as owned). Update the doctrine comment block in
`globals.css` to describe the new system. Both themes must pass WCAG AA for body +
secondary text; keep `prefers-reduced-motion` behavior.

**W6 — Scaffold adapters.** Eight new `ToolDef`s, `crafted: false`, each: 3–5
endpoints (auth token endpoint where the vendor uses OAuth, 1–2 inventory endpoints
projecting from fleet in a plausible vendor shape, 1 action endpoint), 1–2 events,
category fit (add `itam`/`cloud-security` categories if needed), authored `params`
for every endpoint, `AdapterMeta` with connectionParams + fetchSteps (devices:
tenable/sentinelone/intune/jamf/servicenow/rapid7; users: okta; devices+saas: wiz)
and `recordsPath` documented in the meta entry itself. Register alphabetically in
`registry.ts`. Their normalizers ship in **W3's** generic fallback: W6 fetchSteps
must emit records whose field names match the **generic normalizer contract**:
`id`, `hostname`/`name`, `mac`, `serial`, `email`, `os`, `ip`, `lastSeen` — nested
under the path you declare. (This is what makes W6 independent of W3.)

**W7 — Adapters UI.** `/adapters`: PageHeader + stat row (adapters, connections by
status, assets, last discovery), search + category chips + "configured only" toggle,
card grid (logo initials tile, name/vendor, category chip, asset-type chips,
connection-status dots + counts, records count). `/adapters/[tool]`: header (status
rollup, base path copy, docs link) + tabs: **Connections** (table: label, status
chip + reason tooltip, enabled toggle, last heartbeat, last fetch, records, session
reuse %, actions test/fetch/edit/delete; Add Connection modal generated from
`connectionParams` with standard fields Label + Verify SSL (display-only) +
simulate selector on edit; test-before-save flow), **Fetch history** (runs table +
expandable steps), **Endpoints** (existing EndpointConsole + docs), **Events**
(existing ToolEvents), **Automation** (existing ToolAutomation), **State** (existing
ToolState). `/tools*` → `redirect()` to the adapter equivalents. Empty states for
DB-offline. 5s polling like existing panels.

**W8 — Assets UI.** `/assets`: type tabs (device/user/vulnerability with live
counts), search, source-tool filter chips, table (name, type icon, key ids
hostname/serial/mac/email, sources as tool chips, first/last seen, source count);
asset drawer: correlated summary fields, per-source cards (tool, connection,
correlation-rule chip, normalized fields, raw JSON via JsonViewer), fetch-run link.
Overview stat + empty/DB-offline states.

**W9 — Overview + docs.** Rework `/` overview: adapters/connections/assets/fetch
stat tiles (extend `/api/stats`), "discovery activity" feed (recent fetch_runs +
status transitions), keep request-trace + getting-started (update curl examples to
gateway). Rewrite README sections (architecture diagram, adapters quick-start:
create connection → test → fetch → query assets → gateway curl) +
`docs/adapter-platform/USAGE.md` walkthrough.

## 7. How agents work (process contract)

- Branch from `main` (after foundation merge): `feat/adapters-w<N>-<slug>`.
- Commits: repo style `feat(adapters): …` / `fix(adapters): …`. **Never add any
  AI/Claude/Anthropic attribution, Co-Authored-By trailer, or generated-with note
  to commits, PR titles, or PR bodies.** Author is the repo user only.
- PR to `main`, title `[W<N>] <summary>`, body: what/why, contract deviations (if
  any), test evidence (build output, script runs), and `Closes #<issue>`.
- Before PR: `npm install` (worktrees start without `node_modules`), then
  `npm run build` **must pass with zero type errors**. No new npm dependencies.
  No edits outside your owned files. Quote paths — the repo path contains a space.
- Runtime DB access is NOT available in worktrees (no `.env`) — verify by build +
  code-path reasoning; the master runs `scripts/verify-adapters.mjs` + the
  VERIFICATION.md checklist against a live DB after merge.
- The master agent (session orchestrator) merges PRs in order W5 → W1 → W2 → W4 →
  W6 → W3 (then wave 2: W7 → W8 → W9), resolving trivial conflicts; anything
  non-trivial goes back to the owning agent.

## 8. Decision log

- Connections provision REAL `api_keys` rows so engine auth is genuinely exercised (§4.2).
- Sessions/gateway-core/fleet live in the foundation so W1/W2/W3/W6 stay decoupled.
- `/tools` pages become redirects; adapter detail absorbs the tool detail tabs (W7).
- Vulnerability assets don't cross-correlate in v1 (per-host rows only).
- Scenario management API assigned to W2 (it previously had no API/UI at all).
- No queue/broker: fetch steps run inline per run, serverless-bounded like generators.
