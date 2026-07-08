import { SkeletonHeader, Skeleton, SkeletonRows } from "@/components/ui";

// Instant fallback for the generators route while it loads. Mirrors the header,
// the bulk start/stop controls, and the generator list.
export default function GeneratorsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading generators">
      <SkeletonHeader lines={2} />
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="panel">
        <SkeletonRows rows={6} />
      </div>
    </div>
  );
}
