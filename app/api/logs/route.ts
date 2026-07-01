import { NextRequest, NextResponse } from "next/server";
import { tryQuery, q, dbAvailable, SCHEMA } from "@/lib/db";
import type { LogRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ reachable: false, logs: [] });

  const sp = req.nextUrl.searchParams;
  const tool = sp.get("tool");
  const status = sp.get("status"); // "2xx" | "4xx" | "5xx" | exact code
  const search = sp.get("q");
  const limit = Math.min(Number(sp.get("limit")) || 50, 200);

  const where: string[] = [];
  const params: any[] = [];
  if (tool) { params.push(tool); where.push(`(tool_id = $${params.length} or tool_slug = $${params.length})`); }
  if (status) {
    if (/^\dxx$/.test(status)) { params.push(Number(status[0])); where.push(`status / 100 = $${params.length}`); }
    else if (/^\d{3}$/.test(status)) { params.push(Number(status)); where.push(`status = $${params.length}`); }
  }
  if (search) { params.push(`%${search}%`); where.push(`(path ilike $${params.length} or operation ilike $${params.length} or tool_slug ilike $${params.length})`); }

  params.push(limit);
  const logs = await tryQuery<LogRow>(
    `select * from ${SCHEMA}.request_logs ${where.length ? "where " + where.join(" and ") : ""}
     order by created_at desc limit $${params.length}`,
    params
  );
  return NextResponse.json({ reachable: true, logs });
}

export async function DELETE(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, deleted: 0 });
  const tool = req.nextUrl.searchParams.get("tool");
  try {
    const rows = tool
      ? await q<{ count: string }>(`with d as (delete from ${SCHEMA}.request_logs where tool_id = $1 or tool_slug = $1 returning 1) select count(*)::text from d`, [tool])
      : await q<{ count: string }>(`with d as (delete from ${SCHEMA}.request_logs returning 1) select count(*)::text from d`);
    return NextResponse.json({ ok: true, deleted: Number(rows[0]?.count) || 0 });
  } catch {
    return NextResponse.json({ ok: false, deleted: 0 });
  }
}
