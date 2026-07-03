import { requireApiUser } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { q, tryQuery, dbAvailable, SCHEMA } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import { buildEventPayload } from "@/lib/tools/events";
import { publishEvent } from "@/lib/engine/events";
import type { GeneratorRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fire a generator once, immediately (manual "run now"). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const _auth = await requireApiUser();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const [gen] = await tryQuery<GeneratorRow>(`select * from ${SCHEMA}.generators where generator_id = $1`, [params.id]);
  if (!gen) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const tool = getTool(gen.tool_id);
  if (!tool) return NextResponse.json({ ok: false, error: "unknown tool" }, { status: 400 });

  const data = gen.payload_override ?? buildEventPayload(tool, gen.event_type);
  const result = await publishEvent({ toolId: tool.id, toolSlug: tool.id, eventType: gen.event_type, data, source: "simulator" });
  await q(`update ${SCHEMA}.generators set run_count = run_count + 1, last_run_at = now() where generator_id = $1`, [params.id]).catch(() => {});
  return NextResponse.json({ ok: true, result });
}
