import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, fakeIp, fakeSha1, minutesAgoIso, daysAgoIso, nowIso, uuid, MALWARE_FAMILIES } from "../helpers";
import { fleetEndpoints, ownerOf, extId, macColon, FLEET_ORG, type FleetDevice } from "../../fleet/fleet";

// SentinelOne Singularity (EDR) - Management API v2.1 agents, threats and
// response actions (scaffold adapter). Auth is the "Authorization" header with
// an API token ("ApiToken <token>"; the raw token is also accepted). Agents
// project the canonical fleet's Windows and macOS endpoints
// (lib/fleet/fleet.ts) so hosts correlate with CrowdStrike / Qualys / Intune
// on serial/mac/hostname. Every record keeps the generic-normalizer keys
// (id / hostname / mac / serial / os / ip / lastSeen) at the top level
// alongside SentinelOne-flavored fields.

/** 18-digit-style numeric SentinelOne id derived from extId. */
const s1Id = (seed: string): string => BigInt("0x" + extId("sentinelone", seed, 15)).toString();

/** UUID-shaped agent uuid derived from extId. */
function s1Uuid(seed: string): string {
  const h = extId("sentinelone", "uuid:" + seed, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const AGENT_VERSIONS = ["23.4.2.14", "24.1.3.7", "24.2.2.5"] as const;

const s1Fleet = (): FleetDevice[] => fleetEndpoints().filter((d) => d.platform === "windows" || d.platform === "mac");

/** Project one fleet endpoint into SentinelOne's agent shape (+ generic keys). */
function s1Agent(d: FleetDevice) {
  const r = rng("s1:agent:" + d.fleetId);
  const owner = ownerOf(d);
  const lastActive = minutesAgoIso(int(r, 1, 720));
  const threats = chance(r, 0.08) ? int(r, 1, 2) : 0;
  return {
    // generic normalizer contract (top level)
    id: s1Id(d.fleetId),
    hostname: d.hostname,
    mac: macColon(d.mac),
    serial: d.serial,
    os: d.os,
    ip: d.ip,
    lastSeen: lastActive,
    // SentinelOne-flavored surface
    uuid: s1Uuid(d.fleetId),
    computerName: d.hostname,
    agentVersion: pick(r, AGENT_VERSIONS),
    osName: d.os,
    osType: d.platform === "mac" ? "macos" : "windows",
    machineType: d.hostname.startsWith("SRV-") ? "server" : "laptop",
    serialNumber: d.serial,
    externalIp: fakeIp(r),
    lastActiveDate: lastActive,
    registeredAt: daysAgoIso(int(r, 30, 600)),
    isActive: threats === 0 ? chance(r, 0.95) : true,
    infected: threats > 0,
    activeThreats: threats,
    networkStatus: pick(r, ["connected", "connected", "connected", "disconnected"] as const),
    mitigationMode: "protect",
    siteName: d.site,
    groupName: `${d.site} / Default Group`,
    domain: d.platform === "windows" ? FLEET_ORG.domain.split(".")[0].toUpperCase() : "WORKGROUP",
    lastLoggedInUserName: owner ? owner.upn.split("@")[0] : "",
    networkInterfaces: [
      { id: s1Id("nic:" + d.fleetId), name: d.platform === "mac" ? "en0" : "Ethernet", inet: [d.ip], physical: macColon(d.mac) },
    ],
  };
}

/** Deterministic subset of agents with an active threat. */
function s1Threats() {
  return s1Fleet()
    .filter((d) => chance(rng("s1:hasthreat:" + d.fleetId), 0.2))
    .map((d) => {
      const r = rng("s1:threat:" + d.fleetId);
      const family = pick(r, MALWARE_FAMILIES);
      const resolved = chance(r, 0.4);
      return {
        id: s1Id("threat:" + d.fleetId),
        threatInfo: {
          threatName: `${family}.${pick(r, ["gen", "exe", "dropper"] as const)}`,
          classification: pick(r, ["Malware", "Ransomware", "PUA", "Trojan"] as const),
          analystVerdict: resolved ? "true_positive" : "undefined",
          incidentStatus: resolved ? "resolved" : "unresolved",
          mitigationStatus: resolved ? "mitigated" : pick(r, ["not_mitigated", "mitigated"] as const),
          confidenceLevel: pick(r, ["malicious", "suspicious"] as const),
          sha1: fakeSha1("s1:" + d.fleetId),
          createdAt: minutesAgoIso(int(r, 30, 10080)),
        },
        agentRealtimeInfo: {
          agentId: s1Id(d.fleetId),
          agentComputerName: d.hostname,
          agentOsType: d.platform === "mac" ? "macos" : "windows",
        },
        agentDetectionInfo: { agentLastLoggedInUserName: ownerOf(d)?.upn.split("@")[0] ?? "" },
      };
    });
}

const paged = <T>(data: T[]) => ({ pagination: { totalItems: data.length, nextCursor: null }, data });

export const sentinelOne: ToolDef = {
  id: "sentinelone",
  name: "SentinelOne Singularity",
  vendor: "SentinelOne",
  category: "edr",
  crafted: false,
  summary:
    "SentinelOne Singularity EDR - Management API v2.1 agent inventory (Windows/macOS fleet), threats, response actions (disconnect from network) and system info.",
  tags: ["edr", "sentinelone", "agents", "threats", "response", "endpoint"],
  auth: { type: "api_key_header", param: "authorization" },
  docsUrl: "https://usea1-partners.sentinelone.net/api-doc/overview",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "GET",
      path: "/web/api/v2.1/agents",
      operation: "listAgents",
      summary: "List agents - body { data: [...], pagination }. Projects the fleet's Windows and macOS endpoints.",
      request: { limit: "10" },
      params: [
        { name: "limit", in: "query", type: "integer", description: "Number of agents to return (1-1000); omit to return all.", example: 10 },
        { name: "cursor", in: "query", type: "string", description: "Pagination cursor from a previous response (server-generated)." },
        { name: "computerName__contains", in: "query", type: "string", description: "Case-insensitive substring match on computer name.", example: "SRV" },
        { name: "osTypes", in: "query", type: "string", description: "Comma-separated OS types to include.", format: "comma list of: windows, macos", example: "windows" },
      ],
      respond: (ctx: MockContext): MockResult => {
        let data = s1Fleet().map(s1Agent);
        const name = (ctx.query.computerName__contains || "").toLowerCase();
        if (name) data = data.filter((a) => a.computerName.toLowerCase().includes(name));
        if (ctx.query.osTypes) {
          const want = new Set(ctx.query.osTypes.split(",").map((s) => s.trim().toLowerCase()));
          data = data.filter((a) => want.has(a.osType));
        }
        const limit = Number(ctx.query.limit);
        if (Number.isFinite(limit) && limit > 0) data = data.slice(0, Math.min(limit, 1000));
        return { status: 200, body: paged(data) };
      },
    },
    {
      method: "GET",
      path: "/web/api/v2.1/threats",
      operation: "listThreats",
      summary: "List threats detected across agents - body { data: [...], pagination }.",
      request: { limit: "10" },
      params: [
        { name: "limit", in: "query", type: "integer", description: "Number of threats to return (1-1000); omit to return all.", example: 10 },
        { name: "resolved", in: "query", type: "boolean", enum: ["true", "false"], description: "Filter by incident resolution state." },
      ],
      respond: (ctx: MockContext): MockResult => {
        let data = s1Threats();
        if (ctx.query.resolved === "true") data = data.filter((t) => t.threatInfo.incidentStatus === "resolved");
        if (ctx.query.resolved === "false") data = data.filter((t) => t.threatInfo.incidentStatus !== "resolved");
        const limit = Number(ctx.query.limit);
        if (Number.isFinite(limit) && limit > 0) data = data.slice(0, Math.min(limit, 1000));
        return { status: 200, body: paged(data) };
      },
    },
    {
      method: "POST",
      path: "/web/api/v2.1/agents/actions/disconnect",
      operation: "disconnectAgents",
      summary: "Disconnect agents from the network (containment) - filter selects the targets.",
      emits: "agent.disconnected",
      request: { filter: { ids: ["225494730938493804"] } },
      params: [
        { name: "filter.ids[]", in: "body", type: "array", description: "Agent ids to disconnect.", format: "array of numeric agent ids", example: "[\"225494730938493804\"]" },
        { name: "filter.computerName__contains", in: "body", type: "string", description: "Alternative target selector - substring match on computer name.", example: "LT-FIN" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ids: string[] = ctx.body?.filter?.ids ?? [];
        const nameSel: string = (ctx.body?.filter?.computerName__contains ?? "").toLowerCase();
        let affected = ids.length;
        if (!affected && nameSel) affected = s1Fleet().filter((d) => d.hostname.toLowerCase().includes(nameSel)).length;
        return { status: 200, body: { data: { affected } } };
      },
    },
    {
      method: "GET",
      path: "/web/api/v2.1/system/info",
      operation: "getSystemInfo",
      summary: "Management console build/health info - the cheapest liveness probe.",
      params: [],
      respond: (): MockResult => ({
        status: 200,
        body: { data: { health: "ok", latestAgentVersion: AGENT_VERSIONS[AGENT_VERSIONS.length - 1], consoleBuild: "24.2.2.1105" } },
      }),
    },
  ],
  events: [
    {
      type: "agent.disconnected",
      summary: "An agent was disconnected from the network by a response action.",
      sample: () => {
        const d = pick(rng("s1:evt:" + uuid()), s1Fleet());
        return { ...s1Agent(d), networkStatus: "disconnected", disconnectedAt: nowIso() };
      },
    },
    {
      type: "threat.detected",
      summary: "A new threat was detected on an agent.",
      sample: () => {
        const r = rng("s1:evt:" + uuid());
        const d = pick(r, s1Fleet());
        const family = pick(r, MALWARE_FAMILIES);
        return {
          id: s1Id("threat:" + d.fleetId),
          threatInfo: { threatName: `${family}.gen`, classification: "Malware", mitigationStatus: "not_mitigated", confidenceLevel: "malicious", sha1: fakeSha1("s1evt:" + d.fleetId), createdAt: nowIso() },
          agentRealtimeInfo: { agentId: s1Id(d.fleetId), agentComputerName: d.hostname, agentOsType: d.platform === "mac" ? "macos" : "windows" },
        };
      },
    },
  ],
};
