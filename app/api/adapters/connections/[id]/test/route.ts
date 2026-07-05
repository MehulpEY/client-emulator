import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable, tryQuery, SCHEMA } from "@/lib/db";
import { applyStatus, getConnection, insertConnectionEvent, HEARTBEAT_FLOOR_MS } from "@/lib/adapters/connections";
import { heartbeatConnection } from "@/lib/adapters/heartbeat";
import type { ConnectionDbRow } from "@/lib/adapters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/adapters/connections/[id]/test — test now (PLAN §4.1): go to
// `connecting`, run one real heartbeat immediately, and land on `connected`
// or `error` with statusReason. Writes 'test' + 'status_change' events.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });

  const row = await getConnection(params.id);
  if (!row) return NextResponse.json({ ok: false, error: "connection not found" }, { status: 404 });
  if (!row.enabled || row.status === "disabled") {
    return NextResponse.json({ ok: false, error: "connection is disabled — enable it to test" }, { status: 409 });
  }

  await insertConnectionEvent({
    connectionId: row.connection_id,
    toolId: row.tool_id,
    kind: "test",
    detail: `manual connectivity test by ${auth.user.email}`,
  });
  await applyStatus(row, "connecting", null, "manual test");
  // Claim the next scheduled slot so the scheduler doesn't double-probe right after.
  await tryQuery(
    `update ${SCHEMA}.adapter_connections
        set next_heartbeat_at = now() + greatest(heartbeat_interval_ms, ${HEARTBEAT_FLOOR_MS}) * interval '1 millisecond'
      where connection_id = $1`,
    [row.connection_id]
  );

  const connecting: ConnectionDbRow = { ...row, status: "connecting", status_reason: null };
  const outcome = await heartbeatConnection(connecting);
  return NextResponse.json({
    ok: outcome.ok,
    status: outcome.status,
    statusReason: outcome.statusReason ?? undefined,
    latencyMs: outcome.latencyMs,
  });
}
