// ============================================================================
// Gateway core — call a tool THROUGH a connection (PLAN §3, §4).
// The single choke point used by the public gateway route (W2), heartbeats
// (W1) and fetch cycles (W3). It resolves the connection's tool, injects the
// connection's provisioned credential in the tool's own auth scheme, honors
// connection-level fault injection, runs the real mock engine (so scenarios,
// latency, auth and logging all apply), and records the call in the trace.
// ============================================================================

import type { HttpMethod, ToolDef, ToolEndpoint } from "../tools/types";
import { basePath } from "../tools/types";
import { getTool } from "../tools/registry";
import { runEngine } from "../engine/engine";
import { logRequest } from "../engine/log";
import { publishEvent } from "../engine/events";
import { tryQuery, SCHEMA } from "../db";
import type { ConnectionDbRow, GatewayCallInput, GatewayCallResult } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Load one connection row (params include the server-only __secret). */
export async function loadConnection(connectionId: string): Promise<ConnectionDbRow | null> {
  const rows = await tryQuery<ConnectionDbRow>(
    `select * from ${SCHEMA}.adapter_connections where connection_id = $1`,
    [connectionId]
  );
  return rows[0] ?? null;
}

/** Resolve an operation id to its endpoint on a tool. */
export function resolveOperation(tool: ToolDef, operation: string): ToolEndpoint | undefined {
  return tool.endpoints.find((e) => e.operation === operation);
}

/** Fill `{param}` placeholders in an endpoint path template. */
export function buildPath(template: string, pathParams?: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => encodeURIComponent(pathParams?.[name] ?? `emu-${name}`));
}

/** The connection's provisioned outbound credential (PLAN §4.2). */
export function connectionSecretOf(conn: ConnectionDbRow): string {
  const secret = (conn.params as Record<string, unknown>).__secret;
  return typeof secret === "string" ? secret : "";
}

/** Inject the credential the way the tool's real API expects it. */
export function buildAuthHeaders(
  tool: ToolDef,
  conn: ConnectionDbRow
): { headers: Record<string, string>; query: Record<string, string> } {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const secret = connectionSecretOf(conn);
  const auth = tool.auth;
  if (!auth || auth.type === "none" || !secret) return { headers, query };
  switch (auth.type) {
    case "bearer":
      headers["authorization"] = `Bearer ${secret}`;
      break;
    case "basic": {
      const user = String((conn.params as Record<string, unknown>).username ?? "emulator");
      headers["authorization"] = `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;
      break;
    }
    case "api_key_header":
      headers[(auth.param ?? "x-api-key").toLowerCase()] = secret;
      break;
    case "api_key_query":
      query[auth.param ?? "key"] = secret;
      break;
  }
  return { headers, query };
}

/**
 * Execute one call through a connection. Never throws; failures come back as
 * status/matched/authorized so lifecycle code can classify them (PLAN §4.1).
 */
export async function callThroughConnection(
  conn: ConnectionDbRow,
  input: GatewayCallInput
): Promise<GatewayCallResult> {
  const tool = getTool(conn.tool_id);
  if (!tool) {
    return { status: 404, body: { error: { code: 404, message: `Connection ${conn.connection_id} references unknown tool "${conn.tool_id}"` }, emulated: true }, headers: {}, latencyMs: 0, matched: false, authorized: false };
  }

  // Connection-level fault injection.
  if (conn.simulate === "unreachable") {
    await sleep(400);
    const body = { error: { code: 502, message: `Upstream unreachable (simulated outage on connection ${conn.connection_id})` }, emulated: true };
    return { status: 502, body, headers: {}, latencyMs: 400, matched: false, authorized: false, simulated: "unreachable" };
  }
  const extraLatency = conn.simulate === "slow" ? 2500 : 0;
  if (extraLatency) await sleep(extraLatency);

  const { headers: authHeaders, query: authQuery } = buildAuthHeaders(tool, conn);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...authHeaders,
    "x-emu-via": input.via,
    "x-emu-connection": conn.connection_id,
  };
  const query = { ...(input.query ?? {}), ...authQuery };
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const pathSegments = path.split("/").filter(Boolean);

  const started = Date.now();
  const outcome = await runEngine({
    tool,
    method: input.method as HttpMethod,
    pathSegments,
    query,
    headers,
    body: input.body,
  });

  // Gateway traffic shows up in the same request trace as direct mock calls.
  await logRequest({
    toolId: tool.id,
    toolSlug: tool.id,
    method: input.method,
    path: basePath(tool.id) + path,
    query,
    headers,
    body: input.body,
    outcome,
  });

  // Same activity semantics as the direct mock route: a successful mutating
  // call through the gateway publishes to subscribers (fire-and-forget).
  if (outcome.emitEvent) {
    void publishEvent({ toolId: tool.id, toolSlug: tool.id, eventType: outcome.emitEvent, data: outcome.body, source: "activity" }).catch(() => {});
  }

  return {
    status: outcome.status,
    body: outcome.body,
    headers: outcome.headers,
    latencyMs: (Date.now() - started) + extraLatency,
    matched: outcome.matched,
    authorized: outcome.authorized,
    simulated: conn.simulate === "slow" ? "slow" : undefined,
  };
}

/** Convenience: call a named operation (used by heartbeats and fetch steps). */
export async function callOperation(
  conn: ConnectionDbRow,
  operation: string,
  opts: { pathParams?: Record<string, string>; query?: Record<string, string>; body?: unknown; via: GatewayCallInput["via"] }
): Promise<GatewayCallResult> {
  const tool = getTool(conn.tool_id);
  const endpoint = tool ? resolveOperation(tool, operation) : undefined;
  if (!tool || !endpoint) {
    return { status: 404, body: { error: { code: 404, message: `Unknown operation "${operation}" on tool "${conn.tool_id}"` }, emulated: true }, headers: {}, latencyMs: 0, matched: false, authorized: false };
  }
  return callThroughConnection(conn, {
    method: endpoint.method,
    path: buildPath(endpoint.path, opts.pathParams),
    query: opts.query,
    body: opts.body ?? (endpoint.method === "GET" ? undefined : endpoint.request),
    via: opts.via,
  });
}
