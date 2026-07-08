import { cn } from "@/lib/cn";

/* Skeleton loaders - shown wherever data is being fetched, so the layout never
   flashes empty. The `.skeleton` class (globals.css) carries the themed sheen. */

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={cn("skeleton block", className)} />;
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Grid of catalog-card placeholders that mirror the tool tile shape. */
export function SkeletonCards({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel space-y-3 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <SkeletonText lines={2} />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** List of table-style row placeholders (logs / endpoints). */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="h-5 w-14 shrink-0" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="hidden h-3.5 w-24 shrink-0 sm:block" />
          <Skeleton className="h-3.5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** A panel placeholder with a header line and body text. */
export function SkeletonPanel({ className = "", lines = 4 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("panel space-y-3 p-5", className)}>
      <Skeleton className="h-4 w-40" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** Placeholder that mirrors <PageHeader/> (eyebrow, title, description). Used by
    route-level loading.tsx files so the header lands in place while the page and
    its client bundle load. */
export function SkeletonHeader({ lines = 2 }: { lines?: number }) {
  return (
    <div className="mb-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-7 w-52" />
      <div className="mt-2 max-w-2xl space-y-1.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/5" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

/** Row of stat-card placeholders for the overview header. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel space-y-3 p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}
