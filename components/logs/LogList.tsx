"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { LogRow } from "@/lib/types";
import { MethodBadge, StatusBadge, Chip } from "@/components/ui";
import { relativeTime, prettyJson } from "@/lib/format";
import { cn } from "@/lib/cn";

function Row({ log }: { log: LogRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hair last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="row flex w-full items-center gap-3 px-4 py-2.5 text-left">
        <ChevronRight size={13} className={cn("shrink-0 text-text3 transition-transform", open && "rotate-90")} />
        <MethodBadge method={log.method} />
        <span className="hidden w-28 shrink-0 truncate text-[12px] font-bold text-text2 sm:block">{log.tool_slug}</span>
        <span className="mono min-w-0 flex-1 truncate text-[12px] text-text2">{log.path.replace(/^\/api\/mock\//, "")}</span>
        {log.scenario ? <Chip variant="warn" className="hidden md:inline-flex">{log.scenario}</Chip> : null}
        {!log.authorized && log.matched ? <Chip variant="danger" className="hidden md:inline-flex">401</Chip> : null}
        <span className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums text-text3 sm:block">{log.latency_ms}ms</span>
        <StatusBadge status={log.status} />
        <span className="hidden w-20 shrink-0 text-right text-[11px] text-text3 lg:block">{relativeTime(log.created_at)}</span>
      </button>
      {open && (
        <div className="grid gap-3 bg-surface-sunk px-4 py-3 lg:grid-cols-2">
          <div>
            <div className="label mb-1">Request{log.operation ? ` | ${log.operation}` : ""}</div>
            <pre className="emu-scroll mono max-h-64 overflow-auto bg-surface p-2.5 text-[11px] leading-relaxed text-text2">
{prettyJson({ query: log.query, headers: log.request_headers, body: log.request_body })}
            </pre>
          </div>
          <div>
            <div className="label mb-1">Response | {log.status}</div>
            <pre className="emu-scroll mono max-h-64 overflow-auto bg-surface p-2.5 text-[11px] leading-relaxed text-text2">
{prettyJson(log.response_body)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function LogList({ logs }: { logs: LogRow[] }) {
  return (
    <div>
      {logs.map((l) => <Row key={l.log_id} log={l} />)}
    </div>
  );
}
