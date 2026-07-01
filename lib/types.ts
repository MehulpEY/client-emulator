// Shared types between the API routes and the dashboard UI.

export interface LogRow {
  log_id: string;
  tool_id: string | null;
  tool_slug: string | null;
  operation: string | null;
  method: string;
  path: string;
  query: Record<string, any>;
  request_headers: Record<string, any>;
  request_body: any;
  status: number;
  response_body: any;
  latency_ms: number;
  matched: boolean;
  authorized: boolean;
  scenario: string | null;
  created_at: string;
}

export interface CatalogStats {
  tools: number;
  endpoints: number;
  aiTools: number;
  crafted: number;
  categories: number;
}

export interface DbStats {
  reachable: boolean;
  totalRequests: number;
  last24h: number;
  errorRate: number; // 0..1 over logged requests
  byStatusClass: { class: string; count: number }[];
  topTools: { tool_id: string; count: number }[];
}

export interface StatsResponse {
  catalog: CatalogStats;
  db: DbStats;
}

export interface ApiKeyRow {
  key_id: string;
  tool_id: string | null;
  secret: string;
  label: string;
  active: boolean;
  created_at: string;
}

export interface HealthResponse {
  ok: boolean;
  catalog: CatalogStats;
  db: { configured: boolean; reachable: boolean; schema: string; error?: string; serverTime?: string };
  baseUrl: string;
}

// ── pub/sub ───────────────────────────────────────────────────────────────
export interface SubscriptionRow {
  subscription_id: string;
  tool_id: string | null;
  event_type: string;
  target_url: string;
  secret: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

export interface DeliveryRow {
  delivery_id: string;
  subscription_id: string | null;
  tool_id: string | null;
  tool_slug: string | null;
  event_type: string;
  source: string | null;
  target_url: string;
  payload: any;
  status: "pending" | "delivered" | "failed";
  response_status: number | null;
  response_body: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface EventTypeView {
  type: string;
  summary: string;
  source: "tool" | "activity";
}

export interface DemoEvent {
  received_at: string;
  event: string | null;
  tool: string | null;
  delivery: string | null;
  signature: string | null;
  body: any;
}

export interface PublishResult {
  ok: boolean;
  eventType: string;
  matched: number;
  delivered: number;
  failed: number;
  deliveries: { delivery_id: string; subscription_id: string; target_url: string; status: string; response_status: number | null; attempts: number; error: string | null }[];
}

// ── persisted state (resource store) ───────────────────────────────────────
export interface StoredResource {
  resource_id: string;
  data: any;
  created_at?: string;
  updated_at: string;
}

export interface ToolStateResponse {
  reachable: boolean;
  collections: { collection: string; count: number; last_at: string | null }[];
  recent: { collection: string; resource_id: string; data: any; updated_at: string }[];
}

export interface GeneratorRow {
  generator_id: string;
  tool_id: string;
  event_type: string;
  mode: "fixed" | "random";
  interval_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  payload_override: any;
  active: boolean;
  run_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
  description: string | null;
  created_at: string;
}
