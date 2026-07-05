import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, minutesAgoIso, nowIso, uuid } from "../helpers";
import { fleetEndpoints, extId, macColon, FLEET_ORG, FLEET_SITES, type FleetDevice } from "../../fleet/fleet";

// Rapid7 InsightVM (Security Console API v3) - asset inventory, sites and scan
// launch (scaffold adapter). HTTP Basic auth. Responses use the API's
// { resources: [...], page, links } envelope. Assets project ALL of the
// canonical fleet's endpoints (lib/fleet/fleet.ts) so hosts correlate with
// CrowdStrike / Qualys / Tenable on serial/mac/hostname. Every record keeps
// the generic-normalizer keys (id / hostname / mac / serial / os / ip /
// lastSeen) at the top level alongside InsightVM-flavored fields.

const CONSOLE_URL = `https://insightvm.${FLEET_ORG.domain}:3780`;

/** Stable numeric InsightVM asset id derived from extId (24-bit space). */
const r7Id = (seed: string): number => parseInt(extId("rapid7", seed, 6), 16);

const OS_FAMILY: Record<FleetDevice["platform"], string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
  network: "Embedded",
};

/** Project one fleet endpoint into InsightVM's asset shape (+ generic keys). */
function r7Asset(d: FleetDevice) {
  const r = rng("r7:asset:" + d.fleetId);
  const lastScan = minutesAgoIso(int(r, 60, 10080));
  const critical = int(r, 0, 3);
  const severe = int(r, 0, 8);
  const moderate = int(r, 0, 15);
  const fqdn = `${d.hostname.toLowerCase()}.${FLEET_ORG.domain}`;
  const id = r7Id(d.fleetId);
  return {
    // generic normalizer contract (top level)
    id,
    hostname: d.hostname,
    mac: macColon(d.mac),
    serial: d.serial,
    os: d.os,
    ip: d.ip,
    lastSeen: lastScan,
    // InsightVM-flavored surface
    hostName: fqdn,
    hostNames: [{ name: fqdn, source: "dns" }, { name: d.hostname, source: "netbios" }],
    addresses: [{ ip: d.ip, mac: macColon(d.mac).toUpperCase() }],
    osFingerprint: { description: d.os, family: OS_FAMILY[d.platform], product: d.os, systemName: d.os, type: d.hostname.startsWith("SRV-") ? "Server" : "Workstation" },
    assessedForPolicies: false,
    assessedForVulnerabilities: true,
    riskScore: int(r, 300, 30000),
    rawRiskScore: int(r, 300, 30000),
    vulnerabilities: { critical, severe, moderate, exploits: int(r, 0, 2), malwareKits: 0, total: critical + severe + moderate },
    history: [{ type: "SCAN", date: lastScan, version: 1 }],
    links: [{ href: `${CONSOLE_URL}/api/3/assets/${id}`, rel: "self" }],
  };
}

/** One static site per fleet location. */
function r7Sites() {
  return FLEET_SITES.map((site, i) => {
    const r = rng("r7:site:" + site);
    const assets = fleetEndpoints().filter((d) => d.site === site).length;
    return {
      id: i + 1,
      name: site,
      description: `${FLEET_ORG.company} - ${site} network`,
      type: "static",
      importance: "normal",
      assets,
      riskScore: int(r, 5000, 250000),
      scanEngine: 3,
      scanTemplate: "full-audit-without-web-spider",
      lastScanTime: minutesAgoIso(int(r, 360, 20160)),
      links: [{ href: `${CONSOLE_URL}/api/3/sites/${i + 1}`, rel: "self" }],
    };
  });
}

const pageOf = (total: number, size: number, number: number) => ({
  number,
  size,
  totalResources: total,
  totalPages: Math.max(1, Math.ceil(total / size)),
});

export const rapid7: ToolDef = {
  id: "rapid7",
  name: "Rapid7 InsightVM",
  vendor: "Rapid7",
  category: "vuln-mgmt",
  crafted: false,
  summary:
    "Rapid7 InsightVM Security Console API v3 - scanned asset inventory with vulnerability counts projected from the canonical fleet, scan sites and site scan launch.",
  tags: ["vuln-mgmt", "rapid7", "insightvm", "nexpose", "assets", "scans"],
  auth: { type: "basic" },
  docsUrl: "https://help.rapid7.com/insightvm/en-us/api/index.html",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "GET",
      path: "/api/3/assets",
      operation: "listAssets",
      summary: "List scanned assets - body { resources: [...], page, links }. Projects every fleet endpoint.",
      request: { size: "10" },
      params: [
        { name: "page", in: "query", type: "integer", description: "Zero-based page index.", default: 0 },
        { name: "size", in: "query", type: "integer", description: "Number of assets per page (1-500).", default: 500, example: 10 },
        { name: "sort", in: "query", type: "string", description: "Sort criteria, e.g. riskScore,DESC.", example: "riskScore,DESC" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const all = fleetEndpoints().map(r7Asset);
        const size = Math.min(Math.max(1, Number(ctx.query.size) || 500), 500);
        const page = Math.max(0, Number(ctx.query.page) || 0);
        const resources = all.slice(page * size, page * size + size);
        return {
          status: 200,
          body: { resources, page: pageOf(all.length, size, page), links: [{ href: `${CONSOLE_URL}/api/3/assets`, rel: "self" }] },
        };
      },
    },
    {
      method: "GET",
      path: "/api/3/sites",
      operation: "listSites",
      summary: "List scan sites (one per fleet location) - body { resources: [...], page, links }.",
      params: [
        { name: "page", in: "query", type: "integer", description: "Zero-based page index.", default: 0 },
        { name: "size", in: "query", type: "integer", description: "Number of sites per page.", default: 10 },
      ],
      respond: (): MockResult => {
        const resources = r7Sites();
        return {
          status: 200,
          body: { resources, page: pageOf(resources.length, 10, 0), links: [{ href: `${CONSOLE_URL}/api/3/sites`, rel: "self" }] },
        };
      },
    },
    {
      method: "POST",
      path: "/api/3/sites/{id}/scans",
      operation: "startSiteScan",
      summary: "Start a scan of a site, optionally against specific hosts or with a named scan.",
      emits: "scan.started",
      request: { id: "1", name: "Ad-hoc sweep", hosts: ["10.10.0.0/24"] },
      params: [
        { name: "id", in: "path", type: "integer", required: true, description: "Id of the site to scan (see listSites).", example: 1 },
        { name: "name", in: "body", type: "string", description: "Display name for the scan.", example: "Ad-hoc sweep" },
        { name: "hosts[]", in: "body", type: "array", description: "Optional subset of hosts/ranges to scan instead of the whole site.", format: "array of IPs / CIDR ranges / hostnames", example: "[\"10.10.0.0/24\"]" },
        { name: "engineId", in: "body", type: "integer", description: "Scan engine to run the scan on.", default: 3 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const siteId = Number(ctx.params.id);
        if (!Number.isInteger(siteId) || siteId < 1 || siteId > FLEET_SITES.length) {
          return { status: 404, body: { status: 404, message: `Site ${ctx.params.id} does not exist.` } };
        }
        const scanId = r7Id("scan:" + uuid());
        return { status: 201, body: { id: scanId, links: [{ href: `${CONSOLE_URL}/api/3/scans/${scanId}`, rel: "self" }] } };
      },
    },
  ],
  events: [
    {
      type: "scan.started",
      summary: "A site scan was started.",
      sample: () => {
        const r = rng("r7:evt:" + uuid());
        const siteIdx = int(r, 0, FLEET_SITES.length - 1);
        return { id: r7Id("scan:" + uuid()), siteId: siteIdx + 1, siteName: FLEET_SITES[siteIdx], scanName: "Ad-hoc sweep", engineId: 3, status: "running", startedAt: nowIso() };
      },
    },
  ],
};
