import { cn } from "@/lib/cn";

/** HTTP method pill — colour-coded, monospace, squared. */
const METHOD_TONE: Record<string, string> = {
  GET: "text-info border-info-line bg-info-bg",
  POST: "text-ok border-ok-line bg-ok-bg",
  PUT: "text-warn border-warn-line bg-warn-bg",
  PATCH: "text-warn border-warn-line bg-warn-bg",
  DELETE: "text-danger border-danger-line bg-danger-bg",
};

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const m = method.toUpperCase();
  return (
    <span
      className={cn(
        "mono inline-flex h-5 items-center border px-1.5 text-[10.5px] font-bold tracking-wide",
        METHOD_TONE[m] || "text-text2 border-border bg-surface-sunk",
        className
      )}
    >
      {m}
    </span>
  );
}

/** HTTP status pill — green 2xx, amber 4xx, red 5xx. */
export function StatusBadge({ status, className }: { status: number; className?: string }) {
  const tone =
    status >= 500 ? "text-danger border-danger-line bg-danger-bg"
    : status >= 400 ? "text-warn border-warn-line bg-warn-bg"
    : status >= 200 && status < 300 ? "text-ok border-ok-line bg-ok-bg"
    : "text-text2 border-border bg-surface-sunk";
  return (
    <span className={cn("mono inline-flex h-5 items-center border px-1.5 text-[10.5px] font-bold tnum", tone, className)}>
      {status}
    </span>
  );
}

/** Small uppercase tag for a tool category. */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("chip text-[10px] uppercase tracking-[0.06em]", className)}>{children}</span>
  );
}
