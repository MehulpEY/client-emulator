import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, minutesAgoIso, daysAgoIso, nowIso, uuid } from "../helpers";
import { fleetEndpoints, ownerOf, extId, macColon, macBareUpper, type FleetDevice } from "../../fleet/fleet";

// Microsoft Intune via Microsoft Graph v1.0 - deviceManagement/managedDevices
// (scaffold adapter). App-only (client-credentials) bearer auth with the same
// token endpoint shape as Entra ID. Responses reproduce Graph's OData envelope
// ("@odata.context" / value[]). Managed devices project the canonical fleet's
// Windows and macOS endpoints (lib/fleet/fleet.ts) so they correlate with
// CrowdStrike / SentinelOne / Jamf on serial/mac/hostname and carry the
// owner's UPN for user linkage. Every record keeps the generic-normalizer keys
// (id / hostname / mac / serial / os / ip / lastSeen) at the top level
// alongside Graph's own managedDevice properties.

const V1 = "https://graph.microsoft.com/v1.0";
const CTX = (frag: string) => `${V1}/$metadata#${frag}`;

/** GUID-shaped stable id derived from extId. */
function guidOf(seed: string): string {
  const h = extId("intune", seed, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const WIN_MODELS: readonly [string, string][] = [
  ["Latitude 7440", "Dell Inc."],
  ["ThinkPad X1 Carbon Gen 11", "LENOVO"],
  ["EliteBook 840 G10", "HP"],
  ["Surface Laptop 5", "Microsoft Corporation"],
];
const MAC_MODELS: readonly [string, string][] = [
  ["MacBook Pro (14-inch, 2023)", "Apple Inc."],
  ["MacBook Air (M2, 2022)", "Apple Inc."],
];
const WIN_BUILDS = ["10.0.22631.4317", "10.0.26100.2314", "10.0.19045.5131"] as const;

const intuneFleet = (): FleetDevice[] => fleetEndpoints().filter((d) => d.platform === "windows" || d.platform === "mac");

/** Project one fleet endpoint into Graph's managedDevice shape (+ generic keys). */
function managedDevice(d: FleetDevice) {
  const r = rng("intune:dev:" + d.fleetId);
  const owner = ownerOf(d);
  const lastSync = minutesAgoIso(int(r, 5, 1440));
  const isMac = d.platform === "mac";
  const [model, manufacturer] = pick(r, isMac ? MAC_MODELS : WIN_MODELS);
  const total = pick(r, [256, 512, 1024]) * 1073741824;
  return {
    // generic normalizer contract (top level)
    id: guidOf(d.fleetId),
    hostname: d.hostname,
    mac: macColon(d.mac),
    serial: d.serial,
    os: d.os,
    ip: d.ip,
    lastSeen: lastSync,
    // Graph managedDevice surface
    userId: owner ? guidOf("user:" + owner.fleetId) : "",
    deviceName: d.hostname,
    managedDeviceOwnerType: "company",
    enrolledDateTime: daysAgoIso(int(r, 30, 700)),
    lastSyncDateTime: lastSync,
    operatingSystem: isMac ? "macOS" : "Windows",
    osVersion: isMac ? (d.os.match(/(\d+(\.\d+)+)/)?.[1] ?? "14.7") : pick(r, WIN_BUILDS),
    complianceState: chance(r, 0.85) ? "compliant" : "noncompliant",
    jailBroken: "Unknown",
    managementAgent: "mdm",
    azureADRegistered: true,
    azureADDeviceId: guidOf("aad:" + d.fleetId),
    deviceEnrollmentType: isMac ? "appleBulkWithUser" : "windowsAzureADJoin",
    emailAddress: owner?.upn ?? "",
    userPrincipalName: owner?.upn ?? "",
    userDisplayName: owner?.displayName ?? "",
    isEncrypted: chance(r, 0.92),
    model,
    manufacturer,
    serialNumber: d.serial,
    wiFiMacAddress: macBareUpper(d.mac),
    ethernetMacAddress: null,
    totalStorageSpaceInBytes: total,
    freeStorageSpaceInBytes: Math.floor(total * (0.15 + r() * 0.5)),
    partnerReportedThreatState: "unknown",
  };
}

/** Find a fleet device by its Intune managedDevice id. */
const findDevice = (id: string): FleetDevice | undefined => intuneFleet().find((d) => guidOf(d.fleetId) === id);

const graph404 = (id: string): MockResult => ({
  status: 404,
  body: { error: { code: "ResourceNotFound", message: `Device with id '${id}' was not found.`, innerError: { date: nowIso(), "request-id": uuid() } } },
});

export const intune: ToolDef = {
  id: "intune",
  name: "Microsoft Intune",
  vendor: "Microsoft",
  category: "device-mgmt",
  crafted: false,
  summary:
    "Microsoft Intune device management via Microsoft Graph - managed Windows/macOS devices with compliance state, owner UPN linkage and the syncDevice remote action.",
  tags: ["device-mgmt", "intune", "mdm", "graph", "compliance", "managed-devices"],
  auth: { type: "bearer" },
  docsUrl: "https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/{tenant}/oauth2/v2.0/token",
      operation: "getToken",
      summary: "Exchange client_id/client_secret for an app-only OAuth2 bearer token (client credentials).",
      request: { client_id: "<app-id>", scope: "https://graph.microsoft.com/.default", client_secret: "<secret>", grant_type: "client_credentials" },
      params: [
        { name: "tenant", in: "path", type: "string", required: true, description: "Directory (tenant) id or verified domain.", format: "uuid (tenant id) or domain", example: "contoso.onmicrosoft.com" },
        { name: "client_id", in: "body", type: "string", required: true, description: "Application (client) id of the app registration.", format: "uuid (app id)" },
        { name: "scope", in: "body", type: "string", required: true, description: "Space-delimited scopes; app-only uses the resource .default scope.", example: "https://graph.microsoft.com/.default" },
        { name: "client_secret", in: "body", type: "string", required: true, description: "Client secret credential of the app registration." },
        { name: "grant_type", in: "body", type: "string", required: true, enum: ["client_credentials"], description: "OAuth2 grant type; app-only auth uses client credentials.", example: "client_credentials" },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: { token_type: "Bearer", expires_in: 3599, ext_expires_in: 3599, access_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.mock." + Buffer.from(uuid()).toString("base64url") },
      }),
    },
    {
      method: "GET",
      path: "/deviceManagement/managedDevices",
      operation: "listManagedDevices",
      summary: "List Intune-managed devices - Graph envelope { \"@odata.context\", value: [...] }.",
      request: { $top: "10" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. Supports operatingSystem (Windows|macOS) and complianceState (compliant|noncompliant).", example: "operatingSystem eq 'Windows'" },
        { name: "$top", in: "query", type: "integer", description: "Page size; omit to return the full inventory (capped at 1000).", example: 10 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,deviceName,complianceState,userPrincipalName" },
      ],
      respond: (ctx: MockContext): MockResult => {
        let value = intuneFleet().map(managedDevice);
        const filter = ctx.query.$filter || "";
        const os = /operatingSystem eq '(\w+)'/i.exec(filter);
        if (os) value = value.filter((v) => v.operatingSystem.toLowerCase() === os[1].toLowerCase());
        const comp = /complianceState eq '(\w+)'/i.exec(filter);
        if (comp) value = value.filter((v) => v.complianceState === comp[1]);
        const top = Number(ctx.query.$top);
        if (Number.isFinite(top) && top > 0) value = value.slice(0, Math.min(top, 1000));
        return { status: 200, body: { "@odata.context": CTX("deviceManagement/managedDevices"), "@odata.count": value.length, value } };
      },
    },
    {
      method: "GET",
      path: "/deviceManagement/managedDevices/{managedDeviceId}",
      operation: "getManagedDevice",
      summary: "Get a single managed device by id.",
      request: { managedDeviceId: "<managed-device-guid>" },
      params: [
        { name: "managedDeviceId", in: "path", type: "string", required: true, description: "The managedDevice object id.", format: "uuid", example: "0a1b2c3d-4e5f-6789-abcd-ef0123456789" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const d = findDevice(ctx.params.managedDeviceId);
        if (!d) return graph404(ctx.params.managedDeviceId);
        return { status: 200, body: { "@odata.context": CTX("deviceManagement/managedDevices/$entity"), ...managedDevice(d) } };
      },
    },
    {
      method: "POST",
      path: "/deviceManagement/managedDevices/{managedDeviceId}/syncDevice",
      operation: "syncDevice",
      summary: "Request an immediate check-in/policy sync from the device (remote action).",
      emits: "device.syncRequested",
      request: { managedDeviceId: "<managed-device-guid>" },
      params: [
        { name: "managedDeviceId", in: "path", type: "string", required: true, description: "The managedDevice object id to sync.", format: "uuid", example: "0a1b2c3d-4e5f-6789-abcd-ef0123456789" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const d = findDevice(ctx.params.managedDeviceId);
        if (!d) return graph404(ctx.params.managedDeviceId);
        return { status: 204, body: null };
      },
    },
  ],
  events: [
    {
      type: "device.syncRequested",
      summary: "A sync (check-in) was requested for a managed device.",
      sample: () => {
        const d = pick(rng("intune:evt:" + uuid()), intuneFleet());
        return { managedDeviceId: guidOf(d.fleetId), deviceName: d.hostname, action: "syncDevice", requestedAt: nowIso() };
      },
    },
    {
      type: "device.enrolled",
      summary: "A new device completed Intune enrollment.",
      sample: () => {
        const d = pick(rng("intune:evt:" + uuid()), intuneFleet());
        return { ...managedDevice(d), enrolledDateTime: nowIso(), lastSyncDateTime: nowIso() };
      },
    },
  ],
};
