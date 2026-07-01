import { NextRequest, NextResponse } from "next/server";
import { getTool, TOOLS } from "@/lib/tools/registry";
import { toolEventTypes } from "@/lib/tools/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Event types a tool (or every tool) can publish — feeds the subscribe / emit UI. */
export async function GET(req: NextRequest) {
  const toolId = req.nextUrl.searchParams.get("tool");
  if (toolId) {
    const tool = getTool(toolId);
    if (!tool) return NextResponse.json({ ok: false, error: "unknown tool" }, { status: 404 });
    return NextResponse.json({ tool: tool.id, events: toolEventTypes(tool) });
  }
  return NextResponse.json({
    tools: TOOLS.map((t) => ({ id: t.id, name: t.name, events: toolEventTypes(t) })),
  });
}
