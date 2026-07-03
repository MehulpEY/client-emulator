"use client";

import { useCallback, useEffect, useState } from "react";
import { Timer, Play, Power, Trash2, PlayCircle, StopCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { GeneratorRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, Chip, useConfirm } from "@/components/ui";
import { relativeTime, untilTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export function GeneratorsClient({ tools }: { tools: { id: string; name: string }[] }) {
  const confirm = useConfirm();
  const [gens, setGens] = useState<GeneratorRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [bulk, setBulk] = useState(false);
  const nameOf = (id: string) => tools.find((t) => t.id === id)?.name || id;

  const load = useCallback(
    () =>
      api.generators()
        .then((r) => { setGens(r.generators); setReachable(r.reachable); })
        .catch(() => { /* transient error: keep last state, retry on next poll */ }),
    [],
  );

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const total = gens?.length ?? 0;
  const activeCount = gens?.filter((g) => g.active).length ?? 0;

  async function setAll(active: boolean) {
    if (bulk) return;
    setBulk(true);
    try { await api.bulkGenerators(active); await load(); } finally { setBulk(false); }
  }
  async function toggle(g: GeneratorRow) { await api.toggleGenerator(g.generator_id, !g.active); await load(); }
  async function runNow(g: GeneratorRow) { await api.runGenerator(g.generator_id); await load(); }
  async function remove(g: GeneratorRow) {
    if (!(await confirm({ title: "Delete generator", message: <>Delete the <span className="mono text-text">{g.event_type}</span> generator for <span className="mono text-text">{nameOf(g.tool_id)}</span>? It stops emitting immediately.</>, confirmLabel: "Delete", danger: true }))) return;
    await api.deleteGenerator(g.generator_id);
    await load();
  }

  const rate = (g: GeneratorRow) =>
    g.mode === "random"
      ? `every ${Math.round((g.min_ms || 0) / 1000)}-${Math.round((g.max_ms || 0) / 1000)}s`
      : `every ${Math.round((g.interval_ms || 0) / 1000)}s`;

  return (
    <Panel
      title="Generators"
      icon={<Timer size={14} />}
      noPadding
      actions={
        <div className="flex items-center gap-1.5">
          <span className="chip tabular-nums">{activeCount} active / {total}</span>
          <button onClick={() => setAll(true)} disabled={bulk || !reachable || total === 0} className="btn-ghost h-7 !text-[11px]" title="Enable every generator">
            <PlayCircle size={13} /> Start all
          </button>
          <button onClick={() => setAll(false)} disabled={bulk || !reachable || activeCount === 0} className="btn-ghost h-7 !text-[11px]" title="Pause every generator">
            <StopCircle size={13} /> Stop all
          </button>
        </div>
      }
    >
      {gens === null ? (
        <SkeletonRows rows={5} />
      ) : !reachable ? (
        <EmptyState icon={Timer} title="Database offline" sub="Generators are stored in Supabase." />
      ) : total === 0 ? (
        <EmptyState icon={Timer} title="No generators yet" sub="Create one from a tool's Automation panel to auto-emit its events on a schedule." />
      ) : (
        <div className="divide-y divide-hair">
          {gens.map((g) => (
            <div key={g.generator_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", g.active ? "bg-ok" : "bg-text3")} title={g.active ? "active" : "paused"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mono truncate text-[12.5px] font-bold">{g.event_type}</span>
                  <Chip variant="accent">{nameOf(g.tool_id)}</Chip>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-text3">
                  <Chip variant="muted">{rate(g)}</Chip>
                  <span>| {g.run_count} fired</span>
                  {g.active ? <span>| next {untilTime(g.next_run_at)}</span> : <span>| paused</span>}
                  {g.last_run_at ? <span>| last {relativeTime(g.last_run_at)}</span> : null}
                </div>
              </div>
              <button onClick={() => runNow(g)} className="btn-ghost h-7 w-7 !px-0" title="Run now"><Play size={12} /></button>
              <button onClick={() => toggle(g)} className="btn-ghost h-7 w-7 !px-0" title={g.active ? "Pause" : "Resume"}>
                <Power size={12} className={g.active ? "text-ok" : "text-text3"} />
              </button>
              <button onClick={() => remove(g)} className="btn-danger h-7 w-7 !px-0" title="Delete"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
