"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Webhook, Zap, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { EventTypeView } from "@/lib/types";
import { Panel, SkeletonText, EmptyState, Chip, Spinner } from "@/components/ui";

export function ToolEvents({ toolId }: { toolId: string }) {
  const [events, setEvents] = useState<EventTypeView[] | null>(null);
  const [emitting, setEmitting] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: string; matched: number; delivered: number } | null>(null);

  useEffect(() => {
    api.eventTypes(toolId).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [toolId]);

  async function emit(type: string) {
    setEmitting(type); setResult(null);
    try {
      const r = await api.publishEvent({ tool_id: toolId, event_type: type });
      setResult({ type, matched: r.matched, delivered: r.delivered });
    } finally { setEmitting(null); }
  }

  return (
    <Panel
      title="Events & Webhooks"
      icon={<Webhook size={14} />}
      actions={<Link href="/events" className="btn-ghost h-7 !text-[11px]">Subscriptions <ArrowRight size={12} /></Link>}
    >
      {events === null ? (
        <SkeletonText lines={3} />
      ) : events.length === 0 ? (
        <EmptyState icon={Webhook} title="No events" />
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <div key={e.type} className="sunk flex items-center gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="mono text-[12px] font-bold">{e.type}</span>
                  <Chip variant={e.source === "tool" ? "accent" : "muted"}>{e.source === "tool" ? "domain" : "activity"}</Chip>
                </div>
                <div className="mt-0.5 text-[11px] text-text3">{e.summary}</div>
              </div>
              <button className="btn-ghost h-7 !text-[11px]" onClick={() => emit(e.type)} disabled={emitting === e.type}>
                {emitting === e.type ? <Spinner /> : <><Zap size={12} /> Emit</>}
              </button>
            </div>
          ))}
          {result && (
            <div className="text-[11.5px] text-text2">
              Emitted <span className="mono">{result.type}</span> {"->"} {result.matched} matched, <span className="text-ok">{result.delivered} delivered</span>.
              {result.matched === 0 ? <> No subscription yet - <Link href="/events" className="text-accent-fg hover:underline">create one</Link>.</> : null}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
