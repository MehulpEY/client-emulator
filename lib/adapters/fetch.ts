// ============================================================================
// Discovery fetch cycle (W3, PLAN §6): one run = one session + the adapter's
// fetchSteps called through gateway-core (so real engine auth, scenarios,
// latency, logging and connection-level fault injection all apply), records
// extracted by recordsPath, normalized per tool, correlated into assets.
// History lands in fetch_runs; lifecycle breadcrumbs in connection_events.
// ============================================================================

import { tryQuery, SCHEMA } from "../db";
import { getTool } from "../tools/registry";
import { adapterMeta } from "./meta";
import { buildPath, callOperation, resolveOperation } from "./gateway-core";
import { getOrCreateSession } from "./sessions";
import { runId as newRunId } from "./ids";
import { normalizerFor } from "./normalize";
import { upsertRecords } from "./assets";
import type {
  AssetType, ConnectionDbRow, FetchRunRow, FetchRunStatus, FetchRunStep, FetchTrigger,
} from "./types";

// -- DB row shape + mapper (used here and by /api/fetches) ---------------------

export interface FetchRunDbRow {
  run_id: string;
  connection_id: string;
  tool_id: string;
  trigger: FetchTrigger;
  status: FetchRunStatus;
  started_at: string | Date;
  finished_at: string | Date | null;
  duration_ms: number | null;
  requests_made: number;
  session_reused: boolean;
  records_by_type: Partial<Record<AssetType, number>>;
  total_records: number;
  error: string | null;
  steps: FetchRunStep[];
}

const iso = (v: string | Date | null | undefined): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v) : null;

export function fetchRunRowFromDb(row: FetchRunDbRow): FetchRunRow {
  return {
    runId: row.run_id,
    connectionId: row.connection_id,
    toolId: row.tool_id,
    trigger: row.trigger,
    status: row.status,
    startedAt: iso(row.started_at) ?? new Date(0).toISOString(),
    finishedAt: iso(row.finished_at),
    durationMs: row.duration_ms,
    requestsMade: row.requests_made,
    sessionReused: row.session_reused,
    recordsByType: row.records_by_type ?? {},
    totalRecords: row.total_records,
    error: row.error,
    steps: Array.isArray(row.steps) ? row.steps : [],
  };
}

// -- record extraction ---------------------------------------------------------

/**
 * Walk a dot-path to the records array ("$" = the body itself). Tolerates two
 * vendor envelope quirks: Trellix ePO's `OK:\n<json>` text bodies, and
 * XML-derived wrappers that hold the list one level deeper (Qualys
 * `HOST_LIST` = `{ HOST: [...] }`, single records collapsed to an object).
 * Returns null when the path doesn't resolve (-> step error, empty records).
 */
export function extractRecords(body: unknown, recordsPath: string): unknown[] | null {
  let node: unknown = body;
  if (typeof node === "string") {
    const text = node.startsWith("OK:") ? node.slice(3).trimStart() : node;
    try {
      node = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (recordsPath !== "$") {
    for (const seg of recordsPath.split(".")) {
      if (node !== null && typeof node === "object" && !Array.isArray(node) && seg in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[seg];
      } else {
        return null;
      }
    }
  }
  if (Array.isArray(node)) return node;
  if (node !== null && typeof node === "object") {
    const children = Object.values(node as Record<string, unknown>);
    const arrays = children.filter(Array.isArray) as unknown[][];
    if (arrays.length === 1) return arrays[0];
    if (children.length === 1 && children[0] !== null && typeof children[0] === "object") return [children[0]];
  }
  return null;
}

/** Human error out of an engine/vendor error body. */
function errorMessageFrom(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  const obj = body as { error?: { message?: unknown }; message?: unknown } | null;
  const msg = obj?.error?.message ?? obj?.message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  return `HTTP ${status}`;
}

const event = (
  conn: ConnectionDbRow,
  kind: "fetch_started" | "fetch_finished" | "status_change",
  detail: string,
  data: Record<string, unknown> | null = null,
  fromStatus: string | null = null,
  toStatus: string | null = null
) =>
  tryQuery(
    `insert into ${SCHEMA}.connection_events (connection_id, tool_id, kind, from_status, to_status, detail, data)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [conn.connection_id, conn.tool_id, kind, fromStatus, toStatus, detail, data ? JSON.stringify(data) : null]
  );

// -- the run -------------------------------------------------------------------

/**
 * Execute one discovery run for a connection. Never throws; the returned
 * FetchRunRow is the finished run (status success/partial/failed). All
 * persistence is best-effort so a DB outage degrades to an unrecorded run.
 */
export async function executeFetch(conn: ConnectionDbRow, trigger: FetchTrigger): Promise<FetchRunRow> {
  const meta = adapterMeta(conn.tool_id);
  const fetchSteps = meta?.fetchSteps ?? [];
  const tool = getTool(conn.tool_id);
  const id = newRunId();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  await tryQuery(
    `insert into ${SCHEMA}.fetch_runs (run_id, connection_id, tool_id, trigger, status)
     values ($1, $2, $3, $4, 'running')`,
    [id, conn.connection_id, conn.tool_id, trigger]
  );
  await event(conn, "fetch_started", `discovery run ${id} started (${trigger})`, { runId: id, trigger });

  // ONE session spans the whole run — the observable-reuse claim (PLAN §1 #3).
  const session = await getOrCreateSession(conn);

  const steps: FetchRunStep[] = [];
  const recordsByType: Partial<Record<AssetType, number>> = {};
  let totalRecords = 0;
  let requestsMade = 0;
  let authFailure: string | null = null;

  for (const step of fetchSteps) {
    const endpoint = tool ? resolveOperation(tool, step.operation) : undefined;
    const path = endpoint ? buildPath(endpoint.path, step.pathParams) : step.operation;
    const t0 = Date.now();
    let status = 0;
    let records = 0;
    let error: string | undefined;
    try {
      const res = await callOperation(conn, step.operation, {
        pathParams: step.pathParams,
        query: step.query,
        via: "fetch",
      });
      requestsMade++;
      status = res.status;
      if (res.matched && !res.authorized) {
        // The engine genuinely rejected the connection's provisioned credential
        // (revoked key / simulate: revoked_credentials) — hard failure (PLAN §4.1).
        error = errorMessageFrom(res.body, res.status);
        authFailure = authFailure ?? error;
      } else if (!res.matched || res.status >= 400) {
        error = errorMessageFrom(res.body, res.status);
      } else {
        const raw = extractRecords(res.body, step.recordsPath);
        if (raw === null) {
          error = `recordsPath "${step.recordsPath}" not found in ${step.operation} response`;
        } else {
          const normalized = normalizerFor(conn.tool_id)(step, raw);
          const { byType, total } = await upsertRecords(conn, id, normalized);
          records = total;
          totalRecords += total;
          for (const [type, n] of Object.entries(byType)) {
            recordsByType[type as AssetType] = (recordsByType[type as AssetType] ?? 0) + (n ?? 0);
          }
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    steps.push({ op: step.operation, path, status, ms: Date.now() - t0, records, ...(error ? { error } : {}) });
  }

  const failed = steps.filter((s) => s.error);
  const status: FetchRunStatus =
    failed.length === 0 ? "success" : failed.length < steps.length ? "partial" : "failed";
  const error = status === "failed" ? failed[0]?.error ?? null : null;
  const durationMs = Date.now() - startedAtMs;
  const finishedAt = new Date().toISOString();

  await tryQuery(
    `update ${SCHEMA}.fetch_runs
        set status = $2, finished_at = now(), duration_ms = $3, requests_made = $4,
            session_reused = $5, records_by_type = $6::jsonb, total_records = $7,
            error = $8, steps = $9::jsonb
      where run_id = $1`,
    [id, status, durationMs, requestsMade, session.reused, JSON.stringify(recordsByType), totalRecords, error, JSON.stringify(steps)]
  );
  await tryQuery(
    `update ${SCHEMA}.adapter_connections
        set total_fetches = total_fetches + 1,
            total_records = total_records + $2,
            last_fetch_at = now(),
            next_fetch_at = now() + (fetch_interval_ms || ' milliseconds')::interval,
            updated_at = now()
      where connection_id = $1`,
    [conn.connection_id, totalRecords]
  );
  await event(
    conn,
    "fetch_finished",
    `discovery run ${id} ${status}: ${totalRecords} record(s) across ${steps.length} step(s) in ${durationMs}ms`,
    { runId: id, trigger, status, totalRecords, recordsByType, requestsMade, durationMs }
  );

  // An auth-failed step means the credential itself is bad -> error immediately
  // (PLAN §4.1). Claimed atomically so we only log a transition that happened.
  if (authFailure) {
    const flipped = await tryQuery<{ connection_id: string }>(
      `update ${SCHEMA}.adapter_connections
          set status = 'error', status_reason = $2, updated_at = now()
        where connection_id = $1 and status not in ('error', 'disabled')
        returning connection_id`,
      [conn.connection_id, authFailure]
    );
    if (flipped.length > 0) {
      await event(conn, "status_change", `fetch auth failure: ${authFailure}`, { runId: id }, conn.status, "error");
    }
  }

  return {
    runId: id,
    connectionId: conn.connection_id,
    toolId: conn.tool_id,
    trigger,
    status,
    startedAt,
    finishedAt,
    durationMs,
    requestsMade,
    sessionReused: session.reused,
    recordsByType,
    totalRecords,
    error,
    steps,
  };
}
