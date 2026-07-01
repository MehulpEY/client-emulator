import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ChipVariant = "default" | "accent" | "ok" | "info" | "warn" | "danger" | "muted";

export interface ChipProps {
  children: ReactNode;
  variant?: ChipVariant;
  icon?: ReactNode;
  className?: string;
  title?: string;
}

const VARIANTS: Record<ChipVariant, string> = {
  default: "",
  accent: "border-accent/50 text-accent-fg bg-accent-soft",
  ok: "border-ok-line text-ok bg-ok-bg",
  info: "border-info-line text-info bg-info-bg",
  warn: "border-warn-line text-warn bg-warn-bg",
  danger: "border-danger-line text-danger bg-danger-bg",
  muted: "text-text3",
};

/** Squared hairline tag. Variants carry meaning via state colour. */
export function Chip({ children, variant = "default", icon, className, title }: ChipProps) {
  return (
    <span className={cn("chip", VARIANTS[variant], className)} title={title}>
      {icon ? <span className="grid place-items-center">{icon}</span> : null}
      {children}
    </span>
  );
}

export default Chip;
