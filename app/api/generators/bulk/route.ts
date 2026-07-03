import { requireApiUser } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { q, dbAvailable, SCHEMA } from "@/lib/db";
import { reloadScheduler } from "@/lib/engine/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk enable/disable generators (start all / stop all), optionally scoped to a
// tool. Body: { active: boolean, tool_id?: string }.
export async function POST(req: NextRequest) {
  const _auth = await requireApiUser();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.active !== "boolean") return NextResponse.json({ ok: false, error: "active (boolean) required" }, { status: 400 });
  const tool: string | null = body.tool_id ?? null;

  try {
    const rows = tool
      ? await q<{ generator_id: string }>(`update ${SCHEMA}.generators set active = $1 where tool_id = $2 returning generator_id`, [body.active, tool])
      : await q<{ generator_id: string }>(`update ${SCHEMA}.generators set active = $1 returning generator_id`, [body.active]);
    await reloadScheduler();
    return NextResponse.json({ ok: true, updated: rows.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "bulk update failed" }, { status: 500 });
  }
}
