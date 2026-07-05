import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable, tryQuery, SCHEMA } from "@/lib/db";
import { toApiEventRow, type ConnectionEventDbRow } from "@/lib/adapters/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/adapters/connections/[id]/events?limit= — the lifecycle trail
// (created, tests, heartbeats, status changes, sessions, simulate flips,
// deleted). Events use soft refs, so the trail of a deleted connection is
// still readable. DB offline degrades to an empty list.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;

  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_LIMIT, Math.round(raw)) : DEFAULT_LIMIT;

  if (!dbAvailable()) return NextResponse.json({ ok: false, events: [] });

  const rows = await tryQuery<ConnectionEventDbRow>(
    `select * from ${SCHEMA}.connection_events
      where connection_id = $1
      order by created_at desc, event_id desc
      limit $2`,
    [params.id, limit]
  );
  return NextResponse.json({ ok: true, events: rows.map(toApiEventRow) });
}
