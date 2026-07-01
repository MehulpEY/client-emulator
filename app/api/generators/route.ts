import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { tryQuery, q, dbAvailable, SCHEMA } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import { startScheduler, reloadScheduler } from "@/lib/engine/scheduler";
import type { GeneratorRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN = 2000;

export async function GET(req: NextRequest) {
  startScheduler(); // safety net if instrumentation didn't run
  if (!dbAvailable()) return NextResponse.json({ reachable: false, generators: [] });
  const tool = req.nextUrl.searchParams.get("tool");
  const rows = tool
    ? await tryQuery<GeneratorRow>(`select * from ${SCHEMA}.generators where tool_id = $1 order by created_at desc`, [tool])
    : await tryQuery<GeneratorRow>(`select * from ${SCHEMA}.generators order by created_at desc`);
  return NextResponse.json({ reachable: true, generators: rows });
}

export async function POST(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  const tool = getTool(body.tool_id);
  if (!tool) return NextResponse.json({ ok: false, error: "unknown tool" }, { status: 400 });
  const eventType: string = (body.event_type || "").trim();
  if (!eventType) return NextResponse.json({ ok: false, error: "event_type required" }, { status: 400 });
  const mode: "fixed" | "random" = body.mode === "random" ? "random" : "fixed";

  let interval_ms: number | null = null;
  let min_ms: number | null = null;
  let max_ms: number | null = null;
  if (mode === "fixed") {
    interval_ms = Math.max(MIN, Number(body.interval_ms) || 0);
    if (!interval_ms) return NextResponse.json({ ok: false, error: "interval_ms required (>= 2000)" }, { status: 400 });
  } else {
    min_ms = Math.max(MIN, Number(body.min_ms) || 0);
    max_ms = Math.max(min_ms, Number(body.max_ms) || 0);
    if (!min_ms || !max_ms) return NextResponse.json({ ok: false, error: "min_ms and max_ms required (>= 2000)" }, { status: 400 });
  }

  const id = `gen_${randomBytes(8).toString("hex")}`;
  const firstDelay = mode === "random" ? (min_ms as number) : (interval_ms as number);
  const nextRun = new Date(Date.now() + firstDelay).toISOString();
  const description: string | null = body.description ? String(body.description).slice(0, 200) : null;

  try {
    const rows = await q<GeneratorRow>(
      `insert into ${SCHEMA}.generators (generator_id, tool_id, event_type, mode, interval_ms, min_ms, max_ms, active, next_run_at, description)
       values ($1,$2,$3,$4,$5,$6,$7,true,$8,$9) returning *`,
      [id, tool.id, eventType, mode, interval_ms, min_ms, max_ms, nextRun, description]
    );
    startScheduler();
    await reloadScheduler();
    return NextResponse.json({ ok: true, generator: rows[0] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "insert failed" }, { status: 500 });
  }
}
