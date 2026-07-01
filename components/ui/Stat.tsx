import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StatTone = "default" | "accent" | "ok" | "warn" | "danger" | "info";

const TONE: Record<StatTone, string> = {
  default: "text-text",
  accent: "text-accent-fg",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
};

/** Big-number stat tile for the overview header. */
export function Stat({
  label, value, sub, icon, tone = "default", className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={cn("panel p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="label">{label}</div>
        {icon ? <span className="text-text3">{icon}</span> : null}
      </div>
      <div className={cn("mt-2 text-[26px] font-bold leading-none tnum", TONE[tone])}>{value}</div>
      {sub ? <div className="mt-1.5 text-[11.5px] text-text2">{sub}</div> : null}
    </div>
  );
}

export default Stat;
