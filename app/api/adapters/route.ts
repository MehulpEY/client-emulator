import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable, tryQuery, SCHEMA } from "@/lib/db";
import { TOOLS } from "@/lib/tools/registry";
import { buildAdapterSummary, type ConnectionRollupRow } from "@/lib/adapters/connections";
import type { AdapterSummary } from "@/lib/adapters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/adapters — the adapters catalog (PLAN §4.3): every registry tool
// joined with its AdapterMeta plus live rollups from adapter_connections
// (counts by status, last fetch, total records). The catalog itself is code —
// with the DB offline the grid still renders, rollups degrade to zeros.
export async function GET() {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;

  const reachable = dbAvailable();
  const rollups = reachable
    ? await tryQuery<ConnectionRollupRow>(
        `select tool_id, status, last_fetch_at, total_records from ${SCHEMA}.adapter_connections`
      )
    : [];

  const byTool = new Map<string, ConnectionRollupRow[]>();
  for (const r of rollups) {
    const list = byTool.get(r.tool_id);
    if (list) list.push(r);
    else byTool.set(r.tool_id, [r]);
  }

  const adapters: AdapterSummary[] = TOOLS.map((t) => buildAdapterSummary(t, byTool.get(t.id) ?? []));
  return NextResponse.json({ reachable, adapters });
}
