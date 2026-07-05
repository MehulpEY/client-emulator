// ============================================================================
// Heartbeat runner — STUB. W1 implements this per PLAN §4.1/§6 (W1 spec):
// atomic-claim due enabled connections (mirror lib/engine/scheduler.ts:122),
// probe via sessions.getOrCreateSession + gateway-core callOperation of the
// adapter's heartbeat spec, apply the state machine, write metrics +
// connection_events. The wiring (cron tick + in-process scheduler) already
// calls this — only fill in the body, keep the signature.
// ============================================================================

export interface HeartbeatSummary {
  checked: number;
  ran: number;
  transitions: number;
}

export async function runDueHeartbeats(): Promise<HeartbeatSummary> {
  return { checked: 0, ran: 0, transitions: 0 };
}
