import Link from "next/link";
import type { AdapterSummary } from "@/lib/adapters/types";
import { categoryLabel } from "@/lib/tools/categories";
import { Chip } from "@/components/ui";
import { ASSET_TYPE_LABEL, fmtInt, MonogramTile, StatusDots } from "./shared";

const MAX_CATEGORIES = 3;
const MAX_ASSET_TYPES = 4;

/** One adapter tile in the catalog grid — the whole card links to the detail. */
export function AdapterCard({ adapter }: { adapter: AdapterSummary }) {
  const cats = adapter.categories.slice(0, MAX_CATEGORIES);
  const moreCats = adapter.categories.length - cats.length;
  const assets = adapter.assetTypes.slice(0, MAX_ASSET_TYPES);

  return (
    <Link href={`/adapters/${adapter.toolId}`} className="card animate-fade-rise flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <MonogramTile name={adapter.name} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-bold">{adapter.name}</h3>
          <div className="truncate text-[11px] text-text3">{adapter.vendor || "—"}</div>
        </div>
      </div>

      <p className="truncate text-[12px] leading-relaxed text-text2" title={adapter.blurb}>
        {adapter.blurb}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {cats.map((c) => (
          <Chip key={c}>{categoryLabel(c)}</Chip>
        ))}
        {moreCats > 0 ? <Chip variant="muted" title={adapter.categories.slice(MAX_CATEGORIES).map(categoryLabel).join(", ")}>+{moreCats}</Chip> : null}
      </div>

      {assets.length > 0 ? (
        <div className="truncate text-[11px] text-text3" title={adapter.assetTypes.map((a) => ASSET_TYPE_LABEL[a]).join(", ")}>
          {assets.map((a) => ASSET_TYPE_LABEL[a]).join(" · ")}
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-hair pt-2.5">
        <StatusDots byStatus={adapter.connectionsByStatus} emptyText="no connections" />
        <span className="whitespace-nowrap text-[11px] text-text3 tnum">
          {adapter.totalRecords > 0 ? <>{fmtInt(adapter.totalRecords)} records {"·"} </> : null}
          {adapter.endpointCount} endpoints
        </span>
      </div>
    </Link>
  );
}
