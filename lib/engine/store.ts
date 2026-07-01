import { tryQuery, dbAvailable, SCHEMA } from "../db";

// Durable per-tool resource store. This is what makes the emulator *stateful*:
// events created by a generator, a manual emit, or an agent's mutating call are
// persisted here (keyed by tool + collection + resource_id), so the tool's normal
// GET endpoints return the same records an agent (or a subscriber) just saw.
//
// A "collection" is a named bucket within a tool, e.g. forcepoint-dlp/incidents.
// All helpers are best-effort: with the DB offline they no-op / return empty.

export interface StoredResource {
  resource_id: string;
  data: any;
  created_at: string;
  updated_at: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** Optional filter on the record's top-level `status` field. */
  status?: string | null;
}

/** Upsert a resource (create, or replace an existing one with the same id). */
export async function putResource(toolId: string, collection: string, resourceId: string, data: any): Promise<void> {
  await tryQuery(
    `insert into ${SCHEMA}.resources (tool_id, collection, resource_id, data)
       values ($1, $2, $3, $4::jsonb)
     on conflict (tool_id, collection, resource_id)
       do update set data = excluded.data, updated_at = now()`,
    [toolId, collection, resourceId, JSON.stringify(data ?? {})]
  );
}

/** Shallow-merge `patch` into an existing resource's data. Returns null if absent. */
export async function patchResource(toolId: string, collection: string, resourceId: string, patch: any): Promise<StoredResource | null> {
  const rows = await tryQuery<StoredResource>(
    `update ${SCHEMA}.resources
        set data = data || $4::jsonb, updated_at = now()
      where tool_id = $1 and collection = $2 and resource_id = $3
      returning resource_id, data, created_at, updated_at`,
    [toolId, collection, resourceId, JSON.stringify(patch ?? {})]
  );
  return rows[0] ?? null;
}

export async function getResource(toolId: string, collection: string, resourceId: string): Promise<StoredResource | null> {
  const rows = await tryQuery<StoredResource>(
    `select resource_id, data, created_at, updated_at
       from ${SCHEMA}.resources
      where tool_id = $1 and collection = $2 and resource_id = $3
      limit 1`,
    [toolId, collection, resourceId]
  );
  return rows[0] ?? null;
}

export async function listResources(toolId: string, collection: string, opts: ListOptions = {}): Promise<{ items: StoredResource[]; total: number }> {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await tryQuery<StoredResource & { total: string }>(
    `select resource_id, data, created_at, updated_at, count(*) over() as total
       from ${SCHEMA}.resources
      where tool_id = $1 and collection = $2
        and ($3::text is null or data->>'status' = $3)
      order by created_at desc
      limit $4 offset $5`,
    [toolId, collection, opts.status ?? null, limit, offset]
  );
  const total = rows[0] ? Number(rows[0].total) : 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total };
}

export async function countResources(toolId: string, collection: string): Promise<number> {
  const rows = await tryQuery<{ n: number }>(
    `select count(*)::int as n from ${SCHEMA}.resources where tool_id = $1 and collection = $2`,
    [toolId, collection]
  );
  return rows[0] ? Number(rows[0].n) : 0;
}

/**
 * Populate a collection with `count` records the first time it's read, so a
 * fresh tool looks realistically populated (like a real system with history)
 * instead of empty. No-op once the collection has anything in it.
 */
export async function ensureSeeded(toolId: string, collection: string, count: number, factory: () => { id: string; data: any }): Promise<void> {
  if (!dbAvailable()) return;
  if ((await countResources(toolId, collection)) > 0) return;
  for (let i = 0; i < count; i++) {
    const { id, data } = factory();
    await putResource(toolId, collection, id, data);
  }
}

/** Summary of every collection a tool has stored (for the dashboard). */
export async function collectionsFor(toolId: string): Promise<{ collection: string; count: number; last_at: string | null }[]> {
  return tryQuery(
    `select collection, count(*)::int as count, max(updated_at) as last_at
       from ${SCHEMA}.resources
      where tool_id = $1
      group by collection
      order by collection`,
    [toolId]
  );
}
