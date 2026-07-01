"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, ChevronRight, Trash2, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import type { DeliveryRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, StatusBadge, Chip, Spinner } from "@/components/ui";
import { relativeTime, prettyJson } from "@/lib/format";
import { cn } from "@/lib/cn";

function Row({ d }: { d: DeliveryRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hair last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="row flex w-full items-center gap-2.5 px-4 py-2.5 text-left">
        <ChevronRight size={13} className={cn("shrink-0 text-text3 transition-transform", open && "rotate-90")} />
        <span className={cn("h-2 w-2 shrink-0 rounded-full", d.status === "delivered" ? "bg-ok" : "bg-danger")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold">{d.event_type}</span>
          <span className="mono block truncate text-[10.5px] text-text3">{d.tool_slug} → {d.target_url}</span>
        </span>
        {d.source ? <Chip variant="muted" className="hidden md:inline-flex">{d.source}</Chip> : null}
        {d.attempts > 1 ? <span className="hidden text-[10.5px] text-text3 md:block">×{d.attempts}</span> : null}
        {d.response_status != null ? <StatusBadge status={d.response_status} /> : <Chip variant="danger">{d.error || "failed"}</Chip>}
        <span className="hidden w-16 shrink-0 text-right text-[11px] text-text3 lg:block">{relativeTime(d.created_at)}</span>
      </button>
      {open && (
        <div className="grid gap-3 bg-surface-sunk px-4 py-3 lg:grid-cols-2">
          <div>
            <div className="label mb-1">Event payload</div>
            <pre className="emu-scroll mono max-h-64 overflow-auto bg-surface p-2.5 text-[11px] leading-relaxed text-text2">{prettyJson(d.payload)}</pre>
          </div>
          <div>
            <div className="label mb-1">Consumer response{d.response_status != null ? ` · ${d.response_status}` : ""}</div>
            <pre className="emu-scroll mono max-h-64 overflow-auto bg-surface p-2.5 text-[11px] leading-relaxed text-text2">{d.response_body || d.error || "(no response)"}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function DeliveriesLog({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    return api.deliveries({ limit: 80 })
      .then((r) => { setRows(r.deliveries); setReachable(r.reachable); })
      .catch(() => { setRows([]); setReachable(false); });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  async function clear() {
    if (!confirm("Clear the delivery log?")) return;
    setClearing(true);
    try { await api.clearDeliveries(); await load(); } finally { setClearing(false); }
  }

  return (
    <Panel
      title="Event Deliveries"
      icon={<Send size={14} />}
      noPadding
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={load} className="btn-ghost h-7 w-7 !px-0" title="Refresh"><RotateCw size={13} /></button>
          <button onClick={clear} className="btn-danger h-7 !text-[11px]" disabled={clearing || !reachable}>{clearing ? <Spinner /> : <><Trash2 size={12} /> Clear</>}</button>
        </div>
      }
    >
      {rows === null ? (
        <SkeletonRows rows={6} />
      ) : !reachable ? (
        <EmptyState icon={Send} title="Database offline" sub="Delivery history is stored in Supabase." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Send} title="No deliveries yet" sub="Emit a test event or trigger one via a mutating tool call." />
      ) : (
        <div className="emu-scroll max-h-[460px] overflow-y-auto">{rows.map((d) => <Row key={d.delivery_id} d={d} />)}</div>
      )}
    </Panel>
  );
}
