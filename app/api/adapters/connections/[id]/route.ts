import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, requireApiUser } from "@/lib/auth/guard";
import { dbAvailable } from "@/lib/db";
import { deleteConnection, getConnection, toApiRow, updateConnection } from "@/lib/adapters/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/adapters/connections/[id] — read/patch/delete one connection.
// The static "connections" segment wins over the sibling [tool] route, so
// this path never collides with /api/adapters/[tool] (PLAN §4.3 note).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });

  const row = await getConnection(params.id);
  if (!row) return NextResponse.json({ ok: false, error: "connection not found" }, { status: 404 });
  return NextResponse.json({ ok: true, connection: toApiRow(row) });
}

// PATCH accepts label / notes / params / enabled / fetchEnabled /
// fetchIntervalMs / heartbeatIntervalMs / simulate. Param updates re-validate
// against the spec and keep the provisioned __secret; enable/disable and
// simulate changes drive the credential + session lifecycle (PLAN §4.1/§4.2).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  try {
    const result = await updateConnection(params.id, body ?? {});
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, problems: result.problems },
        { status: result.notFound ? 404 : 400 }
      );
    }
    return NextResponse.json({ ok: true, connection: toApiRow(result.row) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });

  try {
    const result = await deleteConnection(params.id);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: params.id });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "delete failed" }, { status: 500 });
  }
}
