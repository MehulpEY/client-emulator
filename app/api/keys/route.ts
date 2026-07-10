import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { tryQuery, q, dbAvailable, SCHEMA } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import { invalidateRuntimeCache } from "@/lib/engine/runtime";
import type { ApiKeyRow } from "@/lib/types";
import { requireApiAdmin } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ reachable: false, keys: [] });
  const tool = req.nextUrl.searchParams.get("tool");
  const keys = tool
    ? await tryQuery<ApiKeyRow>(`select * from ${SCHEMA}.api_keys where tool_id = $1 or tool_id is null order by created_at desc`, [tool])
    : await tryQuery<ApiKeyRow>(`select * from ${SCHEMA}.api_keys order by created_at desc`);
  return NextResponse.json({ reachable: true, keys });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const toolId: string | null = body.tool_id ?? null;
  if (toolId && !getTool(toolId)) return NextResponse.json({ ok: false, error: "unknown tool" }, { status: 400 });

  const label: string = (body.label || "default").slice(0, 60);
  const secret = `emu_${toolId ? toolId.replace(/[^a-z0-9]/gi, "").slice(0, 8) : "master"}_${randomBytes(18).toString("hex")}`;
  const keyId = `key_${randomBytes(8).toString("hex")}`;
  try {
    const rows = await q<ApiKeyRow>(
      `insert into ${SCHEMA}.api_keys (key_id, tool_id, secret, label, active) values ($1,$2,$3,$4,true) returning *`,
      [keyId, toolId, secret, label]
    );
    invalidateRuntimeCache();
    return NextResponse.json({ ok: true, key: rows[0] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "insert failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const keyId = req.nextUrl.searchParams.get("id");
  if (!keyId) return NextResponse.json({ ok: false, error: "missing key id" }, { status: 400 });
  try {
    const rows = await q<{ key_id: string }>(
      `delete from ${SCHEMA}.api_keys where key_id = $1 returning key_id`,
      [keyId]
    );
    if (rows.length === 0) return NextResponse.json({ ok: false, error: "unknown key" }, { status: 404 });
    // A removed key changes which tools are gated (dropping the last key for a
    // tool reopens it), so refresh the engine's cached auth view.
    invalidateRuntimeCache();
    return NextResponse.json({ ok: true, deleted: rows.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "delete failed" }, { status: 500 });
  }
}
