"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radio, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { LogRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState } from "@/components/ui";
import { LogList } from "@/components/logs/LogList";

export function RecentActivity() {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => api.logs({ limit: 8 })
      .then((r) => { if (alive) { setLogs(r.logs); setReachable(r.reachable); } })
      .catch(() => { if (alive) { setLogs([]); setReachable(false); } });
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <Panel
      title="Recent Agent Traffic"
      noPadding
      actions={<Link href="/logs" className="btn-ghost">Full trace <ArrowRight size={13} /></Link>}
    >
      {logs === null ? (
        <SkeletonRows rows={6} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={Radio}
          title={reachable ? "No requests yet" : "Database offline"}
          sub={reachable ? "Point an agent at an emulated endpoint and calls will stream in here." : "Connect Supabase to capture the request trace."}
        />
      ) : (
        <LogList logs={logs} />
      )}
    </Panel>
  );
}
