"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Webhook, Zap, Send } from "lucide-react";
import { api } from "@/lib/api";
import type { EventTypeView, PublishResult } from "@/lib/types";
import { Panel, Chip, Spinner } from "@/components/ui";
import { SubscriptionList } from "./SubscriptionList";
import { DeliveriesLog } from "./DeliveriesLog";
import { DemoInbox } from "./DemoInbox";

type Tool = { id: string; name: string };

/** Load a tool's event types for the select inputs. */
function useEventTypes(toolId: string) {
  const [events, setEvents] = useState<EventTypeView[]>([]);
  useEffect(() => {
    if (!toolId) { setEvents([]); return; }
    let alive = true;
    api.eventTypes(toolId).then((r) => { if (alive) setEvents(r.events); }).catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [toolId]);
  return events;
}

export function SubscriptionsClient({ tools, baseUrl }: { tools: Tool[]; baseUrl: string }) {
  const [bump, setBump] = useState(0);
  const refresh = useCallback(() => setBump((b) => b + 1), []);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <CreateSubscription tools={tools} baseUrl={baseUrl} onCreated={refresh} />
        <EmitTester tools={tools} onEmitted={refresh} />
      </div>
      <SubscriptionList tools={tools} refreshKey={bump} onChange={refresh} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DeliveriesLog refreshKey={bump} />
        <DemoInbox refreshKey={bump} />
      </div>
    </div>
  );
}

function CreateSubscription({ tools, baseUrl, onCreated }: { tools: Tool[]; baseUrl: string; onCreated: () => void }) {
  const [toolId, setToolId] = useState("");
  const [eventType, setEventType] = useState("*");
  const [targetUrl, setTargetUrl] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const events = useEventTypes(toolId);

  useEffect(() => { setEventType("*"); }, [toolId]);

  async function create() {
    setBusy(true); setError(null);
    try {
      const r = await api.createSubscription({ tool_id: toolId || null, event_type: eventType, target_url: targetUrl, description: description || undefined });
      if (!r.ok) { setError(r.error || "Failed"); return; }
      setTargetUrl(""); setDescription(""); onCreated();
    } catch (e: any) { setError(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="Create Subscription" icon={<Plus size={14} />}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1.5 block">Tool</span>
            <select className="field" value={toolId} onChange={(e) => setToolId(e.target.value)}>
              <option value="">All tools</option>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Event</span>
            <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value)} disabled={!toolId}>
              <option value="*">All events</option>
              {events.map((ev) => <option key={ev.type} value={ev.type}>{ev.type}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="label mb-1.5 flex items-center justify-between">
            <span>Consumer URL (agent webhook)</span>
            <button type="button" className="text-[10.5px] font-bold text-accent-fg hover:underline" onClick={() => setTargetUrl(`${baseUrl}/api/consumer/demo`)}>use demo consumer</button>
          </span>
          <input className="field mono" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://your-agent.example/webhook" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Description (optional)</span>
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. SOC triage agent" />
        </label>
        {error && <div className="border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</div>}
        <button className="btn-primary w-full" onClick={create} disabled={busy || !targetUrl}>
          {busy ? <Spinner label="Creating…" /> : <><Webhook size={14} /> Subscribe</>}
        </button>
        <p className="text-[11px] leading-relaxed text-text3">
          Deliveries are POSTed with an HMAC <span className="mono">x-emulator-signature</span> header you can verify with the subscription secret.
        </p>
      </div>
    </Panel>
  );
}

function EmitTester({ tools, onEmitted }: { tools: Tool[]; onEmitted: () => void }) {
  const [toolId, setToolId] = useState(() => tools.find((t) => t.id === "crowdstrike")?.id || tools[0]?.id || "");
  const [eventType, setEventType] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const events = useEventTypes(toolId);

  useEffect(() => { if (events.length && !events.some((e) => e.type === eventType)) setEventType(events[0].type); }, [events, eventType]);

  async function emit() {
    if (!toolId || !eventType) return;
    setBusy(true); setResult(null);
    try { setResult(await api.publishEvent({ tool_id: toolId, event_type: eventType })); onEmitted(); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="Emit Test Event" icon={<Zap size={14} />}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1.5 block">Tool</span>
            <select className="field" value={toolId} onChange={(e) => setToolId(e.target.value)}>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Event type</span>
            <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {events.map((ev) => <option key={ev.type} value={ev.type}>{ev.type}</option>)}
            </select>
          </label>
        </div>
        <button className="btn-primary w-full" onClick={emit} disabled={busy || !eventType}>
          {busy ? <Spinner label="Publishing…" /> : <><Send size={14} /> Emit to subscribers</>}
        </button>
        {result && (
          <div className="sunk p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-bold">{result.eventType}</span>
              <Chip variant="muted">{result.matched} matched</Chip>
              <Chip variant="ok">{result.delivered} delivered</Chip>
              {result.failed > 0 ? <Chip variant="danger">{result.failed} failed</Chip> : null}
            </div>
            {result.matched === 0 && <p className="mt-2 text-[11.5px] text-text3">No active subscription matched this tool/event. Create one above (try the demo consumer).</p>}
            {result.deliveries.map((d) => (
              <div key={d.delivery_id} className="mono mt-1.5 truncate text-[10.5px] text-text3">
                {d.status === "delivered" ? "✓" : "✗"} {d.target_url} {d.response_status ? `(${d.response_status})` : d.error ? `(${d.error})` : ""}
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-text3">
          Emits a realistic sample payload for the chosen event and fans it out to every matching active subscription.
        </p>
      </div>
    </Panel>
  );
}
