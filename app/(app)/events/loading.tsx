import { SkeletonHeader, SkeletonPanel } from "@/components/ui";

// Instant fallback for the event subscriptions route while it loads. Mirrors the
// header and the two-column panels (subscriptions + deliveries / inbox).
export default function EventsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading event subscriptions">
      <SkeletonHeader lines={2} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonPanel lines={6} />
        <SkeletonPanel lines={6} />
      </div>
    </div>
  );
}
