import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable, tryQuery, SCHEMA } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import {
  buildAdapterSummary,
  listConnections,
  metaOrFallback,
  toApiEventRow,
  toApiRow,
  type ConnectionEventDbRow,
} from "@/lib/adapters/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_EVENTS = 30;

// GET /api/adapters/[tool] — one adapter's detail (PLAN §4.3): meta + summary
// rollup + its connections + the latest lifecycle events across them.
// Meta/summary come from code, so the page renders with the DB offline.
export async function GET(_req: NextRequest, { params }: { params: { tool: string } }) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;

  const tool = getTool(params.tool);
  if (!tool) return NextResponse.json({ error: `unknown tool "${params.tool}"` }, { status: 404 });

  const reachable = dbAvailable();
  const rows = reachable ? await listConnections(tool.id) : [];
  const events = reachable
    ? await tryQuery<ConnectionEventDbRow>(
        `select * from ${SCHEMA}.connection_events
          where tool_id = $1
          order by created_at desc, event_id desc
          limit ${RECENT_EVENTS}`,
        [tool.id]
      )
    : [];

  return NextResponse.json({
    reachable,
    adapter: buildAdapterSummary(tool, rows),
    meta: metaOrFallback(tool),
    connections: rows.map(toApiRow),
    recentEvents: events.map(toApiEventRow),
  });
}
