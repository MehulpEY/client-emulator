import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, fakeIp, minutesAgoIso, daysAgoIso, nowIso, uuid } from "../helpers";
import { fleetDevices, ownerOf, extId, macColon, type FleetDevice } from "../../fleet/fleet";

// Jamf Pro (Apple device management) - the modern /api/v1 surface: token auth,
// computers-inventory and the redeploy-framework remote action (scaffold
// adapter). Basic credentials are exchanged at /api/v1/auth/token for a
// short-lived bearer token. Computer inventory projects ONLY the canonical
// fleet's macOS devices (lib/fleet/fleet.ts), so Macs correlate with
// CrowdStrike / SentinelOne / Intune on serial/mac/hostname. Every record
// keeps the generic-normalizer keys (id / hostname / mac / serial / os / ip /
// lastSeen) at the top level alongside Jamf's sectioned inventory shape.

const JAMF_VERSION = "11.10.1-t1726676133";

/** UUID-shaped (uppercase) hardware UDID derived from extId. */
function udidOf(fleetId: string): string {
  const h = extId("jamf", fleetId, 32).toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const MAC_MODELS: readonly [string, string][] = [
  ["MacBook Pro (14-inch, 2023)", "Mac14,9"],
  ["MacBook Air (M2, 2022)", "Mac14,2"],
  ["MacBook Pro (16-inch, 2023)", "Mac14,10"],
];
const OS_BUILDS = ["23H124", "24D60", "23G93"] as const;

/** The Macs in the canonical fleet, in stable order (Jamf ids are 1-based positions). */
const jamfFleet = (): FleetDevice[] => fleetDevices().filter((d) => d.platform === "mac");

/** Project one fleet Mac into Jamf's computers-inventory shape (+ generic keys). */
function jamfComputer(d: FleetDevice, idx: number) {
  const r = rng("jamf:comp:" + d.fleetId);
  const owner = ownerOf(d);
  const lastContact = minutesAgoIso(int(r, 5, 2880));
  const [model, modelIdentifier] = pick(r, MAC_MODELS);
  return {
    // generic normalizer contract (top level)
    id: String(idx + 1),
    hostname: d.hostname,
    mac: macColon(d.mac),
    serial: d.serial,
    os: d.os,
    ip: d.ip,
    lastSeen: lastContact,
    // Jamf-flavored sectioned surface
    udid: udidOf(d.fleetId),
    general: {
      name: d.hostname,
      lastIpAddress: d.ip,
      lastReportedIp: fakeIp(r),
      jamfBinaryVersion: JAMF_VERSION.split("-")[0],
      platform: "Mac",
      supervised: true,
      mdmCapable: { capable: true, capableUsers: owner ? [owner.upn] : [] },
      lastContactTime: lastContact,
      lastEnrolledDate: daysAgoIso(int(r, 60, 700)),
      managementId: udidOf("mgmt:" + d.fleetId).toLowerCase(),
      remoteManagement: { managed: true },
      site: { id: "-1", name: d.site },
    },
    hardware: {
      make: "Apple",
      model,
      modelIdentifier,
      serialNumber: d.serial,
      processorType: pick(r, ["Apple M2", "Apple M2 Pro", "Apple M3"] as const),
      totalRamMegabytes: pick(r, [16384, 32768] as const),
      macAddress: macColon(d.mac).toUpperCase(),
    },
    operatingSystem: {
      name: "macOS",
      version: d.os.match(/(\d+(\.\d+)+)/)?.[1] ?? "14.7",
      build: pick(r, OS_BUILDS),
      fileVault2Status: chance(r, 0.9) ? "ALL_ENCRYPTED" : "NOT_ENCRYPTED",
    },
    userAndLocation: {
      username: owner ? owner.upn.split("@")[0] : "",
      realname: owner?.displayName ?? "",
      email: owner?.upn ?? "",
      position: owner?.title ?? "",
    },
  };
}

const jamf404 = (id: string): MockResult => ({
  status: 404,
  body: { httpStatus: 404, errors: [{ code: "INVALID_ID", description: `Computer with id ${id} not found`, id, field: "id" }] },
});

export const jamfPro: ToolDef = {
  id: "jamf",
  name: "Jamf Pro",
  vendor: "Jamf",
  category: "device-mgmt",
  crafted: false,
  summary:
    "Jamf Pro Apple device management - token auth, macOS computer inventory (general/hardware/OS/user sections) and the redeploy-management-framework remote action.",
  tags: ["device-mgmt", "jamf", "apple", "macos", "mdm", "inventory"],
  auth: { type: "bearer" },
  docsUrl: "https://developer.jamf.com/jamf-pro/reference/get_v1-computers-inventory",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/api/v1/auth/token",
      operation: "getToken",
      summary: "Exchange Basic credentials for a short-lived bearer token (30 minutes).",
      params: [
        { name: "Authorization", in: "header", type: "string", required: true, description: "HTTP Basic auth carrying the Jamf Pro username and password.", format: "Basic base64(username:password)", example: "Basic YWRtaW46aHVudGVyMg==" },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: { token: "eyJhbGciOiJIUzI1NiJ9.mock." + Buffer.from(uuid()).toString("base64url"), expires: new Date(Date.now() + 30 * 60_000).toISOString() },
      }),
    },
    {
      method: "GET",
      path: "/api/v1/computers-inventory",
      operation: "listComputersInventory",
      summary: "List computer inventory records - body { totalCount, results: [...] }. Projects the fleet's Macs.",
      request: { "page-size": "10" },
      params: [
        { name: "section", in: "query", type: "array", description: "Inventory sections to include (all four are always returned here).", enum: ["GENERAL", "HARDWARE", "OPERATING_SYSTEM", "USER_AND_LOCATION"] },
        { name: "page", in: "query", type: "integer", description: "Zero-based page index.", default: 0 },
        { name: "page-size", in: "query", type: "integer", description: "Number of records per page (1-2000).", default: 100, example: 10 },
        { name: "filter", in: "query", type: "string", description: "RSQL filter; supports general.name==\"<name>\".", format: "RSQL expression", example: 'general.name=="MAC-ENG-001"' },
        { name: "sort", in: "query", type: "string", description: "Sort expression.", example: "general.name:asc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        let results = jamfFleet().map(jamfComputer);
        const nameFilter = /general\.name=="([^"]+)"/.exec(ctx.query.filter || "");
        if (nameFilter) results = results.filter((c) => c.general.name.toLowerCase() === nameFilter[1].toLowerCase());
        const totalCount = results.length;
        const size = Math.min(Math.max(1, Number(ctx.query["page-size"]) || 100), 2000);
        const page = Math.max(0, Number(ctx.query.page) || 0);
        results = results.slice(page * size, page * size + size);
        return { status: 200, body: { totalCount, results } };
      },
    },
    {
      method: "POST",
      path: "/api/v1/computers-inventory/{id}/redeploy-framework",
      operation: "redeployFramework",
      summary: "Redeploy the Jamf management framework to a computer via an MDM InstallEnterpriseApplication command.",
      emits: "framework.redeployed",
      request: { id: "1" },
      params: [
        { name: "id", in: "path", type: "string", required: true, description: "Inventory id of the computer to redeploy the framework to.", format: "numeric computer id", example: "1" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const idx = Number(ctx.params.id);
        if (!Number.isInteger(idx) || idx < 1 || idx > jamfFleet().length) return jamf404(ctx.params.id);
        return { status: 202, body: { deviceId: ctx.params.id, commandUuid: uuid() } };
      },
    },
    {
      method: "GET",
      path: "/api/v1/jamf-pro-version",
      operation: "getJamfProVersion",
      summary: "Jamf Pro server version - the cheapest liveness probe.",
      params: [],
      respond: (): MockResult => ({ status: 200, body: { version: JAMF_VERSION } }),
    },
  ],
  events: [
    {
      type: "framework.redeployed",
      summary: "The Jamf management framework was redeployed to a computer.",
      sample: () => {
        const macs = jamfFleet();
        const i = int(rng("jamf:evt:" + uuid()), 0, macs.length - 1);
        return { deviceId: String(i + 1), computerName: macs[i].hostname, commandUuid: uuid(), requestedAt: nowIso() };
      },
    },
    {
      type: "computer.checkedIn",
      summary: "A managed Mac checked in with the Jamf Pro server.",
      sample: () => {
        const macs = jamfFleet();
        const i = int(rng("jamf:evt:" + uuid()), 0, macs.length - 1);
        return { ...jamfComputer(macs[i], i), lastSeen: nowIso() };
      },
    },
  ],
};
