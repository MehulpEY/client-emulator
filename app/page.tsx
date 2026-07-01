import Link from "next/link";
import { TOOLS, toolCount, endpointCount, aiToolCount } from "@/lib/tools/registry";
import { CATEGORIES } from "@/lib/tools/categories";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui";
import { CategoryIcon } from "@/lib/icons";
import { OverviewStats } from "@/components/overview/OverviewStats";
import { RecentActivity } from "@/components/overview/RecentActivity";
import { GettingStarted } from "@/components/overview/GettingStarted";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const baseUrl = process.env.NEXT_PUBLIC_EMULATOR_BASE_URL || "http://localhost:3001";
  const counts = CATEGORIES.map((c) => ({ ...c, count: TOOLS.filter((t) => t.category === c.id).length }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Client Tool Emulator"
        description="A sandbox that stands in for the cybersecurity tools a client runs — so agent workflows can be exercised against realistic, logged mock APIs instead of production systems."
      />

      <OverviewStats catalogFallback={{ tools: toolCount(), endpoints: endpointCount(), aiTools: aiToolCount() }} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivity />
        </div>
        <div className="space-y-4">
          <GettingStarted baseUrl={baseUrl} />
          <Panel title="Categories" noPadding>
            <div className="divide-y divide-hair">
              {counts.map((c) => (
                <Link key={c.id} href={`/tools?category=${c.id}`} className="rowlink flex items-center gap-3 px-4 py-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center bg-surface-sunk text-accent-fg">
                    <CategoryIcon id={c.id} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.label}</span>
                  <span className="chip tabular-nums">{c.count}</span>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
