"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, RotateCw, Trash2, ListTree, Pause, Play } from "lucide-react";
import { api } from "@/lib/api";
import type { LogRow } from "@/lib/types";
import { Panel, SkeletonRows, EmptyState, Spinner, useConfirm } from "@/components/ui";
import { LogList } from "./LogList";

export function LogsClient({ tools }: { tools: { id: string; name: string }[] }) {
  const confirm = useConfirm();
  const [tool, setTool] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [auto, setAuto] = useState(true);
  const [clearing, setClearing] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;

  const load = useCallback(async () => {
    try {
      const r = await api.logs({ tool: tool || undefined, status: status || undefined, q: qRef.current || undefined, limit: 200 });
      setLogs(r.logs); setReachable(r.reachable);
    } catch { /* transient error: keep last state, retry on next poll */ }
  }, [tool, status]);

  useEffect(() => { setLogs(null); load(); }, [load]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [auto, load]);

  // debounce search
  useEffect(() => {
    const id = setTimeout(load, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function clear() {
    const label = tool ? tools.find((t) => t.id === tool)?.name || tool : null;
    if (!(await confirm({ title: "Clear request trace", message: label ? <>Clear the request trace for <span className="mono text-text">{label}</span>?</> : "Clear the entire request trace? This removes all logged calls.", confirmLabel: "Clear trace", danger: true }))) return;
    setClearing(true);
    try { await api.clearLogs(tool || undefined); await load(); } finally { setClearing(false); }
  }

  return (
    <Panel
      noPadding
      title="Request Trace"
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={() => setAuto((a) => !a)} className="btn-ghost h-7 !text-[11px]" title={auto ? "Pause auto-refresh" : "Resume auto-refresh"}>
            {auto ? <Pause size={12} /> : <Play size={12} />} {auto ? "Live" : "Paused"}
          </button>
          <button onClick={load} className="btn-ghost h-7 w-7 !px-0" title="Refresh"><RotateCw size={13} /></button>
          <button onClick={clear} className="btn-danger h-7 !text-[11px]" disabled={clearing || !reachable}>{clearing ? <Spinner /> : <><Trash2 size={12} /> Clear</>}</button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-hair p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
          <input className="field !h-8 pl-9" placeholder="Search path / operation / tool..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="field !h-8 w-auto" value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="">All tools</option>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="field !h-8 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="2xx">2xx success</option>
          <option value="4xx">4xx client</option>
          <option value="5xx">5xx server</option>
        </select>
      </div>

      {logs === null ? (
        <SkeletonRows rows={10} />
      ) : !reachable ? (
        <EmptyState icon={ListTree} title="Database offline" sub="The request trace is stored in Supabase. Reconnect to view logged calls." />
      ) : logs.length === 0 ? (
        <EmptyState icon={ListTree} title="No matching requests" sub="Calls made by agents against the emulator appear here in real time." />
      ) : (
        <div className="emu-scroll max-h-[calc(100vh-260px)] overflow-y-auto"><LogList logs={logs} /></div>
      )}
    </Panel>
  );
}
