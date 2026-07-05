"use client";

// /assets - the correlated inventory (PLAN §6 W8). Type tabs with live facet
// counts, search + source-tool filter chips, and a table where multi-source
// rows - the correlation win - stand out. Row click opens the evidence drawer.
// All data flows through lib/api-adapters.ts (adaptersApi.assets).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Database, GitMerge, Layers, RotateCw, Search, X } from "lucide-react";
import { adaptersApi, type AssetFacets } from "@/lib/api-adapters";
import type { AssetRow, AssetType } from "@/lib/adapters/types";
import { Chip, EmptyState, Panel, SkeletonRows } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ALWAYS_VISIBLE_TYPES, ASSET_TYPE_META, ASSET_TYPE_ORDER } from "./meta";
import { AssetDrawer } from "./AssetDrawer";

const LIMITS = [50, 100, 200]; // API caps at 200

// -- cells ---------------------------------------------------------------------

function IdValue({ value }: { value: string | null | undefined }) {
  return value
    ? <span className="mono text-[12px] text-text2">{value}</span>
    : <span className="text-[12px] text-text3">&mdash;</span>;
}

function NameCell({ a }: { a: AssetRow }) {
  const meta = ASSET_TYPE_META[a.assetType];
  const Icon = meta.icon;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="shrink-0 text-text3" title={meta.label}><Icon size={15} /></span>
      <span className="min-w-0 truncate text-[13px] font-medium text-text">{a.displayName}</span>
    </span>
  );
}

/**
 * The correlation-win cell. List responses carry sourceCount (not the per-source
 * rows), so multi-source assets get a visually distinct accent chip; when the API
 * does include sources[] (detail payloads), per-tool chips render instead.
 */
function SourcesCell({ a, toolName }: { a: AssetRow; toolName: (id: string) => string }) {
  const multi = a.sourceCount >= 2;
  const srcTools = a.sources?.length ? Array.from(new Set(a.sources.map((s) => s.toolId))) : null;
  if (srcTools) {
    const shown = srcTools.slice(0, 3);
    return (
      <span className="flex items-center gap-1">
        {shown.map((t) => (
          <Chip key={t} variant={multi ? "accent" : "default"} className="!h-[22px] !px-2 !text-[11px]">{toolName(t)}</Chip>
        ))}
        {srcTools.length > 3 ? <Chip variant="muted" className="!h-[22px] !px-2 !text-[11px]">+{srcTools.length - 3}</Chip> : null}
      </span>
    );
  }
  return (
    <Chip
      variant={multi ? "accent" : "muted"}
      icon={multi ? <GitMerge size={11} /> : undefined}
      title={multi ? "Correlated from multiple adapters - open the row for the evidence" : "Reported by a single source"}
    >
      <span className="tabular-nums">{a.sourceCount} {a.sourceCount === 1 ? "source" : "sources"}</span>
    </Chip>
  );
}

// -- columns ---------------------------------------------------------------------

interface Col {
  key: string;
  label: string;
  headClassName?: string;
  cellClassName?: string;
  render: (a: AssetRow) => ReactNode;
}

const idCol = (key: "hostname" | "serial" | "mac" | "email", label: string, hide?: string): Col => ({
  key,
  label,
  headClassName: hide,
  cellClassName: cn("whitespace-nowrap", hide),
  render: (a) => <IdValue value={a[key]} />,
});

const seenCol = (key: "firstSeen" | "lastSeen", label: string, hide?: string): Col => ({
  key,
  label,
  headClassName: cn("text-right", hide),
  cellClassName: cn("whitespace-nowrap text-right", hide),
  render: (a) => (
    <span className="text-[11.5px] tabular-nums text-text3" title={new Date(a[key]).toLocaleString()}>
      {relativeTime(a[key])}
    </span>
  ),
});

function columnsFor(type: AssetType | "", toolName: (id: string) => string): Col[] {
  const cols: Col[] = [
    { key: "name", label: "Name", cellClassName: "w-full min-w-[220px] max-w-0", render: (a) => <NameCell a={a} /> },
  ];
  if (type === "device") {
    cols.push(idCol("hostname", "Hostname", "hidden sm:table-cell"));
    cols.push(idCol("serial", "Serial", "hidden lg:table-cell"));
    cols.push(idCol("mac", "MAC", "hidden xl:table-cell"));
  } else if (type === "user") {
    cols.push(idCol("email", "Email", "hidden sm:table-cell"));
  } else if (type === "vulnerability") {
    cols.push(idCol("hostname", "Hostname", "hidden sm:table-cell"));
  } else {
    // All / software / saas_app / alert - the first identifier a source recorded.
    cols.push({
      key: "identifier",
      label: "Identifier",
      headClassName: "hidden sm:table-cell",
      cellClassName: "hidden whitespace-nowrap sm:table-cell",
      render: (a) => <IdValue value={a.hostname ?? a.email ?? a.serial ?? a.mac} />,
    });
  }
  cols.push({
    key: "sources",
    label: "Sources",
    cellClassName: "whitespace-nowrap",
    render: (a) => <SourcesCell a={a} toolName={toolName} />,
  });
  cols.push(seenCol("firstSeen", "First seen", "hidden md:table-cell"));
  cols.push(seenCol("lastSeen", "Last seen"));
  return cols;
}

// -- small controls ----------------------------------------------------------------

function TypeTab({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] transition-colors",
        active ? "font-semibold text-text" : "text-text2 hover:text-text",
      )}
    >
      {label}
      <span className="text-[11.5px] tabular-nums text-text3">{count}</span>
      {active ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] bg-accent" /> : null}
    </button>
  );
}

function ToolChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "chip shrink-0 cursor-pointer transition-colors",
        active ? "border-accent !bg-accent-soft !text-accent-fg" : "hover:border-borderStrong",
      )}
    >
      {label}
      <span className="tabular-nums text-text3">{count}</span>
    </button>
  );
}

// -- main ----------------------------------------------------------------------------

export function AssetsClient({ tools }: { tools: { id: string; name: string }[] }) {
  const [type, setType] = useState<AssetType | "">("");
  const [q, setQ] = useState("");
  const [tool, setTool] = useState("");
  const [limit, setLimit] = useState(LIMITS[0]);
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<AssetFacets>({ byType: {}, byTool: {} });
  const [reachable, setReachable] = useState(true);
  // Tab counts survive tab switches: the All response refreshes every type;
  // a typed response (facets are computed under the type filter) only its own.
  const [counts, setCounts] = useState<Partial<Record<AssetType, number>>>({});
  const [selected, setSelected] = useState<AssetRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;

  const nameById = useMemo(() => new Map(tools.map((t) => [t.id, t.name])), [tools]);
  const toolName = useCallback((id: string) => nameById.get(id) ?? id, [nameById]);

  const load = useCallback(async () => {
    try {
      const r = await adaptersApi.assets({
        type: type || undefined,
        q: qRef.current.trim() || undefined,
        tool: tool || undefined,
        limit,
      });
      setAssets(r.assets);
      setTotal(r.total);
      setFacets(r.facets);
      setReachable(r.reachable);
      setCounts((prev) => (type ? { ...prev, [type]: r.facets.byType[type] ?? 0 } : { ...r.facets.byType }));
    } catch {
      /* transient error: keep last state, retry on next action */
    }
  }, [type, tool, limit]);

  useEffect(() => { setAssets(null); load(); }, [load]);

  // Debounced search - the current list stays on screen while typing.
  useEffect(() => {
    const id = setTimeout(load, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  const allCount = useMemo(() => Object.values(counts).reduce((s, n) => s + (n ?? 0), 0), [counts]);
  const visibleTypes = ASSET_TYPE_ORDER.filter(
    (t) => ALWAYS_VISIBLE_TYPES.includes(t) || (counts[t] ?? 0) > 0 || type === t,
  );

  const toolFacets = useMemo(() => {
    const entries = Object.entries(facets.byTool)
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => b.n - a.n || toolName(a.id).localeCompare(toolName(b.id)));
    // Keep an active chip visible even when the current facet base drops it.
    if (tool && !entries.some((e) => e.id === tool)) entries.unshift({ id: tool, n: 0 });
    return entries;
  }, [facets, tool, toolName]);

  const cols = useMemo(() => columnsFor(type, toolName), [type, toolName]);
  const hasFilters = Boolean(q.trim() || tool || type);

  return (
    <div>
      {/* Type tabs */}
      <div className="emu-scroll mb-4 flex items-end gap-1 overflow-x-auto border-b border-hair">
        <TypeTab active={type === ""} label="All" count={allCount} onClick={() => setType("")} />
        {visibleTypes.map((t) => (
          <TypeTab key={t} active={type === t} label={ASSET_TYPE_META[t].plural} count={counts[t] ?? 0} onClick={() => setType(t)} />
        ))}
      </div>

      <Panel
        noPadding
        title="Correlated inventory"
        actions={
          <button onClick={refresh} className="btn-ghost h-7 w-7 !px-0" title="Refresh" disabled={refreshing}>
            <RotateCw size={13} className={refreshing ? "animate-spin" : undefined} />
          </button>
        }
      >
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hair p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              className="field !h-8 pl-9"
              placeholder="Search name, hostname, email, serial..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text3 hover:text-text" aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <select className="field !h-8 w-auto" value={limit} onChange={(e) => setLimit(Number(e.target.value))} title="Rows to load">
            {LIMITS.map((n) => <option key={n} value={n}>{n} rows</option>)}
          </select>
          <span className="text-[11.5px] tabular-nums text-text3">
            {assets ? <>Showing {assets.length} of {total}</> : "Loading..."}
          </span>
        </div>

        {/* Source-tool filter chips */}
        {toolFacets.length > 0 && (
          <div className="emu-scroll flex items-center gap-1.5 overflow-x-auto border-b border-hair px-3 py-2">
            <span className="label shrink-0">Sources</span>
            {toolFacets.map((f) => (
              <ToolChip
                key={f.id}
                active={tool === f.id}
                label={toolName(f.id)}
                count={f.n}
                onClick={() => setTool(tool === f.id ? "" : f.id)}
              />
            ))}
          </div>
        )}

        {/* Body */}
        {assets === null ? (
          <SkeletonRows rows={8} />
        ) : !reachable ? (
          <EmptyState
            icon={Database}
            title="Database offline"
            sub="The asset inventory lives in Supabase. Reconnect the database, then run a discovery fetch to browse correlated assets."
          />
        ) : assets.length === 0 ? (
          hasFilters ? (
            <EmptyState icon={Layers} title="No assets match" sub="Try a different search term, type tab or source filter." />
          ) : (
            <EmptyState
              icon={Layers}
              title="No assets yet"
              sub="Assets appear after a discovery fetch runs. Open the Adapters page, add a connection and run a fetch to populate the inventory."
            />
          )
        ) : (
          <div className="emu-scroll max-h-[calc(100vh-350px)] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-hair">
                  {cols.map((c) => (
                    <th key={c.key} className={cn("px-4 py-2 text-[11px] font-semibold text-text3", c.headClassName)}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr
                    key={a.assetId}
                    tabIndex={0}
                    className="row cursor-pointer border-b border-hair last:border-0"
                    onClick={() => setSelected(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(a); }
                    }}
                  >
                    {cols.map((c) => (
                      <td key={c.key} className={cn("px-4 py-2.5 align-middle", c.cellClassName)}>{c.render(a)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AssetDrawer asset={selected} onClose={() => setSelected(null)} toolName={toolName} />
    </div>
  );
}
