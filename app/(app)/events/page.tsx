import { TOOLS } from "@/lib/tools/registry";
import { PageHeader } from "@/components/PageHeader";
import { SubscriptionsClient } from "@/components/events/SubscriptionsClient";

export const dynamic = "force-dynamic";

export default function EventsPage() {
  const tools = TOOLS.map((t) => ({ id: t.id, name: t.name }));
  const baseUrl = process.env.NEXT_PUBLIC_EMULATOR_BASE_URL || "http://localhost:3002";
  return (
    <div>
      <PageHeader
        eyebrow="Pub / Sub"
        title="Event Subscriptions"
        description="Register a consumer (an agent's webhook URL) to receive a tool's events. Events fire when an agent mutates data through a tool, or when you emit one manually - each delivery is HMAC-signed and logged."
      />
      <SubscriptionsClient tools={tools} baseUrl={baseUrl} />
    </div>
  );
}
