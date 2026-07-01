"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, ChevronRight, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DemoEvent } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, Chip } from "@/components/ui";
import { relativeTime, prettyJson } from "@/lib/format";
import { cn } from "@/lib/cn";

function Row({ e }: { e: DemoEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hair last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="row flex w-full items-center gap-2.5 px-4 py-2.5 text-left">
        <ChevronRight size={13} className={cn("shrink-0 text-text3 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold">{e.event || "event"}</span>
          <span className="mono block truncate text-[10.5px] text-text3">{e.tool}</span>
        </span>
        <span className="hidden w-16 shrink-0 text-right text-[11px] text-text3 sm:block">{relativeTime(e.received_at)}</span>
      </button>
      {open && (
        <div className="space-y-2 bg-surface-sunk px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-text3">
            <Chip variant="muted">delivery {e.delivery}</Chip>
            <span className="mono truncate" title={e.signature || ""}>sig {(e.signature || "").slice(0, 22)}…</span>
          </div>
          <pre className="emu-scroll mono max-h-64 overflow-auto bg-surface p-2.5 text-[11px] leading-relaxed text-text2">{prettyJson(e.body)}</pre>
        </div>
      )}
    </div>
  );
}

export function DemoInbox({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<DemoEvent[] | null>(null);

  const load = useCallback(() => api.demoInbox().then((r) => setEvents(r.events)).catch(() => setEvents([])), []);
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  async function clear() { await api.clearDemoInbox(); await load(); }

  return (
    <Panel
      title="Demo Consumer Inbox"
      icon={<Inbox size={14} />}
      noPadding
      actions={<button onClick={clear} className="btn-ghost h-7 !text-[11px]"><Trash2 size={12} /> Clear</button>}
    >
      <div className="border-b border-hair px-4 py-2 text-[11px] text-text3">
        Built-in consumer at <span className="mono text-text2">/api/consumer/demo</span> — subscribe to it to see deliveries land here.
      </div>
      {events === null ? (
        <SkeletonRows rows={4} />
      ) : events.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing received yet" sub="Point a subscription at the demo consumer, then emit an event." />
      ) : (
        <div className="emu-scroll max-h-[420px] overflow-y-auto">{events.map((e, i) => <Row key={(e.delivery || "") + i} e={e} />)}</div>
      )}
    </Panel>
  );
}
