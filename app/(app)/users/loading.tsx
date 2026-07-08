import { SkeletonHeader, Skeleton, SkeletonRows } from "@/components/ui";

// Instant fallback for the users administration route while it loads. Mirrors the
// header, the invite action, and the user list.
export default function UsersLoading() {
  return (
    <div aria-busy="true" aria-label="Loading users">
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
