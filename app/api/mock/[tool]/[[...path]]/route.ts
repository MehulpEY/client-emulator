import { NextRequest, NextResponse } from "next/server";
import type { HttpMethod } from "@/lib/tools/types";
import { getTool } from "@/lib/tools/registry";
import { basePath } from "@/lib/tools/types";
import { runEngine } from "@/lib/engine/engine";
import { logRequest } from "@/lib/engine/log";
import { publishEvent } from "@/lib/engine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function headerObject(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => { out[k] = v; });
  return out;
}

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

async function handle(req: NextRequest, ctx: { params: { tool: string; path?: string[] } }): Promise<NextResponse> {
  const toolSlug = ctx.params.tool;
  const pathSegments = ctx.params.path ?? [];
  const method = req.method as HttpMethod;
  const query = Object.fromEntries(req.nextUrl.searchParams.entries());
  const headers = headerObject(req);
  const body = await parseBody(req);
  const fullPath = basePath(toolSlug) + (pathSegments.length ? "/" + pathSegments.join("/") : "");

  const tool = getTool(toolSlug);

  // Unknown tool -> 404, still logged so it shows up in the trace.
  if (!tool) {
    const outcome = {
      status: 404, body: { error: { code: 404, message: `Unknown tool "${toolSlug}"`, emulated: true } },
      headers: {}, matched: false, authorized: false, open: false, params: {}, latencyMs: 0,
    };
    await logRequest({ toolId: null, toolSlug, method, path: fullPath, query, headers, body, outcome });
    return NextResponse.json(outcome.body, { status: 404 });
  }

  // Base path with no subpath -> a friendly "tool is live" descriptor.
  if (pathSegments.length === 0) {
    return NextResponse.json({
      emulated: true,
      tool: { id: tool.id, name: tool.name, vendor: tool.vendor, category: tool.category },
      message: `${tool.name} emulator is live. Call one of the endpoints below.`,
      auth: tool.auth,
      endpoints: tool.endpoints.map((e) => ({ method: e.method, path: basePath(tool.id) + e.path, operation: e.operation })),
    });
  }

  const outcome = await runEngine({ tool, method, pathSegments, query, headers, body });
  await logRequest({ toolId: tool.id, toolSlug, method, path: fullPath, query, headers, body, outcome });

  // Activity trigger: a successful mutating call publishes to subscribers. Fire-
  // and-forget - the `next start` event loop drains it without blocking the call.
  if (outcome.emitEvent) {
    void publishEvent({ toolId: tool.id, toolSlug, eventType: outcome.emitEvent, data: outcome.body, source: "activity" }).catch(() => {});
  }

  return NextResponse.json(outcome.body, { status: outcome.status, headers: outcome.headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
