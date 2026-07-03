// Core types for the tool registry + mock engine. The registry (code) is the
// source of truth for the catalog; Supabase mirrors it and stores runtime data.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AuthType = "api_key_header" | "api_key_query" | "bearer" | "basic" | "none";

export type CategoryId =
  | "ai-security"
  | "threat-intel"
  | "edr"
  | "siem"
  | "network"
  | "identity"
  | "dlp"
  | "vuln-mgmt"
  | "monitoring"
  | "soar"
  | "awareness"
  | "pki"
  | "forensics"
  | "automation"
  | "data-security"
  | "device-mgmt"
  | "enrichment";

/** Runtime context handed to a response generator. */
export interface MockContext {
  method: HttpMethod;
  /** Path params parsed from the matched template, e.g. { id: "abc" }. */
  params: Record<string, string>;
  /** Parsed query-string params. */
  query: Record<string, string>;
  /** Parsed JSON body (or undefined). */
  body: any;
  /** Lowercased request headers. */
  headers: Record<string, string>;
  /** The tool this request is for. */
  tool: ToolDef;
  /** The endpoint that matched. */
  endpoint: ToolEndpoint;
}

export interface MockResult {
  status: number;
  body: any;
  /** Optional extra response headers. */
  headers?: Record<string, string>;
}

/** A documented input parameter for an endpoint (Swagger-like reference). */
export interface EndpointParam {
  /** Field name; use dot paths for nested body fields, e.g. "incident_keys[].incident_id". */
  name: string;
  /** Where it goes on the wire. */
  in: "path" | "query" | "header" | "body";
  /** JSON type: "string" | "integer" | "number" | "boolean" | "array" | "object". */
  type?: string;
  required?: boolean;
  /** Short description of what the field does. */
  description?: string;
  /** Closed set of accepted values, when the field is an enum. */
  enum?: string[];
  /** Human format hint when it's not an enum, e.g. "dd/MM/yyyy HH:mm:ss", "sha256 hash". */
  format?: string;
  /** A representative example value. */
  example?: string | number | boolean;
  /** Value the API assumes when the field is omitted. */
  default?: string | number | boolean;
}

export interface ToolEndpoint {
  method: HttpMethod;
  /** Path relative to the tool base, with `{param}` placeholders. */
  path: string;
  /** Short operation id, e.g. "getFileReport". */
  operation: string;
  summary: string;
  /** Surfaced as an AI-callable tool (n8n "AI tool"). */
  aiTool?: boolean;
  /** Example request (body or params) shown in the docs/try-it console. */
  request?: any;
  /**
   * Authored parameter reference (accepted values, required, descriptions).
   * When present the docs modal renders this instead of auto-deriving from
   * `request`, so enums / allowed values are documented explicitly.
   */
  params?: EndpointParam[];
  /** Static example response - used when `respond` is absent. */
  responseExample?: any;
  /** Dynamic response generator (flagship fidelity). Wins over responseExample. */
  respond?: (ctx: MockContext) => MockResult | Promise<MockResult>;
  /**
   * Event type to publish to subscribers when this endpoint is called
   * successfully. Defaults to the operation name for non-GET endpoints; set
   * explicitly to use a domain event name (e.g. "host.contained").
   */
  emits?: string;
}

/** An event a tool can publish to subscribers (pub/sub). */
export interface ToolEvent {
  /** Dotted event name, e.g. "detection.created". */
  type: string;
  summary: string;
  /** Build a representative payload for a manually-emitted sample of this event. */
  sample: () => any;
  /**
   * If set, firing this event persists its payload as a durable resource in the
   * tool's `collection` (keyed by `idOf(data)`), so the tool's GET endpoints can
   * return it. Persistence happens on every emit - generator, manual, or
   * activity - regardless of whether any subscription matches.
   */
  persist?: { collection: string; idOf: (data: any) => string };
}

export interface ToolDef {
  /** URL slug + primary key, e.g. "virustotal". */
  id: string;
  name: string;
  vendor?: string;
  category: CategoryId;
  summary: string;
  tags?: string[];
  /** Exposes an AI-tool surface (works as an n8n AI tool). */
  aiTool?: boolean;
  /** Hand-authored flagship fidelity (vs. generic scaffold). */
  crafted?: boolean;
  auth?: { type: AuthType; param?: string };
  docsUrl?: string;
  /** Baseline simulated latency (ms) before responding. */
  defaultLatencyMs?: number;
  /** Baseline random 5xx rate, 0..1. */
  failureRate?: number;
  endpoints: ToolEndpoint[];
  /** Domain events this tool can publish to subscribers (pub/sub). */
  events?: ToolEvent[];
}

export function basePath(toolId: string): string {
  return `/api/mock/${toolId}`;
}
