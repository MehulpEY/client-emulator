import type { Metadata } from "next";
import { toolCount, endpointCount } from "@/lib/tools/registry";
import { CATEGORIES } from "@/lib/tools/categories";
import { FLEET_DEVICES, FLEET_USERS } from "@/lib/fleet/fleet";
import { ADAPTER_META } from "@/lib/adapters/meta";
import { ArchitectureDoc, type ArchStats } from "@/components/architecture/ArchitectureDoc";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Architecture: Client Tool Emulator",
  description:
    "A detailed, plain-language walk through how the Client Tool Emulator is built: the request path, the mock engine, the adapter platform, correlated assets, and whether the data is real.",
};

// Public architecture reference. Unlike the landing page this does NOT redirect
// signed-in visitors, and it needs no session. Anyone can read it. Every number
// is derived from the code registry at request time so the page never drifts
// from the shipped catalog.
export default function ArchitecturePage() {
  const assetTypes = Array.from(
    new Set(ADAPTER_META.flatMap((m) => m.assetTypes ?? [])),
  ).sort();

  const stats: ArchStats = {
    adapters: toolCount(),
    endpoints: endpointCount(),
    categories: CATEGORIES.length,
    fleetDevices: FLEET_DEVICES.length,
    fleetUsers: FLEET_USERS.length,
    discoveryAdapters: ADAPTER_META.filter((m) => m.fetchSteps.length > 0).length,
    withParams: ADAPTER_META.filter((m) => m.connectionParams.length > 0).length,
    assetTypes,
    // Six tool-specific normalizers (CrowdStrike, Qualys, Meraki, Entra,
    // Trellix, Zscaler ZIA) plus a generic-contract fallback.
    normalizers: 6,
    // Count of tables in the emulator schema (db/schema.sql).
    tables: 16,
  };

  return <ArchitectureDoc stats={stats} />;
}
