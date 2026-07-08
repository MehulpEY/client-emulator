import { SkeletonHeader, SkeletonStats, SkeletonCards } from "@/components/ui";

// Instant fallback for the adapters catalog while the page and the AdaptersCatalog
// client bundle load. Mirrors header + stat rollup + the adapter card grid.
export default function AdaptersLoading() {
  return (
    <div aria-busy="true" aria-label="Loading adapters">
      <SkeletonHeader lines={2} />
      <SkeletonStats count={4} />
      <div className="mt-4">
        <SkeletonCards count={9} />
      </div>
    </div>
  );
}
