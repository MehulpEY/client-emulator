"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, PlugZap, Search, X } from "lucide-react";
import { adaptersApi } from "@/lib/api-adapters";
import type { AdapterSummary, ConnectionStatus } from "@/lib/adapters/types";
import type { CategoryId } from "@/lib/tools/types";
import { CATEGORIES, categoryLabel } from "@/lib/tools/categories";
import { CategoryIcon } from "@/lib/icons";
import { EmptyState, SkeletonCards, SkeletonStats, Stat } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AdapterCard } from "./AdapterCard";
import { absTime, ASSET_TYPE_LABEL, fmtInt, StatusDots } from "./shared";

const REFRESH_MS = 15_000;

interface CatalogData {
  reachable: boolean;
  adapters: AdapterSummary[];
}

export function AdaptersCatalog({ initialCategory }: { initialCategory?: string }) {
  const [data, setData] = useState<CatalogData | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(
    initialCategory && CATEGORIES.some((c) => c.id === initialCategory) ? initialCategory : "all",
  );
  const [configuredOnly, setConfiguredOnly] = useState(false);

  const load = useCallback(
    () => adaptersApi.list().then(setData).catch(() => { /* transient error: keep last state, retry on next poll */ }),
    [],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const adapters = useMemo(() => data?.adapters ?? [], [data]);

  // -- header stats (derived from the same rollup call) ------------------------
  const stats = useMemo(() => {
    const byStatus: Partial<Record<ConnectionStatus, number>> = {};
    let connections = 0;
    let records = 0;
    let endpoints = 0;
    let lastFetch: string | null = null;
    for (const a of adapters) {
      connections += a.connectionCount;
      records += a.totalRecords;
      endpoints += a.endpointCount;
      for (const [s, n] of Object.entries(a.connectionsByStatus) as [ConnectionStatus, number | undefined][]) {
        byStatus[s] = (byStatus[s] ?? 0) + (n ?? 0);
      }
      if (a.lastFetchAt && (!lastFetch || new Date(a.lastFetchAt).getTime() > new Date(lastFetch).getTime())) {
        lastFetch = a.lastFetchAt;
      }
    }
    return { adapters: adapters.length, connections, records, endpoints, byStatus, lastFetch };
  }, [adapters]);

  const cats = useMemo(
    () =>
      CATEGORIES.map((c) => ({ ...c, count: adapters.filter((a) => a.categories.includes(c.id)).length })).filter(
        (c) => c.count > 0,
      ),
    [adapters],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return adapters.filter((a) => {
      if (category !== "all" && !a.categories.includes(category as CategoryId)) return false;
      if (configuredOnly && a.connectionCount === 0) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.vendor ?? "").toLowerCase().includes(q) ||
        a.blurb.toLowerCase().includes(q) ||
        a.assetTypes.some((t) => ASSET_TYPE_LABEL[t].toLowerCase().includes(q)) ||
        a.categories.some((c) => categoryLabel(c).toLowerCase().includes(q))
      );
    });
  }, [adapters, query, category, configuredOnly]);

  const configured = useMemo(() => filtered.filter((a) => a.connectionCount > 0), [filtered]);
  const unconfigured = useMemo(() => filtered.filter((a) => a.connectionCount === 0), [filtered]);

  if (data === null) {
    return (
      <div className="space-y-4">
        <SkeletonStats count={4} />
        <SkeletonCards count={9} />
      </div>
    );
  }

  return (
    <div>
      {/* Stat row */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Adapters" value={stats.adapters} sub={<span className="tnum">{fmtInt(stats.endpoints)} live endpoints</span>} />
        <Stat
          label="Connections"
          value={stats.connections}
          sub={<StatusDots byStatus={stats.byStatus} emptyText="none configured yet" />}
        />
        <Stat label="Records fetched" value={fmtInt(stats.records)} sub="across all connections" />
        <Stat
          label="Last discovery"
          value={stats.lastFetch ? <span title={absTime(stats.lastFetch)}>{relativeTime(stats.lastFetch)}</span> : "—"}
          sub={stats.lastFetch ? "most recent fetch cycle" : "no fetches yet"}
        />
      </div>

      {!data.reachable && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warn-line bg-warn-bg px-4 py-3 text-[12.5px] leading-relaxed text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            Database offline — the catalog renders from code, but connection status, fetch history and record counts are
            unavailable until Supabase is reachable.
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search adapters, vendors, asset types..."
              className="field !h-9 pl-9"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text3 hover:text-text" aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setConfiguredOnly((v) => !v)}
            className={cn("btn-ghost !h-9", configuredOnly && "border-accent !bg-accent-soft !text-accent-fg")}
            title="Show only adapters with at least one connection"
          >
            <PlugZap size={14} /> Configured only
          </button>
        </div>

        <div className="emu-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip active={category === "all"} onClick={() => setCategory("all")} label="All" count={adapters.length} />
          {cats.map((c) => (
            <FilterChip
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
              label={c.label}
              count={c.count}
              icon={<CategoryIcon id={c.id} size={12} />}
            />
          ))}
        </div>
      </div>

      <div className="mb-3 text-[11.5px] text-text3 tnum">
        {filtered.length} of {adapters.length} adapters
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No adapters match"
          sub={configuredOnly ? "No configured adapters match — clear the filter or add a connection first." : "Try a different search term or category."}
        />
      ) : configured.length > 0 ? (
        <div className="space-y-5">
          <section>
            <SectionHeader label="Configured" count={configured.length} total={adapters.length} />
            <Grid adapters={configured} />
          </section>
          {!configuredOnly && unconfigured.length > 0 && (
            <section>
              <SectionHeader label="Not configured" count={unconfigured.length} />
              <Grid adapters={unconfigured} />
            </section>
          )}
        </div>
      ) : (
        <Grid adapters={filtered} />
      )}
    </div>
  );
}

function Grid({ adapters }: { adapters: AdapterSummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
      {adapters.map((a) => (
        <AdapterCard key={a.toolId} adapter={a} />
      ))}
    </div>
  );
}

/** Axonius-style section header: "Configured (5 of 23)". */
function SectionHeader({ label, count, total }: { label: string; count: number; total?: number }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-1.5 text-[12px] font-semibold text-text2">
      {label}
      <span className="font-normal text-text3 tnum">({count}{total !== undefined ? ` of ${total}` : ""})</span>
    </div>
  );
}

function FilterChip({
  active, onClick, label, count, icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "chip shrink-0 cursor-pointer transition-colors",
        active ? "border-accent !bg-accent-soft !text-accent-fg" : "hover:border-borderStrong",
      )}
    >
      {icon}
      {label}
      <span className="tabular-nums text-text3">{count}</span>
    </button>
  );
}
