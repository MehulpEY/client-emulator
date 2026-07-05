# Adapter Platform — Verification

> The master agent's acceptance gate. Workstream specs live in [PLAN.md](./PLAN.md) §6.
> **Status: verification pass completed 2026-07-05** — every gate below was executed
> against the merged `main` (through PR #24) with a live Supabase DB; unchecked items
> carry an explicit note.

## Prerequisites (once)

- [x] `.env` has `DATABASE_URL` (Supabase) and the DB is reachable (`GET /api/health` → `db.reachable: true`).
- [x] `npm run db:apply` — applied; all 6 adapter tables present alongside the original 10.
- [x] `npm run db:seed` — catalog seeded (23 tools after W6); master api key exists.
- [x] Admin account — a temporary `verify-tmp@emulator.local` administrator was provisioned for the pass and **deleted afterwards**.

## Gate A — foundation

- [x] `npm run build` green on `main` (zero type errors) — verified after every merge.
- [x] `db/schema.sql` re-applied cleanly over the pre-adapter schema (idempotent).
- [x] `GET /api/cron/tick` returns `{ ok, generators, heartbeats, fetches }`.
- [x] `/api/gateway/*` middleware-public (descriptor reachable without a session).

## Gate B — per-workstream acceptance (verified on each PR before merge)

All PRs: build green, no new dependencies, only owned files, no AI attribution (grep-checked per PR).

**W1 connections domain (PR #18)** — [x] catalog rollups (23 AdapterSummary rows) · [x] provisioning: create adds `conn:<id>` api_key, delete removes (0 orphan keys after cleanup), revoke/disable deactivates · [x] param validation named-key 400s · [x] secrets never leave the API (`__secret` stripped, passwords `•••` — asserted by the e2e script) · [x] dry-run test persists nothing · [x] test transitions pending→connecting→connected / →error with reason · [x] heartbeat runner atomic-claim (agent harness: exactly-once under concurrent ticks) · [x] `saveAndFetch` schedules immediate fetch.

**W2 gateway + scenarios (PR #16)** — [x] descriptor (redacted connection, tool, session, curl) · [x] proxy with `x-emu-connection/-tool/-session-reused` headers · [x] second call reuses session (asserted live) · [x] 404/409/503 failure surface · [x] gateway traffic in the request trace · [x] scenarios CRUD with config validation + cache invalidation.

**W3 fetch + assets (PR #21)** — [x] manual fetch → `success` run with `records_by_type` + steps (live: 62 records CrowdStrike, 150 Qualys) · [x] one session per run (`sessionReused=true` live) · [x] scheduler atomic-claim (agent harness, 39 checks) · [x] correlation per §4.5 with rules recorded (live: 52 devices correlated across CrowdStrike+Qualys via `serial`) · [x] re-fetch dedupe via UNIQUE upsert (harness) · [x] facets + per-source raw evidence in the assets APIs · [x] partial-run semantics (harness).

**W4 fleet rewires (PR #19)** — [x] vendor envelopes preserved (agent ran 50-assertion before/after harness) · [x] cross-tool identity: `dev-001` serial identical in CrowdStrike + Qualys; UPNs identical in Entra + ZIA · [x] new `getDeviceEntities` endpoint documented with authored params · [x] existing filters/pagination honored.

**W5 design system (PR #17)** — [x] Inter + JetBrains Mono via `next/font` (font variables confirmed in served HTML; no runtime CDN) · [x] radius scale un-zeroed per spec · [x] spectrum-line neon removed (calm `.accent-line`) · [x] contrast computed with WCAG relative luminance and written as token comments (light text-2 8.74:1, text-3 5.64:1; dark 8.77/5.28; status mains ≥3:1; border-strong ~4:1) · [x] `prefers-reduced-motion` preserved · [~] both-themes visual eyeball on every page — token-level verified; final human pass recommended.

**W6 scaffold adapters (PR #20)** — [x] 8 new tools, catalog 23, 30 endpoints + 13 events with authored params · [x] generic-normalizer contract verified by agent runtime smoke (top-level id/hostname/mac/serial/email/os/ip/lastSeen; colon-lowercase macs) · [x] fleet identity across 5 device adapters + Okta users = all 40 fleet UPNs · [x] `db:seed` mirrors them (health shows 23).

**W7 adapters UI (PR #24)** — [x] catalog page (search, category chips, configured-only, status-dot cards) · [x] detail tabs incl. reused Endpoints/Events/Automation/State/Keys/Logs components · [x] Add Connection modal generated from `connectionParams` with dry-run + test-before-close · [x] simulate selector on edit · [x] `/tools*` → 307 redirects (verified live) · [x] DB-offline empty states (code-reviewed; degrading `reachable:false` path shared with existing pages).

**W8 assets UI (PR #22)** — [x] type tabs with facet counts, search, source filter · [x] correlated table with multi-source emphasis · [x] drawer: correlation-rule chips, per-source normalized + raw JSON, run reference.

**W9 overview + docs (PR #23)** — [x] adapter/connection/asset/fetch stat tiles + discovery feed · [x] README rewritten (architecture, quick-start, 23-adapter table, serverless notes) · [x] USAGE.md walkthrough.

## Gate C — master end-to-end

- [x] `npm run build` on final merged `main` — green.
- [x] `node scripts/verify-adapters.mjs` — **13/13 steps passed** (and 12/12 on a KEEP re-run
      against the final build): login, health, catalog≥15 (23), dry-run, create+redaction,
      test→connected, gateway session mint/reuse (52 devices), CrowdStrike fetch (62 records),
      Qualys fetch (150 records), **cross-adapter correlation (52 devices, serial rule)**,
      credential revocation→error→recovery, full lifecycle event trail (10 kinds), cleanup.
- [x] UI smoke (authenticated): `/` `/adapters` `/adapters/crowdstrike` `/assets` all 200 with
      content; `/tools` + `/tools/[tool]` 307 to adapter equivalents.
- [ ] Serverless sanity (`VERCEL=1` + concurrent double-tick) — not run live this pass. Risk is
      low: the heartbeat/fetch claims reuse the exact SQL pattern proven for generators (PR #4),
      and both W1/W3 shipped concurrent-claim harnesses. Run on the first Vercel deploy:
      2× parallel `GET /api/cron/tick` must fire each due cycle once.
- [x] This file updated and committed as the pass record.

## Deviations log

| Date | Item | Deviation & why |
|---|---|---|
| 2026-07-05 | verify script | health check moved after login (health route is session-gated by middleware). |
| 2026-07-05 | W1 | plain save schedules first fetch one interval out (not NULL); DB-offline catalog serves registry with zero rollups; hard auth failures also count toward the failure streak. |
| 2026-07-05 | W3 | `simulate: unreachable` classified transient (per §4.1) — only engine 401 flips `error`; vuln merges record rule `hostname`; enrichment-only adapters 409 on manual fetch. |
| 2026-07-05 | W4 | Trellix rows nest property groups per contract (old impl used flat dotted keys); Qualys detection STATUS narrowed to Active/Fixed. |
| 2026-07-05 | W5 | status hues unchanged (already ≥3:1); no spectrum-line compat alias needed (zero external usages). |
| 2026-07-05 | W6 | Wiz ships device+alert (PLAN said device+saas); Tenable device+vulnerability. |
| 2026-07-05 | W7 | unchanged password params PATCH the `•••` sentinel (server keeps `__secret`, engine auth unaffected); "Save & fetch" queues the run rather than awaiting it. |
| 2026-07-05 | W8 | list rows show source-count chip (list API omits per-row sources); per-tool chips render in the drawer. |
| 2026-07-05 | icons | `CloudCog` mapped in lib/icons.tsx by the orchestrator (unowned file). |
