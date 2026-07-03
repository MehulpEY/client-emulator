import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TOOLS, toolCount, endpointCount, aiToolCount } from "@/lib/tools/registry";
import { CATEGORIES } from "@/lib/tools/categories";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui";
import { CategoryIcon } from "@/lib/icons";
import { OverviewStats } from "@/components/overview/OverviewStats";
import { RecentActivity } from "@/components/overview/RecentActivity";
import { GettingStarted } from "@/components/overview/GettingStarted";
import { getBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const baseUrl = getBaseUrl();
  const counts = CATEGORIES.map((c) => ({ ...c, count: TOOLS.filter((t) => t.category === c.id).length }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Client Tool Emulator"
        description="A sandbox that stands in for the cybersecurity tools a client runs - so agent workflows can be exercised against realistic, logged mock APIs instead of production systems."
      />

      <OverviewStats catalogFallback={{ tools: toolCount(), endpoints: endpointCount(), aiTools: aiToolCount() }} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivity />
        </div>
        <GettingStarted baseUrl={baseUrl} />
      </div>

      <Panel
        title="Browse by Category"
        className="mt-4"
        actions={<Link href="/tools" className="btn-ghost">All tools <ArrowRight size={13} /></Link>}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {counts.map((c) => (
            <Link
              key={c.id}
              href={`/tools?category=${c.id}`}
              className="group flex items-start gap-3 border border-border bg-sunk p-3 transition-colors hover:border-accent hover:bg-surface-hover"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center border border-hair bg-surface text-accent-fg">
                <CategoryIcon id={c.id} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-bold">{c.label}</span>
                  <span className="chip tabular-nums ml-auto shrink-0">{c.count}</span>
                </span>
                <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-text3">{c.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
