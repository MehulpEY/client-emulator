# Adapter Platform — Verification

> The master agent's acceptance gate. Work through this after each merge wave;
> everything must be checked before the effort is called done. Workstream specs
> live in [PLAN.md](./PLAN.md) §6 — this file is only about *proving* them.

## Prerequisites (once)

- [ ] `.env` has `DATABASE_URL` (Supabase) and the DB is reachable (`GET /api/health` → `db.reachable: true`).
- [ ] `npm run db:apply` — applies `db/schema.sql` including the 6 new adapter tables (idempotent).
- [ ] `npm run db:seed` (app running) — seeds catalog + ensures a **master api key** exists.
      This matters: connection provisioning adds per-tool keys, which ends a tool's
      "open dev mode"; the master key keeps ad-hoc `/api/mock/*` calls working.
- [ ] Admin account exists; export `EMU_ADMIN_EMAIL` / `EMU_ADMIN_PASSWORD` for the script.

## Gate A — foundation (before wave-1 agents branch)

- [ ] `npm run build` passes with zero type errors on `main`.
- [ ] `db/schema.sql` re-applies cleanly on a DB that already ran the old schema.
- [ ] `GET /api/cron/tick` returns `{ ok, generators, heartbeats, fetches }` (stubs return zeros).
- [ ] `/api/gateway/anything` is middleware-public (401 must NOT come from the session gate; the route may 404 until W2 merges).

## Gate B — per-workstream acceptance (check on each PR before merge)

Every PR, regardless of workstream:
- [ ] `npm run build` green; no new npm dependencies; only owned files touched (PLAN §6 table).
- [ ] No AI/Claude attribution anywhere in commits or the PR.

**W1 connections domain**
- [ ] `GET /api/adapters` returns 15 `AdapterSummary` rows with meta merged and status rollups.
- [ ] Create → provisions `api_keys` row labeled `conn:<id>`; delete → removes it; disable → deactivates it (verify in DB or via engine 401).
- [ ] Param validation: missing required param → 400 with the param key named; unknown param → 400.
- [ ] Secrets: API responses never contain `__secret` or raw password-typed values (redacted to `•••`).
- [ ] Dry-run test endpoint: valid params → `{ ok: true }` without creating rows.
- [ ] `POST …/test`: transitions pending → connecting → connected (or → error with `statusReason` when engine auth fails); writes `connection_events` (`test`, `status_change`).
- [ ] Heartbeat runner: with a connection made stale (`next_heartbeat_at` in the past), `GET /api/cron/tick` runs exactly one heartbeat (atomic claim: hit the endpoint twice concurrently — combined `ran` count is 1); failure-streak transitions per PLAN §4.1 (force via `simulate`).
- [ ] `saveAndFetch: true` on create sets `next_fetch_at <= now()`.

**W2 gateway + scenarios**
- [ ] `GET /api/gateway/<id>` descriptor: connection (redacted), tool, session info, lifetime metrics, example curl.
- [ ] `ALL /api/gateway/<id>/<tool path>` proxies through the engine with injected auth; response headers include `x-emu-connection`, `x-emu-tool`, `x-emu-session-reused`.
- [ ] Second consecutive call reuses the session (`x-emu-session-reused: true`; `session_reuses` incremented).
- [ ] Unknown connection → 404; disabled → 409; `status='error'` → 503 with `statusReason`.
- [ ] Gateway calls appear in `/api/logs` (request trace) like direct mock calls.
- [ ] Scenario CRUD works and a `force_status: 503` scenario on a tool visibly breaks that tool's connections (heartbeat → degraded/error) — the chaos-demo loop.

**W3 fetch + assets**
- [ ] `POST /api/adapters/connections/<id>/fetch` creates a `fetch_runs` row that finishes `success` with `records_by_type` populated and steps[] per §4.4.
- [ ] One session spans all steps of a run (`session_reused: true` on the run when a live session existed).
- [ ] Scheduler: due connection fetched exactly once per interval via cron tick (atomic claim, same double-call test as W1).
- [ ] Assets upserted with correlation per §4.5; re-fetch does NOT duplicate sources (unique key upsert).
- [ ] `GET /api/assets?type=device` returns facets (byType, byTool); `GET /api/assets/<id>` includes per-source `correlationRule` + `normalized` + `raw`.
- [ ] A failing step (point a fetchStep at a scenario-broken tool) yields run status `partial` with the step error recorded.

**W4 fleet rewires**
- [ ] Each §4.4 operation returns fleet-projected records with the exact envelope/casing of the old response (diff a saved before/after sample for one endpoint per tool).
- [ ] Same fleet member has consistent identifiers across tools: pick `dev-001` in the fleet, verify its serial appears in both CrowdStrike `getDeviceEntities` and Qualys `listHosts` outputs (formats per §4.4).
- [ ] CrowdStrike `getDeviceEntities` new endpoint documented (`params` authored) and visible in the tool's endpoint docs UI.
- [ ] Existing filters/pagination params still honored (spot-check `limit`).

**W5 design system**
- [ ] Inter + JetBrains Mono load via `next/font` (no external CDN request at runtime; check the Network tab).
- [ ] Radius scale un-zeroed; panels/cards/buttons/chips/fields visibly rounded per PLAN §5.
- [ ] `.spectrum-line` neon gone from the UI; aurora/glass reduced.
- [ ] Contrast: verify `--text-2`/`--text-3` and all status dot colors against their surfaces ≥ 4.5:1 / ≥ 3:1 (compute, don't eyeball — WCAG relative luminance).
- [ ] Both themes render correctly on: overview, tools/adapters catalog, a tool detail, logs, events, generators, login.
- [ ] `prefers-reduced-motion` still kills animations.

**W6 scaffold adapters**
- [ ] 8 new tools registered; catalog shows 23 adapters; each has ≥3 endpoints with authored `params`, 1–2 events, an `AdapterMeta` entry with fetchSteps whose records match the generic-normalizer contract (PLAN §6 W6).
- [ ] Okta fetch yields users correlating with Entra users (email rule); Tenable/SentinelOne/Intune/Jamf devices correlate with the CrowdStrike/Qualys fleet (serial/mac/hostname rules).
- [ ] `npm run db:seed` mirrors them into the DB catalog without errors.

**W7 adapters UI**
- [ ] `/adapters`: search, category chips, configured-only toggle, cards with status dots + counts; card click → detail.
- [ ] Detail tabs all render: Connections (table + Add Connection modal generated from `connectionParams`, dry-run test button, test-before-save), Fetch history (runs + expandable steps), Endpoints (console works through existing components), Events, Automation, State.
- [ ] Add → test → fetch → see records, entirely through the UI.
- [ ] Simulate selector (edit connection) → status chip goes red after test; recovery works.
- [ ] `/tools` and `/tools/[tool]` redirect to the adapter equivalents.
- [ ] DB-offline: pages render with empty-state panels, no crashes (stop DB or break `DATABASE_URL` locally to check).

**W8 assets UI**
- [ ] `/assets`: type tabs with live counts, search, source-tool filter, correlated table.
- [ ] Asset drawer: summary fields, per-source cards with correlation-rule chip + raw JSON viewer, link to the fetch run.
- [ ] A 2+-source device renders both source cards (use verify connections).

**W9 overview + docs**
- [ ] Overview shows adapter/connection/asset/fetch stat tiles + discovery activity feed.
- [ ] README adapters quick-start works copy-paste (create → test → fetch → assets → gateway curl).
- [ ] `docs/adapter-platform/USAGE.md` walkthrough matches the shipped UI.

## Gate C — master end-to-end (after each wave; must be all-green at the end)

- [ ] `npm run build` on merged `main`.
- [ ] `node scripts/verify-adapters.mjs` — **all steps pass** (catalog, dry-run, create,
      test, gateway session reuse, fetch, cross-adapter correlation, revocation +
      recovery, lifecycle events, cleanup).
- [ ] Serverless sanity: with `VERCEL=1` set locally, `npm run build && npm start`, confirm in-process
      schedulers stay off and 2× concurrent `GET /api/cron/tick` fire each due cycle exactly once.
- [ ] UI smoke in both themes: adapters catalog → detail → add connection → test →
      fetch → fetch history → assets drawer → gateway descriptor curl from docs.
- [ ] Update this file: tick every box, note deviations inline, commit as
      `docs(adapters): verification pass <date>`.

## Deviations log

| Date | Item | Deviation & why |
|---|---|---|
| — | — | — |
