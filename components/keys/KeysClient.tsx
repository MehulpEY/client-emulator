"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ApiKeyRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, Spinner, CopyButton, Chip, useConfirm } from "@/components/ui";
import { relativeTime } from "@/lib/format";

export function KeysClient({ tools }: { tools: { id: string; name: string }[] }) {
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [toolId, setToolId] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string | null) => (id ? tools.find((t) => t.id === id)?.name || id : "Master (all tools)");

  function load() {
    return api.keys()
      .then((r) => { setKeys(r.keys); setReachable(r.reachable); })
      .catch(() => { /* transient error: keep last state, retry on next poll */ });
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

  async function remove(k: ApiKeyRow) {
    const scope = k.tool_id === null ? "the master key" : `the ${nameOf(k.tool_id)} key`;
    const ok = await confirm({
      title: "Delete key",
      message: (
        <>
          Delete <span className="font-semibold text-text">{scope}</span> (<span className="mono">{k.label}</span>)?
          Any agent still presenting it will start getting 401s. If this is the last key for a tool, that tool reopens
          to unauthenticated calls.
        </>
      ),
      confirmLabel: "Delete key",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setDeleting(k.key_id);
    try {
      const r = await api.deleteKey(k.key_id);
      if (!r.ok) setError(r.error ?? "Delete failed");
      await load();
    } catch {
      setError("Delete failed — request error");
    } finally {
      setDeleting(null);
    }
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
                    <span className="text-[11px] text-text3">| {k.label}</span>
                  </div>
                  <div className="mono mt-0.5 truncate text-[11px] text-text3">{k.secret}</div>
                </div>
                <span className="hidden shrink-0 text-[11px] text-text3 sm:block">{relativeTime(k.created_at)}</span>
                <CopyButton value={k.secret} className="h-7 w-7 shrink-0 !px-0" />
                <button
                  className="btn-danger h-7 w-7 shrink-0 !px-0"
                  title="Delete key"
                  onClick={() => remove(k)}
                  disabled={deleting === k.key_id}
                >
                  {deleting === k.key_id ? <Spinner className="!text-[10px]" /> : <Trash2 size={13} />}
                </button>
              </div>
            ))}
          </div>
        )}
        {error ? (
          <div className="border-t border-danger-line bg-danger-bg px-4 py-2 text-[12px] text-danger">{error}</div>
        ) : null}
      </Panel>

      <Panel title="Issue a Key" icon={<Plus size={14} />}>
        <div className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Scope</span>
            <select className="field" value={toolId} onChange={(e) => setToolId(e.target.value)} disabled={!reachable}>
              <option value="">Master - all tools</option>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Label</span>
            <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. soc-agent" disabled={!reachable} />
          </label>
          <button className="btn-primary w-full" onClick={create} disabled={creating || !reachable}>
            {creating ? <Spinner label="Creating..." /> : <><Plus size={14} /> Create key</>}
          </button>
          <p className="text-[11.5px] leading-relaxed text-text3">
            Once any key exists for a tool (or a master key exists), that tool&apos;s endpoints require a valid key. With none, endpoints stay open for quick testing.
          </p>
        </div>
      </Panel>
    </div>
  );
}
