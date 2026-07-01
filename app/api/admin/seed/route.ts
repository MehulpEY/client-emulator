import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { q, dbAvailable, SCHEMA } from "@/lib/db";
import { TOOLS } from "@/lib/tools/registry";
import { basePath } from "@/lib/tools/types";
import { invalidateRuntimeCache } from "@/lib/engine/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Build a multi-row VALUES clause + flat params for a chunk of rows. */
function bulk(rows: any[][], cols: number): { placeholders: string; params: any[] } {
  const params: any[] = [];
  const groups = rows.map((row, r) => {
    const ph = row.map((_, c) => `$${r * cols + c + 1}`).join(",");
    params.push(...row);
    return `(${ph})`;
  });
  return { placeholders: groups.join(","), params };
}

// Mirror the code catalog (source of truth) into Supabase, and ensure a master
// API key exists. Idempotent: re-running UPSERTs identical rows. Bulk-inserts so
// the whole catalog lands in a couple of round-trips, not one per row.
async function seed() {
  const toolRows = TOOLS.map((t) => [
    t.id, t.name, t.vendor ?? null, t.category, t.summary, t.tags ?? [], t.aiTool ?? false, t.crafted ?? false,
    basePath(t.id), t.auth?.type ?? "none", t.auth?.param ?? null, t.docsUrl ?? null, t.defaultLatencyMs ?? 0, t.failureRate ?? 0, true,
  ]);
  const tb = bulk(toolRows, 15);
  await q(
    `insert into ${SCHEMA}.tools (tool_id, name, vendor, category, summary, tags, ai_tool, crafted, base_path, auth_type, auth_param, docs_url, default_latency_ms, failure_rate, enabled)
     values ${tb.placeholders}
     on conflict (tool_id) do update set
       name=excluded.name, vendor=excluded.vendor, category=excluded.category, summary=excluded.summary,
       tags=excluded.tags, ai_tool=excluded.ai_tool, crafted=excluded.crafted, base_path=excluded.base_path,
       auth_type=excluded.auth_type, auth_param=excluded.auth_param, docs_url=excluded.docs_url,
       default_latency_ms=excluded.default_latency_ms, failure_rate=excluded.failure_rate`,
    tb.params
  );

  const endpointRows: any[][] = [];
  for (const t of TOOLS) {
    let sort = 0;
    for (const e of t.endpoints) {
      endpointRows.push([
        `${t.id}__${e.method}__${e.path}`.replace(/[^a-zA-Z0-9_/{}.-]/g, "_"),
        t.id, e.method, e.path, e.operation, e.summary, e.aiTool ?? false,
        JSON.stringify(e.request ?? {}),
        JSON.stringify(e.responseExample ?? (typeof e.respond === "function" ? { dynamic: true } : {})),
        sort++,
      ]);
    }
  }
  // Chunk to stay well under the parameter limit even if the catalog grows.
  const endpointN = endpointRows.length;
  for (let i = 0; i < endpointRows.length; i += 80) {
    const eb = bulk(endpointRows.slice(i, i + 80), 10);
    await q(
      `insert into ${SCHEMA}.endpoints (endpoint_id, tool_id, method, path, operation, summary, ai_tool, request_example, response_example, sort)
       values ${eb.placeholders}
       on conflict (tool_id, method, path) do update set
         endpoint_id=excluded.endpoint_id, operation=excluded.operation, summary=excluded.summary,
         ai_tool=excluded.ai_tool, request_example=excluded.request_example, response_example=excluded.response_example, sort=excluded.sort`,
      eb.params
    );
  }

  // Master key (works for every tool) — create one if none exists.
  const [{ count }] = await q<{ count: string }>(`select count(*)::text count from ${SCHEMA}.api_keys where tool_id is null`);
  let masterSecret: string | undefined;
  if (Number(count) === 0) {
    masterSecret = `emu_master_${randomBytes(20).toString("hex")}`;
    await q(`insert into ${SCHEMA}.api_keys (key_id, tool_id, secret, label, active) values ($1,null,$2,'master',true)`, [
      `key_${randomBytes(8).toString("hex")}`,
      masterSecret,
    ]);
  } else {
    const [row] = await q<{ secret: string }>(`select secret from ${SCHEMA}.api_keys where tool_id is null order by created_at asc limit 1`);
    masterSecret = row?.secret;
  }

  invalidateRuntimeCache();
  return { tools: TOOLS.length, endpoints: endpointN, masterKey: masterSecret };
}

export async function POST() {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  try {
    const result = await seed();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "POST to this endpoint to seed the catalog + master key into Supabase." });
}
