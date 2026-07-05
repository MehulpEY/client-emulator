// ============================================================================
// Asset store — normalized records in, correlated inventory out (PLAN §4.5).
// Deterministic, ordered, *explainable* correlation: the rule that merged each
// source is recorded on asset_sources.correlation_rule with the raw evidence
// alongside — the anti-black-box answer to Axonius' correlation complaints.
//
// Rules (first hit wins):
//   device        serial -> mac -> hostname     (keys lowercased at write time)
//   user          email
//   vulnerability one asset per unique (cve|qid + hostname) via a deterministic
//                 external_keys.vulnKey; no asset-to-asset correlation in v1
//
// Concurrency note: records are upserted sequentially with plain statements —
// no transactions. Two *concurrent* runs could in theory both miss a match and
// create twins before either lands (the per-source UNIQUE key still prevents
// duplicate evidence). Fetch runs are claimed one-at-a-time per connection and
// the window is tiny, so v1 accepts the race instead of taking locks.
// ============================================================================

import { tryQuery, SCHEMA } from "../db";
import { astId } from "./ids";
import type {
  AssetRow, AssetSourceRow, AssetType, ConnectionDbRow, CorrelationRule, NormalizedRecord,
} from "./types";

// -- DB row shapes (snake_case; timestamptz arrives as Date via node-postgres) --

export interface AssetDbRow {
  asset_id: string;
  asset_type: AssetType;
  display_name: string;
  hostname: string | null;
  mac: string | null;
  serial: string | null;
  email: string | null;
  external_keys: Record<string, unknown>;
  summary: Record<string, unknown>;
  first_seen: string | Date;
  last_seen: string | Date;
  source_count: number;
}

export interface AssetSourceDbRow {
  id: number | string;
  asset_id: string;
  asset_type: AssetType;
  tool_id: string;
  connection_id: string;
  external_id: string;
  correlation_rule: CorrelationRule | null;
  normalized: Record<string, unknown>;
  raw: unknown;
  fetch_run_id: string | null;
  first_seen: string | Date;
  last_seen: string | Date;
}

const iso = (v: string | Date | null | undefined): string =>
  v instanceof Date ? v.toISOString() : v ? String(v) : new Date(0).toISOString();

export function assetRowFromDb(row: AssetDbRow, sources?: AssetSourceRow[]): AssetRow {
  return {
    assetId: row.asset_id,
    assetType: row.asset_type,
    displayName: row.display_name,
    hostname: row.hostname,
    mac: row.mac,
    serial: row.serial,
    email: row.email,
    externalKeys: row.external_keys ?? {},
    summary: row.summary ?? {},
    firstSeen: iso(row.first_seen),
    lastSeen: iso(row.last_seen),
    sourceCount: row.source_count,
    ...(sources ? { sources } : {}),
  };
}

export function assetSourceRowFromDb(row: AssetSourceDbRow): AssetSourceRow {
  return {
    toolId: row.tool_id,
    connectionId: row.connection_id,
    externalId: row.external_id,
    correlationRule: row.correlation_rule,
    normalized: row.normalized ?? {},
    raw: row.raw,
    fetchRunId: row.fetch_run_id,
    firstSeen: iso(row.first_seen),
    lastSeen: iso(row.last_seen),
  };
}

// -- correlation --------------------------------------------------------------

const lc = (v: string | undefined): string | null => {
  const t = v?.trim().toLowerCase();
  return t ? t : null;
};

/** The vulnerability identity: external key (cve, else qid) + hostname (PLAN §4.5). */
function vulnExternalKeys(rec: NormalizedRecord, hostname: string | null): Record<string, unknown> {
  const cve = typeof rec.fields.cve === "string" ? rec.fields.cve : undefined;
  const qid = rec.fields.qid !== null && rec.fields.qid !== undefined ? String(rec.fields.qid) : undefined;
  const key = (cve ?? (qid ? `qid:${qid}` : rec.externalId)).toLowerCase();
  return {
    ...(cve ? { cve } : {}),
    ...(qid ? { qid } : {}),
    vulnKey: `${key}|${hostname ?? ""}`,
  };
}

interface Keys {
  hostname: string | null;
  mac: string | null;
  serial: string | null;
  email: string | null;
  externalKeys: Record<string, unknown>;
}

/** Ordered match per PLAN §4.5. Returns the matched asset + the rule that hit. */
async function correlate(rec: NormalizedRecord, keys: Keys): Promise<{ assetId: string; rule: CorrelationRule } | null> {
  const probe = async (column: "serial" | "mac" | "hostname" | "email", value: string | null) => {
    if (!value) return null;
    const rows = await tryQuery<{ asset_id: string }>(
      `select asset_id from ${SCHEMA}.assets
        where asset_type = $1 and ${column} = $2
        order by first_seen asc limit 1`,
      [rec.assetType, value]
    );
    return rows[0]?.asset_id ?? null;
  };

  if (rec.assetType === "device") {
    for (const rule of ["serial", "mac", "hostname"] as const) {
      const assetId = await probe(rule, keys[rule]);
      if (assetId) return { assetId, rule };
    }
    return null;
  }
  if (rec.assetType === "user") {
    const assetId = await probe("email", keys.email);
    return assetId ? { assetId, rule: "email" } : null;
  }
  if (rec.assetType === "vulnerability") {
    const rows = await tryQuery<{ asset_id: string }>(
      `select asset_id from ${SCHEMA}.assets
        where asset_type = 'vulnerability' and external_keys->>'vulnKey' = $1
        order by first_seen asc limit 1`,
      [String(keys.externalKeys.vulnKey ?? "")]
    );
    // The vuln identity is (external key + hostname); hostname is its asset-level
    // component, and the closest name the frozen CorrelationRule union offers.
    return rows[0] ? { assetId: rows[0].asset_id, rule: "hostname" } : null;
  }
  // software / saas_app / alert: no cross-source rules in v1 — per-source assets.
  return null;
}

// -- upsert -------------------------------------------------------------------

async function upsertOne(conn: ConnectionDbRow, runId: string | null, rec: NormalizedRecord): Promise<boolean> {
  if (!rec.externalId) return false; // no stable identity -> unupsertable
  const keys: Keys = {
    hostname: lc(rec.hostname),
    mac: lc(rec.mac),
    serial: lc(rec.serial),
    email: lc(rec.email),
    externalKeys: rec.assetType === "vulnerability" ? vulnExternalKeys(rec, lc(rec.hostname)) : {},
  };
  const displayName = rec.displayName?.trim() || rec.externalId;
  const summaryJson = JSON.stringify(rec.fields ?? {});
  const rawJson = JSON.stringify(rec.raw ?? {});
  const extKeysJson = JSON.stringify(keys.externalKeys);

  // 1. Same source seen before? Its asset assignment is sticky: refresh the
  //    evidence but keep the correlation_rule that originally explained it.
  const existing = await tryQuery<{ id: number | string; asset_id: string }>(
    `select id, asset_id from ${SCHEMA}.asset_sources
      where tool_id = $1 and connection_id = $2 and asset_type = $3 and external_id = $4`,
    [conn.tool_id, conn.connection_id, rec.assetType, rec.externalId]
  );

  let assetId: string;
  if (existing[0]) {
    assetId = existing[0].asset_id;
    await tryQuery(
      `update ${SCHEMA}.asset_sources
          set normalized = $2::jsonb, raw = $3::jsonb, fetch_run_id = coalesce($4, fetch_run_id), last_seen = now()
        where id = $1`,
      [existing[0].id, summaryJson, rawJson, runId]
    );
  } else {
    // 2. First time this source reports this record: correlate (first rule wins).
    const match = await correlate(rec, keys);
    let rule: CorrelationRule;
    if (match) {
      ({ assetId } = match);
      rule = match.rule;
    } else {
      assetId = astId();
      rule = "new";
      await tryQuery(
        `insert into ${SCHEMA}.assets
            (asset_id, asset_type, display_name, hostname, mac, serial, email, external_keys, summary, source_count)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 0)
         on conflict (asset_id) do nothing`,
        [assetId, rec.assetType, displayName, keys.hostname, keys.mac, keys.serial, keys.email, extKeysJson, summaryJson]
      );
    }
    await tryQuery(
      `insert into ${SCHEMA}.asset_sources
          (asset_id, asset_type, tool_id, connection_id, external_id, correlation_rule, normalized, raw, fetch_run_id)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       on conflict (tool_id, connection_id, asset_type, external_id)
       do update set normalized = excluded.normalized, raw = excluded.raw,
                     fetch_run_id = coalesce(excluded.fetch_run_id, ${SCHEMA}.asset_sources.fetch_run_id),
                     last_seen = now()`,
      [assetId, rec.assetType, conn.tool_id, conn.connection_id, rec.externalId, rule, summaryJson, rawJson, runId]
    );
  }

  // 3. Merge into the correlated asset: summary is last-writer per field,
  //    correlation keys only ever FILL (never overwrite — no key flapping),
  //    last_seen bumps, source_count recomputed from the evidence rows.
  await tryQuery(
    `update ${SCHEMA}.assets
        set display_name = coalesce(nullif($2, ''), display_name),
            hostname = coalesce(hostname, $3),
            mac = coalesce(mac, $4),
            serial = coalesce(serial, $5),
            email = coalesce(email, $6),
            external_keys = external_keys || $7::jsonb,
            summary = summary || $8::jsonb,
            last_seen = now(),
            source_count = (select count(*)::int from ${SCHEMA}.asset_sources s where s.asset_id = $1)
      where asset_id = $1`,
    [assetId, displayName, keys.hostname, keys.mac, keys.serial, keys.email, extKeysJson, summaryJson]
  );
  return true;
}

/**
 * Upsert one fetch step's normalized records (PLAN §4.5). Sequential on
 * purpose (see the race note above); every statement is best-effort tryQuery
 * so a DB blip degrades to "nothing persisted" instead of failing the run.
 */
export async function upsertRecords(
  conn: ConnectionDbRow,
  runId: string | null,
  records: NormalizedRecord[]
): Promise<{ byType: Partial<Record<AssetType, number>>; total: number }> {
  const byType: Partial<Record<AssetType, number>> = {};
  let total = 0;
  for (const rec of records) {
    const ok = await upsertOne(conn, runId, rec);
    if (ok) {
      byType[rec.assetType] = (byType[rec.assetType] ?? 0) + 1;
      total++;
    }
  }
  return { byType, total };
}
