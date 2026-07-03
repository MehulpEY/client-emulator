import { TOOLS } from "@/lib/tools/registry";
import { PageHeader } from "@/components/PageHeader";
import { LogsClient } from "@/components/logs/LogsClient";

export const dynamic = "force-dynamic";

export default function LogsPage() {
  const tools = TOOLS.map((t) => ({ id: t.id, name: t.name }));
  return (
    <div>
      <PageHeader
        eyebrow="Trace"
        title="Request Trace"
        description="Every call agents make to the emulator - method, endpoint, status, latency and the full request/response payloads. Click a row to expand."
      />
      <LogsClient tools={tools} />
    </div>
  );
}
