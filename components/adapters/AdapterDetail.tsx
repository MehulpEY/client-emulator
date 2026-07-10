"use client";

// Adapter detail (PLAN §6 W7): header with live status rollup + tabbed body.
// One 5s poll (adaptersApi.get) feeds the header AND the Connections tab; the
// remaining tabs reuse the existing tool components with the same props the
// old /tools/[tool] page passed them. The active tab persists in the URL hash.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, BookOpen, ShieldCheck } from "lucide-react";
import { adaptersApi } from "@/lib/api-adapters";
import type { AdapterMeta, AdapterSummary, ConnectionRow } from "@/lib/adapters/types";
import type { EndpointView } from "@/lib/tools/registry";
import type { AuthType } from "@/lib/tools/types";
import { categoryLabel } from "@/lib/tools/categories";
import { CategoryIcon } from "@/lib/icons";
import { Chip, CopyButton, Skeleton } from "@/components/ui";
import { EndpointConsole } from "@/components/tools/EndpointConsole";
import { ToolEvents } from "@/components/tools/ToolEvents";
import { ToolAutomation } from "@/components/tools/ToolAutomation";
import { ToolState } from "@/components/tools/ToolState";
import { ToolKeys } from "@/components/tools/ToolKeys";
import { ToolLogs } from "@/components/tools/ToolLogs";
import { cn } from "@/lib/cn";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { FetchHistoryPanel } from "./FetchHistoryPanel";
import { ASSET_TYPE_LABEL, fmtInt, StatusDots } from "./shared";
import { BrandLogo } from "@/components/BrandLogo";

const POLL_MS = 5000;

const TAB_IDS = ["connections", "fetch-history", "endpoints", "events", "automation", "state", "keys", "logs"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABEL: Record<TabId, string> = {
  connections: "Connections",
  "fetch-history": "Fetch history",
  endpoints: "Endpoints",
  events: "Events",
  automation: "Automation",
  state: "State",
  keys: "Keys",
  logs: "Logs",
};

function isTab(v: string): v is TabId {
  return (TAB_IDS as readonly string[]).includes(v);
}

/** The slice of the /api/adapters/[tool] response this page consumes. */
interface DetailData {
  reachable: boolean;
  adapter: AdapterSummary;
  connections: ConnectionRow[];
}

const AUTH_LABEL: Record<AuthType, string> = {
  api_key_header: "API key (header)",
  api_key_query: "API key (query)",
  bearer: "Bearer token",
  basic: "Basic auth",
  none: "No auth",
};

export interface AdapterDetailProps {
  toolId: string;
  name: string;
  vendor?: string;
  blurb: string;
  docsUrl?: string;
  auth: { type: AuthType; param?: string };
  basePath: string;
  baseUrl: string;
  endpoints: EndpointView[];
  meta: AdapterMeta;
  serverless: boolean;
  /** Connection CRUD is admin-only server-side — gates those affordances. */
  isAdmin: boolean;
}

export function AdapterDetail({
  toolId, name, vendor, blurb, docsUrl, auth, basePath, baseUrl, endpoints, meta, serverless, isAdmin,
}: AdapterDetailProps) {
  const [tab, setTab] = useState<TabId>("connections");
  const [data, setData] = useState<DetailData | null>(null);

  // Tab state persists in the URL hash (deep-linkable, survives refresh).
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (isTab(h)) setTab(h);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const select = useCallback((t: TabId) => {
    setTab(t);
    window.history.replaceState(null, "", `#${t}`);
  }, []);

  // Monotonic sequence so a slow in-flight poll can never overwrite the fresher
  // state a mutation-triggered reload just wrote.
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    return adaptersApi
      .get(toolId)
      .then((d) => { if (mine === seq.current) setData(d); })
      .catch(() => { /* transient error: keep last state, retry on next poll */ });
  }, [toolId]);

  useEffect(() => {
    load();
    // Skip ticks while the tab is hidden — one poll after re-focus catches up.
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const adapter = data?.adapter;
  const reachable = data?.reachable ?? true;
  const connections = data?.connections ?? [];

  return (
    <div>
      <Link href="/adapters" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-text3 hover:text-text">
        <ArrowLeft size={14} /> Adapters
      </Link>

      {/* Header */}
      <div className="panel mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <BrandLogo toolId={toolId} name={name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-[-0.01em]">{name}</h1>
              {vendor ? <span className="text-[13px] text-text3">by {vendor}</span> : null}
            </div>
            <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-text2">{blurb}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {meta.categories.map((c) => (
                <Chip key={c} icon={<CategoryIcon id={c} size={11} />}>{categoryLabel(c)}</Chip>
              ))}
              {meta.assetTypes.length > 0 ? (
                <span className="ml-1 text-[11px] text-text3">
                  {meta.assetTypes.map((a) => ASSET_TYPE_LABEL[a]).join(" · ")}
                </span>
              ) : null}
            </div>
          </div>

          {/* Live rollup */}
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <div className="sm:text-right">
              <div className="label">Records fetched</div>
              <div className="mt-1 text-[22px] font-semibold leading-none tnum">
                {adapter ? fmtInt(adapter.totalRecords) : <Skeleton className="inline-block h-5 w-14" />}
              </div>
            </div>
            {adapter ? (
              <StatusDots byStatus={adapter.connectionsByStatus} withLabels emptyText="no connections yet" />
            ) : (
              <Skeleton className="h-3.5 w-28" />
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hair pt-3">
          <div className="mono flex min-w-0 items-center gap-2 text-[11.5px] text-text2">
            <span className="label shrink-0">Base URL</span>
            <span className="truncate" title={baseUrl}>{baseUrl}</span>
          </div>
          <CopyButton value={baseUrl} label="Copy" className="h-7 !text-[11px]" />
          {docsUrl ? (
            <a href={docsUrl} target="_blank" rel="noreferrer" className="btn-ghost h-7 !text-[11px]">
              <BookOpen size={12} /> Vendor docs
            </a>
          ) : null}
          <span className="chip" title="Authentication scheme">
            <ShieldCheck size={12} /> {AUTH_LABEL[auth.type]}{auth.param ? ` | ${auth.param}` : ""}
          </span>
          <span className="chip tnum">{endpoints.length} endpoints</span>
          {adapter ? <span className="chip tnum">{adapter.connectionCount} connection{adapter.connectionCount === 1 ? "" : "s"}</span> : null}
          {data && !data.reachable ? (
            <Chip variant="warn" icon={<AlertTriangle size={11} />} title="Live connection data is unavailable until Supabase is reachable">
              database offline
            </Chip>
          ) : null}
        </div>
      </div>

      {/* Tab bar */}
      <div className="emu-scroll mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Adapter sections">
        {TAB_IDS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => select(t)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 border-transparent px-3.5 py-2.5 text-[13px] font-medium text-text2 transition-colors hover:text-text",
              tab === t && "border-accent font-semibold text-text",
            )}
          >
            {TAB_LABEL[t]}
            {t === "connections" && adapter && adapter.connectionCount > 0 ? (
              <span className="ml-1.5 text-[11px] text-text3 tnum">{adapter.connectionCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content — only the active tab is mounted */}
      {tab === "connections" ? (
        <ConnectionsPanel
          toolId={toolId}
          toolName={name}
          meta={meta}
          connections={data ? connections : null}
          reachable={reachable}
          isAdmin={isAdmin}
          baseUrl={baseUrl}
          endpoints={endpoints}
          onChanged={load}
        />
      ) : null}
      {tab === "fetch-history" ? <FetchHistoryPanel toolId={toolId} connections={connections} /> : null}
      {tab === "endpoints" ? (
        <div className="min-w-0">
          <EndpointConsole toolId={toolId} basePath={basePath} auth={auth} endpoints={endpoints} />
        </div>
      ) : null}
      {tab === "events" ? (
        <div className="max-w-3xl"><ToolEvents toolId={toolId} /></div>
      ) : null}
      {tab === "automation" ? (
        <div className="max-w-3xl"><ToolAutomation toolId={toolId} serverless={serverless} /></div>
      ) : null}
      {tab === "state" ? (
        <div className="max-w-3xl"><ToolState toolId={toolId} /></div>
      ) : null}
      {tab === "keys" ? (
        <div className="max-w-3xl"><ToolKeys toolId={toolId} /></div>
      ) : null}
      {tab === "logs" ? (
        <div className="min-w-0"><ToolLogs toolId={toolId} /></div>
      ) : null}
    </div>
  );
}
