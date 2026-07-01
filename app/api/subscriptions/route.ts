import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { tryQuery, q, dbAvailable, SCHEMA } from "@/lib/db";
import { getTool } from "@/lib/tools/registry";
import { invalidateSubscriptionsCache } from "@/lib/engine/events";
import type { SubscriptionRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ reachable: false, subscriptions: [] });
  const tool = req.nextUrl.searchParams.get("tool");
  const subs = tool
    ? await tryQuery<SubscriptionRow>(`select * from ${SCHEMA}.subscriptions where tool_id = $1 or tool_id is null order by created_at desc`, [tool])
    : await tryQuery<SubscriptionRow>(`select * from ${SCHEMA}.subscriptions order by created_at desc`);
  return NextResponse.json({ reachable: true, subscriptions: subs });
}

export async function POST(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  const toolId: string | null = body.tool_id ?? null;
  if (toolId && !getTool(toolId)) return NextResponse.json({ ok: false, error: "unknown tool" }, { status: 400 });

  const targetUrl: string = (body.target_url || "").trim();
  try { new URL(targetUrl); } catch { return NextResponse.json({ ok: false, error: "target_url must be a valid URL" }, { status: 400 }); }

  const eventType: string = (body.event_type || "*").trim() || "*";
  const description: string | null = body.description ? String(body.description).slice(0, 200) : null;
  const secret = `whsec_${randomBytes(20).toString("hex")}`;
  const id = `sub_${randomBytes(9).toString("hex")}`;

  try {
    const rows = await q<SubscriptionRow>(
      `insert into ${SCHEMA}.subscriptions (subscription_id, tool_id, event_type, target_url, secret, description, active)
       values ($1,$2,$3,$4,$5,$6,true) returning *`,
      [id, toolId, eventType, targetUrl, secret, description]
    );
    invalidateSubscriptionsCache();
    return NextResponse.json({ ok: true, subscription: rows[0] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "insert failed" }, { status: 500 });
  }
}
