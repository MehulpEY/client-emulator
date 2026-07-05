"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Boxes, HardDrive, PlugZap, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { StatsResponse } from "@/lib/types";
import { Stat, Skeleton, cn } from "@/components/ui";

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6";

/** Dot + count + word — dots are always paired with a text label (design doctrine). */
function StatusPart({ dot, n, word }: { dot: string; n: number; word: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="tnum">{n}</span> {word}
    </span>
  );
}

/** Adapter-platform stat tiles: adapters, connections, assets, fetches 24h,
 *  plus the existing request-trace tiles. 10s poll — discovery is live. */
export function OverviewStats({ catalogFallback }: { catalogFallback: { adapters: number; endpoints: number } }) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => api.stats()
      .then((s) => { if (alive) setStats(s); })
      .catch(() => { /* keep last state; retry on next poll */ })
      .finally(() => { if (alive) setLoading(false); });
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) {
    return (
      <div className={GRID}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel space-y-3 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
    );
  }

  const db = stats?.db;
  const a = stats?.adapters;
  const live = db?.reachable ?? false; // adapter/asset/fetch counts share the same DB
  const byStatus = a?.connections.byStatus;
  const failures = a?.fetches24h.failures ?? 0;

  return (
    <div className={GRID}>
      <Stat
        label="Adapters"
        value={a?.adapters ?? catalogFallback.adapters}
        icon={<Boxes size={16} />}
        tone="accent"
        sub={`${catalogFallback.endpoints} live endpoints`}
      />
      <Stat
        label="Connections"
        value={live ? a?.connections.total ?? 0 : "-"}
        icon={<PlugZap size={16} />}
        sub={
          !live ? "DB offline" : (a?.connections.total ?? 0) === 0 ? "none configured yet" : (
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <StatusPart dot="bg-ok" n={byStatus?.connected ?? 0} word="connected" />
              {(byStatus?.degraded ?? 0) > 0 && <StatusPart dot="bg-warn" n={byStatus!.degraded} word="degraded" />}
              {(byStatus?.error ?? 0) > 0 && <StatusPart dot="bg-danger" n={byStatus!.error} word="error" />}
            </span>
          )
        }
      />
      <Stat
        label="Assets"
        value={live ? a?.assets.total ?? 0 : "-"}
        icon={<HardDrive size={16} />}
        tone="ok"
        sub={
          !live ? "DB offline" : (a?.assets.total ?? 0) === 0 ? "run a fetch to populate" :
            `${a?.assets.byType.device ?? 0} devices · ${a?.assets.byType.user ?? 0} users`
        }
      />
      <Stat
        label="Fetches (24h)"
        value={live ? a?.fetches24h.runs ?? 0 : "-"}
        icon={<RefreshCw size={16} />}
        tone={live && failures > 0 ? "danger" : "default"}
        sub={
          !live ? "DB offline" :
            `${a?.fetches24h.records ?? 0} records${failures > 0 ? ` · ${failures} failed` : ""}`
        }
      />
      <Stat
        label="Requests (24h)"
        value={db?.reachable ? db.last24h : "-"}
        icon={<Activity size={16} />}
        tone="info"
        sub={db?.reachable ? `${db.totalRequests} total logged` : db ? "DB offline" : "no data yet"}
      />
      <Stat
        label="Error rate"
        value={db?.reachable ? `${Math.round((db.errorRate || 0) * 100)}%` : "-"}
        icon={<AlertTriangle size={16} />}
        tone={db?.reachable && db.errorRate > 0.25 ? "danger" : "default"}
        sub={db?.reachable ? "of logged calls" : "awaiting traffic"}
      />
    </div>
  );
}
