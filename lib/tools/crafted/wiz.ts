import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, minutesAgoIso, daysAgoIso, nowIso, uuid } from "../helpers";
import { fleetDevices, extId, macColon, FLEET_ORG, type FleetDevice } from "../../fleet/fleet";

// Wiz cloud security (CNAPP) - cloud resource inventory and issues (scaffold
// adapter). OAuth2 client-credentials at /oauth/token exchanged for a bearer
// token (the real API is GraphQL; this scaffold exposes an equivalent REST
// surface with the same envelope shapes: cloud resources as
// { data: { nodes: [...] } } connection pages, issues as { issues: [...] }).
// Cloud VMs project the canonical fleet's SERVERS (hostnames "SRV-*") plus a
// few pure-cloud extras, so the server estate correlates with CrowdStrike /
// Qualys / ServiceNow on serial/mac/hostname. Every resource keeps the
// generic-normalizer keys (id / hostname / mac / serial / os / ip / lastSeen)
// at the top level alongside Wiz-flavored cloud fields.

/** UUID-shaped stable id derived from extId. */
function wizUuid(seed: string): string {
  const h = extId("wiz", seed, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const PLATFORM_META: readonly [string, string, readonly string[]][] = [
  ["AWS", "EC2 Instance", ["us-east-1", "eu-west-1", "ap-southeast-1"]],
  ["Azure", "Microsoft.Compute/virtualMachines", ["eastus", "westeurope", "southeastasia"]],
  ["GCP", "compute#instance", ["us-central1", "europe-west1", "asia-southeast1"]],
];

/** Extra cloud-only workloads (not in the fleet - correlate as new assets). */
const CLOUD_EXTRAS: readonly [string, string][] = [
  ["eks-node-prod-01", "Amazon Linux 2023"],
  ["eks-node-prod-02", "Amazon Linux 2023"],
  ["aks-nodepool1-vm-03", "Ubuntu 22.04 LTS"],
  ["gke-batch-pool-7f2a", "Container-Optimized OS 113"],
  ["vm-ci-runner-01", "Ubuntu 22.04 LTS"],
];

interface CloudSeed {
  key: string;          // seed key (fleetId or extra name)
  hostname: string;
  mac: string;
  serial: string;
  os: string;
  ip: string;
}

function cloudSeeds(): CloudSeed[] {
  const servers = fleetDevices().filter((d: FleetDevice) => d.hostname.startsWith("SRV-"));
  const fromFleet = servers.map((d) => ({ key: d.fleetId, hostname: d.hostname, mac: macColon(d.mac), serial: d.serial, os: d.os, ip: d.ip }));
  const extras = CLOUD_EXTRAS.map(([name, os]) => {
    const r = rng("wiz:extra:" + name);
    const oct = () => int(r, 0, 255).toString(16).padStart(2, "0");
    return {
      key: "extra:" + name,
      hostname: name,
      // "0e:" locally-administered prefix so extras never collide with fleet macs ("0a:").
      mac: `0e:${oct()}:${oct()}:${oct()}:${oct()}:${oct()}`,
      serial: "ec2-" + extId("wiz", "serial:" + name, 17),
      os,
      ip: `172.31.${int(r, 0, 254)}.${int(r, 2, 250)}`,
    };
  });
  return [...fromFleet, ...extras];
}

/** Project one seed into Wiz's cloud-resource node shape (+ generic keys). */
function cloudResource(s: CloudSeed) {
  const r = rng("wiz:vm:" + s.key);
  const [cloudPlatform, nativeType, regions] = pick(r, PLATFORM_META);
  const region = pick(r, regions);
  const account = String(int(r, 100000000000, 999999999999));
  const providerUniqueId =
    cloudPlatform === "AWS"
      ? `arn:aws:ec2:${region}:${account}:instance/i-${extId("wiz", "inst:" + s.key, 17)}`
      : cloudPlatform === "Azure"
        ? `/subscriptions/${wizUuid("sub:" + s.key)}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/${s.hostname.toLowerCase()}`
        : `projects/meridian-prod/zones/${region}-a/instances/${s.hostname.toLowerCase()}`;
  return {
    // generic normalizer contract (top level)
    id: wizUuid(s.key),
    hostname: s.hostname,
    mac: s.mac,
    serial: s.serial,
    os: s.os,
    ip: s.ip,
    lastSeen: minutesAgoIso(int(r, 5, 720)),
    // Wiz-flavored cloud surface
    name: s.hostname,
    type: "VIRTUAL_MACHINE",
    nativeType,
    cloudPlatform,
    subscriptionExternalId: cloudPlatform === "Azure" ? wizUuid("sub:" + s.key) : account,
    providerUniqueId,
    region,
    status: "Active",
    creationDate: daysAgoIso(int(r, 20, 600)),
    externallyExposed: chance(r, 0.2),
    tags: { env: s.hostname.includes("ci") ? "ci" : "production", owner: "platform-eng", "wiz:managed-by": FLEET_ORG.company },
  };
}

const CONTROLS = [
  ["Publicly exposed VM with a known exploitable vulnerability", "CRITICAL"],
  ["VM with cleartext cloud keys stored on disk", "HIGH"],
  ["Unencrypted disk attached to a production VM", "MEDIUM"],
  ["VM instance assigned a permissive admin IAM role", "HIGH"],
  ["OS end-of-life on a running instance", "MEDIUM"],
  ["Log4Shell (CVE-2021-44228) detected on internet-facing workload", "CRITICAL"],
] as const;

/** Deterministic issues: a seeded subset of resources each raise 1-2 issues. */
function wizIssues() {
  return cloudSeeds()
    .filter((s) => chance(rng("wiz:hasissue:" + s.key), 0.45))
    .flatMap((s) => {
      const r = rng("wiz:issues:" + s.key);
      const res = cloudResource(s);
      const count = int(r, 1, 2);
      return Array.from({ length: count }, (_, i) => {
        const ir = rng("wiz:issue:" + s.key + ":" + i);
        const [name, severity] = pick(ir, CONTROLS);
        const status = pick(ir, ["OPEN", "OPEN", "OPEN", "IN_PROGRESS", "RESOLVED"] as const);
        return {
          id: wizUuid("issue:" + s.key + ":" + i),
          name,
          severity,
          status,
          hostname: s.hostname,
          createdAt: daysAgoIso(int(ir, 1, 90)),
          updatedAt: minutesAgoIso(int(ir, 10, 4320)),
          resolvedAt: status === "RESOLVED" ? minutesAgoIso(int(ir, 10, 1440)) : null,
          dueAt: null,
          entitySnapshot: { id: res.id, name: res.name, type: "VIRTUAL_MACHINE", cloudPlatform: res.cloudPlatform, region: res.region, subscriptionExternalId: res.subscriptionExternalId },
          sourceRule: { id: wizUuid("rule:" + name), name },
          projects: [{ id: wizUuid("project:production"), name: "Production" }],
        };
      });
    });
}

export const wiz: ToolDef = {
  id: "wiz",
  name: "Wiz",
  vendor: "Wiz",
  category: "cloud-security",
  crafted: false,
  summary:
    "Wiz cloud security (CNAPP) - OAuth token endpoint, cloud VM inventory projected from the fleet's servers plus cloud-only workloads, security issues and an issue-resolve action.",
  tags: ["cloud-security", "wiz", "cnapp", "cspm", "cloud-resources", "issues"],
  auth: { type: "bearer" },
  docsUrl: "https://docs.wiz.io/wiz-docs/docs/using-the-wiz-api",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/oauth/token",
      operation: "getToken",
      summary: "OAuth2 client-credentials grant - service-account client id/secret exchanged for a bearer token.",
      request: { grant_type: "client_credentials", client_id: "<service-account-id>", client_secret: "<secret>", audience: "wiz-api" },
      params: [
        { name: "grant_type", in: "body", type: "string", required: true, enum: ["client_credentials"], description: "OAuth2 grant type - only client_credentials is supported.", default: "client_credentials" },
        { name: "client_id", in: "body", type: "string", required: true, description: "Service account client id." },
        { name: "client_secret", in: "body", type: "string", required: true, description: "Service account client secret." },
        { name: "audience", in: "body", type: "string", required: true, description: "Token audience.", enum: ["wiz-api"], default: "wiz-api" },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: { access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock." + Buffer.from(uuid()).toString("base64url"), token_type: "Bearer", expires_in: 86400 },
      }),
    },
    {
      method: "GET",
      path: "/v1/cloud-resources",
      operation: "listCloudResources",
      summary: "List cloud resources (VMs) - connection envelope { data: { nodes: [...], pageInfo } }.",
      request: { first: "10" },
      params: [
        { name: "first", in: "query", type: "integer", description: "Page size; omit to return the full inventory (capped at 500).", example: 10 },
        { name: "after", in: "query", type: "string", description: "Pagination cursor from pageInfo.endCursor (server-generated)." },
        { name: "cloudPlatform", in: "query", type: "string", description: "Filter to one cloud platform.", enum: ["AWS", "Azure", "GCP"] },
      ],
      respond: (ctx: MockContext): MockResult => {
        let nodes = cloudSeeds().map(cloudResource);
        if (ctx.query.cloudPlatform) nodes = nodes.filter((n) => n.cloudPlatform === ctx.query.cloudPlatform);
        const first = Number(ctx.query.first);
        if (Number.isFinite(first) && first > 0) nodes = nodes.slice(0, Math.min(first, 500));
        return { status: 200, body: { data: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } };
      },
    },
    {
      method: "GET",
      path: "/v1/issues",
      operation: "listIssues",
      summary: "List security issues raised by controls - body { issues: [...], totalCount }.",
      request: { severity: "CRITICAL", limit: "10" },
      params: [
        { name: "severity", in: "query", type: "string", description: "Filter by severity.", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
        { name: "status", in: "query", type: "string", description: "Filter by workflow status.", enum: ["OPEN", "IN_PROGRESS", "RESOLVED"] },
        { name: "limit", in: "query", type: "integer", description: "Max issues to return; omit to return all (capped at 500).", example: 10 },
      ],
      respond: (ctx: MockContext): MockResult => {
        let issues = wizIssues();
        if (ctx.query.severity) issues = issues.filter((i) => i.severity === ctx.query.severity);
        if (ctx.query.status) issues = issues.filter((i) => i.status === ctx.query.status);
        const limit = Number(ctx.query.limit);
        if (Number.isFinite(limit) && limit > 0) issues = issues.slice(0, Math.min(limit, 500));
        return { status: 200, body: { issues, totalCount: issues.length } };
      },
    },
    {
      method: "POST",
      path: "/v1/issues/{issueId}/resolve",
      operation: "resolveIssue",
      summary: "Resolve an issue with an optional resolution reason and note.",
      emits: "issue.resolved",
      request: { issueId: "<issue-uuid>", resolutionReason: "ISSUE_FIXED", note: "Patched and redeployed" },
      params: [
        { name: "issueId", in: "path", type: "string", required: true, description: "Id of the issue to resolve.", format: "uuid", example: "9b8c7d6e-5f4a-3210-bcde-f01234567890" },
        { name: "resolutionReason", in: "body", type: "string", description: "Why the issue is being resolved.", enum: ["ISSUE_FIXED", "CONTROL_CHANGED", "FALSE_POSITIVE", "EXCEPTION"], default: "ISSUE_FIXED" },
        { name: "note", in: "body", type: "string", description: "Free-text resolution note.", example: "Patched and redeployed" },
      ],
      respond: (ctx: MockContext): MockResult => ({
        status: 200,
        body: {
          id: ctx.params.issueId,
          status: "RESOLVED",
          resolutionReason: ctx.body?.resolutionReason ?? "ISSUE_FIXED",
          note: ctx.body?.note ?? null,
          resolvedAt: nowIso(),
        },
      }),
    },
  ],
  events: [
    {
      type: "issue.resolved",
      summary: "A security issue was resolved.",
      sample: () => {
        const issues = wizIssues();
        const i = int(rng("wiz:evt:" + uuid()), 0, issues.length - 1);
        return { ...issues[i], status: "RESOLVED", resolvedAt: nowIso() };
      },
    },
    {
      type: "issue.created",
      summary: "A control raised a new security issue on a cloud resource.",
      sample: () => {
        const issues = wizIssues();
        const i = int(rng("wiz:evt:" + uuid()), 0, issues.length - 1);
        return { ...issues[i], status: "OPEN", createdAt: nowIso(), resolvedAt: null };
      },
    },
  ],
};
