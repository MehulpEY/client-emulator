import { TOOLS } from "@/lib/tools/registry";
import { PageHeader } from "@/components/PageHeader";
import { AssetsClient } from "@/components/assets/AssetsClient";

export const dynamic = "force-dynamic";

// /assets - the normalized, correlated inventory built by discovery fetches
// (PLAN §6 W8). Auth comes from the (app) layout's requireUser().
export default function AssetsPage() {
  const tools = TOOLS.map((t) => ({ id: t.id, name: t.name }));
  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Assets"
        description="The correlated asset inventory built by adapter discovery fetches - devices, users and vulnerabilities merged across sources, with the rule and raw evidence behind every merge."
      />
      <AssetsClient tools={tools} />
    </div>
  );
}
