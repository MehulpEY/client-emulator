import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { TOOLS, toolCount, endpointCount } from "@/lib/tools/registry";
import { toolEventTypes } from "@/lib/tools/events";
import { CATEGORIES } from "@/lib/tools/categories";
import { FLEET_DEVICES, FLEET_USERS } from "@/lib/fleet/fleet";
import { ADAPTER_META } from "@/lib/adapters/meta";
import { LandingPage, type LandingStats } from "@/components/landing/LandingPage";

export const dynamic = "force-dynamic";

// Public landing. Signed-in visitors go straight to the dashboard. Every
// number shown is derived from the code registry at request time — nothing is
// invented, nothing needs the database.
export default async function Landing() {
  if (await getCurrentUser()) redirect("/overview");

  const stats: LandingStats = {
    adapters: toolCount(),
    endpoints: endpointCount(),
    eventTypes: TOOLS.reduce((n, t) => n + toolEventTypes(t).length, 0),
    fleetDevices: FLEET_DEVICES.length,
    fleetUsers: FLEET_USERS.length,
    categories: CATEGORIES.length,
    discoveryAdapters: ADAPTER_META.filter((m) => m.fetchSteps.length > 0).length,
  };

  return <LandingPage stats={stats} />;
}
