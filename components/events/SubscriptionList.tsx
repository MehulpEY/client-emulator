"use client";

import { useCallback, useEffect, useState } from "react";
import { Webhook, Trash2, Power } from "lucide-react";
import { api } from "@/lib/api";
import type { SubscriptionRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, Chip, CopyButton, useConfirm } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export function SubscriptionList({ tools, refreshKey, onChange }: { tools: { id: string; name: string }[]; refreshKey: number; onChange: () => void }) {
  const confirm = useConfirm();
  const [subs, setSubs] = useState<SubscriptionRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const nameOf = (id: string | null) => (id ? tools.find((t) => t.id === id)?.name || id : "All tools");

  const load = useCallback(() => {
    return api.subscriptions()
      .then((r) => { setSubs(r.subscriptions); setReachable(r.reachable); })
      .catch(() => { /* transient error: keep last state, retry on next poll */ });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function toggle(s: SubscriptionRow) { await api.toggleSubscription(s.subscription_id, !s.active); await load(); onChange(); }
  async function remove(s: SubscriptionRow) {
    if (!(await confirm({ title: "Delete subscription", message: <>Delete the subscription for <span className="mono text-text">{nameOf(s.tool_id)}</span>? Its webhook will stop receiving events.</>, confirmLabel: "Delete", danger: true }))) return;
    await api.deleteSubscription(s.subscription_id); await load(); onChange();
  }

  return (
    <Panel title="Subscriptions" icon={<Webhook size={14} />} noPadding actions={<span className="chip">{subs?.length ?? 0}</span>}>
      {subs === null ? (
        <SkeletonRows rows={4} />
      ) : !reachable ? (
        <EmptyState icon={Webhook} title="Database offline" sub="Subscriptions live in Supabase. Reconnect to manage them." />
      ) : subs.length === 0 ? (
        <EmptyState icon={Webhook} title="No subscriptions yet" sub="Create one above to push tool events to a consumer (an agent webhook URL)." />
      ) : (
        <div className="divide-y divide-hair">
          {subs.map((s) => (
            <div key={s.subscription_id} className="flex items-center gap-3 px-4 py-3">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", s.active ? "bg-ok" : "bg-text3")} title={s.active ? "active" : "paused"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-bold">{nameOf(s.tool_id)}</span>
                  <Chip variant={s.event_type === "*" ? "muted" : "accent"}>{s.event_type === "*" ? "all events" : s.event_type}</Chip>
                  {s.description ? <span className="text-[11px] text-text3">| {s.description}</span> : null}
                </div>
                <div className="mono mt-0.5 truncate text-[11px] text-text3" title={s.target_url}>{"->"} {s.target_url}</div>
              </div>
              <span className="hidden shrink-0 text-[11px] text-text3 lg:block">{relativeTime(s.created_at)}</span>
              <CopyButton value={s.secret} label="secret" className="h-7 !text-[11px]" />
              <button onClick={() => toggle(s)} className="btn-ghost h-7 w-7 !px-0" title={s.active ? "Pause" : "Activate"}><Power size={13} className={s.active ? "text-ok" : "text-text3"} /></button>
              <button onClick={() => remove(s)} className="btn-danger h-7 w-7 !px-0" title="Delete"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
