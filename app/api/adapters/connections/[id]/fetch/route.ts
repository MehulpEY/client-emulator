// POST /api/adapters/connections/[id]/fetch — run a discovery cycle NOW
// (PLAN §4.3, W3). Awaited: the response carries the finished run so the UI
// can show records/steps immediately.

import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { dbAvailable } from "@/lib/db";
import { adapterMeta } from "@/lib/adapters/meta";
import { loadConnection } from "@/lib/adapters/gateway-core";
import { executeFetch } from "@/lib/adapters/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });

  const conn = await loadConnection(params.id);
  if (!conn) return NextResponse.json({ ok: false, error: "unknown connection" }, { status: 404 });
  if (!conn.enabled || conn.status === "disabled") {
    return NextResponse.json({ ok: false, error: "connection is disabled" }, { status: 409 });
  }
  const meta = adapterMeta(conn.tool_id);
  if (!meta || meta.fetchSteps.length === 0) {
    return NextResponse.json({ ok: false, error: "adapter has no fetch steps (enrichment-only)" }, { status: 409 });
  }

  const run = await executeFetch(conn, "manual");
  return NextResponse.json({
    ok: run.status !== "failed",
    run,
    ...(run.error ? { error: run.error } : {}),
  });
}
