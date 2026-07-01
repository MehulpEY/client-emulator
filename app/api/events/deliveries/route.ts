import { NextRequest, NextResponse } from "next/server";
import { tryQuery, q, dbAvailable, SCHEMA } from "@/lib/db";
import type { DeliveryRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ reachable: false, deliveries: [] });
  const sp = req.nextUrl.searchParams;
  const tool = sp.get("tool");
  const status = sp.get("status");
  const limit = Math.min(Number(sp.get("limit")) || 50, 200);

  const where: string[] = [];
  const p: any[] = [];
  if (tool) { p.push(tool); where.push(`(tool_id = $${p.length} or tool_slug = $${p.length})`); }
  if (status) { p.push(status); where.push(`status = $${p.length}`); }
  p.push(limit);

  const deliveries = await tryQuery<DeliveryRow>(
    `select * from ${SCHEMA}.event_deliveries ${where.length ? "where " + where.join(" and ") : ""}
     order by created_at desc limit $${p.length}`,
    p
  );
  return NextResponse.json({ reachable: true, deliveries });
}

export async function DELETE() {
  if (!dbAvailable()) return NextResponse.json({ ok: false, deleted: 0 });
  try {
    const rows = await q<{ count: string }>(`with d as (delete from ${SCHEMA}.event_deliveries returning 1) select count(*)::text from d`);
    return NextResponse.json({ ok: true, deleted: Number(rows[0]?.count) || 0 });
  } catch {
    return NextResponse.json({ ok: false, deleted: 0 });
  }
}
