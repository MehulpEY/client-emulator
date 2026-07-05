// Typed client helpers for the adapter-platform APIs (PLAN §4.3). Wave-2 UI
// components call ONLY through these — no ad-hoc fetch URLs in components.
// Mirrors the conventions of lib/api.ts (j/jr/post).

import type {
  AdapterMeta, AdapterSummary, AssetRow, AssetType, ConnectionEventRow,
  ConnectionRow, ConnectionSimulate, FetchRunRow, SessionInfo,
} from "./adapters/types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

/** Returns the parsed body on any status so `{ ok, error }` surfaces instead of throwing. */
async function jr<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  return (await r.json().catch(() => ({ ok: false, error: `request failed (${r.status})` }))) as T;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
});
const patch = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | number | undefined>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export interface ScenarioApiRow {
  scenario_id: string;
  tool_id: string | null;
  name: string;
  description?: string | null;
  config: { latency_ms?: number; failure_rate?: number; force_status?: number; force_body?: unknown };
  active: boolean;
  created_at: string;
}

export interface GatewayDescriptor {
  ok: boolean;
  connection: ConnectionRow;
  tool: { id: string; name: string; vendor?: string };
  session: SessionInfo | null;
  exampleCurl: string;
}

export interface AssetFacets {
  byType: Partial<Record<AssetType, number>>;
  byTool: Record<string, number>;
}

export const adaptersApi = {
  // -- catalog ----------------------------------------------------------------
  list: () => j<{ reachable: boolean; adapters: AdapterSummary[] }>("/api/adapters"),
  get: (tool: string) =>
    j<{ reachable: boolean; adapter: AdapterSummary; meta: AdapterMeta; connections: ConnectionRow[]; recentEvents: ConnectionEventRow[] }>(
      `/api/adapters/${encodeURIComponent(tool)}`),

  // -- connections ------------------------------------------------------------
  createConnection: (tool: string, body: { label: string; notes?: string; params: Record<string, unknown>; saveAndFetch?: boolean; fetchIntervalMs?: number }) =>
    jr<{ ok: boolean; connection?: ConnectionRow; error?: string }>(`/api/adapters/${encodeURIComponent(tool)}/connections`, post(body)),
  dryRunTest: (tool: string, body: { params: Record<string, unknown> }) =>
    jr<{ ok: boolean; reachable?: boolean; problems?: string[]; error?: string }>(`/api/adapters/${encodeURIComponent(tool)}/connections/test`, post(body)),
  connection: (id: string) => j<{ ok: boolean; connection: ConnectionRow }>(`/api/adapters/connections/${encodeURIComponent(id)}`),
  updateConnection: (id: string, body: Partial<{ label: string; notes: string; params: Record<string, unknown>; enabled: boolean; fetchEnabled: boolean; fetchIntervalMs: number; heartbeatIntervalMs: number; simulate: ConnectionSimulate }>) =>
    jr<{ ok: boolean; connection?: ConnectionRow; error?: string }>(`/api/adapters/connections/${encodeURIComponent(id)}`, patch(body)),
  deleteConnection: (id: string) => j<{ ok: boolean }>(`/api/adapters/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testConnection: (id: string) =>
    jr<{ ok: boolean; status?: ConnectionRow["status"]; statusReason?: string; latencyMs?: number; error?: string }>(
      `/api/adapters/connections/${encodeURIComponent(id)}/test`, post()),
  connectionEvents: (id: string, limit = 50) =>
    j<{ ok: boolean; events: ConnectionEventRow[] }>(`/api/adapters/connections/${encodeURIComponent(id)}/events${qs({ limit })}`),

  // -- discovery / fetch history ------------------------------------------------
  runFetch: (id: string) =>
    jr<{ ok: boolean; run?: FetchRunRow; error?: string }>(`/api/adapters/connections/${encodeURIComponent(id)}/fetch`, post()),
  fetches: (params: { connection?: string; tool?: string; limit?: number } = {}) =>
    j<{ reachable: boolean; runs: FetchRunRow[] }>(`/api/fetches${qs(params)}`),

  // -- assets -------------------------------------------------------------------
  assets: (params: { type?: AssetType; q?: string; tool?: string; limit?: number } = {}) =>
    j<{ reachable: boolean; assets: AssetRow[]; total: number; facets: AssetFacets }>(`/api/assets${qs(params)}`),
  asset: (id: string) => j<{ ok: boolean; asset: AssetRow }>(`/api/assets/${encodeURIComponent(id)}`),

  // -- scenarios (fault injection) ------------------------------------------------
  scenarios: (tool?: string) => j<{ reachable: boolean; scenarios: ScenarioApiRow[] }>(`/api/scenarios${qs({ tool })}`),
  createScenario: (body: { tool_id?: string | null; name: string; description?: string; config: ScenarioApiRow["config"]; active?: boolean }) =>
    jr<{ ok: boolean; scenario?: ScenarioApiRow; error?: string }>("/api/scenarios", post(body)),
  updateScenario: (id: string, body: Partial<{ active: boolean; config: ScenarioApiRow["config"]; name: string; description: string }>) =>
    jr<{ ok: boolean; scenario?: ScenarioApiRow; error?: string }>(`/api/scenarios/${encodeURIComponent(id)}`, patch(body)),
  deleteScenario: (id: string) => j<{ ok: boolean }>(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // -- gateway ---------------------------------------------------------------------
  gatewayDescriptor: (id: string) => j<GatewayDescriptor>(`/api/gateway/${encodeURIComponent(id)}`),
};
