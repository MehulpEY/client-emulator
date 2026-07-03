import { allSummaries } from "@/lib/tools/registry";
import { PageHeader } from "@/components/PageHeader";
import { CatalogClient } from "@/components/tools/CatalogClient";

export const dynamic = "force-dynamic";

export default function ToolsPage({ searchParams }: { searchParams: { category?: string } }) {
  const tools = allSummaries();
  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Emulated Tools"
        description="Every tool the client might run, mocked behind a stable API. Open one to see its endpoints, try a live call, and watch the request trace."
      />
      <CatalogClient tools={tools} initialCategory={searchParams.category} />
    </div>
  );
}
