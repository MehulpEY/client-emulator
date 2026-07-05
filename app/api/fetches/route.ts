// GET /api/fetches?connection=&tool=&limit= — the discovery fetch history
// (PLAN §4.3, W3). Newest first; degrades to { reachable: false } offline.

import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable, tryQuery, SCHEMA } from "@/lib/db";
import { fetchRunRowFromDb, type FetchRunDbRow } from "@/lib/adapters/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export async function GET(req: NextRequest) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ reachable: false, runs: [] });

  const sp = req.nextUrl.searchParams;
  const connection = sp.get("connection");
  const tool = sp.get("tool");
  const limit = Math.min(Math.max(1, Number(sp.get("limit")) || DEFAULT_LIMIT), MAX_LIMIT);

  const where: string[] = [];
  const params: unknown[] = [];
  if (connection) {
    params.push(connection);
    where.push(`connection_id = $${params.length}`);
  }
  if (tool) {
    params.push(tool);
    where.push(`tool_id = $${params.length}`);
  }
  params.push(limit);

  const rows = await tryQuery<FetchRunDbRow>(
    `select * from ${SCHEMA}.fetch_runs
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by started_at desc
      limit $${params.length}`,
    params
  );
  return NextResponse.json({ reachable: true, runs: rows.map(fetchRunRowFromDb) });
}
