import { TOOLS } from "@/lib/tools/registry";
import { PageHeader } from "@/components/PageHeader";
import { KeysClient } from "@/components/keys/KeysClient";

export const dynamic = "force-dynamic";

export default function KeysPage() {
  const tools = TOOLS.map((t) => ({ id: t.id, name: t.name }));
  return (
    <div>
      <PageHeader
        eyebrow="Access"
        title="API Keys"
        description="Credentials agents present to reach the emulated endpoints. A master key works for every tool; scoped keys gate a single tool. With no keys, endpoints stay open for quick testing."
      />
      <KeysClient tools={tools} />
    </div>
  );
}
