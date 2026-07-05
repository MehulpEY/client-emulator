// ============================================================================
// Heartbeat runner (W1) — the liveness probe behind the connection lifecycle
// (PLAN §4.1). Due connections are claimed atomically exactly like
// lib/engine/scheduler.ts runDueGenerators (UPDATE ... WHERE still due
// RETURNING), so overlapping cron ticks / a persistent host ticking in
// parallel fire each probe exactly once. A heartbeat reuses the connection's
// live session (observable-reuse claim) and calls the adapter's heartbeat
// operation THROUGH gateway-core, so the engine's real auth, scenarios and
// latency all apply. Wiring (cron tick + in-process scheduler) is
// foundation-owned; this file only implements the runner.
// ============================================================================

import { dbAvailable, tryQuery, SCHEMA } from "../db";
import { callOperation } from "./gateway-core";
import { getOrCreateSession } from "./sessions";
import { heartbeatSpecFor, insertConnectionEvent, HEARTBEAT_FLOOR_MS } from "./connections";
import type { ConnectionDbRow, ConnectionStatus, GatewayCallResult } from "./types";

export interface HeartbeatSummary {
  checked: number;
  ran: number;
  transitions: number;
}

export interface HeartbeatOutcome {
  /** True when the probe landed the connection on `connected`. */
  ok: boolean;
  status: ConnectionStatus;
  statusReason: string | null;
  latencyMs: number;
  /** True when the connection's status changed as a result of this probe. */
  changed: boolean;
  httpStatus: number;
}

/** Bound one tick's work so a serverless invocation stays short (Axonius caps parallel fetches at 20). */
const MAX_PER_TICK = 25;

function errorMessageFrom(result: GatewayCallResult): string {
  const body = result.body as { error?: { message?: unknown } | string } | null | undefined;
  const raw = body && typeof body === "object" ? body.error : undefined;
  const msg = typeof raw === "string" ? raw : raw && typeof raw.message === "string" ? raw.message : undefined;
  return msg && msg.trim() ? msg : `HTTP ${result.status}`;
}

/**
 * Probe one connection and apply the PLAN §4.1 state machine:
 *   - transient failure (5xx / simulated outage): streak 1–2 → degraded, >= 3 → error
 *   - hard auth failure (engine 401 / misconfigured tool): → error immediately
 *   - anything else the vendor answered while authorized (2xx/3xx/4xx): → connected
 * Writes last_heartbeat_at / consecutive_failures / status and the
 * connection_events trail ('heartbeat' + 'status_change' when it moved).
 * Shared by the scheduler and the manual test action.
 */
export async function heartbeatConnection(conn: ConnectionDbRow): Promise<HeartbeatOutcome> {
  const spec = heartbeatSpecFor(conn.tool_id);
  let result: GatewayCallResult;
  if (!spec) {
    result = {
      status: 404,
      body: { error: { code: 404, message: `no heartbeat operation available for tool "${conn.tool_id}"` }, emulated: true },
      headers: {},
      latencyMs: 0,
      matched: false,
      authorized: false,
    };
  } else {
    // Reuse (or mint) the connection's live session, then probe through the gateway core.
    await getOrCreateSession(conn);
    result = await callOperation(conn, spec.operation, {
      pathParams: spec.pathParams,
      query: spec.query,
      via: "heartbeat",
    });
  }

  // Classification order matters: a simulated outage also reports
  // authorized=false, but it is a transient failure, not a credential one.
  const transient = result.status >= 500 || result.simulated === "unreachable";
  const hardAuthFailure = !transient && !result.authorized;

  let toStatus: ConnectionStatus;
  let reason: string | null;
  let failures: number;
  if (transient) {
    failures = conn.consecutive_failures + 1;
    toStatus = failures >= 3 ? "error" : "degraded";
    reason = errorMessageFrom(result);
  } else if (hardAuthFailure) {
    failures = conn.consecutive_failures + 1;
    toStatus = "error";
    reason = errorMessageFrom(result);
  } else {
    failures = 0;
    toStatus = "connected";
    reason = null;
  }
  const ok = toStatus === "connected";
  const changed = conn.status !== toStatus;

  await tryQuery(
    `update ${SCHEMA}.adapter_connections
        set status = $2, status_reason = $3, consecutive_failures = $4,
            last_heartbeat_at = now(), updated_at = now()
      where connection_id = $1`,
    [conn.connection_id, toStatus, reason, failures]
  );

  const opName = spec?.operation ?? "(none)";
  await insertConnectionEvent({
    connectionId: conn.connection_id,
    toolId: conn.tool_id,
    kind: "heartbeat",
    detail: ok
      ? `heartbeat ok — ${opName} ${result.status} in ${result.latencyMs}ms`
      : `heartbeat failed — ${opName} ${result.status}: ${reason} (streak ${failures})`,
    data: {
      operation: opName,
      status: result.status,
      latencyMs: result.latencyMs,
      ok,
      consecutiveFailures: failures,
      ...(result.simulated ? { simulated: result.simulated } : {}),
    },
  });
  if (changed) {
    await insertConnectionEvent({
      connectionId: conn.connection_id,
      toolId: conn.tool_id,
      kind: "status_change",
      fromStatus: conn.status,
      toStatus,
      detail: ok ? "heartbeat ok" : reason,
    });
  }

  return { ok, status: toStatus, statusReason: reason, latencyMs: result.latencyMs, changed, httpStatus: result.status };
}

/**
 * Run every due heartbeat exactly once. Candidates: enabled connections not
 * disabled whose next_heartbeat_at is unset or in the past. Each is claimed by
 * advancing next_heartbeat_at while it is STILL due (atomic claim, mirroring
 * lib/engine/scheduler.ts:122) — a concurrent tick matches 0 rows and skips.
 */
export async function runDueHeartbeats(): Promise<HeartbeatSummary> {
  if (!dbAvailable()) return { checked: 0, ran: 0, transitions: 0 };

  const due = await tryQuery<ConnectionDbRow>(
    `select * from ${SCHEMA}.adapter_connections
      where enabled = true and status <> 'disabled'
        and (next_heartbeat_at is null or next_heartbeat_at <= now())
      order by next_heartbeat_at asc nulls first
      limit ${MAX_PER_TICK}`
  );

  let ran = 0;
  let transitions = 0;
  for (const candidate of due) {
    const claimed = await tryQuery<ConnectionDbRow>(
      `update ${SCHEMA}.adapter_connections
          set next_heartbeat_at = now() + greatest(heartbeat_interval_ms, ${HEARTBEAT_FLOOR_MS}) * interval '1 millisecond'
        where connection_id = $1
          and enabled = true and status <> 'disabled'
          and (next_heartbeat_at is null or next_heartbeat_at <= now())
        returning *`,
      [candidate.connection_id]
    );
    const conn = claimed[0];
    if (!conn) continue; // another tick already claimed this probe
    ran++;
    const outcome = await heartbeatConnection(conn).catch(() => null);
    if (outcome?.changed) transitions++;
  }

  return { checked: due.length, ran, transitions };
}
