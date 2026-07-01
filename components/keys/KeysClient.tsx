"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { ApiKeyRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, Spinner, CopyButton, Chip } from "@/components/ui";
import { relativeTime } from "@/lib/format";

export function KeysClient({ tools }: { tools: { id: string; name: string }[] }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [toolId, setToolId] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const nameOf = (id: string | null) => (id ? tools.find((t) => t.id === id)?.name || id : "Master (all tools)");

  function load() {
    return api.keys()
      .then((r) => { setKeys(r.keys); setReachable(r.reachable); })
      .catch(() => { setKeys([]); setReachable(false); });
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setCreating(true);
    try {
      await api.createKey({ tool_id: toolId || null, label: label || "default" });
      setLabel("");
      await load();
    } finally { setCreating(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Issued Keys" noPadding>
        {keys === null ? (
          <SkeletonRows rows={6} />
        ) : !reachable ? (
          <EmptyState icon={KeyRound} title="Database offline" sub="Keys are stored in Supabase. While it's unreachable, every endpoint runs in open dev mode (any key works)." />
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No keys issued" sub="Endpoints accept any/no key (open dev mode) until you create one. A master key gates every tool." />
        ) : (
          <div className="divide-y divide-hair">
            {keys.map((k) => (
              <div key={k.key_id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center bg-surface-sunk text-accent-fg"><KeyRound size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-bold">{nameOf(k.tool_id)}</span>
                    {k.tool_id === null ? <Chip variant="accent">master</Chip> : null}
                    <span className="text-[11px] text-text3">· {k.label}</span>
                  </div>
                  <div className="mono mt-0.5 truncate text-[11px] text-text3">{k.secret}</div>
                </div>
                <span className="hidden shrink-0 text-[11px] text-text3 sm:block">{relativeTime(k.created_at)}</span>
                <CopyButton value={k.secret} className="h-7 w-7 shrink-0 !px-0" />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Issue a Key" icon={<Plus size={14} />}>
        <div className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Scope</span>
            <select className="field" value={toolId} onChange={(e) => setToolId(e.target.value)} disabled={!reachable}>
              <option value="">Master — all tools</option>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Label</span>
            <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. soc-agent" disabled={!reachable} />
          </label>
          <button className="btn-primary w-full" onClick={create} disabled={creating || !reachable}>
            {creating ? <Spinner label="Creating…" /> : <><Plus size={14} /> Create key</>}
          </button>
          <p className="text-[11.5px] leading-relaxed text-text3">
            Once any key exists for a tool (or a master key exists), that tool&apos;s endpoints require a valid key. With none, endpoints stay open for quick testing.
          </p>
        </div>
      </Panel>
    </div>
  );
}
