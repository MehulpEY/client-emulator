// Shared presentation bits for the adapters UI (W7): the PLAN §4.7 status →
// variant mappings, monogram tile, status-dot clusters and small formatters.
// No "use client" directive — everything here is render-only and is consumed
// by the client components in this folder.

import type { ReactNode } from "react";
import type { ChipVariant } from "@/components/ui";
import type { AssetType, ConnectionSimulate, ConnectionStatus } from "@/lib/adapters/types";
import { cn } from "@/lib/cn";

/** PLAN §4.7: connected→ok, degraded→warn, error→danger, pending/connecting→info, disabled→muted. */
export const STATUS_CHIP: Record<ConnectionStatus, ChipVariant> = {
  connected: "ok",
  degraded: "warn",
  error: "danger",
  pending: "info",
  connecting: "info",
  disabled: "muted",
};

/** Dot colour per status (same semantic mapping as STATUS_CHIP). */
export const STATUS_DOT_BG: Record<ConnectionStatus, string> = {
  connected: "bg-ok",
  degraded: "bg-warn",
  error: "bg-danger",
  pending: "bg-info",
  connecting: "bg-info",
  disabled: "bg-text3",
};

/** Display order for rollup clusters (healthy → broken → idle). */
export const STATUS_ORDER: ConnectionStatus[] = [
  "connected", "degraded", "error", "connecting", "pending", "disabled",
];

/** Fault-injection modes with one-line explanations (edit modal + sim badges). */
export const SIMULATE_META: Record<ConnectionSimulate, { label: string; short: string; help: string }> = {
  none: {
    label: "None",
    short: "none",
    help: "Behave normally — no injected faults.",
  },
  revoked_credentials: {
    label: "Revoked credentials",
    short: "revoked creds",
    help: "Deactivates the provisioned credential so the tool genuinely returns 401 — the connection lands on error until simulate is cleared.",
  },
  unreachable: {
    label: "Unreachable",
    short: "unreachable",
    help: "Calls never reach the tool (simulated network failure) — repeated transient failures degrade, then error the connection.",
  },
  slow: {
    label: "Slow",
    short: "slow",
    help: "Adds heavy latency to every call — fetches crawl and heartbeats can degrade the connection.",
  },
};

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  device: "Devices",
  user: "Users",
  vulnerability: "Vulnerabilities",
  software: "Software",
  saas_app: "SaaS apps",
  alert: "Alerts",
};

const nf = new Intl.NumberFormat("en-US");
export function fmtInt(n: number | null | undefined): string {
  return nf.format(Number(n) || 0);
}

/** "840ms" / "1.2s" — compact duration. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

/** Absolute timestamp for title attributes ("" when absent/invalid). */
export function absTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** Session reuse ratio — reuses / (issued + reuses); "—" when nothing issued yet. */
export function sessionReusePct(issued: number, reuses: number): string {
  const total = (Number(issued) || 0) + (Number(reuses) || 0);
  if (total <= 0) return "—";
  return `${Math.round(((Number(reuses) || 0) / total) * 100)}%`;
}

/** Two-letter monogram from a display name ("CrowdStrike Falcon" → "CF"). */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/** Initials/logo tile — 2-letter monogram on the accent-soft surface. */
export function MonogramTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 select-none place-items-center rounded-md bg-accent-soft font-semibold tracking-[0.02em] text-accent-fg",
        className ?? "h-10 w-10 text-[13px]",
      )}
    >
      {monogram(name)}
    </span>
  );
}

/** Table header cell shared by the connections + fetch-history tables. */
export function Th({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold text-text3", className)} title={title}>
      {children}
    </th>
  );
}

export function StatusDot({ status, className }: { status: ConnectionStatus; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_DOT_BG[status], className)} />;
}

/**
 * Status dot cluster with per-status counts (dots never carry meaning alone —
 * each has a count, a title, and optionally the status word).
 */
export function StatusDots({
  byStatus, withLabels = false, emptyText = "no connections", className,
}: {
  byStatus: Partial<Record<ConnectionStatus, number>>;
  withLabels?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const entries = STATUS_ORDER.map((s) => [s, byStatus[s] ?? 0] as const).filter(([, n]) => n > 0);
  if (entries.length === 0) {
    return <span className={cn("text-[11px] text-text3", className)}>{emptyText}</span>;
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      {entries.map(([status, n]) => (
        <span
          key={status}
          title={`${n} ${status}`}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-text2"
        >
          <StatusDot status={status} />
          <span className="tnum">{n}</span>
          {withLabels ? <span className="text-text3">{status}</span> : null}
        </span>
      ))}
    </span>
  );
}
