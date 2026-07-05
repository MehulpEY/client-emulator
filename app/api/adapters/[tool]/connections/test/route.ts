import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/guard";
import { getTool } from "@/lib/tools/registry";
import { validateConnectionParams } from "@/lib/adapters/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/adapters/[tool]/connections/test — DRY RUN, Axonius "Check Network
// Connectivity" semantics (PLAN §4.3): confirm the tool is reachable in the
// registry and the param payload has a valid shape. NO authentication is
// performed and NOTHING is persisted — it works even with the DB offline.
export async function POST(req: NextRequest, { params }: { params: { tool: string } }) {
  const auth = await requireApiUser();
  if ("res" in auth) return auth.res;

  const tool = getTool(params.tool);
  if (!tool) {
    return NextResponse.json({ ok: false, reachable: false, error: `unknown tool "${params.tool}"` }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { problems } = validateConnectionParams(tool.id, body?.params ?? {});
  return NextResponse.json({
    ok: problems.length === 0,
    reachable: true,
    ...(problems.length > 0 ? { problems } : {}),
  });
}
