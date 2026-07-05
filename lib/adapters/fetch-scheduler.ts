// ============================================================================
// Discovery/fetch scheduler (W3, PLAN §4.6). Serverless-safe: due connections
// are claimed with a single atomic UPDATE that advances next_fetch_at while
// the row is still due (mirrors lib/engine/scheduler.ts runDueGenerators) — an
// overlapping cron call or a persistent host ticking in parallel matches zero
// rows, so each interval fires exactly once. Runs execute sequentially,
// capped per tick to stay inside serverless time budgets.
// ============================================================================

import { dbAvailable, tryQuery, SCHEMA } from "../db";
import { adapterMeta } from "./meta";
import { executeFetch } from "./fetch";
import type { ConnectionDbRow } from "./types";

const MAX_PER_TICK = 3;

export interface FetchSchedulerSummary {
  checked: number;
  started: number;
}

export async function runDueFetches(): Promise<FetchSchedulerSummary> {
  if (!dbAvailable()) return { checked: 0, started: 0 };

  const due = `fetch_enabled and enabled and status in ('connected','degraded')
           and (next_fetch_at is null or next_fetch_at <= now())`;

  const counted = await tryQuery<{ n: number }>(
    `select count(*)::int as n from ${SCHEMA}.adapter_connections where ${due}`
  );
  const checked = counted[0]?.n ?? 0;
  if (checked === 0) return { checked, started: 0 };

  // Atomic claim: the outer UPDATE re-checks the due predicate under the row
  // lock, so of two concurrent ticks only one gets each connection. UPDATE
  // can't LIMIT directly — the subselect caps the batch at MAX_PER_TICK.
  const claimed = await tryQuery<ConnectionDbRow>(
    `update ${SCHEMA}.adapter_connections
        set next_fetch_at = now() + (fetch_interval_ms || ' milliseconds')::interval,
            updated_at = now()
      where connection_id in (
              select connection_id from ${SCHEMA}.adapter_connections
               where ${due}
               order by next_fetch_at asc nulls first
               limit ${MAX_PER_TICK})
        and ${due}
      returning *`
  );

  let started = 0;
  for (const conn of claimed) {
    // Enrichment-only adapters (no fetchSteps) get their schedule advanced by
    // the claim (so they stop coming up due) but produce no empty runs.
    if ((adapterMeta(conn.tool_id)?.fetchSteps.length ?? 0) === 0) continue;
    try {
      await executeFetch(conn, "schedule");
      started++;
    } catch {
      /* executeFetch never throws by contract — belt and braces */
    }
  }
  return { checked, started };
}
