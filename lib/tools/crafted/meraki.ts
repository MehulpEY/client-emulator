import type { ToolDef, MockContext, MockResult } from "../types";
import {
  rng,
  int,
  pick,
  sample,
  chance,
  fakeIp,
  fakeSha256,
  minutesAgoIso,
  daysAgoIso,
  uuid,
  HOSTNAMES,
  USERS,
  COUNTRIES,
  MALWARE_FAMILIES,
  type RNG,
} from "../helpers";
import { fleetNetworkDevices, FLEET_ORG, macColon, type FleetDevice } from "../../fleet/fleet";

// Cisco Meraki Dashboard API v1. Cloud-managed networking (MX appliances, MS
// switches, MR access points). Auth is an API key sent in the X-Cisco-Meraki-API-Key
// header (the real API also accepts "Authorization: Bearer <key>"). Meraki
// responses are almost all BARE JSON ARRAYS (no envelope); a couple of overview
// endpoints return a single object. Ids follow Meraki's real shapes - networks
// "N_########", config templates "L_########", serials "Q234-ABCD-5678", numeric
// organization ids like "2930418". Everything is seeded from the request input so
// the same org / network id returns a stable response across calls.

/** Numeric organization id, e.g. "2930418". */
function orgId(seed: string): string {
  return String(int(rng("meraki:orgid:" + seed), 100000, 9999999));
}

/** Network id, e.g. "N_24329156". */
function networkId(seed: string): string {
  return "N_" + int(rng("meraki:netid:" + seed), 10000000, 999999999);
}

/** Device serial, e.g. "Q234-ABCD-5678". */
function serial(seed: string): string {
  const r = rng("meraki:serial:" + seed);
  const LET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = (n: number) => Array.from({ length: n }, () => int(r, 0, 9)).join("");
  const letters = (n: number) => Array.from({ length: n }, () => LET[Math.floor(r() * LET.length)]).join("");
  return `Q${digits(3)}-${letters(4)}-${digits(4)}`;
}

const MERAKI_OUI = ["e0:55:3d", "00:18:0a", "ac:17:c8", "88:15:44", "0c:8d:db", "e0:cb:bc"] as const;
const CLIENT_OUI = ["3c:22:fb", "a4:83:e7", "f0:18:98", "dc:a6:32", "b8:27:eb", "5c:cf:7f", "48:e1:5c"] as const;

/** MAC address; `meraki=true` uses a Meraki OUI, otherwise a client-device OUI. */
function macAddr(seed: string, meraki: boolean): string {
  const r = rng("meraki:mac:" + seed);
  const oui = pick(r, meraki ? MERAKI_OUI : CLIENT_OUI);
  const b = () => int(r, 0, 255).toString(16).padStart(2, "0");
  return `${oui}:${b()}:${b()}:${b()}`;
}

/** Short base62-ish token used inside dashboard URLs, e.g. "/o/-t35Mb". */
function token(seed: string, len: number): string {
  const r = rng("meraki:tok:" + seed);
  const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length: len }, () => CH[Math.floor(r() * CH.length)]).join("");
}

/** Lowercase hex string (client ids, hashes). */
function hexId(seed: string, len: number): string {
  const r = rng("meraki:hex:" + seed);
  const H = "0123456789abcdef";
  return Array.from({ length: len }, () => H[Math.floor(r() * 16)]).join("");
}

/** A private RFC1918 LAN address. */
const privateIp = (r: RNG): string => `10.${int(r, 0, 60)}.${int(r, 0, 255)}.${int(r, 2, 254)}`;

const ORG_NAMES = ["Contoso Global", "Northwind Traders", "Acme Retail Group", "Fabrikam Manufacturing"] as const;
const REGIONS: readonly [string, string][] = [
  ["North America", "https://api.meraki.com"],
  ["Europe", "https://api.meraki.com"],
  ["Asia", "https://api.meraki.com"],
  ["Canada", "https://api.meraki.ca"],
];
const NET_NAMES = ["HQ - Main Campus", "Branch - Chicago", "Branch - Austin", "Datacenter - East", "Warehouse - Reno", "Retail - Store 118", "Remote - VPN Users"] as const;
const TIMEZONES = ["America/Los_Angeles", "America/New_York", "America/Chicago", "Europe/London", "Asia/Kolkata"] as const;
const PRODUCT_SETS: readonly string[][] = [
  ["appliance", "switch", "wireless"],
  ["appliance", "switch"],
  ["wireless"],
  ["appliance", "switch", "wireless", "camera"],
  ["appliance"],
];
const NET_TAGS = ["recently-added", "campus", "branch", "pci", "guest-enabled", "voice"] as const;
const NET_NOTES = ["Primary corporate site", "Managed by NOC", "PCI scope - do not modify", "Guest WiFi only", "Backup uplink via LTE"] as const;

const MODELS: Record<string, readonly string[]> = {
  appliance: ["MX64", "MX67", "MX68", "MX84", "MX100", "MX250"],
  switch: ["MS120-8", "MS210-24", "MS225-48LP", "MS350-24X", "MS425-16"],
  wireless: ["MR33", "MR36", "MR44", "MR46", "MR56"],
  camera: ["MV12WE", "MV32", "MV72X"],
};
const NAMES_BY_TYPE: Record<string, readonly string[]> = {
  appliance: ["HQ-MX", "Branch-MX67", "DC-MX250", "Store-MX68", "WH-MX84"],
  switch: ["HQ-Core-SW", "Floor2-SW", "IDF-1-SW", "Access-SW-03", "MDF-Agg-SW"],
  wireless: ["AP-Lobby-01", "AP-Floor2-14", "AP-ConfA", "AP-Warehouse-07", "AP-Exec-02"],
  camera: ["CAM-Entrance", "CAM-Dock", "CAM-Lobby"],
};
const FIRMWARE: Record<string, readonly string[]> = {
  appliance: ["wired-18-107", "wired-18-211", "wired-19-1-4"],
  switch: ["switch-15-21-1", "switch-16-8", "switch-17-2"],
  wireless: ["wireless-29-5-1", "wireless-30-6", "wireless-31-1-4"],
  camera: ["camera-5-1", "camera-5-2"],
};
/** Anchor coordinates for the canonical fleet sites (lib/fleet/fleet.ts). */
const SITE_GEO: Record<string, [number, number]> = {
  "NYC-HQ": [40.71427, -74.00597],
  "LON-01": [51.50735, -0.12776],
  "SG-02": [1.35208, 103.81983],
  REMOTE: [39.52963, -119.8138],
};

const MANUFACTURERS = ["Apple", "Dell", "Intel", "Samsung", "Google", "Lenovo", "HP", "Cisco Systems", "Raspberry Pi Foundation", "Espressif"] as const;
const CLIENT_OSES = ["Windows 11", "Windows 10", "macOS 14", "iOS 17", "Android 14", "Ubuntu 22.04", "Chrome OS", null] as const;
const CLIENT_DESC = ["MacBook-Pro", "iPhone-15", "DESKTOP-A19QK", "Galaxy-S23", "Pixel-8", "Conference-AppleTV", "HP-Printer-3F", "IoT-Sensor-12", null] as const;
const SSID_NAMES = ["Corp-WiFi", "Guest", "IoT", "Voice"] as const;

const THREAT_URIS = [
  "http://malicious-cdn.example.net/update/setup.exe",
  "http://198.51.100.23/gate.php",
  "http://free-invoice-download.example.com/invoice_0492.pdf",
  "http://cdn.badactor.example.org/payload.zip",
] as const;
const FILE_TYPES = ["MSEXE", "PDF", "ZIP", "MSOLE2", "SWF"] as const;

const IDS_SIGS: readonly [number, string, string][] = [
  [21516, "SERVER-WEBAPP JBoss JMX console access attempt", "Web Application Attack"],
  [26267, "MALWARE-CNC Win.Trojan.Zeus variant outbound connection attempt", "A Network Trojan was Detected"],
  [41978, "SERVER-WEBAPP Apache Struts remote code execution attempt", "Attempted Administrator Privilege Gain"],
  [58635, "OS-WINDOWS Microsoft Windows SMBv1 remote code execution attempt", "Attempted Administrator Privilege Gain"],
  [1917, "INDICATOR-SCAN UPnP service discover attempt", "Detection of a Network Scan"],
  [46316, "MALWARE-CNC Win.Ransomware.WannaCry killswitch domain lookup", "A Network Trojan was Detected"],
];

/** ---- generators (bare objects; endpoints wrap them in arrays) ---- */

function organization(seed: string) {
  const r = rng("meraki:org:" + seed);
  const id = orgId(seed);
  const name = pick(r, ORG_NAMES);
  const [regionName, host] = pick(r, REGIONS);
  return {
    id,
    name,
    url: `https://n${int(r, 1, 300)}.meraki.com/o/${token("o:" + seed, 6)}/manage/organization/overview`,
    api: { enabled: true },
    licensing: { model: "co-term" },
    cloud: { region: { name: regionName, host: { name: host } } },
    management: { details: [] },
  };
}

function network(org: string, seed: string) {
  const r = rng("meraki:net:" + org + ":" + seed);
  const products = pick(r, PRODUCT_SETS);
  const name = pick(r, NET_NAMES);
  return {
    id: networkId(org + ":" + seed),
    organizationId: org,
    name,
    productTypes: products,
    timeZone: pick(r, TIMEZONES),
    tags: sample(r, NET_TAGS, int(r, 0, 3)),
    enrollmentString: null,
    url: `https://n${int(r, 1, 300)}.meraki.com/${name.replace(/[^A-Za-z0-9]+/g, "-")}/n/${token("n:" + seed, 6)}/manage/usage/list`,
    notes: chance(r, 0.4) ? pick(r, NET_NOTES) : "",
    isBoundToConfigTemplate: chance(r, 0.2),
  };
}

// ---- fleet projection (org device inventory, PLAN §4.4) --------------------
// getOrganizationDevices serves the canonical fleet's network gear
// (lib/fleet/fleet.ts) so serials/MACs line up across adapters. The fleet os
// string carries the model, e.g. "MR46 (AP)" -> model "MR46" / productType
// "wireless". Deterministic per fleetId.

/** Fleet os string -> Meraki model + productType. */
function fleetModel(os: string): { model: string; productType: string } {
  const model = os.split(" ")[0];
  const productType = model.startsWith("MR") ? "wireless" : model.startsWith("MS") ? "switch" : "appliance";
  return { model, productType };
}

/** Project a fleet network device into an org inventory device record. */
function fleetOrgDevice(d: FleetDevice) {
  const r = rng("meraki:fleetdev:" + d.fleetId);
  const { model, productType } = fleetModel(d.os);
  const [lat, lng] = SITE_GEO[d.site] ?? SITE_GEO["NYC-HQ"];
  return {
    name: d.hostname,
    serial: d.serial,
    mac: macColon(d.mac),
    model,
    networkId: FLEET_ORG.merakiNetworkId,
    productType,
    lat: +(lat + (r() - 0.5) * 0.01).toFixed(5),
    lng: +(lng + (r() - 0.5) * 0.01).toFixed(5),
    address: d.site,
    firmware: pick(r, FIRMWARE[productType]),
    lanIp: d.ip,
    tags: d.tags,
  };
}

function deviceStatus(seed: string) {
  const r = rng("meraki:devstat:" + seed);
  const productType = pick(r, ["appliance", "switch", "wireless"]);
  const status = pick(r, ["online", "online", "online", "alerting", "offline", "dormant"]);
  return {
    name: pick(r, NAMES_BY_TYPE[productType]),
    serial: serial("s:" + seed),
    mac: macAddr("s:" + seed, true),
    publicIp: fakeIp(r),
    networkId: networkId("sn:" + seed),
    status,
    lastReportedAt: minutesAgoIso(status === "offline" ? int(r, 60, 4320) : int(r, 0, 20)),
    lanIp: privateIp(r),
    gateway: `10.${int(r, 0, 60)}.${int(r, 0, 255)}.1`,
    ipType: "static",
    primaryDns: "8.8.8.8",
    productType,
    model: pick(r, MODELS[productType]),
  };
}

function merakiClient(seed: string) {
  const r = rng("meraki:client:" + seed);
  const wireless = chance(r, 0.65);
  const online = chance(r, 0.7);
  const desc = pick(r, CLIENT_DESC);
  return {
    id: "k" + hexId("k:" + seed, 6),
    mac: macAddr("c:" + seed, false),
    ip: privateIp(r),
    ip6: null,
    ip6Local: `fe80::${hexId("l:" + seed, 4)}:${hexId("l2:" + seed, 4)}`,
    description: desc,
    firstSeen: daysAgoIso(int(r, 5, 400)),
    lastSeen: minutesAgoIso(online ? int(r, 0, 10) : int(r, 60, 2880)),
    manufacturer: pick(r, MANUFACTURERS),
    os: pick(r, CLIENT_OSES),
    user: chance(r, 0.5) ? pick(r, USERS) : null,
    vlan: pick(r, [1, 10, 20, 30, 100, 200]),
    ssid: wireless ? pick(r, SSID_NAMES) : null,
    switchport: wireless ? null : String(int(r, 1, 48)),
    status: online ? "Online" : "Offline",
    usage: { sent: int(r, 100, 500000), recv: int(r, 100, 900000) },
    recentDeviceConnection: wireless ? "Wireless" : "Wired",
  };
}

/** AMP (Advanced Malware Protection) file-scan security event. */
function ampEvent(seed: string) {
  const r = rng("meraki:amp:" + seed);
  const family = pick(r, MALWARE_FAMILIES);
  return {
    ts: minutesAgoIso(int(r, 1, 4320)),
    eventType: "File Scanned",
    clientName: pick(r, HOSTNAMES),
    clientMac: macAddr("ampc:" + seed, false),
    clientIp: privateIp(r),
    srcIp: privateIp(r),
    destIp: fakeIp(r),
    protocol: "http",
    uri: pick(r, THREAT_URIS),
    canonicalName: `${pick(r, ["Trojan", "PUA", "Ransomware", "Downloader"])}.Win.${family}::in07.talos`,
    destinationPort: pick(r, [80, 443, 8080]),
    fileHash: fakeSha256("fh:" + seed),
    fileType: pick(r, FILE_TYPES),
    fileSizeBytes: int(r, 10240, 5242880),
    disposition: "Malicious",
    action: "Blocked",
  };
}

/** Snort IDS/IPS alert security event. */
function idsEvent(seed: string) {
  const r = rng("meraki:ids:" + seed);
  const [sid, message, classification] = pick(r, IDS_SIGS);
  return {
    ts: minutesAgoIso(int(r, 1, 4320)),
    eventType: "IDS Alert",
    deviceMac: macAddr("idsd:" + seed, true),
    clientMac: macAddr("idsc:" + seed, false),
    srcIp: `${fakeIp(r)}:${int(r, 1024, 65535)}`,
    destIp: `${privateIp(r)}:${pick(r, [80, 443, 22, 3389, 445])}`,
    protocol: "tcp/ip",
    priority: int(r, 1, 3),
    classification,
    blocked: true,
    message,
    signature: `1:${sid}:${int(r, 1, 20)}`,
    ruleId: `meraki:intrusion/snort/GID/1/SID/${sid}`,
  };
}

/** A network's security-event feed: a mix of AMP and IDS events, newest first. */
function securityEvents(seed: string, n: number) {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? ampEvent(seed + ":" + i) : idsEvent(seed + ":" + i)));
}

function vpnStatus(org: string, seed: string) {
  const r = rng("meraki:vpn:" + org + ":" + seed);
  const nid = networkId("vpnn:" + seed);
  const name = pick(r, NET_NAMES);
  return {
    networkId: nid,
    networkName: name,
    deviceSerial: serial("vpn:" + seed),
    deviceStatus: "online",
    uplinks: [{ interface: "wan1", publicIp: fakeIp(r) }],
    vpnMode: "hub",
    exportedSubnets: [
      { subnet: `10.${int(r, 0, 60)}.0.0/24`, name: "Corp LAN" },
      { subnet: `10.${int(r, 61, 120)}.0.0/24`, name: "Voice VLAN" },
    ],
    merakiVpnPeers: Array.from({ length: int(r, 1, 3) }, (_, i) => ({
      networkId: networkId("peer:" + seed + i),
      networkName: pick(r, NET_NAMES),
      reachability: "reachable",
      priority: i + 1,
    })),
    thirdPartyVpnPeers: chance(r, 0.5)
      ? [{ name: pick(r, ["AWS us-east-1", "Azure Hub", "Datacenter Colo"]), publicIp: fakeIp(r), reachability: "reachable" }]
      : [],
  };
}

function ssidRow(netSeed: string, num: number) {
  const r = rng("meraki:ssid:" + netSeed + ":" + num);
  if (num >= SSID_NAMES.length) {
    return {
      number: num,
      name: `Unconfigured SSID ${num + 1}`,
      enabled: false,
      splashPage: "None",
      ssidAdminAccessible: false,
      authMode: "open",
      ipAssignmentMode: "NAT mode",
      bandSelection: "Dual band operation",
      minBitrate: 11,
      visible: true,
      availableOnAllAps: true,
    };
  }
  const name = SSID_NAMES[num];
  const guest = name === "Guest";
  const iot = name === "IoT";
  const enterprise = name === "Corp-WiFi" || name === "Voice";
  return {
    number: num,
    name,
    enabled: true,
    splashPage: guest ? "Click-through splash page" : "None",
    ssidAdminAccessible: false,
    authMode: enterprise ? "8021x-radius" : guest ? "open" : "psk",
    encryptionMode: guest ? undefined : "wpa",
    wpaEncryptionMode: guest ? undefined : enterprise ? "WPA2 only" : "WPA3 Transition Mode",
    ipAssignmentMode: guest || iot ? "NAT mode" : "Bridge mode",
    bandSelection: enterprise ? "Dual band operation with Band Steering" : "Dual band operation",
    minBitrate: 12,
    visible: true,
    availableOnAllAps: true,
  };
}

function inventoryDevice(seed: string) {
  const r = rng("meraki:inv:" + seed);
  const productType = pick(r, ["appliance", "switch", "wireless", "camera"]);
  const claimed = chance(r, 0.8);
  return {
    mac: macAddr("inv:" + seed, true),
    serial: serial("inv:" + seed),
    name: claimed ? pick(r, NAMES_BY_TYPE[productType]) : null,
    model: pick(r, MODELS[productType]),
    networkId: claimed ? networkId("invn:" + seed) : null,
    orderNumber: "4C" + int(r, 1000000, 9999999),
    claimedAt: daysAgoIso(int(r, 30, 1000)),
    licenseExpirationDate: daysAgoIso(-int(r, 90, 900)),
    productType,
    countryCode: pick(r, COUNTRIES),
    tags: sample(r, NET_TAGS, int(r, 0, 2)),
  };
}

/** How many rows a list endpoint returns, honoring Meraki's `perPage`. */
const perPage = (ctx: MockContext, def: number, max: number) => Math.min(Math.max(1, Number(ctx.query.perPage) || def), max);

export const ciscoMeraki: ToolDef = {
  id: "cisco-meraki",
  name: "Cisco Meraki",
  vendor: "Cisco",
  category: "network",
  crafted: true,
  aiTool: true,
  summary:
    "Cisco Meraki cloud-managed networking via the Dashboard API v1 - organizations, networks, devices (MX/MS/MR), device status, connected clients, MX appliance security events (AMP file scans and Snort IDS/IPS alerts), site-to-site VPN status, wireless SSIDs, and licensing/inventory.",
  tags: ["network", "meraki", "cisco", "firewall", "ids-ips", "amp", "wireless", "vpn", "dashboard-api"],
  auth: { type: "api_key_header", param: "X-Cisco-Meraki-API-Key" },
  docsUrl: "https://developer.cisco.com/meraki/api-v1/",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "GET",
      path: "/organizations",
      operation: "getOrganizations",
      summary: "List the organizations the API key can access.",
      params: [],
      respond: (): MockResult => ({ status: 200, body: Array.from({ length: 3 }, (_, i) => organization("list:" + i)) }),
    },
    {
      method: "GET",
      path: "/organizations/{organizationId}/networks",
      operation: "getOrganizationNetworks",
      summary: "List the networks in an organization.",
      request: { organizationId: "2930418", perPage: "10" },
      params: [
        { name: "organizationId", in: "path", type: "string", required: true, description: "Organization to list networks for.", format: "numeric organization id", example: "2930418" },
        { name: "perPage", in: "query", type: "integer", description: "Number of networks to return per page (1-1000).", default: 8, example: 10 },
        { name: "startingAfter", in: "query", type: "string", description: "Pagination token; return items after this value (server-generated)." },
        { name: "productTypes", in: "query", type: "array", description: "Filter to networks that include these product types.", enum: ["appliance", "switch", "wireless", "camera"] },
      ],
      respond: (ctx: MockContext): MockResult => {
        const org = ctx.params.organizationId;
        const n = perPage(ctx, 8, 1000);
        return { status: 200, body: Array.from({ length: n }, (_, i) => network(org, "list:" + i)) };
      },
    },
    {
      method: "GET",
      path: "/organizations/{organizationId}/devices",
      operation: "getOrganizationDevices",
      summary: "List every device claimed into an organization.",
      request: { organizationId: "2930418", perPage: "10" },
      params: [
        { name: "organizationId", in: "path", type: "string", required: true, description: "Organization to list devices for.", format: "numeric organization id", example: "2930418" },
        { name: "perPage", in: "query", type: "integer", description: "Number of devices to return per page (1-1000).", default: 12, example: 10 },
        { name: "startingAfter", in: "query", type: "string", description: "Pagination token; return items after this value (server-generated)." },
        { name: "productTypes", in: "query", type: "array", description: "Filter to these device product types.", enum: ["appliance", "switch", "wireless"] },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = perPage(ctx, 12, 1000);
        const typeFilter = (ctx.query.productTypes || "").split(",").map((s) => s.trim()).filter(Boolean);
        let devices = fleetNetworkDevices().map(fleetOrgDevice);
        if (typeFilter.length) devices = devices.filter((d) => typeFilter.includes(d.productType));
        return { status: 200, body: devices.slice(0, n) };
      },
    },
    {
      method: "GET",
      path: "/organizations/{organizationId}/devices/statuses",
      operation: "getOrganizationDevicesStatuses",
      summary: "Availability status (online/alerting/offline/dormant) of every device in an organization.",
      aiTool: true,
      request: { organizationId: "2930418", perPage: "10" },
      params: [
        { name: "organizationId", in: "path", type: "string", required: true, description: "Organization to report device statuses for.", format: "numeric organization id", example: "2930418" },
        { name: "perPage", in: "query", type: "integer", description: "Number of statuses to return per page (1-1000).", default: 12, example: 10 },
        { name: "startingAfter", in: "query", type: "string", description: "Pagination token; return items after this value (server-generated)." },
        { name: "statuses", in: "query", type: "array", description: "Filter to devices in these availability states.", enum: ["online", "alerting", "offline", "dormant"] },
        { name: "productTypes", in: "query", type: "array", description: "Filter to these device product types.", enum: ["appliance", "switch", "wireless"] },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = perPage(ctx, 12, 1000);
        return { status: 200, body: Array.from({ length: n }, (_, i) => deviceStatus(ctx.params.organizationId + ":" + i)) };
      },
    },
    {
      method: "GET",
      path: "/networks/{networkId}/clients",
      operation: "getNetworkClients",
      summary: "List clients that have used the network within the timespan (wired and wireless).",
      aiTool: true,
      request: { networkId: "N_24329156", timespan: "86400", perPage: "10" },
      params: [
        { name: "networkId", in: "path", type: "string", required: true, description: "Network to list clients for.", format: "network id (N_...)", example: "N_24329156" },
        { name: "timespan", in: "query", type: "integer", description: "Lookback window in seconds (max 2678400 / 31 days). Use instead of t0/t1.", default: 86400, example: 86400 },
        { name: "t0", in: "query", type: "string", description: "Start of the reporting window; alternative to timespan.", format: "date-time (ISO 8601)" },
        { name: "t1", in: "query", type: "string", description: "End of the reporting window; alternative to timespan.", format: "date-time (ISO 8601)" },
        { name: "perPage", in: "query", type: "integer", description: "Number of clients to return per page (1-1000).", default: 10, example: 10 },
        { name: "startingAfter", in: "query", type: "string", description: "Pagination token; return items after this value (server-generated)." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = perPage(ctx, 10, 1000);
        return { status: 200, body: Array.from({ length: n }, (_, i) => merakiClient(ctx.params.networkId + ":" + i)) };
      },
    },
    {
      method: "GET",
      path: "/organizations/{organizationId}/appliance/security/events",
      operation: "getOrganizationApplianceSecurityEvents",
      summary: "Organization-wide MX appliance security events - AMP file scans and Snort IDS/IPS alerts.",
      aiTool: true,
      request: { organizationId: "2930418", timespan: "86400", perPage: "20" },
      params: [
        { name: "organizationId", in: "path", type: "string", required: true, description: "Organization to report appliance security events for.", format: "numeric organization id", example: "2930418" },
        { name: "timespan", in: "query", type: "integer", description: "Lookback window in seconds (max 31536000 / 365 days). Use instead of t0/t1.", default: 86400, example: 86400 },
        { name: "t0", in: "query", type: "string", description: "Start of the reporting window; alternative to timespan.", format: "date-time (ISO 8601)" },
        { name: "t1", in: "query", type: "string", description: "End of the reporting window; alternative to timespan.", format: "date-time (ISO 8601)" },
        { name: "perPage", in: "query", type: "integer", description: "Number of events to return per page (1-1000).", default: 12, example: 20 },
        { name: "sortOrder", in: "query", type: "string", description: "Order events by timestamp.", enum: ["ascending", "descending"], default: "descending" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = perPage(ctx, 12, 1000);
        return { status: 200, body: securityEvents("org:" + ctx.params.organizationId, n) };
      },
    },
    {
      method: "GET",
      path: "/networks/{networkId}/appliance/security/events",
      operation: "getNetworkApplianceSecurityEvents",
      summary: "Security events (AMP file scans + IDS/IPS alerts) for a single MX network.",
      aiTool: true,
      request: { networkId: "N_24329156", timespan: "86400", perPage: "20" },
      params: [
        { name: "networkId", in: "path", type: "string", required: true, description: "MX network to report security events for.", format: "network id (N_...)", example: "N_24329156" },
        { name: "timespan", in: "query", type: "integer", description: "Lookback window in seconds (max 31536000 / 365 days). Use instead of t0/t1.", default: 86400, example: 86400 },
        { name: "t0", in: "query", type: "string", description: "Start of the reporting window; alternative to timespan.", format: "date-time (ISO 8601)" },
        { name: "t1", in: "query", type: "string", description: "End of the reporting window; alternative to timespan.", format: "date-time (ISO 8601)" },
        { name: "perPage", in: "query", type: "integer", description: "Number of events to return per page (1-1000).", default: 10, example: 20 },
        { name: "sortOrder", in: "query", type: "string", description: "Order events by timestamp.", enum: ["ascending", "descending"], default: "descending" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = perPage(ctx, 10, 1000);
        return { status: 200, body: securityEvents("net:" + ctx.params.networkId, n) };
      },
    },
    {
      method: "GET",
      path: "/organizations/{organizationId}/appliance/vpn/statuses",
      operation: "getOrganizationApplianceVpnStatuses",
      summary: "Site-to-site AutoVPN status for each MX network in the organization.",
      aiTool: true,
      request: { organizationId: "2930418", perPage: "10" },
      params: [
        { name: "organizationId", in: "path", type: "string", required: true, description: "Organization to report AutoVPN statuses for.", format: "numeric organization id", example: "2930418" },
        { name: "perPage", in: "query", type: "integer", description: "Number of network VPN statuses to return per page (1-300).", default: 6, example: 10 },
        { name: "startingAfter", in: "query", type: "string", description: "Pagination token; return items after this value (server-generated)." },
        { name: "networkIds", in: "query", type: "array", description: "Filter to VPN statuses for these networks.", format: "network ids (N_...)" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = perPage(ctx, 6, 300);
        return { status: 200, body: Array.from({ length: n }, (_, i) => vpnStatus(ctx.params.organizationId, "list:" + i)) };
      },
    },
    {
      method: "GET",
      path: "/networks/{networkId}/wireless/ssids",
      operation: "getNetworkWirelessSsids",
      summary: "List all 15 wireless SSID configurations for an MR network.",
      request: { networkId: "N_24329156" },
      params: [
        { name: "networkId", in: "path", type: "string", required: true, description: "Wireless (MR) network to list SSIDs for.", format: "network id (N_...)", example: "N_24329156" },
      ],
      respond: (ctx: MockContext): MockResult => ({
        status: 200,
        body: Array.from({ length: 15 }, (_, i) => ssidRow(ctx.params.networkId, i)),
      }),
    },
    {
      method: "GET",
      path: "/organizations/{organizationId}/licenses/overview",
      operation: "getOrganizationLicensesOverview",
      summary: "Co-term licensing overview - expiration, licensed device counts, and per-state counts.",
      request: { organizationId: "2930418" },
      params: [
        { name: "organizationId", in: "path", type: "string", required: true, description: "Organization to report the co-term licensing overview for.", format: "numeric organization id", example: "2930418" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const r = rng("meraki:lic:" + ctx.params.organizationId);
        const exp = new Date(Date.now() + int(r, 120, 900) * 86_400_000);
        const expiring = int(r, 0, 6);
        return {
          status: 200,
          body: {
            status: "OK",
            expirationDate: exp.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) + " UTC",
            licensedDeviceCounts: { MX: int(r, 5, 20), MS: int(r, 40, 150), MR: int(r, 20, 120), MV: int(r, 0, 30) },
            licenseCount: int(r, 100, 320),
            states: {
              active: { count: int(r, 90, 300) },
              expired: { count: int(r, 0, 4) },
              expiring: { count: expiring, warning: { thresholdInDays: 90, expiringCount: expiring } },
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/organizations/{organizationId}/inventory/devices",
      operation: "getOrganizationInventoryDevices",
      summary: "Full device inventory for an organization (claimed and unassigned).",
      aiTool: true,
      request: { organizationId: "2930418", perPage: "10" },
      params: [
        { name: "organizationId", in: "path", type: "string", required: true, description: "Organization to list inventory devices for.", format: "numeric organization id", example: "2930418" },
        { name: "perPage", in: "query", type: "integer", description: "Number of inventory devices to return per page (1-1000).", default: 12, example: 10 },
        { name: "startingAfter", in: "query", type: "string", description: "Pagination token; return items after this value (server-generated)." },
        { name: "usedState", in: "query", type: "string", description: "Filter by whether the device is assigned to a network.", enum: ["used", "unused"] },
        { name: "productTypes", in: "query", type: "array", description: "Filter to these device product types.", enum: ["appliance", "switch", "wireless", "camera"] },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = perPage(ctx, 12, 1000);
        return { status: 200, body: Array.from({ length: n }, (_, i) => inventoryDevice(ctx.params.organizationId + ":" + i)) };
      },
    },
  ],
  events: [
    {
      type: "security.event",
      summary: "An MX appliance security event (AMP file scan / IDS alert) was recorded.",
      sample: () => ampEvent("evt:" + uuid()),
    },
  ],
};
