import type {
  StatsResponse, LogRow, HealthResponse, ApiKeyRow,
  SubscriptionRow, DeliveryRow, EventTypeView, DemoEvent, PublishResult, GeneratorRow,
  ToolStateResponse,
} from "./types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
});

export const api = {
  health: () => j<HealthResponse>("/api/health"),
  stats: () => j<StatsResponse>("/api/stats"),
  logs: (params: { tool?: string; limit?: number; status?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.tool) qs.set("tool", params.tool);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.status) qs.set("status", params.status);
    if (params.q) qs.set("q", params.q);
    const s = qs.toString();
    return j<{ reachable: boolean; logs: LogRow[] }>(`/api/logs${s ? "?" + s : ""}`);
  },
  clearLogs: (tool?: string) => j<{ ok: boolean; deleted: number }>(`/api/logs${tool ? "?tool=" + encodeURIComponent(tool) : ""}`, { method: "DELETE" }),
  keys: (tool?: string) => j<{ reachable: boolean; keys: ApiKeyRow[] }>(`/api/keys${tool ? "?tool=" + encodeURIComponent(tool) : ""}`),
  createKey: (body: { tool_id?: string | null; label?: string }) => j<{ ok: boolean; key: ApiKeyRow }>("/api/keys", post(body)),

  // ── pub/sub ──────────────────────────────────────────────────────────────
  subscriptions: (tool?: string) => j<{ reachable: boolean; subscriptions: SubscriptionRow[] }>(`/api/subscriptions${tool ? "?tool=" + encodeURIComponent(tool) : ""}`),
  createSubscription: (body: { tool_id?: string | null; event_type?: string; target_url: string; description?: string }) =>
    j<{ ok: boolean; subscription?: SubscriptionRow; error?: string }>("/api/subscriptions", post(body)),
  toggleSubscription: (id: string, active: boolean) =>
    j<{ ok: boolean }>(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) }),
  deleteSubscription: (id: string) => j<{ ok: boolean }>(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  eventTypes: (tool: string) => j<{ tool: string; events: EventTypeView[] }>(`/api/events/types?tool=${encodeURIComponent(tool)}`),
  publishEvent: (body: { tool_id: string; event_type: string; payload?: any }) => j<PublishResult>("/api/events/publish", post(body)),
  deliveries: (params: { tool?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.tool) qs.set("tool", params.tool);
    if (params.status) qs.set("status", params.status);
    if (params.limit) qs.set("limit", String(params.limit));
    const s = qs.toString();
    return j<{ reachable: boolean; deliveries: DeliveryRow[] }>(`/api/events/deliveries${s ? "?" + s : ""}`);
  },
  clearDeliveries: () => j<{ ok: boolean; deleted: number }>("/api/events/deliveries", { method: "DELETE" }),
  demoInbox: () => j<{ count: number; events: DemoEvent[] }>("/api/consumer/demo"),
  clearDemoInbox: () => j<{ ok: boolean }>("/api/consumer/demo", { method: "DELETE" }),

  // ── generators (scheduled simulators) ────────────────────────────────────
  generators: (tool?: string) => j<{ reachable: boolean; generators: GeneratorRow[] }>(`/api/generators${tool ? "?tool=" + encodeURIComponent(tool) : ""}`),
  createGenerator: (body: { tool_id: string; event_type: string; mode: "fixed" | "random"; interval_ms?: number; min_ms?: number; max_ms?: number; description?: string }) =>
    j<{ ok: boolean; generator?: GeneratorRow; error?: string }>("/api/generators", post(body)),
  toggleGenerator: (id: string, active: boolean) =>
    j<{ ok: boolean }>(`/api/generators/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) }),
  deleteGenerator: (id: string) => j<{ ok: boolean }>(`/api/generators/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runGenerator: (id: string) => j<{ ok: boolean; result?: PublishResult; error?: string }>(`/api/generators/${encodeURIComponent(id)}/run`, post()),

  // ── persisted state (resource store) ─────────────────────────────────────
  toolState: (tool: string) => j<ToolStateResponse>(`/api/resources/${encodeURIComponent(tool)}`),
  clearState: (tool: string, collection?: string) =>
    j<{ ok: boolean }>(`/api/resources/${encodeURIComponent(tool)}${collection ? "?collection=" + encodeURIComponent(collection) : ""}`, { method: "DELETE" }),
};
