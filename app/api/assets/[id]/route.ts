// GET /api/assets/[id] — one correlated asset with its full evidence trail:
// every source row (normalized fields + raw vendor record + the correlation
// rule that merged it + the fetch run that carried it). PLAN §4.3, W3.

import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable, tryQuery, SCHEMA } from "@/lib/db";
import {
  assetRowFromDb, assetSourceRowFromDb, type AssetDbRow, type AssetSourceDbRow,
} from "@/lib/adapters/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });

  const rows = await tryQuery<AssetDbRow>(`select * from ${SCHEMA}.assets where asset_id = $1`, [params.id]);
  const asset = rows[0];
  if (!asset) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const sources = await tryQuery<AssetSourceDbRow>(
    `select * from ${SCHEMA}.asset_sources where asset_id = $1 order by last_seen desc, id asc`,
    [params.id]
  );
  return NextResponse.json({ ok: true, asset: assetRowFromDb(asset, sources.map(assetSourceRowFromDb)) });
}
