// GET /api/assets?type=&q=&tool=&limit= — the correlated inventory
// (PLAN §4.3, W3). Returns the filtered page + facet counts (byType, byTool).
// Facets are computed over the q+type filter (a tool chip narrows the list,
// not the facet base). Degrades to { reachable: false } offline.

import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable, tryQuery, SCHEMA } from "@/lib/db";
import { assetRowFromDb, type AssetDbRow } from "@/lib/adapters/assets";
import type { AssetType } from "@/lib/adapters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const ASSET_TYPES: AssetType[] = ["device", "user", "vulnerability", "software", "saas_app", "alert"];

const EMPTY = { reachable: false, assets: [], total: 0, facets: { byType: {}, byTool: {} } };

/** Composable WHERE over the assets table (aliased `a`). */
function buildWhere(opts: { type?: string | null; q?: string | null; tool?: string | null }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.type) {
    params.push(opts.type);
    where.push(`a.asset_type = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q}%`);
    const i = params.length;
    where.push(`(a.display_name ilike $${i} or a.hostname ilike $${i} or a.email ilike $${i} or a.serial ilike $${i})`);
  }
  if (opts.tool) {
    params.push(opts.tool);
    where.push(`exists (select 1 from ${SCHEMA}.asset_sources s where s.asset_id = a.asset_id and s.tool_id = $${params.length})`);
  }
  return { clause: where.length ? `where ${where.join(" and ")}` : "", params };
}

export async function GET(req: NextRequest) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json(EMPTY);

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  const q = sp.get("q")?.trim() || null;
  const tool = sp.get("tool");
  const limit = Math.min(Math.max(1, Number(sp.get("limit")) || DEFAULT_LIMIT), MAX_LIMIT);
  if (type && !ASSET_TYPES.includes(type as AssetType)) {
    return NextResponse.json({ error: `unknown asset type "${type}"` }, { status: 400 });
  }

  const full = buildWhere({ type, q, tool });
  const facetBase = buildWhere({ type, q });

  const [rows, totals, byTypeRows, byToolRows] = await Promise.all([
    tryQuery<AssetDbRow>(
      `select a.* from ${SCHEMA}.assets a ${full.clause}
        order by a.last_seen desc
        limit $${full.params.length + 1}`,
      [...full.params, limit]
    ),
    tryQuery<{ n: number }>(`select count(*)::int as n from ${SCHEMA}.assets a ${full.clause}`, full.params),
    tryQuery<{ k: AssetType; n: number }>(
      `select a.asset_type as k, count(*)::int as n from ${SCHEMA}.assets a ${facetBase.clause} group by a.asset_type`,
      facetBase.params
    ),
    tryQuery<{ k: string; n: number }>(
      `select s.tool_id as k, count(distinct s.asset_id)::int as n
         from ${SCHEMA}.asset_sources s
        where s.asset_id in (select a.asset_id from ${SCHEMA}.assets a ${facetBase.clause})
        group by s.tool_id`,
      facetBase.params
    ),
  ]);

  const byType: Partial<Record<AssetType, number>> = {};
  for (const r of byTypeRows) byType[r.k] = r.n;
  const byTool: Record<string, number> = {};
  for (const r of byToolRows) byTool[r.k] = r.n;

  return NextResponse.json({
    reachable: true,
    assets: rows.map((r) => assetRowFromDb(r)),
    total: totals[0]?.n ?? rows.length,
    facets: { byType, byTool },
  });
}
