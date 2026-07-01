import { NextRequest, NextResponse } from "next/server";
import { tryQuery, dbAvailable, SCHEMA } from "@/lib/db";
import { collectionsFor, listResources } from "@/lib/engine/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inspect a tool's persisted state (what its stateful endpoints read from).
//   GET /api/resources/<tool>                     → collections summary + recent
//   GET /api/resources/<tool>?collection=incidents → items in one collection
export async function GET(req: NextRequest, { params }: { params: { tool: string } }) {
  if (!dbAvailable()) return NextResponse.json({ reachable: false, collections: [], recent: [] });

  const url = new URL(req.url);
  const collection = url.searchParams.get("collection");

  if (collection) {
    const { items, total } = await listResources(params.tool, collection, { limit: Number(url.searchParams.get("limit")) || 50 });
    return NextResponse.json({ reachable: true, collection, total, items });
  }

  const collections = await collectionsFor(params.tool);
  const recent = await tryQuery(
    `select collection, resource_id, data, updated_at
       from ${SCHEMA}.resources where tool_id = $1
      order by updated_at desc limit 6`,
    [params.tool]
  );
  return NextResponse.json({ reachable: true, collections, recent });
}

// Clear a tool's state (all collections, or one via ?collection=).
export async function DELETE(req: NextRequest, { params }: { params: { tool: string } }) {
  if (!dbAvailable()) return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  const collection = new URL(req.url).searchParams.get("collection");
  if (collection) {
    await tryQuery(`delete from ${SCHEMA}.resources where tool_id = $1 and collection = $2`, [params.tool, collection]);
  } else {
    await tryQuery(`delete from ${SCHEMA}.resources where tool_id = $1`, [params.tool]);
  }
  return NextResponse.json({ ok: true });
}
