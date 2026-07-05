import { requireApiUser } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { tryQuery, dbAvailable, SCHEMA } from "@/lib/db";
import { catalogStats } from "@/lib/stats";
import { allAdapterMeta } from "@/lib/adapters/meta";
import type { AdapterPlatformStats, ConnectionsByStatus, DbStats, DiscoveryActivityItem } from "@/lib/types";
import type { AssetType, ConnectionStatus, FetchRunStatus } from "@/lib/adapters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dbStats(): Promise<DbStats> {
  const empty: DbStats = { reachable: false, totalRequests: 0, last24h: 0, errorRate: 0, byStatusClass: [], topTools: [] };
  if (!dbAvailable()) return empty;

  const [totals] = await tryQuery<{ total: string; last24h: string; errors: string }>(
    `select count(*)::text total,
            count(*) filter (where created_at > now() - interval '24 hours')::text last24h,
            count(*) filter (where status >= 400)::text errors
     from ${SCHEMA}.request_logs`
  );
  if (!totals) return empty;

  const byStatusClass = await tryQuery<{ class: string; count: string }>(
    `select (status/100)::text || 'xx' as class, count(*)::text count
       from ${SCHEMA}.request_logs group by status/100 order by class`
  );
  const topTools = await tryQuery<{ tool_id: string; count: string }>(
    `select coalesce(tool_id, tool_slug, 'unknown') tool_id, count(*)::text count
       from ${SCHEMA}.request_logs group by 1 order by count(*) desc limit 6`
  );

  const total = Number(totals.total) || 0;
  const errors = Number(totals.errors) || 0;
  return {
    reachable: true,
    totalRequests: total,
    last24h: Number(totals.last24h) || 0,
    errorRate: total ? errors / total : 0,
    byStatusClass: byStatusClass.map((r) => ({ class: r.class, count: Number(r.count) })),
    topTools: topTools.map((r) => ({ tool_id: r.tool_id, count: Number(r.count) })),
  };
}

// -- adapter platform block (PLAN §6 W9) --------------------------------------

const iso = (v: string | Date | null | undefined): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v) : null;

/** Feed tone per PLAN §4.7: connected→ok, degraded→warn, error→danger,
 *  pending/connecting→info, disabled→muted. */
function statusTone(status: ConnectionStatus | null): DiscoveryActivityItem["tone"] {
  switch (status) {
    case "connected": return "ok";
    case "degraded": return "warn";
    case "error": return "danger";
    case "disabled": return "muted";
    default: return "info"; // pending / connecting / unknown
  }
}

function runTone(status: FetchRunStatus): DiscoveryActivityItem["tone"] {
  switch (status) {
    case "success": return "ok";
    case "partial": return "warn";
    case "failed": return "danger";
    default: return "info"; // running
  }
}

interface RecentRunRow {
  connection_id: string;
  tool_id: string;
  status: FetchRunStatus;
  total_records: number;
  duration_ms: number | null;
  error: string | null;
  at: string | Date;
  label: string;
}

interface RecentStatusRow {
  connection_id: string;
  tool_id: string;
  from_status: ConnectionStatus | null;
  to_status: ConnectionStatus | null;
  detail: string | null;
  at: string | Date;
  label: string;
}

/** Latest fetch runs merged with connection status transitions, newest first. */
async function recentActivity(): Promise<DiscoveryActivityItem[]> {
  const [runs, transitions] = await Promise.all([
    tryQuery<RecentRunRow>(
      `select r.connection_id, r.tool_id, r.status, r.total_records, r.duration_ms, r.error,
              coalesce(r.finished_at, r.started_at) as at,
              coalesce(c.label, r.connection_id) as label
         from ${SCHEMA}.fetch_runs r
         left join ${SCHEMA}.adapter_connections c on c.connection_id = r.connection_id
        order by r.started_at desc
        limit 10`
    ),
    tryQuery<RecentStatusRow>(
      `select e.connection_id, e.tool_id, e.from_status, e.to_status, e.detail,
              e.created_at as at,
              coalesce(c.label, e.connection_id) as label
         from ${SCHEMA}.connection_events e
         left join ${SCHEMA}.adapter_connections c on c.connection_id = e.connection_id
        where e.kind = 'status_change'
        order by e.created_at desc
        limit 10`
    ),
  ]);

  const items: DiscoveryActivityItem[] = [
    ...runs.map((r): DiscoveryActivityItem => {
      const n = Number(r.total_records) || 0;
      const detail =
        r.status === "running"
          ? "fetch running…"
          : `fetch ${r.status} — ${n} record${n === 1 ? "" : "s"} in ${Number(r.duration_ms) || 0}ms` +
            (r.status !== "success" && r.error ? ` — ${r.error.slice(0, 140)}` : "");
      return {
        kind: "fetch",
        at: iso(r.at) ?? new Date(0).toISOString(),
        toolId: r.tool_id,
        label: r.label,
        detail,
        ok: r.status === "success",
        tone: runTone(r.status),
      };
    }),
    ...transitions.map((t): DiscoveryActivityItem => ({
      kind: "status",
      at: iso(t.at) ?? new Date(0).toISOString(),
      toolId: t.tool_id,
      label: t.label,
      detail: `${t.from_status ?? "new"} → ${t.to_status ?? "?"}${t.detail ? ` — ${t.detail.slice(0, 140)}` : ""}`,
      ok: t.to_status === "connected",
      tone: statusTone(t.to_status),
    })),
  ];

  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10);
}

async function adapterStats(): Promise<AdapterPlatformStats> {
  const byStatus: ConnectionsByStatus = { connected: 0, degraded: 0, error: 0, pending: 0, connecting: 0, disabled: 0 };
  const empty: AdapterPlatformStats = {
    adapters: allAdapterMeta().length,
    connections: { total: 0, byStatus },
    assets: { total: 0, byType: {} },
    fetches24h: { runs: 0, records: 0, failures: 0 },
    lastDiscoveryAt: null,
    recentActivity: [],
  };
  if (!dbAvailable()) return empty;

  const [connRows, assetRows, fetchTotals, lastRun, activity] = await Promise.all([
    tryQuery<{ status: ConnectionStatus; n: number }>(
      `select status, count(*)::int as n from ${SCHEMA}.adapter_connections group by status`
    ),
    tryQuery<{ k: AssetType; n: number }>(
      `select asset_type as k, count(*)::int as n from ${SCHEMA}.assets group by asset_type`
    ),
    tryQuery<{ runs: number; records: number; failures: number }>(
      `select count(*)::int as runs,
              coalesce(sum(total_records), 0)::int as records,
              count(*) filter (where status = 'failed')::int as failures
         from ${SCHEMA}.fetch_runs
        where started_at > now() - interval '24 hours'`
    ),
    tryQuery<{ at: string | Date | null }>(
      `select max(coalesce(finished_at, started_at)) as at from ${SCHEMA}.fetch_runs`
    ),
    recentActivity(),
  ]);

  let connectionTotal = 0;
  for (const r of connRows) {
    const n = Number(r.n) || 0;
    connectionTotal += n;
    if (r.status in byStatus) byStatus[r.status as keyof ConnectionsByStatus] = n;
  }

  const byType: Record<string, number> = {};
  let assetTotal = 0;
  for (const r of assetRows) {
    const n = Number(r.n) || 0;
    byType[r.k] = n;
    assetTotal += n;
  }

  const f = fetchTotals[0];
  return {
    adapters: empty.adapters,
    connections: { total: connectionTotal, byStatus },
    assets: { total: assetTotal, byType },
    fetches24h: {
      runs: Number(f?.runs) || 0,
      records: Number(f?.records) || 0,
      failures: Number(f?.failures) || 0,
    },
    lastDiscoveryAt: iso(lastRun[0]?.at),
    recentActivity: activity,
  };
}

export async function GET() {
  const _auth = await requireApiUser();
  if ("res" in _auth) return _auth.res;
  const [db, adapters] = await Promise.all([dbStats(), adapterStats()]);
  return NextResponse.json({ catalog: catalogStats(), db, adapters });
}
