import { SkeletonHeader, SkeletonStats, SkeletonPanel } from "@/components/ui";

// Instant fallback for the overview route while its (force-dynamic) server render
// and client feeds load. Mirrors header + stat row + the two activity grids.
export default function OverviewLoading() {
  return (
    <div aria-busy="true" aria-label="Loading overview">
      <SkeletonHeader lines={2} />
      <SkeletonStats count={4} />
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonPanel lines={6} />
        </div>
        <SkeletonPanel lines={6} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonPanel lines={6} />
        </div>
        <SkeletonPanel lines={6} />
      </div>
    </div>
  );
}
