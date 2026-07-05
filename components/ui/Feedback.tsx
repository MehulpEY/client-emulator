import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ label, className }: { label?: ReactNode; className?: string }) {
  // The ring inherits `currentColor` so it stays visible on any surface.
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px]", className)}>
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </span>
  );
}

/** Plain sentence-case section label (no leading square). */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("label mb-3", className)}>{children}</div>;
}

/** Signature eyebrow - yellow square + uppercase micro-label. */
export function Eyebrow({ children, accent = false, className }: { children: ReactNode; accent?: boolean; className?: string }) {
  return <span className={cn("eyebrow", accent && "accent", className)}>{children}</span>;
}

/** Thin accent keyline (decorative rule). The `thin`/`warm` props are kept for
 *  API compatibility - the calm system renders a single 2px accent rule. */
export function SpectrumLine({ className }: { thin?: boolean; warm?: boolean; className?: string }) {
  return <span aria-hidden className={cn("accent-line", className)} />;
}

export function EmptyState({ icon: Icon, title, sub, action }: { icon: LucideIcon; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-text3">
      <Icon size={26} />
      <div className="text-[13px] font-semibold text-text2">{title}</div>
      {sub && <div className="max-w-md text-[12px]">{sub}</div>}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
