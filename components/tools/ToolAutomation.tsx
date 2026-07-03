"use client";

import { useCallback, useEffect, useState } from "react";
import { Timer, Plus, Power, Trash2, Play, Repeat, Shuffle } from "lucide-react";
import { api } from "@/lib/api";
import type { GeneratorRow, EventTypeView } from "@/lib/types";
import { Panel, SkeletonText, EmptyState, Chip, Spinner, useConfirm } from "@/components/ui";
import { relativeTime, untilTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export function ToolAutomation({ toolId }: { toolId: string }) {
  const confirm = useConfirm();
  const [gens, setGens] = useState<GeneratorRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [events, setEvents] = useState<EventTypeView[]>([]);

  // form state
  const [eventType, setEventType] = useState("");
  const [mode, setMode] = useState<"fixed" | "random">("random");
  const [interval, setIntervalS] = useState(30);
  const [minS, setMinS] = useState(15);
  const [maxS, setMaxS] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api.generators(toolId)
      .then((r) => { setGens(r.generators); setReachable(r.reachable); })
      .catch(() => { /* transient error: keep last state, retry on next poll */ });
  }, [toolId]);

  useEffect(() => {
    api.eventTypes(toolId).then((r) => { setEvents(r.events); if (r.events[0]) setEventType((e) => e || r.events[0].type); }).catch(() => {});
  }, [toolId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function create() {
    setBusy(true); setError(null);
    try {
      const r = await api.createGenerator({
        tool_id: toolId,
        event_type: eventType,
        mode,
        ...(mode === "fixed" ? { interval_ms: interval * 1000 } : { min_ms: minS * 1000, max_ms: maxS * 1000 }),
      });
      if (!r.ok) { setError(r.error || "Failed"); return; }
      await load();
    } catch (e: any) { setError(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function toggle(g: GeneratorRow) { await api.toggleGenerator(g.generator_id, !g.active); await load(); }
  async function remove(g: GeneratorRow) {
    if (await confirm({ title: "Delete generator", message: <>Delete the generator for <span className="mono text-text">{g.event_type}</span>? It will stop emitting immediately.</>, confirmLabel: "Delete", danger: true })) {
      await api.deleteGenerator(g.generator_id);
      await load();
    }
  }
  async function runNow(g: GeneratorRow) { await api.runGenerator(g.generator_id); await load(); }

  const rate = (g: GeneratorRow) =>
    g.mode === "random" ? `every ${Math.round((g.min_ms || 0) / 1000)}-${Math.round((g.max_ms || 0) / 1000)}s` : `every ${Math.round((g.interval_ms || 0) / 1000)}s`;

  return (
    <Panel title="Automation" icon={<Timer size={14} />}>
      {/* Config box */}
      <div className="sunk space-y-3 p-3">
        <div className="label">New generator</div>
        <label className="block">
          <span className="mb-1 block text-[11px] text-text3">Event</span>
          <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {events.map((ev) => <option key={ev.type} value={ev.type}>{ev.type}</option>)}
          </select>
        </label>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setMode("random")} className={cn("btn-ghost h-8 flex-1 !text-[11px]", mode === "random" && "border-accent !bg-accent-soft !text-accent-fg")}>
            <Shuffle size={12} /> Random
          </button>
          <button type="button" onClick={() => setMode("fixed")} className={cn("btn-ghost h-8 flex-1 !text-[11px]", mode === "fixed" && "border-accent !bg-accent-soft !text-accent-fg")}>
            <Repeat size={12} /> Fixed
          </button>
        </div>
        {mode === "fixed" ? (
          <label className="block">
            <span className="mb-1 block text-[11px] text-text3">Interval (seconds)</span>
            <input type="number" min={2} className="field" value={interval} onChange={(e) => setIntervalS(Math.max(2, Number(e.target.value) || 2))} />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-text3">Min (s)</span>
              <input type="number" min={2} className="field" value={minS} onChange={(e) => setMinS(Math.max(2, Number(e.target.value) || 2))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-text3">Max (s)</span>
              <input type="number" min={2} className="field" value={maxS} onChange={(e) => setMaxS(Math.max(2, Number(e.target.value) || 2))} />
            </label>
          </div>
        )}
        {error && <div className="border border-danger-line bg-danger-bg px-2.5 py-1.5 text-[11.5px] text-danger">{error}</div>}
        <button className="btn-primary w-full" onClick={create} disabled={busy || !eventType || !reachable}>
          {busy ? <Spinner label="Creating..." /> : <><Plus size={13} /> Add generator</>}
        </button>
        <p className="text-[10.5px] leading-relaxed text-text3">
          Auto-emits this event on a schedule (then delivered to matching subscriptions). Configure a subscription to route it to an agent.
        </p>
      </div>

      {/* Active generators */}
      <div className="mt-3">
        {gens === null ? (
          <SkeletonText lines={2} />
        ) : !reachable ? (
          <div className="text-[11.5px] text-text3">Database offline - generators are stored in Supabase.</div>
        ) : gens.length === 0 ? (
          <div className="py-2 text-center text-[11.5px] text-text3">No generators yet.</div>
        ) : (
          <div className="space-y-2">
            {gens.map((g) => (
              <div key={g.generator_id} className="flex items-center gap-2 border border-border p-2.5">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", g.active ? "bg-ok" : "bg-text3")} />
                <div className="min-w-0 flex-1">
                  <div className="mono truncate text-[12px] font-bold">{g.event_type}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-text3">
                    <Chip variant="muted">{rate(g)}</Chip>
                    <span>| {g.run_count} fired</span>
                    {g.active ? <span>| next {untilTime(g.next_run_at)}</span> : <span>| paused</span>}
                    {g.last_run_at ? <span>| last {relativeTime(g.last_run_at)}</span> : null}
                  </div>
                </div>
                <button onClick={() => runNow(g)} className="btn-ghost h-7 w-7 !px-0" title="Run now"><Play size={12} /></button>
                <button onClick={() => toggle(g)} className="btn-ghost h-7 w-7 !px-0" title={g.active ? "Pause" : "Resume"}><Power size={12} className={g.active ? "text-ok" : "text-text3"} /></button>
                <button onClick={() => remove(g)} className="btn-danger h-7 w-7 !px-0" title="Delete"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
