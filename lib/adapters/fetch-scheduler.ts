// ============================================================================
// Discovery/fetch scheduler — STUB. W3 implements this per PLAN §6 (W3 spec):
// atomic-claim due fetch-enabled connections in connected/degraded states
// (mirror lib/engine/scheduler.ts:122), then executeFetch(conn, "schedule")
// from lib/adapters/fetch.ts. The wiring (cron tick + in-process scheduler)
// already calls this — only fill in the body, keep the signature.
// ============================================================================

export interface FetchSchedulerSummary {
  checked: number;
  started: number;
}

export async function runDueFetches(): Promise<FetchSchedulerSummary> {
  return { checked: 0, started: 0 };
}
