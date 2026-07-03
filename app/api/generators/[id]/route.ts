import { requireApiUser } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { q, dbAvailable, SCHEMA } from "@/lib/db";
import { reloadScheduler } from "@/lib/engine/scheduler";
import type { GeneratorRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const _auth = await requireApiUser();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.active !== "boolean") return NextResponse.json({ ok: false, error: "active (boolean) required" }, { status: 400 });
  try {
    const rows = await q<GeneratorRow>(`update ${SCHEMA}.generators set active = $2 where generator_id = $1 returning *`, [params.id, body.active]);
    if (!rows[0]) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    await reloadScheduler();
    return NextResponse.json({ ok: true, generator: rows[0] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const _auth = await requireApiUser();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  try {
    await q(`delete from ${SCHEMA}.generators where generator_id = $1`, [params.id]);
    await reloadScheduler();
    return NextResponse.json({ ok: true, deleted: params.id });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "delete failed" }, { status: 500 });
  }
}
