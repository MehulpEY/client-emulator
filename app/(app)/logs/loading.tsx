import { SkeletonHeader, Skeleton, SkeletonRows } from "@/components/ui";

// Instant fallback for the request trace route while it loads. Mirrors the header,
// the filter bar, and the log rows.
export default function LogsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading request trace">
      <SkeletonHeader lines={2} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="panel">
        <SkeletonRows rows={8} />
      </div>
    </div>
  );
}
