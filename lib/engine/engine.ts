import type { ToolDef, HttpMethod, MockContext } from "../tools/types";
import { matchEndpoint } from "./match";
import { expandTemplates } from "./templating";
import { checkAuth, activeScenario } from "./runtime";

export interface EngineInput {
  tool: ToolDef;
  method: HttpMethod;
  pathSegments: string[];
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
}

export interface EngineOutcome {
  status: number;
  body: any;
  headers: Record<string, string>;
  matched: boolean;
  authorized: boolean;
  open: boolean;
  operation?: string;
  endpointPath?: string;
  params: Record<string, string>;
  scenario?: string;
  latencyMs: number;
  /** Set on a successful mutating call -> publish this event to subscribers. */
  emitEvent?: string;
}

const MAX_LATENCY = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, Math.min(ms, MAX_LATENCY))));

function errorBody(tool: ToolDef, status: number, message: string) {
  return { error: { code: status, status, message, tool: tool.id }, emulated: true };
}

export async function runEngine(input: EngineInput): Promise<EngineOutcome> {
  const { tool, method, pathSegments, query, headers, body } = input;
  const started = Date.now();
  const base = { params: {} as Record<string, string>, latencyMs: 0, open: false };

  const match = matchEndpoint(tool, method, pathSegments);

  // No path match at all -> 404.
  if (!match) {
    return { ...base, status: 404, body: errorBody(tool, 404, `No emulated endpoint for ${method} ${"/" + pathSegments.join("/")}`), headers: {}, matched: false, authorized: false };
  }
  // Path matched but method differs -> 405.
  if (match.params.__wrongMethod) {
    const { __wrongMethod, ...params } = match.params;
    return { ...base, params, status: 405, body: errorBody(tool, 405, `Method ${method} not allowed on this endpoint`), headers: {}, matched: false, authorized: false };
  }

  const endpoint = match.endpoint;
  const params = match.params;

  // Auth.
  const auth = await checkAuth(tool, headers, query);
  if (!auth.authorized) {
    return {
      ...base, params, open: auth.open, status: 401,
      body: errorBody(tool, 401, "Missing or invalid API credentials"),
      headers: {}, matched: true, authorized: false, operation: endpoint.operation, endpointPath: endpoint.path,
      latencyMs: Date.now() - started,
    };
  }

  // Scenario overrides (fault injection).
  const scenario = await activeScenario(tool);
  const latency = scenario.latencyMs ?? tool.defaultLatencyMs ?? 0;
  await sleep(latency);

  if (typeof scenario.forceStatus === "number") {
    return {
      ...base, params, open: auth.open, status: scenario.forceStatus,
      body: scenario.forceBody ?? errorBody(tool, scenario.forceStatus, `Forced by scenario "${scenario.name}"`),
      headers: {}, matched: true, authorized: true, operation: endpoint.operation, endpointPath: endpoint.path,
      scenario: scenario.name, latencyMs: Date.now() - started,
    };
  }
  const failRate = scenario.failureRate ?? tool.failureRate ?? 0;
  if (failRate > 0 && Math.random() < failRate) {
    return {
      ...base, params, open: auth.open, status: 503,
      body: errorBody(tool, 503, "Service temporarily unavailable (injected failure)"),
      headers: {}, matched: true, authorized: true, operation: endpoint.operation, endpointPath: endpoint.path,
      scenario: scenario.name, latencyMs: Date.now() - started,
    };
  }

  // Generate the response: dynamic handler wins, else expand the static example.
  let status = 200;
  let respBody: any;
  let respHeaders: Record<string, string> = {};
  try {
    if (typeof endpoint.respond === "function") {
      const ctx: MockContext = { method, params, query, body, headers, tool, endpoint };
      const result = await endpoint.respond(ctx);
      status = result.status;
      respBody = result.body;
      respHeaders = result.headers ?? {};
    } else {
      respBody = expandTemplates(endpoint.responseExample ?? { ok: true });
    }
  } catch (err: any) {
    status = 500;
    respBody = errorBody(tool, 500, `Emulator handler error: ${err?.message ?? "unknown"}`);
  }

  // A successful, non-GET call is a state change -> publish an activity event.
  const emitEvent = method !== "GET" && status < 300 ? endpoint.emits || endpoint.operation : undefined;

  return {
    ...base, params, open: auth.open, status, body: respBody, headers: respHeaders,
    matched: true, authorized: true, operation: endpoint.operation, endpointPath: endpoint.path,
    scenario: scenario.name, latencyMs: Date.now() - started, emitEvent,
  };
}
