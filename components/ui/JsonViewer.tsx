"use client";

import { useMemo, useState } from "react";
import { Braces, Check, AlertTriangle, Copy, WrapText } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "@/lib/cn";

interface JsonViewerProps {
  open: boolean;
  onClose: () => void;
  /** Raw JSON string OR an already-parsed value. */
  value: unknown;
  title?: string;
}

/** Best-effort parse: accepts a string (parsed) or an already-structured value. */
function analyze(value: unknown): { ok: boolean; pretty: string; error?: string; lines: number } {
  let obj: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, pretty: "", error: "Empty - nothing to format.", lines: 0 };
    try {
      obj = JSON.parse(trimmed);
    } catch (e: any) {
      return { ok: false, pretty: trimmed, error: e?.message || "Invalid JSON", lines: trimmed.split("\n").length };
    }
  }
  try {
    const pretty = JSON.stringify(obj, null, 2);
    return { ok: true, pretty: pretty ?? String(obj), lines: (pretty ?? "").split("\n").length };
  } catch {
    return { ok: false, pretty: String(obj), error: "Value is not serializable to JSON.", lines: 1 };
  }
}

/** Modal that pretty-prints + validates JSON, with copy and line-wrap toggles. */
export function JsonViewer({ open, onClose, value, title = "JSON viewer" }: JsonViewerProps) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const { ok, pretty, error, lines } = useMemo(() => analyze(value), [value]);

  async function copy() {
    try { await navigator.clipboard.writeText(pretty); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      icon={<Braces size={14} />}
      title={
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold">{title}</span>
          {ok ? (
            <span className="chip !text-ok"><Check size={11} /> Valid</span>
          ) : (
            <span className="chip !text-danger"><AlertTriangle size={11} /> Invalid</span>
          )}
          {ok ? <span className="chip">{lines} lines</span> : null}
        </div>
      }
      footer={
        <>
          <button className={cn("btn-ghost", wrap && "border-accent !text-accent-fg")} onClick={() => setWrap((w) => !w)}>
            <WrapText size={13} /> {wrap ? "No wrap" : "Wrap"}
          </button>
          <button className="btn-primary" onClick={copy} disabled={!pretty}>
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
        </>
      }
    >
      {!ok && error ? (
        <div className="mb-3 flex items-start gap-2 border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <pre
        className={cn(
          "emu-scroll mono max-h-[62vh] overflow-auto bg-surface-sunk p-3 text-[12px] leading-relaxed",
          ok ? "text-text2" : "text-text3",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        )}
      >
        {pretty || "-"}
      </pre>
    </Modal>
  );
}

/** Small inline button that opens a JsonViewer for the given value. */
export function JsonViewerButton({ value, title, label = "View", className }: { value: unknown; title?: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={cn("btn-ghost h-6 !text-[11px]", className)} onClick={() => setOpen(true)} title="Open JSON viewer">
        <Braces size={12} /> {label}
      </button>
      <JsonViewer open={open} onClose={() => setOpen(false)} value={value} title={title} />
    </>
  );
}

export default JsonViewer;
