// Scenario update/delete (PLAN §4.3, §6 W2). Admin-only. PATCH accepts any of
// active / config / name / description (config fully replaces, validated the
// same as create). Every write invalidates the engine's runtime cache.

import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/guard";
import { q, dbAvailable, SCHEMA } from "@/lib/db";
import { invalidateRuntimeCache } from "@/lib/engine/runtime";
import { validateScenarioConfig, type ScenarioRow } from "../validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const _auth = await requireApiAdmin();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  // Build the SET list from the provided fields ($1 is the scenario id;
  // Array.push returns the new length, i.e. each value's placeholder index).
  const sets: string[] = [];
  const vals: unknown[] = [params.id];

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return NextResponse.json({ ok: false, error: "active must be a boolean" }, { status: 400 });
    sets.push(`active = $${vals.push(body.active)}`);
  }
  if (body.name !== undefined) {
    const name = String(body.name ?? "").trim().slice(0, 200);
    if (!name) return NextResponse.json({ ok: false, error: "name cannot be empty" }, { status: 400 });
    sets.push(`name = $${vals.push(name)}`);
  }
  if (body.description !== undefined) {
    const description = body.description == null || body.description === "" ? null : String(body.description).slice(0, 500);
    sets.push(`description = $${vals.push(description)}`);
  }
  if (body.config !== undefined) {
    const cfg = validateScenarioConfig(body.config);
    if (cfg.error) return NextResponse.json({ ok: false, error: cfg.error }, { status: 400 });
    sets.push(`config = $${vals.push(JSON.stringify(cfg.config))}::jsonb`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "nothing to update (accepted: active, config, name, description)" }, { status: 400 });
  }

  try {
    const rows = await q<ScenarioRow>(
      `update ${SCHEMA}.scenarios set ${sets.join(", ")} where scenario_id = $1 returning *`,
      vals
    );
    if (!rows[0]) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    invalidateRuntimeCache(); // engine re-reads active scenarios on the next request
    return NextResponse.json({ ok: true, scenario: rows[0] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const _auth = await requireApiAdmin();
  if ("res" in _auth) return _auth.res;
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  try {
    const rows = await q<{ scenario_id: string }>(
      `delete from ${SCHEMA}.scenarios where scenario_id = $1 returning scenario_id`,
      [params.id]
    );
    if (!rows[0]) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    invalidateRuntimeCache();
    return NextResponse.json({ ok: true, deleted: params.id });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "delete failed" }, { status: 500 });
  }
}
