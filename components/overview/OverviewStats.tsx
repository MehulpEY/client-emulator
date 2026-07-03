"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Boxes, Cpu, Radio } from "lucide-react";
import { api } from "@/lib/api";
import type { StatsResponse } from "@/lib/types";
import { Stat, SkeletonStats } from "@/components/ui";

export function OverviewStats({ catalogFallback }: { catalogFallback: { tools: number; endpoints: number; aiTools: number } }) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.stats()
      .then((s) => { if (alive) setStats(s); })
      .catch(() => { /* keep fallback */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <SkeletonStats count={4} />;

  const db = stats?.db;
  const cat = stats?.catalog;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Emulated Tools" value={cat?.tools ?? catalogFallback.tools} icon={<Boxes size={16} />} sub={`${cat?.endpoints ?? catalogFallback.endpoints} endpoints`} />
      <Stat label="AI-Tool Surfaces" value={cat?.aiTools ?? catalogFallback.aiTools} icon={<Cpu size={16} />} tone="accent" sub="callable by agents" />
      <Stat
        label="Requests (24h)"
        value={db?.reachable ? db.last24h : "-"}
        icon={<Activity size={16} />}
        tone="info"
        sub={db?.reachable ? `${db.totalRequests} total logged` : db ? "DB offline" : "no data yet"}
      />
      <Stat
        label="Error Rate"
        value={db?.reachable ? `${Math.round((db.errorRate || 0) * 100)}%` : "-"}
        icon={<AlertTriangle size={16} />}
        tone={db?.reachable && db.errorRate > 0.25 ? "danger" : "default"}
        sub={db?.reachable ? "of logged calls" : "awaiting traffic"}
      />
    </div>
  );
}
