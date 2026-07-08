import { SkeletonHeader, SkeletonStats, Skeleton, SkeletonRows } from "@/components/ui";

// Instant fallback for the assets inventory while it loads. Mirrors header +
// rollup + the filter bar and the correlated-asset table.
export default function AssetsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading assets">
      <SkeletonHeader lines={2} />
      <SkeletonStats count={4} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="panel mt-3">
        <SkeletonRows rows={8} />
      </div>
    </div>
  );
}
