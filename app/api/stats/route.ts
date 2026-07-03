import { requireApiUser } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { tryQuery, dbAvailable, SCHEMA } from "@/lib/db";
import { catalogStats } from "@/lib/stats";
import type { DbStats } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dbStats(): Promise<DbStats> {
  const empty: DbStats = { reachable: false, totalRequests: 0, last24h: 0, errorRate: 0, byStatusClass: [], topTools: [] };
  if (!dbAvailable()) return empty;

  const [totals] = await tryQuery<{ total: string; last24h: string; errors: string }>(
    `select count(*)::text total,
            count(*) filter (where created_at > now() - interval '24 hours')::text last24h,
            count(*) filter (where status >= 400)::text errors
     from ${SCHEMA}.request_logs`
  );
  if (!totals) return empty;

  const byStatusClass = await tryQuery<{ class: string; count: string }>(
    `select (status/100)::text || 'xx' as class, count(*)::text count
       from ${SCHEMA}.request_logs group by status/100 order by class`
  );
  const topTools = await tryQuery<{ tool_id: string; count: string }>(
    `select coalesce(tool_id, tool_slug, 'unknown') tool_id, count(*)::text count
       from ${SCHEMA}.request_logs group by 1 order by count(*) desc limit 6`
  );

  const total = Number(totals.total) || 0;
  const errors = Number(totals.errors) || 0;
  return {
    reachable: true,
    totalRequests: total,
    last24h: Number(totals.last24h) || 0,
    errorRate: total ? errors / total : 0,
    byStatusClass: byStatusClass.map((r) => ({ class: r.class, count: Number(r.count) })),
    topTools: topTools.map((r) => ({ tool_id: r.tool_id, count: Number(r.count) })),
  };
}

export async function GET() {
  const _auth = await requireApiUser();
  if ("res" in _auth) return _auth.res;
  const [db] = await Promise.all([dbStats()]);
  return NextResponse.json({ catalog: catalogStats(), db });
}
