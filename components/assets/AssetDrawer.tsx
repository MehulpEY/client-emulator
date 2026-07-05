"use client";

// Asset evidence drawer (PLAN §6 W8) - the "explainable correlation" surface.
// Header + correlation keys + merged summary render instantly from the list
// row; the per-source evidence cards (which rule merged each source, the
// normalized fields it contributed, the raw vendor record, the fetch run that
// carried it) stream in via adaptersApi.asset(id).

import { useEffect, useState } from "react";
import { AlertTriangle, GitMerge, Plus } from "lucide-react";
import { adaptersApi } from "@/lib/api-adapters";
import type { AssetRow, AssetSourceRow, CorrelationRule } from "@/lib/adapters/types";
import { Chip, CopyButton, JsonViewerButton, Modal, Panel, SectionLabel, SkeletonPanel } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ASSET_TYPE_META, idLike } from "./meta";

const KEY_FIELDS = ["hostname", "serial", "mac", "email"] as const;

/** "Matched by serial" / "First source" - the rule that merged this evidence. */
function RuleChip({ rule }: { rule?: CorrelationRule | null }) {
  if (!rule) return null;
  if (rule === "new") {
    return <Chip variant="muted" icon={<Plus size={11} />} title="This source created the asset">First source</Chip>;
  }
  return (
    <Chip variant="accent" icon={<GitMerge size={11} />} title={`Merged into this asset because the ${rule} matched an existing source`}>
      Matched by {rule}
    </Chip>
  );
}

function KvRow({ k, v }: { k: string; v: unknown }) {
  const present = v !== null && v !== undefined && v !== "";
  const s = present ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : "—";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hair py-1.5 last:border-0">
      <span className="shrink-0 text-[11.5px] font-medium text-text3">{k}</span>
      <span
        className={cn("min-w-0 truncate text-right text-[12px]", present ? "text-text2" : "text-text3", present && idLike(v) && "mono")}
        title={present ? s : undefined}
      >
        {s}
      </span>
    </div>
  );
}

/** One adapter's evidence: who reported it, why it merged, what it contributed. */
function SourceCard({ source, toolName }: { source: AssetSourceRow; toolName: (id: string) => string }) {
  const fields = Object.entries(source.normalized ?? {});
  return (
    <Panel
      title={
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold">{toolName(source.toolId)}</span>
          <span className="mono max-w-[150px] truncate text-[11px] font-normal text-text3" title={source.connectionId}>
            {source.connectionId}
          </span>
        </div>
      }
      actions={<RuleChip rule={source.correlationRule} />}
      bodyClassName="!p-4"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text3">
        <span className="mono" title="Vendor-side record id">{source.externalId}</span>
        <span>First seen {relativeTime(source.firstSeen)}</span>
        <span>Last seen {relativeTime(source.lastSeen)}</span>
      </div>
      {fields.length > 0 ? (
        <div>{fields.map(([k, v]) => <KvRow key={k} k={k} v={v} />)}</div>
      ) : (
        <div className="text-[12px] text-text3">No normalized fields recorded.</div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <JsonViewerButton value={source.raw ?? {}} title={`${toolName(source.toolId)} raw record`} label="Raw record" />
        {source.fetchRunId ? (
          <span className="mono text-[11px] text-text3" title="Discovery run that last carried this record">
            run {source.fetchRunId}
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

export function AssetDrawer({
  asset,
  onClose,
  toolName,
}: {
  /** The list row - renders the header/summary instantly while sources load. */
  asset: AssetRow | null;
  onClose: () => void;
  toolName: (id: string) => string;
}) {
  const [detail, setDetail] = useState<AssetRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assetId = asset?.assetId ?? null;

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!assetId) return;
    let cancelled = false;
    adaptersApi
      .asset(assetId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.asset) setDetail(r.asset);
        else setError("The asset could not be loaded.");
      })
      .catch(() => {
        if (!cancelled) setError("Source evidence could not be loaded - the database may be offline.");
      });
    return () => { cancelled = true; };
  }, [assetId]);

  if (!asset) return null;

  const a = detail ?? asset;
  const meta = ASSET_TYPE_META[a.assetType];
  const Icon = meta.icon;
  const summary = Object.entries(a.summary ?? {});
  const sources = detail?.sources ?? [];
  const keys = KEY_FIELDS.map((k) => [k, a[k]] as const).filter(([, v]) => Boolean(v));
  const cve = typeof a.externalKeys?.cve === "string" ? a.externalKeys.cve : null;
  const qid = a.externalKeys?.qid !== null && a.externalKeys?.qid !== undefined ? String(a.externalKeys.qid) : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={<Icon size={15} />}
      title={
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[14px] font-semibold">{a.displayName}</span>
          <Chip variant="muted" className="shrink-0">{meta.label}</Chip>
          <span className="mono hidden shrink-0 text-[11px] text-text3 md:inline">{a.assetId}</span>
          <CopyButton value={a.assetId} className="h-7 w-7 shrink-0 !px-0" />
        </div>
      }
    >
      <div className="space-y-5">
        {/* Correlation keys strip */}
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            {keys.map(([k, v]) => (
              <Chip key={k} className="max-w-full">
                <span className="font-normal text-text3">{k}</span>
                <span className="mono max-w-[240px] truncate">{String(v)}</span>
              </Chip>
            ))}
            {cve ? (
              <Chip className="max-w-full">
                <span className="font-normal text-text3">cve</span>
                <span className="mono max-w-[240px] truncate">{cve}</span>
              </Chip>
            ) : null}
            {qid ? (
              <Chip className="max-w-full">
                <span className="font-normal text-text3">qid</span>
                <span className="mono max-w-[240px] truncate">{qid}</span>
              </Chip>
            ) : null}
            {keys.length === 0 && !cve && !qid ? (
              <span className="text-[12px] text-text3">No correlation keys recorded.</span>
            ) : null}
          </div>
          <div className="mt-2 text-[11.5px] tabular-nums text-text2">
            First seen {relativeTime(a.firstSeen)} &middot; Last seen {relativeTime(a.lastSeen)} &middot; {a.sourceCount}{" "}
            {a.sourceCount === 1 ? "source" : "sources"}
          </div>
        </div>

        {/* Merged summary */}
        {summary.length > 0 && (
          <div>
            <SectionLabel>Summary</SectionLabel>
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {summary.map(([k, v]) => <KvRow key={k} k={k} v={v} />)}
            </div>
          </div>
        )}

        {/* Per-source evidence */}
        <div>
          <SectionLabel>Source evidence{detail ? ` (${sources.length})` : ""}</SectionLabel>
          {error ? (
            <div className="flex items-start gap-2 rounded border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : !detail ? (
            <div className="space-y-3">
              <SkeletonPanel lines={3} />
              <SkeletonPanel lines={3} />
            </div>
          ) : sources.length === 0 ? (
            <div className="text-[12px] text-text3">No source rows recorded for this asset.</div>
          ) : (
            <div className="space-y-3">
              {sources.map((s) => (
                <SourceCard key={`${s.toolId}:${s.connectionId}:${s.externalId}`} source={s} toolName={toolName} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
