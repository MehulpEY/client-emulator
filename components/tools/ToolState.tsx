"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ToolStateResponse } from "@/lib/types";
import { Panel, SkeletonText, Chip } from "@/components/ui";
import { relativeTime, prettyJson } from "@/lib/format";

// Read-only view of a tool's persisted state — the records its stateful GET
// endpoints return. Generated/created events land here, so this is the proof
// that "call the API normally and see the same data" works.
export function ToolState({ toolId }: { toolId: string }) {
  const [state, setState] = useState<ToolStateResponse | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    () => api.toolState(toolId).then(setState).catch(() => setState({ reachable: false, collections: [], recent: [] })),
    [toolId],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function clearAll() {
    if (!confirm("Clear all persisted records for this tool?")) return;
    await api.clearState(toolId);
    await load();
  }

  const hasState = state && state.collections.length > 0;

  return (
    <Panel
      title="Persisted State"
      icon={<Database size={14} />}
      actions={
        <div className="flex items-center gap-1">
          <button onClick={load} className="btn-ghost h-7 w-7 !px-0" title="Refresh"><RefreshCw size={12} /></button>
          {hasState ? <button onClick={clearAll} className="btn-danger h-7 w-7 !px-0" title="Clear state"><Trash2 size={12} /></button> : null}
        </div>
      }
    >
      {state === null ? (
        <SkeletonText lines={2} />
      ) : !state.reachable ? (
        <div className="text-[11.5px] text-text3">Database offline — state lives in Supabase.</div>
      ) : !hasState ? (
        <div className="py-2 text-center text-[11.5px] leading-relaxed text-text3">
          No stored records yet. Created / generated events persist here and are returned by this tool&apos;s GET endpoints.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {state.collections.map((c) => (
              <Chip key={c.collection} variant="accent">{c.collection} · {c.count}</Chip>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="label">Most recent</div>
            {state.recent.map((r) => (
              <div key={r.collection + r.resource_id} className="sunk p-2">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === r.resource_id ? null : r.resource_id)}>
                  <span className="mono min-w-0 flex-1 truncate text-[11.5px] font-bold">{r.resource_id}</span>
                  {r.data?.status ? <Chip variant="muted">{String(r.data.status)}</Chip> : null}
                  <span className="shrink-0 text-[10px] text-text3">{relativeTime(r.updated_at)}</span>
                </button>
                {open === r.resource_id && (
                  <pre className="mono mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-all border-t border-hair pt-1.5 text-[10.5px] text-text2">{prettyJson(r.data)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
