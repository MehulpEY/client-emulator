"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import type { LogRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState } from "@/components/ui";
import { LogList } from "@/components/logs/LogList";

export function ToolLogs({ toolId }: { toolId: string }) {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [reachable, setReachable] = useState(true);

  const load = useCallback(() => {
    return api.logs({ tool: toolId, limit: 12 })
      .then((r) => { setLogs(r.logs); setReachable(r.reachable); })
      .catch(() => { /* transient error: keep last state, retry on next poll */ });
  }, [toolId]);

  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) load(); };
    run();
    const id = setInterval(run, 7000);
    return () => { alive = false; clearInterval(id); };
  }, [load]);

  return (
    <Panel
      title="Request Trace"
      noPadding
      actions={<button onClick={() => load()} className="btn-ghost h-7 w-7 !px-0" title="Refresh"><RotateCw size={13} /></button>}
    >
      {logs === null ? (
        <SkeletonRows rows={5} />
      ) : logs.length === 0 ? (
        <EmptyState icon={Radio} title={reachable ? "No calls yet" : "Database offline"} sub={reachable ? "Send a request from the console to see it here." : undefined} />
      ) : (
        <div className="emu-scroll max-h-[420px] overflow-y-auto"><LogList logs={logs} /></div>
      )}
    </Panel>
  );
}
