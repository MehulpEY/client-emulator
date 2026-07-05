import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TOOLS, toolCount, endpointCount } from "@/lib/tools/registry";
import { CATEGORIES } from "@/lib/tools/categories";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui";
import { CategoryIcon } from "@/lib/icons";
import { OverviewStats } from "@/components/overview/OverviewStats";
import { DiscoveryActivity } from "@/components/overview/DiscoveryActivity";
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
        description="An adapter platform over hand-crafted mock security tools: credentialed connections with a live lifecycle, scheduled discovery fetches, a correlated asset inventory and one gateway URL per connection - so agent workflows run against realistic, logged APIs instead of production systems."
        actions={<Link href="/adapters" className="btn-primary">Open adapters <ArrowRight size={13} /></Link>}
      />

      <OverviewStats catalogFallback={{ adapters: toolCount(), endpoints: endpointCount() }} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DiscoveryActivity />
        </div>
        <GettingStarted baseUrl={baseUrl} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivity />
        </div>
        <Panel
          title="Browse by category"
          noPadding
          actions={<Link href="/adapters" className="btn-ghost">All adapters <ArrowRight size={13} /></Link>}
        >
          <div className="p-2">
            {counts.map((c) => (
              <Link
                key={c.id}
                href={`/adapters?category=${c.id}`}
                className="rowlink flex items-center gap-3 rounded px-3 py-2"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-hair bg-sunk text-accent-fg">
                  <CategoryIcon id={c.id} size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{c.label}</span>
                <span className="chip tnum shrink-0">{c.count}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
