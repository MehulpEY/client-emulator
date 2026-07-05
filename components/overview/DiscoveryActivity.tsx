"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Radar } from "lucide-react";
import { api } from "@/lib/api";
import type { DiscoveryActivityItem } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, cn } from "@/components/ui";
import { relativeTime } from "@/lib/format";

const TONE_DOT: Record<DiscoveryActivityItem["tone"], string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  muted: "bg-text3",
};

/** The overview "discovery activity" feed (PLAN §6 W9): the latest fetch runs
 *  merged with connection status transitions, served pre-merged by /api/stats
 *  (adapters.recentActivity) and refreshed on a 10s poll. */
export function DiscoveryActivity() {
  const [items, setItems] = useState<DiscoveryActivityItem[] | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => api.stats()
      .then((s) => {
        if (!alive) return;
        setItems(s.adapters?.recentActivity ?? []);
        setReachable(s.db?.reachable ?? false);
      })
      .catch(() => { /* transient error: keep last state, retry on next poll */ });
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <Panel
      title="Discovery activity"
      noPadding
      actions={<Link href="/adapters" className="btn-ghost">All adapters <ArrowRight size={13} /></Link>}
    >
      {items === null ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Radar}
          title={reachable ? "No discovery activity yet" : "Database offline"}
          sub={reachable
            ? "Add a connection on the Adapters page, test it and run a fetch — runs and status changes will stream in here."
            : "Connect Supabase to record fetch runs and connection lifecycle events."}
        />
      ) : (
        <ul className="emu-scroll max-h-[420px] overflow-y-auto">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.at}-${i}`} className="flex items-start gap-2.5 border-b border-hair px-4 py-2.5 last:border-b-0">
              <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT[it.tone])} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[12.5px] font-semibold">{it.label}</span>
                  <span className="mono shrink-0 text-[11px] text-text3">{it.toolId}</span>
                </div>
                <div className="truncate text-[12px] text-text2" title={it.detail}>{it.detail}</div>
              </div>
              <span className="tnum shrink-0 whitespace-nowrap text-[11px] text-text3">{relativeTime(it.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
