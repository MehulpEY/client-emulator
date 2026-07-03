import { TOOLS } from "@/lib/tools/registry";
import { PageHeader } from "@/components/PageHeader";
import { GeneratorsClient } from "@/components/generators/GeneratorsClient";

export const dynamic = "force-dynamic";

export default function GeneratorsPage() {
  const tools = TOOLS.map((t) => ({ id: t.id, name: t.name }));
  return (
    <div>
      <PageHeader
        eyebrow="Automation"
        title="Generators"
        description="Every scheduled generator across all tools. Start or stop them in bulk, run one on demand, or pause and delete individually. Create new ones from a tool's Automation panel."
      />
      <GeneratorsClient tools={tools} />
    </div>
  );
}
