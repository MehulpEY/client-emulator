import { SkeletonHeader, Skeleton, SkeletonRows } from "@/components/ui";

// Instant fallback for the API keys route while it loads. Mirrors the header, the
// create-key action, and the key list.
export default function KeysLoading() {
  return (
    <div aria-busy="true" aria-label="Loading API keys">
      <SkeletonHeader lines={2} />
      <div className="mb-3 flex justify-end">
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="panel">
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}
