// ============================================================================
// Connections domain (W1) — CRUD, validation, credential provisioning and the
// lifecycle state machine over emulator.adapter_connections.
// Contracts: docs/adapter-platform/PLAN.md §4.1 (state machine), §4.2
// (credential provisioning), §4.3 (API shapes = lib/adapters/types.ts rows).
//
// The loop that makes it real: creating a connection provisions an ACTUAL
// api_keys row (label 'conn:<id>', secret stored server-side in
// params.__secret). Heartbeats/fetches/gateway calls present that secret to
// the engine's real auth check — deactivating the key genuinely 401s.
// ============================================================================

import { randomBytes } from "node:crypto";
import { q, tryQuery, SCHEMA } from "../db";
import { invalidateRuntimeCache } from "../engine/runtime";
import { getTool } from "../tools/registry";
import type { ToolDef } from "../tools/types";
import { adapterMeta, secretParamKeys } from "./meta";
import { resolveOperation } from "./gateway-core";
import { conId, connectionSecret } from "./ids";
import { revokeSessions } from "./sessions";
import type {
  AdapterMeta,
  AdapterSummary,
  ConnectionDbRow,
  ConnectionEventKind,
  ConnectionEventRow,
  ConnectionRow,
  ConnectionSimulate,
  ConnectionStatus,
  HeartbeatSpec,
} from "./types";

// -- limits (PLAN §4.6 floors; notes limit mirrors the Axonius form) ----------
export const HEARTBEAT_FLOOR_MS = 30_000;
export const FETCH_FLOOR_MS = 60_000;
export const NOTES_MAX_CHARS = 250;

const DEFAULT_HEARTBEAT_MS = 60_000; // schema default
const DEFAULT_FETCH_MS = 900_000; //   schema default (15 min discovery cycle)
const LABEL_MAX_CHARS = 120;

const SIMULATE_VALUES: ConnectionSimulate[] = ["none", "revoked_credentials", "unreachable", "slow"];

const REDACTED = "•••";

// ---------------------------------------------------------------------------
// Parameter validation (against the adapter's connectionParams spec)
// ---------------------------------------------------------------------------

export interface ParamValidation {
  problems: string[];
  /** Cleaned params: defaults applied, values coerced. Never contains __secret. */
  params: Record<string, unknown>;
}

/**
 * Validate a caller-supplied params object against the adapter's form spec.
 * Missing required params and unknown keys are errors that NAME the key
 * (Gate B W1). Values are lightly coerced (numeric strings, "true"/"false")
 * so generated forms don't fight over JSON types.
 */
export function validateConnectionParams(toolId: string, input: unknown): ParamValidation {
  const specs = adapterMeta(toolId)?.connectionParams ?? [];
  const problems: string[] = [];
  const params: Record<string, unknown> = {};

  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input))) {
    return { problems: ["params must be a JSON object"], params };
  }
  const given = (input ?? {}) as Record<string, unknown>;
  const byKey = new Map(specs.map((s) => [s.key, s]));

  for (const [key, value] of Object.entries(given)) {
    const spec = byKey.get(key);
    if (!spec) {
      // Also rejects "__secret" — the provisioned credential can never be set by callers.
      problems.push(`unknown parameter "${key}"`);
      continue;
    }
    if (value === undefined || value === null || value === "") continue; // treated as absent
    switch (spec.type) {
      case "number": {
        const n = typeof value === "number" ? value : Number(String(value));
        if (!Number.isFinite(n)) problems.push(`parameter "${key}" must be a number`);
        else params[key] = n;
        break;
      }
      case "boolean": {
        if (typeof value === "boolean") params[key] = value;
        else if (value === "true" || value === "false") params[key] = value === "true";
        else problems.push(`parameter "${key}" must be a boolean`);
        break;
      }
      case "select": {
        const v = String(value);
        if (spec.options && spec.options.length > 0 && !spec.options.includes(v)) {
          problems.push(`parameter "${key}" must be one of: ${spec.options.join(", ")}`);
        } else {
          params[key] = v;
        }
        break;
      }
      default: {
        // string | password
        if (typeof value === "object") problems.push(`parameter "${key}" must be a string`);
        else params[key] = String(value);
      }
    }
  }

  // Defaults first, then required — a spec with a default never fails required.
  for (const spec of specs) {
    if (params[spec.key] === undefined) {
      if (spec.default !== undefined) params[spec.key] = spec.default;
      else if (spec.required) problems.push(`missing required parameter "${spec.key}"`);
    }
  }

  return { problems, params };
}

// ---------------------------------------------------------------------------
// Heartbeat spec resolution + meta fallback (tools without an AdapterMeta yet)
// ---------------------------------------------------------------------------

/** The adapter's heartbeat probe: meta.heartbeat → first GET fetchStep → first GET endpoint. */
export function heartbeatSpecFor(toolId: string): HeartbeatSpec | null {
  const meta = adapterMeta(toolId);
  if (meta?.heartbeat) return meta.heartbeat;
  const tool = getTool(toolId);
  if (!tool) return null;
  if (meta) {
    const step = meta.fetchSteps.find((s) => resolveOperation(tool, s.operation)?.method === "GET");
    if (step) return { operation: step.operation, pathParams: step.pathParams, query: step.query };
  }
  const ep = tool.endpoints.find((e) => e.method === "GET") ?? tool.endpoints[0];
  return ep ? { operation: ep.operation } : null;
}

/** AdapterMeta for a tool, or a minimal synthesized entry (empty params/steps). */
export function metaOrFallback(tool: ToolDef): AdapterMeta {
  return (
    adapterMeta(tool.id) ?? {
      toolId: tool.id,
      blurb: tool.summary,
      categories: [tool.category],
      assetTypes: [],
      connectionParams: [],
      fetchSteps: [],
      heartbeat: heartbeatSpecFor(tool.id) ?? { operation: tool.endpoints[0]?.operation ?? "unknown" },
    }
  );
}

// ---------------------------------------------------------------------------
// API-shape mappers (snake_case DB rows → camelCase contract, secrets redacted)
// ---------------------------------------------------------------------------

/** Redact + map a DB row to the ConnectionRow API contract. Strips __secret and masks password-typed params. */
export function toApiRow(row: ConnectionDbRow): ConnectionRow {
  const meta = adapterMeta(row.tool_id);
  const secrets = meta ? secretParamKeys(meta) : new Set<string>();
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((row.params ?? {}) as Record<string, unknown>)) {
    if (key === "__secret") continue;
    params[key] = secrets.has(key) ? REDACTED : value;
  }
  return {
    connectionId: row.connection_id,
    toolId: row.tool_id,
    label: row.label,
    notes: row.notes,
    params,
    status: row.status,
    statusReason: row.status_reason,
    enabled: row.enabled,
    fetchEnabled: row.fetch_enabled,
    fetchIntervalMs: row.fetch_interval_ms,
    nextFetchAt: row.next_fetch_at,
    lastFetchAt: row.last_fetch_at,
    heartbeatIntervalMs: row.heartbeat_interval_ms,
    lastHeartbeatAt: row.last_heartbeat_at,
    consecutiveFailures: row.consecutive_failures,
    simulate: row.simulate,
    totalFetches: row.total_fetches,
    totalRecords: row.total_records,
    sessionsIssued: row.sessions_issued,
    sessionReuses: row.session_reuses,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Raw connection_events row (snake_case). */
export interface ConnectionEventDbRow {
  event_id: number | string; // bigserial — node-postgres returns int8 as string
  connection_id: string;
  tool_id: string;
  kind: ConnectionEventKind;
  from_status: ConnectionStatus | null;
  to_status: ConnectionStatus | null;
  detail: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export function toApiEventRow(row: ConnectionEventDbRow): ConnectionEventRow {
  return {
    eventId: Number(row.event_id),
    connectionId: row.connection_id,
    toolId: row.tool_id,
    kind: row.kind,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    detail: row.detail,
    data: row.data,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Catalog rollups
// ---------------------------------------------------------------------------

/** The columns the catalog rollup needs (list endpoints select only these). */
export interface ConnectionRollupRow {
  tool_id: string;
  status: ConnectionStatus;
  last_fetch_at: string | null;
  total_records: number;
}

/** AdapterSummary = registry tool + meta + live connection rollups (PLAN §4.3). */
export function buildAdapterSummary(tool: ToolDef, rows: ConnectionRollupRow[]): AdapterSummary {
  const meta = adapterMeta(tool.id);
  const connectionsByStatus: Partial<Record<ConnectionStatus, number>> = {};
  let lastFetchAt: string | null = null;
  let totalRecords = 0;
  for (const r of rows) {
    connectionsByStatus[r.status] = (connectionsByStatus[r.status] ?? 0) + 1;
    totalRecords += Number(r.total_records) || 0;
    if (r.last_fetch_at && (!lastFetchAt || new Date(r.last_fetch_at).getTime() > new Date(lastFetchAt).getTime())) {
      lastFetchAt = r.last_fetch_at;
    }
  }
  return {
    toolId: tool.id,
    name: tool.name,
    vendor: tool.vendor,
    blurb: meta?.blurb ?? tool.summary,
    categories: meta?.categories ?? [tool.category],
    assetTypes: meta?.assetTypes ?? [],
    endpointCount: tool.endpoints.length,
    connectionCount: rows.length,
    connectionsByStatus,
    lastFetchAt,
    totalRecords,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle trail
// ---------------------------------------------------------------------------

export interface ConnectionEventInput {
  connectionId: string;
  toolId: string;
  kind: ConnectionEventKind;
  fromStatus?: ConnectionStatus | null;
  toStatus?: ConnectionStatus | null;
  detail?: string | null;
  data?: Record<string, unknown> | null;
}

/** Best-effort lifecycle-trail insert — must never break the calling flow. */
export async function insertConnectionEvent(e: ConnectionEventInput): Promise<void> {
  await tryQuery(
    `insert into ${SCHEMA}.connection_events (connection_id, tool_id, kind, from_status, to_status, detail, data)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [e.connectionId, e.toolId, e.kind, e.fromStatus ?? null, e.toStatus ?? null, e.detail ?? null, e.data ?? null]
  );
}

/**
 * Set status (+ reason) and record the transition (PLAN §4.1: every transition
 * inserts a status_change event). Returns true when the status actually changed.
 */
export async function applyStatus(
  row: ConnectionDbRow,
  to: ConnectionStatus,
  reason: string | null,
  detail?: string
): Promise<boolean> {
  const changed = row.status !== to;
  await tryQuery(
    `update ${SCHEMA}.adapter_connections set status = $2, status_reason = $3, updated_at = now() where connection_id = $1`,
    [row.connection_id, to, reason]
  );
  if (changed) {
    await insertConnectionEvent({
      connectionId: row.connection_id,
      toolId: row.tool_id,
      kind: "status_change",
      fromStatus: row.status,
      toStatus: to,
      detail: detail ?? reason ?? undefined,
    });
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getConnection(connectionId: string): Promise<ConnectionDbRow | null> {
  const rows = await tryQuery<ConnectionDbRow>(
    `select * from ${SCHEMA}.adapter_connections where connection_id = $1`,
    [connectionId]
  );
  return rows[0] ?? null;
}

export async function listConnections(toolId?: string): Promise<ConnectionDbRow[]> {
  return toolId
    ? tryQuery<ConnectionDbRow>(`select * from ${SCHEMA}.adapter_connections where tool_id = $1 order by created_at desc`, [toolId])
    : tryQuery<ConnectionDbRow>(`select * from ${SCHEMA}.adapter_connections order by created_at desc`);
}

// ---------------------------------------------------------------------------
// Credential provisioning (PLAN §4.2)
// ---------------------------------------------------------------------------

const keyLabelFor = (connectionId: string) => `conn:${connectionId}`;

/**
 * The provisioned api_keys row is active only while the connection is enabled
 * AND not simulating revoked credentials — deactivating it makes the engine
 * genuinely 401 the connection's traffic.
 */
export function desiredKeyActive(row: Pick<ConnectionDbRow, "enabled" | "simulate">): boolean {
  return row.enabled && row.simulate !== "revoked_credentials";
}

async function setProvisionedKeyActive(connectionId: string, active: boolean): Promise<void> {
  await q(`update ${SCHEMA}.api_keys set active = $2 where label = $1`, [keyLabelFor(connectionId), active]);
  invalidateRuntimeCache(); // the engine caches keys for 10s — apply immediately
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type ConnectionMutation =
  | { ok: true; row: ConnectionDbRow }
  | { ok: false; error: string; problems?: string[]; notFound?: boolean };

export interface CreateConnectionInput {
  label?: unknown;
  notes?: unknown;
  params?: unknown;
  saveAndFetch?: unknown;
  fetchEnabled?: unknown;
  fetchIntervalMs?: unknown;
  heartbeatIntervalMs?: unknown;
}

/** Create a connection + provision its real api_keys credential. Throws on DB failure. */
export async function createConnection(toolId: string, input: CreateConnectionInput): Promise<ConnectionMutation> {
  const tool = getTool(toolId);
  if (!tool) return { ok: false, error: `unknown tool "${toolId}"`, notFound: true };

  const problems: string[] = [];
  const label = (typeof input.label === "string" && input.label.trim() ? input.label.trim() : "default").slice(0, LABEL_MAX_CHARS);
  let notes: string | null = null;
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== "string") problems.push("notes must be a string");
    else if (input.notes.trim().length > NOTES_MAX_CHARS) problems.push(`notes must be at most ${NOTES_MAX_CHARS} characters`);
    else notes = input.notes.trim() || null;
  }

  const validated = validateConnectionParams(toolId, input.params);
  problems.push(...validated.problems);
  if (problems.length > 0) return { ok: false, error: problems.join("; "), problems };

  const heartbeatMs = Math.max(HEARTBEAT_FLOOR_MS, Math.round(Number(input.heartbeatIntervalMs)) || DEFAULT_HEARTBEAT_MS);
  const fetchMs = Math.max(FETCH_FLOOR_MS, Math.round(Number(input.fetchIntervalMs)) || DEFAULT_FETCH_MS);
  const fetchEnabled = typeof input.fetchEnabled === "boolean" ? input.fetchEnabled : true;
  const saveAndFetch = input.saveAndFetch === true;

  const connectionId = conId();
  const secret = connectionSecret();
  const params = { ...validated.params, __secret: secret };
  // "Save and Fetch" queues the first discovery immediately; plain save
  // schedules it one interval out. First heartbeat always runs promptly.
  const nextFetchAt = new Date(Date.now() + (saveAndFetch ? 0 : fetchMs)).toISOString();

  const rows = await q<ConnectionDbRow>(
    `insert into ${SCHEMA}.adapter_connections
       (connection_id, tool_id, label, notes, params, status, enabled,
        fetch_enabled, fetch_interval_ms, next_fetch_at,
        heartbeat_interval_ms, next_heartbeat_at)
     values ($1, $2, $3, $4, $5, 'pending', true, $6, $7, $8, $9, now())
     returning *`,
    [connectionId, toolId, label, notes, params, fetchEnabled, fetchMs, nextFetchAt, heartbeatMs]
  );
  const row = rows[0];

  // Provision the REAL outbound credential: a tool-scoped api_keys row whose
  // secret is the same __secret gateway-core injects (PLAN §4.2).
  try {
    await q(
      `insert into ${SCHEMA}.api_keys (key_id, tool_id, secret, label, active) values ($1, $2, $3, $4, true)`,
      [`key_${randomBytes(8).toString("hex")}`, toolId, secret, keyLabelFor(connectionId)]
    );
  } catch (err) {
    // Don't leave a credential-less connection behind.
    await tryQuery(`delete from ${SCHEMA}.adapter_connections where connection_id = $1`, [connectionId]);
    throw err;
  }
  invalidateRuntimeCache();

  await insertConnectionEvent({
    connectionId,
    toolId,
    kind: "created",
    toStatus: "pending",
    detail: `connection created (label "${label}")${saveAndFetch ? " — first fetch queued" : ""}`,
    data: { saveAndFetch },
  });

  return { ok: true, row };
}

export interface UpdateConnectionInput {
  label?: unknown;
  notes?: unknown;
  params?: unknown;
  enabled?: unknown;
  fetchEnabled?: unknown;
  fetchIntervalMs?: unknown;
  heartbeatIntervalMs?: unknown;
  simulate?: unknown;
}

/** Patch a connection per PLAN §4.1/§4.2 (state machine + credential coupling). Throws on DB failure. */
export async function updateConnection(connectionId: string, input: UpdateConnectionInput): Promise<ConnectionMutation> {
  const existing = await q<ConnectionDbRow>(
    `select * from ${SCHEMA}.adapter_connections where connection_id = $1`,
    [connectionId]
  );
  const row = existing[0];
  if (!row) return { ok: false, error: "connection not found", notFound: true };

  const problems: string[] = [];

  let label: string | undefined;
  if (input.label !== undefined) {
    if (typeof input.label !== "string" || !input.label.trim()) problems.push("label must be a non-empty string");
    else label = input.label.trim().slice(0, LABEL_MAX_CHARS);
  }

  let notes: string | null | undefined;
  if (input.notes !== undefined) {
    if (input.notes === null) notes = null;
    else if (typeof input.notes !== "string") problems.push("notes must be a string");
    else if (input.notes.trim().length > NOTES_MAX_CHARS) problems.push(`notes must be at most ${NOTES_MAX_CHARS} characters`);
    else notes = input.notes.trim() || null;
  }

  let params: Record<string, unknown> | undefined;
  if (input.params !== undefined) {
    const validated = validateConnectionParams(row.tool_id, input.params);
    problems.push(...validated.problems);
    // Param updates re-validate but the provisioned credential always survives.
    params = { ...validated.params, __secret: (row.params as Record<string, unknown>).__secret };
  }

  let enabled: boolean | undefined;
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") problems.push("enabled must be a boolean");
    else enabled = input.enabled;
  }

  let fetchEnabled: boolean | undefined;
  if (input.fetchEnabled !== undefined) {
    if (typeof input.fetchEnabled !== "boolean") problems.push("fetchEnabled must be a boolean");
    else fetchEnabled = input.fetchEnabled;
  }

  let fetchIntervalMs: number | undefined;
  if (input.fetchIntervalMs !== undefined) {
    const n = Number(input.fetchIntervalMs);
    if (!Number.isFinite(n)) problems.push("fetchIntervalMs must be a number");
    else fetchIntervalMs = Math.max(FETCH_FLOOR_MS, Math.round(n)); // floor: fetch >= 60000
  }

  let heartbeatIntervalMs: number | undefined;
  if (input.heartbeatIntervalMs !== undefined) {
    const n = Number(input.heartbeatIntervalMs);
    if (!Number.isFinite(n)) problems.push("heartbeatIntervalMs must be a number");
    else heartbeatIntervalMs = Math.max(HEARTBEAT_FLOOR_MS, Math.round(n)); // floor: heartbeat >= 30000
  }

  let simulate: ConnectionSimulate | undefined;
  if (input.simulate !== undefined) {
    if (typeof input.simulate !== "string" || !SIMULATE_VALUES.includes(input.simulate as ConnectionSimulate)) {
      problems.push(`simulate must be one of: ${SIMULATE_VALUES.join(", ")}`);
    } else {
      simulate = input.simulate as ConnectionSimulate;
    }
  }

  if (problems.length > 0) return { ok: false, error: problems.join("; "), problems };

  const finalEnabled = enabled ?? row.enabled;
  const paramsChanged = params !== undefined;
  const enabledChanged = enabled !== undefined && enabled !== row.enabled;
  const simulateChanged = simulate !== undefined && simulate !== row.simulate;

  // -- state machine (PLAN §4.1) ---------------------------------------------
  let status: ConnectionStatus = row.status;
  let statusReason: string | null | undefined; // undefined = keep current
  let heartbeatNow = false;

  if (paramsChanged && finalEnabled && row.status !== "disabled") {
    // Credential/config change → revalidate: back to connecting, probe promptly.
    status = "connecting";
    statusReason = null;
    heartbeatNow = true;
  }
  if (simulateChanged && finalEnabled) heartbeatNow = true; // make the fault (or recovery) visible promptly
  if (enabledChanged) {
    if (!finalEnabled) {
      status = "disabled";
      statusReason = "disabled by user";
    } else {
      status = "connecting"; // disabled --(re-enable)--> connecting
      statusReason = null;
      heartbeatNow = true;
    }
  }

  // -- build the UPDATE -------------------------------------------------------
  const changes: string[] = [];
  const sets: string[] = ["updated_at = now()"];
  const args: unknown[] = [connectionId];
  const bind = (v: unknown): string => {
    args.push(v);
    return `$${args.length}`;
  };

  if (label !== undefined && label !== row.label) {
    sets.push(`label = ${bind(label)}`);
    changes.push("label");
  }
  if (notes !== undefined && notes !== (row.notes ?? null)) {
    sets.push(`notes = ${bind(notes)}`);
    changes.push("notes");
  }
  if (paramsChanged) {
    sets.push(`params = ${bind(params)}`);
    changes.push("params");
  }
  if (enabledChanged) {
    sets.push(`enabled = ${bind(finalEnabled)}`);
    changes.push(finalEnabled ? "enabled" : "disabled");
  }
  if (fetchEnabled !== undefined && fetchEnabled !== row.fetch_enabled) {
    sets.push(`fetch_enabled = ${bind(fetchEnabled)}`);
    changes.push("fetchEnabled");
  }
  if (fetchIntervalMs !== undefined && fetchIntervalMs !== row.fetch_interval_ms) {
    const p = bind(fetchIntervalMs);
    sets.push(`fetch_interval_ms = ${p}`);
    // Never leave the next run further out than one new interval.
    sets.push(`next_fetch_at = least(coalesce(next_fetch_at, now() + ${p}::int * interval '1 millisecond'), now() + ${p}::int * interval '1 millisecond')`);
    changes.push("fetchIntervalMs");
  }
  if (heartbeatIntervalMs !== undefined && heartbeatIntervalMs !== row.heartbeat_interval_ms) {
    const p = bind(heartbeatIntervalMs);
    sets.push(`heartbeat_interval_ms = ${p}`);
    if (!heartbeatNow) {
      sets.push(`next_heartbeat_at = least(coalesce(next_heartbeat_at, now() + ${p}::int * interval '1 millisecond'), now() + ${p}::int * interval '1 millisecond')`);
    }
    changes.push("heartbeatIntervalMs");
  }
  if (simulateChanged) {
    sets.push(`simulate = ${bind(simulate)}`);
    changes.push("simulate");
  }
  if (heartbeatNow) sets.push("next_heartbeat_at = now()");
  if (status !== row.status) sets.push(`status = ${bind(status)}`);
  if (statusReason !== undefined && statusReason !== row.status_reason) sets.push(`status_reason = ${bind(statusReason)}`);

  if (changes.length === 0) return { ok: true, row }; // nothing to do

  const updatedRows = await q<ConnectionDbRow>(
    `update ${SCHEMA}.adapter_connections set ${sets.join(", ")} where connection_id = $1 returning *`,
    args
  );
  const updated = updatedRows[0] ?? row;

  // -- credential coupling (PLAN §4.2) ----------------------------------------
  if (desiredKeyActive(row) !== desiredKeyActive(updated)) {
    await setProvisionedKeyActive(connectionId, desiredKeyActive(updated));
  }
  const revocations: string[] = [];
  if (paramsChanged) revocations.push("credentials updated");
  if (enabledChanged && !updated.enabled) revocations.push("connection disabled");
  if (simulateChanged && updated.simulate === "revoked_credentials") revocations.push("credentials revoked (simulated)");
  if (revocations.length > 0) await revokeSessions(updated, revocations.join("; "));

  // -- lifecycle trail ---------------------------------------------------------
  if (simulateChanged) {
    await insertConnectionEvent({
      connectionId,
      toolId: row.tool_id,
      kind: "simulate_changed",
      detail: `simulate: ${row.simulate} -> ${updated.simulate}`,
      data: { from: row.simulate, to: updated.simulate },
    });
  }
  await insertConnectionEvent({
    connectionId,
    toolId: row.tool_id,
    kind: "updated",
    detail: `updated ${changes.join(", ")}`,
    data: { changes },
  });
  if (updated.status !== row.status) {
    await insertConnectionEvent({
      connectionId,
      toolId: row.tool_id,
      kind: "status_change",
      fromStatus: row.status,
      toStatus: updated.status,
      detail: updated.status === "disabled" ? "disabled by user" : `after update of ${changes.join(", ")}`,
    });
  }

  return { ok: true, row: updated };
}

/** Delete a connection + its provisioned api_keys row. The event trail survives (soft refs). */
export async function deleteConnection(connectionId: string): Promise<ConnectionMutation> {
  const rows = await q<ConnectionDbRow>(
    `select * from ${SCHEMA}.adapter_connections where connection_id = $1`,
    [connectionId]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "connection not found", notFound: true };

  // Trail first — connection_events has no FK, so the record survives deletion.
  await insertConnectionEvent({
    connectionId,
    toolId: row.tool_id,
    kind: "deleted",
    fromStatus: row.status,
    detail: `connection deleted (label "${row.label}")`,
  });
  await revokeSessions(row, "connection deleted");
  await q(`delete from ${SCHEMA}.api_keys where label = $1`, [keyLabelFor(connectionId)]);
  invalidateRuntimeCache();
  await q(`delete from ${SCHEMA}.adapter_connections where connection_id = $1`, [connectionId]); // sessions cascade

  return { ok: true, row };
}
