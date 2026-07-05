// ============================================================================
// In-process tick for adapter cycles (heartbeats + fetches) on long-lived
// servers. On serverless this is skipped — /api/cron/tick drives the same
// runners with DB-coordinated atomic claims (same doctrine as the generator
// scheduler in lib/engine/scheduler.ts).
// Foundation-owned wiring: W1/W3 fill the runner bodies, never this file.
// ============================================================================

import { isServerless } from "../db";
import { runDueHeartbeats } from "./heartbeat";
import { runDueFetches } from "./fetch-scheduler";

const TICK_MS = 5000;

interface AdapterSchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
}
const _store = globalThis as unknown as { __emuAdapterScheduler?: AdapterSchedulerState };
const state: AdapterSchedulerState = (_store.__emuAdapterScheduler ??= { timer: null, ticking: false });

async function tick(): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    await runDueHeartbeats().catch(() => {});
    await runDueFetches().catch(() => {});
  } finally {
    state.ticking = false;
  }
}

/** Idempotent. Started from instrumentation.ts alongside the generator scheduler. */
export function startAdapterScheduler(): void {
  if (isServerless()) return; // cron tick drives cycles on serverless
  if (state.timer) return;
  state.timer = setInterval(() => { void tick(); }, TICK_MS);
  if (typeof (state.timer as unknown as { unref?: () => void }).unref === "function") {
    (state.timer as unknown as { unref: () => void }).unref();
  }
}
