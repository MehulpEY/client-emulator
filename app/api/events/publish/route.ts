import { NextRequest, NextResponse } from "next/server";
import { dbAvailable } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import { buildEventPayload } from "@/lib/tools/events";
import { publishEvent } from "@/lib/engine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manually emit an event for a tool — used by the dashboard "Emit test event"
 *  button and any operator-driven simulation. Awaited so the UI sees the result. */
export async function POST(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  const tool = getTool(body.tool_id);
  if (!tool) return NextResponse.json({ ok: false, error: "unknown tool" }, { status: 400 });
  const eventType: string = (body.event_type || "").trim();
  if (!eventType) return NextResponse.json({ ok: false, error: "event_type required" }, { status: 400 });

  const data = body.payload ?? buildEventPayload(tool, eventType);
  const result = await publishEvent({ toolId: tool.id, toolSlug: tool.id, eventType, data, source: "manual" });
  return NextResponse.json({ ok: true, ...result });
}
