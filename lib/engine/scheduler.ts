import { tryQuery, dbAvailable, SCHEMA } from "../db";
import { getTool } from "../tools/registry";
import { buildEventPayload } from "../tools/events";
import { publishEvent } from "./events";

// In-process scheduler for "generators" - DB-configured simulators that auto-emit
// a tool's events at fixed or random intervals (e.g. random Forcepoint DLP
// incidents). Generators live in memory; a 1s tick fires the due ones (no DB
// polling). The list is reloaded on startup and whenever a generator changes.

const MIN_INTERVAL = 2000;

interface Gen {
  generator_id: string;
  tool_id: string;
  event_type: string;
  mode: "fixed" | "random";
  interval_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  payload_override: any;
  _next: number; // epoch ms of next fire
}

// Store scheduler state on globalThis so a single instance is shared across all
// module copies in a process. Without this, Next.js dev (and HMR) can load this
// module more than once: the tick loop lives in one copy while an API route's
// reloadScheduler() mutates another - so pausing/deleting a generator wouldn't
// actually stop it. One shared object keeps the tick loop and the routes in sync.
interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  gens: Gen[];
  ticking: boolean;
}
const _store = globalThis as unknown as { __emuScheduler?: SchedulerState };
const state: SchedulerState = (_store.__emuScheduler ??= { timer: null, gens: [], ticking: false });

const randInt = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;

function delayFor(g: Pick<Gen, "mode" | "interval_ms" | "min_ms" | "max_ms">): number {
  if (g.mode === "random") {
    const lo = Math.max(MIN_INTERVAL, g.min_ms ?? MIN_INTERVAL);
    const hi = Math.max(lo, g.max_ms ?? lo);
    return randInt(lo, hi);
  }
  return Math.max(MIN_INTERVAL, g.interval_ms ?? MIN_INTERVAL);
}

export async function reloadScheduler(): Promise<void> {
  if (!dbAvailable()) { state.gens = []; return; }
  const rows = await tryQuery<Omit<Gen, "_next">>(
    `select generator_id, tool_id, event_type, mode, interval_ms, min_ms, max_ms, payload_override
       from ${SCHEMA}.generators where active = true`
  );
  const now = Date.now();
  // Preserve countdown for generators that were already scheduled.
  const prev = new Map(state.gens.map((g) => [g.generator_id, g._next]));
  state.gens = rows.map((r) => ({ ...r, _next: prev.get(r.generator_id) ?? now + delayFor(r) }));
}

async function fire(g: Gen): Promise<void> {
  const tool = getTool(g.tool_id);
  if (!tool) return;
  try {
    const data = g.payload_override ?? buildEventPayload(tool, g.event_type);
    await publishEvent({ toolId: tool.id, toolSlug: tool.id, eventType: g.event_type, data, source: "simulator" });
  } catch { /* swallow - best effort */ }
  await tryQuery(
    `update ${SCHEMA}.generators set run_count = run_count + 1, last_run_at = now(), next_run_at = $2 where generator_id = $1`,
    [g.generator_id, new Date(g._next).toISOString()]
  );
}

function tick(): void {
  if (state.ticking || state.gens.length === 0) return;
  state.ticking = true;
  try {
    const now = Date.now();
    for (const g of state.gens) {
      if (g._next <= now) {
        g._next = now + delayFor(g);
        void fire(g);
      }
    }
  } finally {
    state.ticking = false;
  }
}

/** Idempotent. Starts the 1s tick + initial load. Safe to call from anywhere. */
export function startScheduler(): void {
  if (state.timer) return;
  state.timer = setInterval(tick, 1000);
  if (typeof (state.timer as any).unref === "function") (state.timer as any).unref();
  void reloadScheduler();
}
