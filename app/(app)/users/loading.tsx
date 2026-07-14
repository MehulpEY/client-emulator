import { SkeletonHeader, SkeletonRows } from "@/components/ui";

// Instant fallback for the users administration route while it loads.
export default function UsersLoading() {
  return (
    <div aria-busy="true" aria-label="Loading users">
      <SkeletonHeader lines={2} />
      <div className="panel">
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}
