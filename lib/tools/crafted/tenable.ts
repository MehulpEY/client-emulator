import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, minutesAgoIso, daysAgoIso, nowIso, uuid } from "../helpers";
import { fleetEndpoints, extId, macColon, FLEET_ORG, type FleetDevice } from "../../fleet/fleet";

// Tenable Vulnerability Management (Tenable.io) - assets, vulnerability
// findings and scan launch (scaffold adapter). Auth is the X-ApiKeys header
// ("accessKey=...;secretKey=..."). Assets and vulns project the canonical
// fleet's endpoints (lib/fleet/fleet.ts) so hosts correlate with CrowdStrike /
// Qualys / SentinelOne on serial/mac/hostname. Every record keeps the
// generic-normalizer keys (id / hostname / mac / serial / os / ip / lastSeen)
// at the top level alongside Tenable-flavored fields.

/** UUID-shaped stable id derived from extId, e.g. Tenable asset uuids. */
function tenUuid(seed: string): string {
  const h = extId("tenable", seed, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

/** Plugin pool: [pluginId, name, family, severityId 0..4, cve | null]. */
const PLUGINS: readonly [number, string, string, number, string | null][] = [
  [51192, "SSL Certificate Cannot Be Trusted", "General", 2, null],
  [157288, "Apache Log4j 2.x < 2.16.0 RCE (Log4Shell)", "Misc.", 4, "CVE-2021-44228"],
  [161502, "OpenSSL 1.1.1 < 1.1.1n Denial of Service", "General", 3, "CVE-2022-0778"],
  [97833, "MS17-010: Windows SMBv1 Multiple Vulnerabilities (EternalBlue)", "Windows", 4, "CVE-2017-0144"],
  [148847, "Google Chrome < 90.0.4430.72 Multiple Vulnerabilities", "Windows", 3, "CVE-2021-21224"],
  [10863, "SSL Certificate Expiry", "General", 1, null],
  [55901, "Apache Tomcat Default Files", "Web Servers", 2, null],
  [166002, "macOS 12.x < 12.6.1 Multiple Vulnerabilities", "MacOS X Local Security Checks", 3, "CVE-2022-32944"],
  [20007, "SSL Version 2 and 3 Protocol Detection", "Service detection", 3, null],
  [156032, "curl 7.x < 7.81.0 Multiple Vulnerabilities", "Misc.", 2, "CVE-2022-22576"],
] as const;

/** Project one fleet endpoint into Tenable's asset shape (+ generic keys). */
function tenAsset(d: FleetDevice) {
  const r = rng("tenable:asset:" + d.fleetId);
  const lastSeen = minutesAgoIso(int(r, 10, 2880));
  const firstSeen = daysAgoIso(int(r, 45, 700));
  return {
    // generic normalizer contract (top level)
    id: tenUuid(d.fleetId),
    hostname: d.hostname,
    mac: macColon(d.mac),
    serial: d.serial,
    os: d.os,
    ip: d.ip,
    lastSeen,
    // Tenable-flavored surface
    has_agent: d.platform === "linux" ? chance(r, 0.5) : true,
    created_at: firstSeen,
    updated_at: lastSeen,
    first_seen: firstSeen,
    last_seen: lastSeen,
    ipv4s: [d.ip],
    fqdns: [`${d.hostname.toLowerCase()}.${FLEET_ORG.domain}`],
    netbios_names: d.platform === "windows" ? [d.hostname] : [],
    operating_systems: [d.os],
    mac_addresses: [macColon(d.mac)],
    sources: [{ name: "NESSUS_AGENT", first_seen: firstSeen, last_seen: lastSeen }],
    acr_score: int(r, 1, 10),
    exposure_score: int(r, 120, 950),
    tags: d.tags.map((t) => ({ key: "fleet", value: t })),
  };
}

/** Deterministic vulnerability findings for one asset (0-3 plugins). */
function vulnsFor(d: FleetDevice) {
  const r = rng("tenable:vulns:" + d.fleetId);
  const count = int(r, 0, 3);
  return sample(r, PLUGINS, count).map(([pluginId, name, family, sevId, cve]) => {
    const vr = rng("tenable:vuln:" + d.fleetId + ":" + pluginId);
    const lastFound = minutesAgoIso(int(vr, 30, 4320));
    return {
      // generic normalizer contract (top level) + hostname/severity for W3
      id: tenUuid("vuln:" + d.fleetId + ":" + pluginId),
      hostname: d.hostname,
      mac: macColon(d.mac),
      serial: d.serial,
      os: d.os,
      ip: d.ip,
      lastSeen: lastFound,
      severity: SEVERITIES[sevId],
      // Tenable-flavored surface
      severity_id: sevId,
      state: pick(vr, ["OPEN", "OPEN", "OPEN", "REOPENED", "FIXED"] as const),
      cve: cve ? [cve] : [],
      plugin: { id: pluginId, name, family, cvss3_base_score: sevId === 0 ? 0 : +(sevId * 2.2 + vr()).toFixed(1) },
      asset_uuid: tenUuid(d.fleetId),
      port: { port: pick(vr, [0, 443, 445, 3389, 8080]), protocol: "TCP" },
      first_found: daysAgoIso(int(vr, 10, 300)),
      last_found: lastFound,
    };
  });
}

export const tenable: ToolDef = {
  id: "tenable",
  name: "Tenable Vulnerability Management",
  vendor: "Tenable",
  category: "vuln-mgmt",
  crafted: false,
  summary:
    "Tenable Vulnerability Management (Tenable.io) - asset inventory and vulnerability findings projected from the canonical fleet, plus scan launch and server status.",
  tags: ["vuln-mgmt", "tenable", "nessus", "assets", "vulnerabilities", "scans"],
  auth: { type: "api_key_header", param: "x-apikeys" },
  docsUrl: "https://developer.tenable.com/reference/navigate",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "GET",
      path: "/assets",
      operation: "listAssets",
      summary: "List assets seen by scans and agents - body { assets: [...], total }.",
      request: { limit: "10" },
      params: [
        { name: "limit", in: "query", type: "integer", description: "Max assets to return; omit to return the full inventory (capped at 5000).", example: 10 },
      ],
      respond: (ctx: MockContext): MockResult => {
        let assets = fleetEndpoints().map(tenAsset);
        const limit = Number(ctx.query.limit);
        if (Number.isFinite(limit) && limit > 0) assets = assets.slice(0, Math.min(limit, 5000));
        return { status: 200, body: { assets, total: assets.length } };
      },
    },
    {
      method: "GET",
      path: "/vulns",
      operation: "listVulnerabilities",
      summary: "List vulnerability findings across assets - body { vulnerabilities: [...], total }.",
      request: { severity: "critical,high", limit: "20" },
      params: [
        { name: "severity", in: "query", type: "string", description: "Comma-separated severities to include.", format: "comma list of: info, low, medium, high, critical", example: "critical,high" },
        { name: "state", in: "query", type: "string", description: "Filter findings by state.", enum: ["OPEN", "REOPENED", "FIXED"] },
        { name: "limit", in: "query", type: "integer", description: "Max findings to return; omit to return all (capped at 5000).", example: 20 },
      ],
      respond: (ctx: MockContext): MockResult => {
        let vulnerabilities = fleetEndpoints().flatMap(vulnsFor);
        if (ctx.query.severity) {
          const want = new Set(ctx.query.severity.split(",").map((s) => s.trim().toLowerCase()));
          vulnerabilities = vulnerabilities.filter((v) => want.has(v.severity));
        }
        if (ctx.query.state) vulnerabilities = vulnerabilities.filter((v) => v.state === ctx.query.state);
        const limit = Number(ctx.query.limit);
        if (Number.isFinite(limit) && limit > 0) vulnerabilities = vulnerabilities.slice(0, Math.min(limit, 5000));
        return { status: 200, body: { vulnerabilities, total: vulnerabilities.length } };
      },
    },
    {
      method: "POST",
      path: "/scans/{scanId}/launch",
      operation: "launchScan",
      summary: "Launch a configured scan, optionally against alternate targets.",
      emits: "scan.launched",
      request: { scanId: "42", alt_targets: ["10.10.4.0/24"] },
      params: [
        { name: "scanId", in: "path", type: "integer", required: true, description: "Numeric id of the scan configuration to launch.", example: 42 },
        { name: "alt_targets[]", in: "body", type: "array", description: "Optional list of targets to scan instead of the scan's saved targets.", format: "array of IPs / CIDR ranges / hostnames", example: "[\"10.10.4.0/24\"]" },
      ],
      respond: (): MockResult => ({ status: 200, body: { scan_uuid: uuid() } }),
    },
    {
      method: "GET",
      path: "/server/status",
      operation: "getServerStatus",
      summary: "Server/service status - the cheapest liveness probe.",
      params: [],
      respond: (): MockResult => ({ status: 200, body: { code: 200, status: "ready" } }),
    },
  ],
  events: [
    {
      type: "scan.launched",
      summary: "A vulnerability scan was launched.",
      sample: () => {
        const r = rng("tenable:evt:" + uuid());
        return { scan_id: int(r, 10, 99), scan_uuid: uuid(), status: "running", targets: `10.${int(r, 10, 30)}.0.0/24`, launched_at: nowIso() };
      },
    },
    {
      type: "vulnerability.found",
      summary: "A new vulnerability finding was recorded on an asset.",
      sample: () => {
        const r = rng("tenable:evt:" + uuid());
        const d = pick(r, fleetEndpoints());
        return vulnsFor(d)[0] ?? { ...tenAsset(d), severity: "high", plugin: { id: PLUGINS[1][0], name: PLUGINS[1][1] } };
      },
    },
  ],
};
