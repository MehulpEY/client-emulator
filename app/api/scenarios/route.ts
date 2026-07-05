// ============================================================================
// Scenarios API (PLAN §4.3, §6 W2) — fault injection management. The table +
// engine hook (lib/engine/runtime.ts activeScenario) predate this route; this
// is the first API over it. GET is any signed-in user; writes are admin-only.
// config allows ONLY the keys the engine honors:
//   latency_ms (0..4000) | failure_rate (0..1) | force_status (100..599) | force_body (any JSON)
// Every write calls invalidateRuntimeCache() so the engine's 10s TTL cache
// picks the change up immediately.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, requireApiUser } from "@/lib/auth/guard";
import { q, tryQuery, dbAvailable, SCHEMA } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import { scnId } from "@/lib/adapters/ids";
import { invalidateRuntimeCache } from "@/lib/engine/runtime";
import { validateScenarioConfig, type ScenarioRow } from "./validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const _auth = await requireApiUser();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ reachable: false, scenarios: [] });
  const tool = req.nextUrl.searchParams.get("tool");
  const rows = tool
    ? await tryQuery<ScenarioRow>(`select * from ${SCHEMA}.scenarios where tool_id = $1 order by created_at desc`, [tool])
    : await tryQuery<ScenarioRow>(`select * from ${SCHEMA}.scenarios order by created_at desc`);
  return NextResponse.json({ reachable: true, scenarios: rows });
}

export async function POST(req: NextRequest) {
  const _auth = await requireApiAdmin();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  const name = String(body.name ?? "").trim().slice(0, 200);
  if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });

  // tool_id: null/absent/"" = global scenario; otherwise it must exist in the registry.
  const toolId: string | null = body.tool_id == null || body.tool_id === "" ? null : String(body.tool_id);
  if (toolId !== null && !getTool(toolId)) {
    return NextResponse.json({ ok: false, error: `unknown tool "${toolId}"` }, { status: 400 });
  }

  const cfg = validateScenarioConfig(body.config);
  if (cfg.error) return NextResponse.json({ ok: false, error: cfg.error }, { status: 400 });

  const description: string | null = body.description ? String(body.description).slice(0, 500) : null;
  const active = body.active === true;

  try {
    const rows = await q<ScenarioRow>(
      `insert into ${SCHEMA}.scenarios (scenario_id, tool_id, name, description, config, active)
       values ($1, $2, $3, $4, $5::jsonb, $6) returning *`,
      [scnId(), toolId, name, description, JSON.stringify(cfg.config), active]
    );
    invalidateRuntimeCache(); // the engine re-reads scenarios on the next request
    return NextResponse.json({ ok: true, scenario: rows[0] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "insert failed" }, { status: 500 });
  }
}
