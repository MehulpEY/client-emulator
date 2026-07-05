"use client";

// Fetch history tab (PLAN §6 W7): discovery runs for this adapter with
// expandable per-step detail. Polls every 5s while any run is still `running`;
// otherwise data refreshes on mount / manual refresh.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Database, History, RotateCw } from "lucide-react";
import { adaptersApi } from "@/lib/api-adapters";
import type { ConnectionRow, FetchRunRow, FetchRunStatus } from "@/lib/adapters/types";
import { Chip, EmptyState, Panel, SkeletonRows, StatusBadge, type ChipVariant } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { absTime, fmtInt, formatMs, Th } from "./shared";

const POLL_MS = 5000;
const LIMIT = 50;

const RUN_CHIP: Record<FetchRunStatus, ChipVariant> = {
  success: "ok",
  partial: "warn",
  failed: "danger",
  running: "info",
};

interface Props {
  toolId: string;
  /** For joining run.connectionId → label (from the shared detail poll). */
  connections: ConnectionRow[];
}

export function FetchHistoryPanel({ toolId, connections }: Props) {
  const [data, setData] = useState<{ reachable: boolean; runs: FetchRunRow[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const labelById = useMemo(() => new Map(connections.map((c) => [c.connectionId, c.label])), [connections]);

  // Sequence guard: a slow stale response never overwrites a fresher one.
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    return adaptersApi
      .fetches({ tool: toolId, limit: LIMIT })
      .then((d) => { if (mine === seq.current) setData(d); })
      .catch(() => { /* transient: retry on next poll */ });
  }, [toolId]);

  useEffect(() => {
    load();
  }, [load]);

  // 5s polling while any run is in flight — stops by itself once all settle.
  const anyRunning = data?.runs.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [anyRunning, load]);

  const runs = data?.runs ?? [];

  return (
    <Panel
      title="Fetch history"
      icon={<History size={14} />}
      noPadding
      actions={
        <div className="flex items-center gap-1.5">
          {runs.length > 0 ? <span className="chip tnum">{runs.length}{runs.length === LIMIT ? "+" : ""} runs</span> : null}
          <button onClick={() => load()} className="btn-ghost h-7 w-7 !px-0" title="Refresh"><RotateCw size={13} /></button>
        </div>
      }
    >
      {data === null ? (
        <SkeletonRows rows={5} />
      ) : !data.reachable ? (
        <EmptyState icon={Database} title="Database offline" sub="Fetch history lives in Supabase — reconnect it to see discovery runs." />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No fetch runs yet"
          sub={'Run "Fetch now" on a connection, use "Save & fetch", or wait for the schedule — every discovery cycle lands here.'}
        />
      ) : (
        <div className="emu-scroll overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead>
              <tr className="border-b border-hair text-left">
                <Th className="w-8" />
                <Th>Started</Th>
                <Th>Connection</Th>
                <Th>Trigger</Th>
                <Th>Status</Th>
                <Th className="text-right">Duration</Th>
                <Th>Records</Th>
                <Th title="Whether the run reused a live vendor session instead of re-authenticating">Session</Th>
                <Th>Error</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <RunRow
                  key={r.runId}
                  run={r}
                  label={labelById.get(r.connectionId) ?? r.connectionId}
                  open={open === r.runId}
                  onToggle={() => setOpen(open === r.runId ? null : r.runId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function RunRow({ run, label, open, onToggle }: { run: FetchRunRow; label: string; open: boolean; onToggle: () => void }) {
  const records = Object.entries(run.recordsByType).filter(([, n]) => (n ?? 0) > 0);
  return (
    <>
      <tr className="row cursor-pointer border-b border-hair last:border-0" onClick={onToggle}>
        <td className="py-2.5 pl-4 pr-0 text-text3">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-text2" title={absTime(run.startedAt)}>
          {relativeTime(run.startedAt)}
        </td>
        <td className="max-w-[180px] truncate px-4 py-2.5 font-semibold" title={label}>{label}</td>
        <td className="px-4 py-2.5"><Chip variant="muted">{run.trigger}</Chip></td>
        <td className="px-4 py-2.5">
          <Chip
            variant={RUN_CHIP[run.status]}
            icon={run.status === "running" ? <span aria-hidden className="animate-blink inline-block h-1.5 w-1.5 rounded-full bg-info" /> : undefined}
          >
            {run.status}
          </Chip>
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-right text-text2 tnum">
          {run.status === "running" ? "…" : formatMs(run.durationMs)}
        </td>
        <td className="px-4 py-2.5">
          {records.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {records.map(([t, n]) => (
                <Chip key={t} variant="muted" className="tnum">{t} {fmtInt(n)}</Chip>
              ))}
            </div>
          ) : (
            <span className="text-text3 tnum">{run.totalRecords > 0 ? fmtInt(run.totalRecords) : "—"}</span>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-text2"
            title={run.sessionReused ? "Reused a live vendor session (no re-authentication)" : "Minted a new vendor session"}
          >
            <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", run.sessionReused ? "bg-ok" : "bg-text3")} />
            {run.sessionReused ? "reused" : "new"}
          </span>
        </td>
        <td className="max-w-[220px] px-4 py-2.5">
          {run.error ? (
            <span className="block truncate text-[11.5px] text-danger" title={run.error}>{run.error}</span>
          ) : (
            <span className="text-text3">—</span>
          )}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-hair last:border-0">
          <td colSpan={9} className="px-4 pb-3 pt-0">
            <StepList run={run} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StepList({ run }: { run: FetchRunRow }) {
  if (run.steps.length === 0) {
    return <div className="sunk px-3 py-2 text-[11.5px] text-text3">No step detail recorded for this run.</div>;
  }
  return (
    <div className="sunk overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-hair px-3 py-2">
        <span className="label">Steps</span>
        <span className="text-[10.5px] text-text3 tnum">
          {run.requestsMade} request{run.requestsMade === 1 ? "" : "s"} · run {run.runId}
        </span>
      </div>
      {run.steps.map((s, i) => (
        <div key={`${s.op}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hair px-3 py-2 last:border-0">
          <span className="text-[12px] font-semibold">{s.op}</span>
          <span className="mono min-w-0 flex-1 truncate text-[11px] text-text3" title={s.path}>{s.path}</span>
          <StatusBadge status={s.status} />
          <span className="text-[11px] text-text2 tnum">{formatMs(s.ms)}</span>
          <span className="text-[11px] text-text2 tnum">{fmtInt(s.records)} records</span>
          {s.error ? (
            <span className="max-w-[280px] truncate text-[11px] text-danger" title={s.error}>{s.error}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
