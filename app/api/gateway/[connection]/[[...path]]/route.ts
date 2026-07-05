// ============================================================================
// The singular gateway endpoint (PLAN §3, §4.3, §6 W2) — every tool, one URL:
//
//   GET  /api/gateway/<connection>            -> connection descriptor
//   ALL  /api/gateway/<connection>/<tool path> -> proxy through the connection
//
// Public like /api/mock/* (middleware-exempted): the connection itself embodies
// the credential. gateway-core resolves the tool, injects the connection's
// provisioned secret in the tool's own auth scheme, honors simulate faults and
// runs the real mock engine — which also writes the request trace, so this
// route adds NO duplicate log row; it only annotates response headers.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { loadConnection, callThroughConnection, resolveOperation, buildPath } from "@/lib/adapters/gateway-core";
import { getOrCreateSession, currentSession } from "@/lib/adapters/sessions";
import { adapterMeta, secretParamKeys } from "@/lib/adapters/meta";
import { getTool } from "@/lib/tools/registry";
import type { ToolDef, ToolEndpoint } from "@/lib/tools/types";
import { dbAvailable } from "@/lib/db";
import type { ConnectionDbRow, ConnectionRow, GatewayCallInput } from "@/lib/adapters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -- helpers (mirrors app/api/mock/[tool]/[[...path]]/route.ts) ---------------

async function parseBody(req: NextRequest): Promise<any> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) return await req.json();
    const text = await req.text();
    if (!text) return undefined;
    if (ct.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(text));
    }
    // best-effort JSON, else raw text
    try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 4000) }; }
  } catch {
    return undefined;
  }
}

/** DB row -> API camelCase row with secrets redacted (PLAN §4.2). */
function redactConnection(conn: ConnectionDbRow): ConnectionRow {
  const meta = adapterMeta(conn.tool_id);
  const secretKeys = meta ? secretParamKeys(meta) : new Set<string>();
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(conn.params ?? {})) {
    if (key === "__secret") continue; // server-only, stripped entirely
    params[key] = secretKeys.has(key) ? "•••" : value;
  }
  return {
    connectionId: conn.connection_id,
    toolId: conn.tool_id,
    label: conn.label,
    notes: conn.notes,
    params,
    status: conn.status,
    statusReason: conn.status_reason,
    enabled: conn.enabled,
    fetchEnabled: conn.fetch_enabled,
    fetchIntervalMs: conn.fetch_interval_ms,
    nextFetchAt: conn.next_fetch_at,
    lastFetchAt: conn.last_fetch_at,
    heartbeatIntervalMs: conn.heartbeat_interval_ms,
    lastHeartbeatAt: conn.last_heartbeat_at,
    consecutiveFailures: conn.consecutive_failures,
    simulate: conn.simulate,
    totalFetches: conn.total_fetches,
    totalRecords: conn.total_records,
    sessionsIssued: conn.sessions_issued,
    sessionReuses: conn.session_reuses,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  };
}

/** A real, callable endpoint of the tool for the descriptor's example curl. */
function exampleCall(tool: ToolDef, conn: ConnectionDbRow, origin: string): string {
  const hb = adapterMeta(conn.tool_id)?.heartbeat;
  const hbEndpoint = hb ? resolveOperation(tool, hb.operation) : undefined;
  const endpoint: ToolEndpoint | undefined =
    hbEndpoint ?? tool.endpoints.find((e) => e.method === "GET") ?? tool.endpoints[0];
  if (!endpoint) return `curl -s "${origin}/api/gateway/${conn.connection_id}"`;

  const path = buildPath(endpoint.path, hbEndpoint ? hb?.pathParams : undefined);
  const qs = hbEndpoint && hb?.query ? `?${new URLSearchParams(hb.query).toString()}` : "";
  const url = `${origin}/api/gateway/${conn.connection_id}${path}${qs}`;
  if (endpoint.method === "GET") return `curl -s "${url}"`;
  const data = endpoint.request !== undefined ? ` -d '${JSON.stringify(endpoint.request)}'` : "";
  return `curl -s -X ${endpoint.method} "${url}" -H "content-type: application/json"${data}`;
}

// -- the handler --------------------------------------------------------------

async function handle(req: NextRequest, ctx: { params: { connection: string; path?: string[] } }): Promise<NextResponse> {
  if (!dbAvailable()) {
    return NextResponse.json({ error: "database unavailable" }, { status: 503 });
  }

  const connectionId = ctx.params.connection;
  const conn = await loadConnection(connectionId);
  if (!conn) {
    // tryQuery degrades to null on DB failure — if the lookup itself tripped
    // the breaker report the outage, otherwise the id really is unknown.
    if (!dbAvailable()) return NextResponse.json({ error: "database unavailable" }, { status: 503 });
    return NextResponse.json({ error: `Unknown connection "${connectionId}"` }, { status: 404 });
  }

  if (!conn.enabled || conn.status === "disabled") {
    return NextResponse.json(
      {
        error: `Connection "${conn.label}" is disabled`,
        hint: `Re-enable it via PATCH /api/adapters/connections/${conn.connection_id} {"enabled":true} or the adapters UI, then retry.`,
      },
      { status: 409 }
    );
  }

  if (conn.status === "error") {
    // Callers see the broken-vendor reality, not a painted-over proxy.
    return NextResponse.json(
      { error: conn.status_reason || `Connection "${conn.label}" is in error state` },
      { status: 503 }
    );
  }

  const tool = getTool(conn.tool_id);
  if (!tool) {
    return NextResponse.json({ error: `Connection "${conn.connection_id}" references unknown tool "${conn.tool_id}"` }, { status: 404 });
  }

  const segments = ctx.params.path ?? [];

  // Bare connection URL -> the descriptor (GET /api/gateway/[connection]).
  if (segments.length === 0) {
    return NextResponse.json({
      ok: true,
      connection: redactConnection(conn),
      tool: { id: tool.id, name: tool.name, vendor: tool.vendor },
      session: await currentSession(conn.connection_id),
      exampleCurl: exampleCall(tool, conn, req.nextUrl.origin),
    });
  }

  // With a tool path -> proxy through the connection. The session is acquired
  // (reused when live) before the call, exactly like heartbeats and fetches.
  const session = await getOrCreateSession(conn);
  const result = await callThroughConnection(conn, {
    method: req.method as GatewayCallInput["method"],
    path: "/" + segments.join("/"),
    query: Object.fromEntries(req.nextUrl.searchParams.entries()),
    body: await parseBody(req),
    via: "gateway_api",
  });

  // gateway-core already wrote the request trace — only annotate headers here.
  return NextResponse.json(result.body ?? null, {
    status: result.status,
    headers: {
      ...result.headers,
      "x-emu-connection": conn.connection_id,
      "x-emu-tool": conn.tool_id,
      "x-emu-session-reused": session.reused ? "true" : "false",
      "x-emu-session-expires": session.expiresAt,
    },
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
