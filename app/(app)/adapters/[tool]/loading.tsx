import { Skeleton, SkeletonText } from "@/components/ui";

// Instant navigation feedback for the adapter detail route. The App Router shows
// this as a Suspense fallback the moment a catalog card is clicked, while the
// (force-dynamic) page resolves and the heavy AdapterDetail bundle loads. It
// mirrors the real layout: back link, header panel, tab bar, and content, so the
// transition reads as the page arriving rather than the app freezing.
export default function AdapterDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading adapter">
      {/* back link */}
      <Skeleton className="mb-3 h-3.5 w-24" />

      {/* header panel */}
      <div className="panel mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-5 w-64" />
            <SkeletonText lines={2} className="max-w-3xl" />
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>

          {/* live rollup */}
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>

        {/* meta row */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hair pt-3">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-7 w-16 rounded-md" />
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>

      {/* tab bar */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="mb-1 h-7 w-24 rounded-md" />
        ))}
      </div>

      {/* content (Connections tab is the default) */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel flex items-center gap-4 p-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
