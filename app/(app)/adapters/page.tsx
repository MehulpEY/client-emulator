import { PageHeader } from "@/components/PageHeader";
import { AdaptersCatalog } from "@/components/adapters/AdaptersCatalog";

export const dynamic = "force-dynamic";

// The adapters catalog (PLAN §6 W7): every emulated tool as an Axonius-style
// adapter — searchable grid with live connection rollups. Data flows through
// adaptersApi.list() client-side so the status dots stay fresh.
export default function AdaptersPage({ searchParams }: { searchParams: { category?: string } }) {
  return (
    <div>
      <PageHeader
        eyebrow="Adapters"
        title="Adapters"
        description="Connect the tools the client runs. Each adapter holds credentialed connections with live heartbeats, scheduled discovery fetches and a normalized record stream — open one to configure and test it."
      />
      <AdaptersCatalog initialCategory={searchParams.category} />
    </div>
  );
}
