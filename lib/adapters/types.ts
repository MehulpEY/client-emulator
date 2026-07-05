// ============================================================================
// Adapter platform — shared contracts. THE source of truth for every
// workstream (see docs/adapter-platform/PLAN.md §4). Import from here;
// never redefine these shapes elsewhere.
// ============================================================================

import type { CategoryId } from "../tools/types";

/** Asset classes an adapter can fetch (Axonius-style taxonomy, subset). */
export type AssetType = "device" | "user" | "vulnerability" | "software" | "saas_app" | "alert";

/** Connection lifecycle states (superset of Axonius success/error/inactive). */
export type ConnectionStatus =
  | "pending"      // created, never successfully tested
  | "connecting"   // test/heartbeat in flight after a change
  | "connected"    // last heartbeat/fetch healthy
  | "degraded"     // recent transient failures (streak 1..2) — Axonius "partially connected"
  | "error"        // hard failure: bad credentials / unreachable / streak >= 3
  | "disabled";    // switched off by the user — Axonius "inactive"

/** Connection-level fault injection ("what if the vendor breaks?"). */
export type ConnectionSimulate = "none" | "revoked_credentials" | "unreachable" | "slow";

export type FetchRunStatus = "running" | "success" | "partial" | "failed";
export type FetchTrigger = "schedule" | "manual" | "test";

/** One field in an adapter's Add Connection form (mirrors Axonius param conventions). */
export interface ConnectionParamSpec {
  key: string;                       // e.g. "domain", "client_id", "api_key"
  label: string;                     // exact UI label, e.g. "CrowdStrike Cloud Domain"
  type: "string" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: string[];                // for select
  default?: string | number | boolean;
}

/** Which tool endpoint a fetch cycle calls and what it yields. */
export interface FetchStepSpec {
  /** Must match a ToolEndpoint.operation on the tool. */
  operation: string;
  assetType: AssetType;
  /**
   * Dot-path to the records array in the response body, e.g. "resources",
   * "value", "HOST_LIST_OUTPUT.RESPONSE.HOST_LIST". "$" means the body itself
   * is the array.
   */
  recordsPath: string;
  /** Concrete values for `{param}` placeholders in the endpoint path. */
  pathParams?: Record<string, string>;
  /** Query string sent with the step call. */
  query?: Record<string, string>;
  /** Shown in the adapter's "APIs used" docs. */
  summary: string;
}

/** The probe a heartbeat runs (a cheap GET on the tool). */
export interface HeartbeatSpec {
  operation: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
}

/** Adapter-layer metadata wrapped around an existing ToolDef. */
export interface AdapterMeta {
  toolId: string;                    // FK -> ToolDef.id
  /** Marketing-style one-liner for the adapters catalog card. */
  blurb: string;
  /** Primary first. Supersets ToolDef.category. */
  categories: CategoryId[];
  assetTypes: AssetType[];
  connectionParams: ConnectionParamSpec[];
  /** Empty => adapter supports connect/heartbeat only (enrichment adapters). */
  fetchSteps: FetchStepSpec[];
  heartbeat: HeartbeatSpec;
  /** Vendor-side roles/scopes shown in the adapter docs. */
  permissionsRequired?: string[];
  /** Mock vendor session TTL (minutes) for the reuse simulation. Default 30. */
  sessionTtlMinutes?: number;
}

/** AdapterMeta joined with live rollups for the catalog page. */
export interface AdapterSummary {
  toolId: string;
  name: string;
  vendor?: string;
  blurb: string;
  categories: CategoryId[];
  assetTypes: AssetType[];
  endpointCount: number;
  connectionCount: number;
  connectionsByStatus: Partial<Record<ConnectionStatus, number>>;
  lastFetchAt?: string | null;
  totalRecords: number;
}

/** Raw DB row (snake_case) — what gateway-core/sessions/heartbeat/fetch read. */
export interface ConnectionDbRow {
  connection_id: string;
  tool_id: string;
  label: string;
  notes: string | null;
  params: Record<string, unknown>;   // includes server-only "__secret"
  status: ConnectionStatus;
  status_reason: string | null;
  enabled: boolean;
  fetch_enabled: boolean;
  fetch_interval_ms: number;
  next_fetch_at: string | null;
  last_fetch_at: string | null;
  heartbeat_interval_ms: number;
  next_heartbeat_at: string | null;
  last_heartbeat_at: string | null;
  consecutive_failures: number;
  simulate: ConnectionSimulate;
  total_fetches: number;
  total_records: number;
  sessions_issued: number;
  session_reuses: number;
  created_at: string;
  updated_at: string;
}

/** API-facing camelCase row. Secrets redacted ("•••") by the API layer. */
export interface ConnectionRow {
  connectionId: string;
  toolId: string;
  label: string;
  notes?: string | null;
  params: Record<string, unknown>;
  status: ConnectionStatus;
  statusReason?: string | null;
  enabled: boolean;
  fetchEnabled: boolean;
  fetchIntervalMs: number;
  nextFetchAt?: string | null;
  lastFetchAt?: string | null;
  heartbeatIntervalMs: number;
  lastHeartbeatAt?: string | null;
  consecutiveFailures: number;
  simulate: ConnectionSimulate;
  totalFetches: number;
  totalRecords: number;
  sessionsIssued: number;
  sessionReuses: number;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionEventKind =
  | "created" | "updated" | "test" | "heartbeat" | "status_change"
  | "session_issued" | "session_reused" | "session_expired"
  | "fetch_started" | "fetch_finished" | "simulate_changed" | "deleted";

export interface ConnectionEventRow {
  eventId: number;
  connectionId: string;
  toolId: string;
  kind: ConnectionEventKind;
  fromStatus?: ConnectionStatus | null;
  toStatus?: ConnectionStatus | null;
  detail?: string | null;
  data?: Record<string, unknown> | null;
  createdAt: string;
}

export interface FetchRunStep {
  op: string;
  path: string;
  status: number;
  ms: number;
  records: number;
  error?: string;
}

export interface FetchRunRow {
  runId: string;
  connectionId: string;
  toolId: string;
  trigger: FetchTrigger;
  status: FetchRunStatus;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  requestsMade: number;
  sessionReused: boolean;
  recordsByType: Partial<Record<AssetType, number>>;
  totalRecords: number;
  error?: string | null;
  steps: FetchRunStep[];
}

export type CorrelationRule = "serial" | "mac" | "hostname" | "email" | "new";

export interface AssetSourceRow {
  toolId: string;
  connectionId: string;
  externalId: string;
  correlationRule?: CorrelationRule | null;
  normalized: Record<string, unknown>;
  raw?: unknown;
  fetchRunId?: string | null;
  firstSeen: string;
  lastSeen: string;
}

export interface AssetRow {
  assetId: string;
  assetType: AssetType;
  displayName: string;
  hostname?: string | null;
  mac?: string | null;
  serial?: string | null;
  email?: string | null;
  externalKeys: Record<string, unknown>;
  summary: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
  sourceCount: number;
  sources?: AssetSourceRow[];
}

/** A record produced by a per-tool normalizer from one vendor payload item. */
export interface NormalizedRecord {
  assetType: AssetType;
  externalId: string;
  displayName: string;
  hostname?: string;
  mac?: string;        // canonical lowercase aa:bb:cc:dd:ee:ff
  serial?: string;
  email?: string;      // upn/email for users
  /** Flat, human-readable normalized fields for the asset drawer. */
  fields: Record<string, string | number | boolean | null>;
  raw: unknown;
}

/** Normalizer signature: one per tool, registered in lib/adapters/normalize/index.ts (W3). */
export type Normalizer = (step: FetchStepSpec, records: unknown[]) => NormalizedRecord[];

// ---------------------------------------------------------------------------
// Gateway (the "singular endpoint")
// ---------------------------------------------------------------------------

export type GatewayVia = "gateway_api" | "fetch" | "heartbeat" | "test";

export interface GatewayCallInput {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path relative to the tool base, e.g. "/devices/queries/devices/v1". */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Who is calling — recorded on logs. */
  via: GatewayVia;
}

export interface GatewayCallResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  latencyMs: number;
  /** Engine flags — false for simulate:unreachable short-circuits. */
  matched: boolean;
  authorized: boolean;
  /** Set when the call never reached the engine (fault injection). */
  simulated?: ConnectionSimulate;
}

export interface SessionInfo {
  sessionId: string;
  token: string;             // mock display token, never the credential
  reused: boolean;
  issuedAt: string;
  expiresAt: string;
  useCount: number;
}
