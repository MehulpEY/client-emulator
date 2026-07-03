"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { ApiKeyRow } from "@/lib/types";
import { Panel, SkeletonText, EmptyState, Spinner, CopyButton, Chip } from "@/components/ui";

export function ToolKeys({ toolId }: { toolId: string }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [creating, setCreating] = useState(false);

  function load() {
    return api.keys(toolId)
      .then((r) => { setKeys(r.keys); setReachable(r.reachable); })
      .catch(() => { /* transient error: keep last state, retry on next poll */ });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [toolId]);

  async function create() {
    setCreating(true);
    try { await api.createKey({ tool_id: toolId, label: "console" }); await load(); }
    finally { setCreating(false); }
  }

  return (
    <Panel
      title="API Keys"
      icon={<KeyRound size={14} />}
      actions={<button className="btn-ghost h-7" onClick={create} disabled={creating || !reachable}>{creating ? <Spinner /> : <><Plus size={13} /> New</>}</button>}
    >
      {keys === null ? (
        <SkeletonText lines={3} />
      ) : !reachable ? (
        <EmptyState icon={KeyRound} title="Database offline" sub="Keys live in Supabase. Until it's reachable, endpoints accept any key (open dev mode)." />
      ) : keys.length === 0 ? (
        <div className="space-y-2 text-[12px] text-text2">
          <p>No keys yet - endpoints are <span className="text-accent-fg">open in dev mode</span> (any/no key works). Create one to enforce auth.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k.key_id} className="sunk flex items-center gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-bold">{k.label}</span>
                  {k.tool_id === null ? <Chip variant="accent">master</Chip> : null}
                  {!k.active ? <Chip variant="danger">inactive</Chip> : null}
                </div>
                <div className="mono mt-0.5 truncate text-[10.5px] text-text3">{k.secret}</div>
              </div>
              <CopyButton value={k.secret} className="h-7 w-7 shrink-0 !px-0" />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
