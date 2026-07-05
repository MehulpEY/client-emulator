import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/guard";
import { dbAvailable } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import { createConnection, toApiRow } from "@/lib/adapters/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/adapters/[tool]/connections — create a connection (admin).
// Validates params against the adapter's connectionParams spec, provisions the
// real api_keys credential (PLAN §4.2), and — with saveAndFetch — queues the
// first discovery immediately.
export async function POST(req: NextRequest, { params }: { params: { tool: string } }) {
  const auth = await requireApiAdmin();
  if ("res" in auth) return auth.res;

  const tool = getTool(params.tool);
  if (!tool) return NextResponse.json({ ok: false, error: `unknown tool "${params.tool}"` }, { status: 404 });
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  try {
    const result = await createConnection(tool.id, body ?? {});
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, problems: result.problems }, { status: 400 });
    }
    return NextResponse.json({ ok: true, connection: toApiRow(result.row) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "create failed" }, { status: 500 });
  }
}
