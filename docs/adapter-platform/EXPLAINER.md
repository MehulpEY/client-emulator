# Adapters and assets: a plain-language explainer

What changed after commit `10fb848` (PR #5), why, and how it actually works.

This is the friendly companion to [PLAN.md](./PLAN.md), which is the engineering contract, and
[USAGE.md](./USAGE.md), which is the hands-on walkthrough. Read this first if you just want to
understand what the adapter platform is, how adapters and assets work, and whether the data is
"real."

> There is also a public, in-app version of this material at the `/architecture` route. It needs
> no sign-in and pulls its numbers live from the code registry. This file is the repository copy.

---

## 1. The before and after

Commit `10fb848` ("automation view") was the last commit before the platform existed. Up to that
point the product was one thing:

> **Before.** A catalog of standalone mock vendor APIs. You could point an agent at
> `/api/mock/crowdstrike/...` and get a believable CrowdStrike-shaped response. Each tool was an
> island with its own base path and its own auth. There was no notion of "I have a CrowdStrike
> account configured, it is connected, and it pulls inventory on a schedule."

Everything from PR #6 (`9555d6c`) through PR #26 added a second layer on top, modeled on
[Axonius](https://www.axonius.com/adapters):

> **After.** An adapter platform. The same 23 mock tools become adapters. You create credentialed
> connections to them, those connections have a live lifecycle (they connect, degrade, error, and
> recover), they pull inventory on a schedule through a single gateway URL, and the pulled records
> are normalized and correlated into one unified asset inventory. The same laptop seen by
> CrowdStrike, Qualys, and Intune collapses into a single asset that shows which rule merged each
> source.

Nothing from "before" was thrown away. The mock APIs are still first-class. The platform is a layer
that uses them.

### The five vocabulary words

| Term | Plain meaning | Real-world analogue |
|---|---|---|
| Adapter | One of the 23 mock tools, with extra metadata (connection form, asset types, heartbeat probe, permissions) | An Axonius adapter, or a connector |
| Connection | One configured account on an adapter (label plus credentials). You can have many per adapter. | "My prod CrowdStrike tenant" |
| Gateway | One URL per connection, `/api/gateway/<connection>/<path>`, that injects the credential and reuses a session | Axonius Tunnel plus its uniform plugin API |
| Fetch (discovery cycle) | A scheduled run that calls the adapter's endpoints and pulls inventory | Axonius discovery cycle |
| Asset | A correlated, deduplicated device, user, or vulnerability built from many connections' records | Axonius unified asset inventory |

---

## 2. How adapters and connections work

### Creating a connection provisions a real credential

This is the single most important design decision, and it is what makes the whole thing behave
like a real system instead of a mock-up. When you create a connection (`lib/adapters/connections.ts`,
function `createConnection`), three things happen:

1. A row is inserted into `adapter_connections` with status `pending`.
2. A random secret is generated and stored server-side inside the connection params as `__secret`.
   It is never returned to the UI; it is redacted.
3. An actual `api_keys` row is inserted for that tool, whose secret is that same `__secret`,
   labelled `conn:<connectionId>`.

So the connection now owns a genuine, working API key for its tool. Later, when a heartbeat, fetch,
or gateway call runs, `gateway-core` injects that secret in the tool's own auth scheme (bearer,
basic, an API key header, or a query key), and the mock engine's real auth check validates it. The
consequence:

> Disable the connection, or set `simulate: revoked_credentials`, and the provisioned key is
> deactivated. The engine then returns a real 401 on that connection's traffic. Nothing is painted
> on. The failure is produced by the same auth path a real request hits.

### The lifecycle is driven by real probes (heartbeats)

Every connection has a heartbeat, which is a liveness probe that actually calls the adapter's
designated read endpoint through the gateway (`lib/adapters/heartbeat.ts`). The result moves the
connection through a state machine:

```
              first heartbeat succeeds
   pending ------------------------------> connected
      |                                      |  ^
      | config or credential change          |  | heartbeat ok again
      v                                       v  |
  connecting                            degraded (1 to 2 transient failures)
                                              |
                                              | 3+ consecutive failures,
                                              | or a hard 401
                                              v
                                           error
   (user sets enabled = false) -----------> disabled
```

- Transient failure (a 5xx, or `simulate: unreachable`): one or two in a row moves to `degraded`,
  three or more moves to `error`.
- Hard auth failure (engine returns 401): moves to `error` immediately.
- Anything the vendor answered while authorized (2xx, 3xx, or 4xx): moves to `connected`.

Each probe writes `last_heartbeat_at`, the failure streak, and a `connection_events` breadcrumb. So
the lifecycle you see in the UI is a genuine log of probes that ran, not a scripted animation.

### Sessions: cached and reused, and you can watch it happen

A real client SDK authenticates once and reuses the session across many calls. The platform models
exactly that (`lib/adapters/sessions.ts`):

- The first call mints a session (a `connection_sessions` row, 30-minute default time to live) and
  bumps `sessions_issued`.
- Every later call within the window reuses it, bumps `use_count` and `session_reuses`.
- Changing credentials, disabling, or simulating revocation kills live sessions.

The gateway descriptor and the UI expose the `sessions_issued` versus `session_reuses` counters, and
the gateway response carries an `x-emu-session-reused` header. So session reuse is observable, not
just claimed. This is deliberately one step beyond Axonius, which re-authenticates on every fetch.

### One connection, one URL: the gateway

`gateway-core.ts` is the single choke point every call goes through. The public gateway route, the
heartbeats, and the fetch steps all funnel here. It:

1. Loads the connection and resolves its tool.
2. Injects the provisioned credential in the tool's real auth scheme.
3. Applies connection-level fault injection (`unreachable` returns a 502 after a pause, `slow` adds
   about 2.5 seconds of latency).
4. Runs the real mock engine, so path matching, auth, tool-level scenarios, latency, logging, and
   webhook events all apply.
5. Logs the call into the same request trace as direct mock calls.

That is why gateway traffic is indistinguishable from direct traffic in the logs. It is the same
engine.

---

## 3. How assets work: fetch, normalize, correlate

### A fetch is a real multi-step API run

A discovery fetch (`lib/adapters/fetch.ts`, function `executeFetch`) does this, per connection:

1. Open one session for the whole run, which is the reuse behaviour.
2. For each of the adapter's fetch steps, call the endpoint through the gateway (real engine, real
   auth, real latency, connection faults honoured).
3. Extract the records array from the response using a dotted path, tolerant of vendor quirks such
   as Trellix ePO text envelopes and Qualys XML-derived wrappers.
4. Normalize each record with the tool's normalizer.
5. Correlate and upsert the normalized records into the asset store.
6. Write a full `fetch_runs` history row: status (`success`, `partial`, or `failed`), duration,
   per-step results, records by asset type, and whether the session was reused.

If a step's credential is rejected (a revoked key), the run records an auth failure and flips the
connection to `error`. The fetch history and the connection status stay consistent.

### Normalizing: vendor shape to common shape

Each inventory tool has a normalizer in `lib/adapters/normalize/` (CrowdStrike, Qualys, Meraki,
Entra, Trellix, Zscaler ZIA), plus a generic fallback so scaffold adapters work without bespoke
code. A normalizer turns a vendor record into a common shape with the correlation keys pulled out:
`assetType`, `externalId`, `displayName`, `hostname`, `mac`, `serial`, `email`, plus a summary and
the raw evidence.

### Correlating: deterministic, and explainable

The asset store (`lib/adapters/assets.ts`) merges records into unified assets using a fixed, ordered
rule set. The first rule that hits wins:

| Asset type | Correlation rule, in order |
|---|---|
| device | `serial`, then `mac`, then `hostname` |
| user | `email` |
| vulnerability | a unique combination of the CVE or QID and the hostname |
| software, saas_app, alert | no cross-source rule in this version; one asset per source |

The key differentiator is that every source records which rule merged it
(`asset_sources.correlation_rule`), stored next to the raw vendor evidence. So in the assets view you
can drill into one device and see that it was merged from CrowdStrike by serial, from Qualys by mac,
and from Intune by hostname, with the original record behind each source. This is the deliberate
answer to correlation engines that behave like a black box.

The merge is conservative. Correlation keys only ever fill an empty field, they never overwrite one,
so a key cannot flap between values. Summary fields take the most recent value. A source's assignment
to an asset is sticky once made, and the source count on an asset is recomputed from the evidence
rows.

---

## 4. Is it real data? The honest answer

Short version: the data is synthetic (invented), but the mechanics are real. The distinction
matters, so here it is precisely.

### What is not real

- The inventory content is fabricated. There is no live CrowdStrike out there. All devices, users,
  and vulnerabilities are generated deterministically from a single canonical fleet
  (`lib/fleet/fleet.ts`): one invented company, Meridian Dynamics, with about 60 devices and 40
  users, seeded by a pseudo-random generator so the same identifiers appear every time.
- Vendor responses are hand-authored mocks, not proxied from real APIs. They mirror real paths, auth
  schemes, and field names, but the bytes are emulated.
- The failures are opt-in simulations you trigger (`simulate: revoked_credentials`, `unreachable`,
  `slow`, and tool-level scenarios).

### What is real, and this is the point

- The credential and auth flow is real. A provisioned `api_keys` row is genuinely validated by the
  engine. Revoke it and you get a genuine 401. Nothing is faked at the auth layer.
- The lifecycle is real. Statuses come from probes that actually ran, and results that actually came
  back, all persisted, timestamped, and logged.
- The correlation is real. The same laptop actually appears in multiple tools with consistent
  serial, MAC, and hostname, because they all project the one canonical fleet. So the merge genuinely
  happens end to end; it is not pre-baked. Add a Qualys connection and fetch, and you will watch its
  records merge into devices CrowdStrike already created.
- Session reuse is real. Real rows, a real time to live, real counters you can watch increment.
- The persistence is real. Everything lands in a real Postgres database on Supabase.

> The mental model is a flight simulator, not a video of a flight. The weather is synthetic and you
> choose when the engine fails, but the cockpit, the controls, and the way the aircraft responds are
> faithful. You are exercising the real behaviour of an adapter platform against invented inventory.

### Why it is built this way

The product's job is to let agent workflows be simulated end to end, including the messy parts: a
connection degrading, credentials getting revoked, a fetch coming back partial, assets going stale.
Real tenants cannot produce those failures on demand, but a faithful simulator can. Synthetic data
with real mechanics is exactly the combination that makes those scenarios demonstrable and
repeatable.

---

## 5. Where the data physically lives

The code registry (`lib/tools/` plus `lib/adapters/meta.ts`) is the source of truth for the catalog.
The dashboard renders adapters even with the database offline. Runtime data lives in the `emulator`
schema in Supabase Postgres:

| Table | Holds |
|---|---|
| `adapter_connections` | one row per configured connection (status, schedule, counters, `__secret`) |
| `connection_sessions` | minted and reused sessions with a time to live |
| `connection_events` | the lifecycle trail (created, heartbeat, status_change, fetch_started, fetch_finished) |
| `fetch_runs` | discovery history, one row per run, with per-step detail |
| `assets` | the correlated, unified inventory |
| `asset_sources` | per-source evidence plus the correlation rule that merged it |
| `api_keys` | inbound auth, including the per-connection provisioned credentials |
| `request_logs` | the full request trace (direct and gateway) |

Everything degrades gracefully. If the database is unreachable, the catalog still renders, and
database-backed panels simply show empty until it is back.

---

## 6. The whole loop in six steps

```
1. Add connection      -> provisions a real API key, status = pending
2. Test or heartbeat   -> real probe through the gateway, status = connected
3. Gateway call        -> credential injected, session minted then reused
4. Fetch (discovery)   -> multi-step run, records normalized
5. Correlate           -> records merge into assets by serial, mac, hostname, email
6. Assets UI           -> unified inventory, each source tagged with its merge rule
```

Add a second adapter's connection (say Qualys next to CrowdStrike) and repeat steps 1 through 5. The
same machines merge across both, and step 6 shows the explainable correlation. That merge is the
platform's headline capability, and it is genuine: the mechanics are real, the fleet behind them is
synthetic.

---

See also: [PLAN.md](./PLAN.md) for the full contract and state-machine spec, [USAGE.md](./USAGE.md)
for copy-paste commands, the `/architecture` route for the public in-app reference, and the root
`README.md` for the architecture diagram and adapter catalog.
