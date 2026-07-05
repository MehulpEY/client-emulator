import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, HOSTNAMES, USERS, MALWARE_FAMILIES, fakeSha256, fakeIp, minutesAgoIso, nowIso, uuid, shortId } from "../helpers";
import { fleetEndpoints, extId, macDashedUpper, type FleetDevice } from "../../fleet/fleet";

// CrowdStrike Falcon - EDR. OAuth2 token, detections and device management.
// The device inventory and Spotlight vulnerabilities project from the canonical
// fleet (lib/fleet/fleet.ts, PLAN §4.4) so hostnames/serials/MACs line up with
// Qualys, Trellix and the rest of the adapters - deterministic per fleetId.

const SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational"] as const;
const TACTICS = ["Initial Access", "Execution", "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access", "Lateral Movement"] as const;

function detection(id: string) {
  const r = rng("cs:det:" + id);
  const sev = pick(r, SEVERITIES);
  const sevNum = { Critical: 90, High: 70, Medium: 50, Low: 30, Informational: 10 }[sev];
  return {
    detection_id: id,
    cid: shortId(""),
    created_timestamp: minutesAgoIso(int(r, 1, 2880)),
    status: pick(r, ["new", "in_progress", "true_positive", "false_positive"]),
    max_severity: sevNum,
    max_severity_displayname: sev,
    show_in_ui: true,
    device: {
      device_id: shortId(""),
      hostname: pick(r, HOSTNAMES),
      platform_name: pick(r, ["Windows", "Mac", "Linux"]),
      os_version: pick(r, ["Windows 10", "Windows 11", "Sonoma (14)", "Ubuntu 22.04"]),
      local_ip: fakeIp(r),
      external_ip: fakeIp(r),
    },
    behaviors: [
      {
        behavior_id: String(int(r, 1000000, 9999999)),
        tactic: pick(r, TACTICS),
        technique: pick(r, ["Process Injection", "Credential Dumping", "Scheduled Task", "PowerShell", "Masquerading"]),
        severity: sevNum,
        confidence: int(r, 50, 100),
        filename: pick(r, ["powershell.exe", "rundll32.exe", "mimikatz.exe", "svchost.exe", "wscript.exe"]),
        cmdline: pick(r, ["powershell -enc SQBFAFgA...", "rundll32 shell32.dll,Control_RunDLL", "cmd /c whoami /all"]),
        sha256: fakeSha256(id),
        user_name: pick(r, USERS),
        threat_family: pick(r, MALWARE_FAMILIES),
        ioc_type: "sha256",
      },
    ],
  };
}

function device(id: string) {
  const r = rng("cs:dev:" + id);
  return {
    device_id: id,
    cid: shortId(""),
    hostname: pick(r, HOSTNAMES),
    platform_name: pick(r, ["Windows", "Mac", "Linux"]),
    os_version: pick(r, ["Windows 10", "Windows 11", "Sonoma (14)", "Ubuntu 22.04"]),
    product_type_desc: pick(r, ["Workstation", "Server", "Domain Controller"]),
    local_ip: fakeIp(r),
    external_ip: fakeIp(r),
    mac_address: Array.from({ length: 6 }).map(() => int(r, 16, 255).toString(16).padStart(2, "0")).join("-"),
    agent_version: `7.${int(r, 10, 18)}.${int(r, 1000, 9999)}`,
    status: pick(r, ["normal", "containment_pending", "contained"]),
    last_seen: minutesAgoIso(int(r, 1, 600)),
    first_seen: minutesAgoIso(int(r, 5000, 500000)),
  };
}

// ---- fleet projections (device inventory + Spotlight, PLAN §4.4) -----------

/** One Falcon customer id (CID) for the whole emulated tenant - stable. */
const FALCON_CID = extId("crowdstrike", "cid", 32);

/** Fleet platform -> Falcon platform_name (fleetEndpoints() excludes network). */
const PLATFORM_NAMES: Record<FleetDevice["platform"], string> = {
  windows: "Windows",
  mac: "Mac",
  linux: "Linux",
  network: "Linux",
};

/** Project a fleet endpoint into a Falcon device entity (stable per fleetId). */
function fleetFalconDevice(d: FleetDevice) {
  const r = rng("cs:fleetdev:" + d.fleetId);
  return {
    device_id: extId("crowdstrike", d.fleetId),
    cid: FALCON_CID,
    hostname: d.hostname,
    mac_address: macDashedUpper(d.mac),
    serial_number: d.serial,
    os_version: d.os,
    platform_name: PLATFORM_NAMES[d.platform],
    product_type_desc: d.hostname.startsWith("SRV-") ? "Server" : "Workstation",
    local_ip: d.ip,
    external_ip: fakeIp(r),
    agent_version: `7.${int(r, 10, 18)}.${int(r, 1000, 9999)}`,
    status: "normal",
    first_seen: minutesAgoIso(int(r, 5000, 500000)),
    last_seen: minutesAgoIso(int(r, 1, 600)),
    tags: d.tags,
  };
}

/** CVSS-ish score bands per severity. */
const CVSS_BANDS: Record<string, [number, number]> = {
  CRITICAL: [9.0, 10.0],
  HIGH: [7.0, 8.9],
  MEDIUM: [4.0, 6.9],
  LOW: [0.1, 3.9],
};

/** Deterministic Spotlight vulnerabilities for a fleet endpoint (0-4 per device). */
function fleetVulnerabilities(d: FleetDevice) {
  const deviceId = extId("crowdstrike", d.fleetId);
  const count = int(rng("cs:vulncount:" + d.fleetId), 0, 4);
  return Array.from({ length: count }, (_, i) => {
    const r = rng(`cs:fleetvuln:${d.fleetId}:${i}`);
    const severity = pick(r, ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const);
    const [lo, hi] = CVSS_BANDS[severity];
    return {
      id: `${deviceId}_${int(r, 1e5, 9e5)}`,
      cve_id: `CVE-${int(r, 2019, 2024)}-${int(r, 1000, 49999)}`,
      severity,
      status: "open",
      score: +(lo + r() * (hi - lo)).toFixed(1),
      host_info: { hostname: d.hostname, local_ip: d.ip },
      created_timestamp: minutesAgoIso(int(r, 1440, 43200)),
      updated_timestamp: minutesAgoIso(int(r, 1, 1440)),
    };
  });
}

// MITRE tactic/technique labels paired with their ATT&CK ids (index-aligned).
const TECHNIQUES = ["Process Injection", "Credential Dumping", "Scheduled Task", "PowerShell", "Masquerading"] as const;
const TACTIC_IDS = ["TA0001", "TA0002", "TA0003", "TA0004", "TA0005", "TA0006", "TA0008"] as const;
const TECHNIQUE_IDS = ["T1055", "T1003", "T1053", "T1059.001", "T1036"] as const;
const ALERT_STATUSES = ["new", "in_progress", "true_positive", "false_positive", "closed"] as const;

// A full Epp/alert composite. Seeded from the composite id so lookups are stable.
function alert(compositeId: string) {
  const r = rng("cs:alert:" + compositeId);
  const parts = compositeId.split(":");
  const cid = parts.length >= 3 ? parts[0] : shortId("");
  const id = parts.length >= 3 ? parts.slice(2).join(":") : compositeId;
  const sevName = pick(r, SEVERITIES);
  const severity = { Critical: 90, High: 70, Medium: 50, Low: 30, Informational: 10 }[sevName];
  const tIdx = int(r, 0, TACTICS.length - 1);
  const techIdx = int(r, 0, TECHNIQUES.length - 1);
  const hostname = pick(r, HOSTNAMES);
  const filename = pick(r, ["powershell.exe", "rundll32.exe", "mimikatz.exe", "svchost.exe", "wscript.exe"]);
  return {
    composite_id: compositeId,
    id,
    cid,
    created_timestamp: minutesAgoIso(int(r, 5, 4320)),
    updated_timestamp: minutesAgoIso(int(r, 1, 5)),
    severity,
    severity_name: sevName,
    status: pick(r, ALERT_STATUSES),
    confidence: int(r, 50, 100),
    tactic: TACTICS[tIdx],
    technique: TECHNIQUES[techIdx],
    tactic_id: TACTIC_IDS[tIdx],
    technique_id: TECHNIQUE_IDS[techIdx],
    pattern_disposition: pick(r, [0, 512, 2048, 2560, 4096]),
    product: "epp",
    show_in_ui: true,
    hostname,
    device: {
      device_id: shortId(""),
      hostname,
      platform_name: pick(r, ["Windows", "Mac", "Linux"]),
      os_version: pick(r, ["Windows 10", "Windows 11", "Sonoma (14)", "Ubuntu 22.04"]),
      local_ip: fakeIp(r),
    },
    filename,
    cmdline: pick(r, ["powershell -enc SQBFAFgA...", "rundll32 shell32.dll,Control_RunDLL", "cmd /c whoami /all"]),
    sha256: fakeSha256(compositeId),
    user_name: pick(r, USERS),
    description: `${TECHNIQUES[techIdx]} detected on ${hostname} via ${filename}.`,
  };
}

// A correlated incident (grouping of related alerts across hosts).
function incident(id: string) {
  const r = rng("cs:inc:" + id);
  const parts = id.split(":");
  const cid = parts.length >= 3 ? parts[1] : shortId("");
  const hostCount = int(r, 1, 4);
  const hosts = Array.from({ length: hostCount }).map(() => {
    const hostname = pick(r, HOSTNAMES);
    return { device_id: shortId(""), hostname, platform_name: pick(r, ["Windows", "Mac", "Linux"]), local_ip: fakeIp(r) };
  });
  const startAgo = int(r, 120, 10080);
  return {
    incident_id: id,
    cid,
    host_ids: hosts.map((h) => h.device_id),
    created: minutesAgoIso(startAgo + 5),
    start: minutesAgoIso(startAgo),
    end: minutesAgoIso(int(r, 1, startAgo)),
    state: pick(r, ["open", "closed"]),
    status: pick(r, [20, 25, 30, 40]),
    name: `Incident on ${hosts[0].hostname}`,
    description: `Correlated malicious activity spanning ${hostCount} host(s).`,
    tactics: sample(r, TACTICS, int(r, 1, 3)),
    techniques: sample(r, TECHNIQUES, int(r, 1, 3)),
    fine_score: int(r, 10, 100),
    users: sample(r, USERS, int(r, 1, 2)),
    hosts,
  };
}

// A Spotlight vulnerability finding (host + CVE + affected apps).
function vulnerability(id: string) {
  const r = rng("cs:vuln:" + id);
  const sevName = pick(r, ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
  const baseScore = { CRITICAL: 9.8, HIGH: 7.5, MEDIUM: 5.4, LOW: 3.1 }[sevName];
  return {
    id,
    cid: shortId(""),
    status: pick(r, ["open", "closed", "reopen"]),
    created_timestamp: minutesAgoIso(int(r, 60, 43200)),
    cve: {
      id: `CVE-${int(r, 2019, 2024)}-${int(r, 1000, 49999)}`,
      base_score: baseScore,
      severity: sevName,
      exploit_status: pick(r, [0, 30, 60, 90]),
      exprt_rating: sevName,
    },
    host_info: {
      hostname: pick(r, HOSTNAMES),
      local_ip: fakeIp(r),
      os_version: pick(r, ["Windows 10", "Windows 11", "Sonoma (14)", "Ubuntu 22.04"]),
    },
    apps: [
      {
        product_name_version: pick(r, ["Google Chrome 118.0.5993", "OpenSSL 1.1.1", "Apache Log4j 2.14.1", "Microsoft Office 2019", "Adobe Acrobat 23.001"]),
        remediation: { ids: [shortId("")] },
      },
    ],
  };
}

export const crowdstrike: ToolDef = {
  id: "crowdstrike",
  name: "CrowdStrike Falcon",
  vendor: "CrowdStrike",
  category: "edr",
  crafted: true,
  aiTool: true,
  summary:
    "CrowdStrike Falcon is a cloud-native endpoint security platform delivering AI-driven detection, threat intelligence and response across the device fleet.",
  tags: ["edr", "detections", "containment", "falcon", "endpoint"],
  auth: { type: "bearer" },
  docsUrl: "https://falcon.crowdstrike.com/documentation",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/oauth2/token",
      operation: "getToken",
      summary: "Exchange client_id/client_secret for an OAuth2 bearer token.",
      request: { client_id: "<id>", client_secret: "<secret>" },
      params: [
        { name: "client_id", in: "body", type: "string", required: true, description: "Falcon API client id.", example: "<id>" },
        { name: "client_secret", in: "body", type: "string", required: true, description: "Falcon API client secret paired with the client_id." },
      ],
      respond: (): MockResult => ({
        status: 201,
        body: { access_token: "mock_" + Buffer.from(uuid()).toString("base64url"), token_type: "bearer", expires_in: 1799 },
      }),
    },
    {
      method: "GET",
      path: "/detects/queries/detects/v1",
      operation: "listDetections",
      summary: "Search detection ids (query: filter, limit, sort).",
      aiTool: true,
      request: { filter: "max_severity_displayname:'High'", limit: "5" },
      params: [
        { name: "filter", in: "query", type: "string", description: "FQL filter over detection fields, e.g. status, max_severity_displayname.", format: "FQL filter", example: "max_severity_displayname:'High'" },
        { name: "limit", in: "query", type: "integer", description: "Max detection ids to return (capped at 50).", default: 10, example: 5 },
        { name: "offset", in: "query", type: "integer", description: "Starting index for pagination.", default: 0 },
        { name: "sort", in: "query", type: "string", description: "FQL sort expression.", format: "FQL sort", example: "max_severity|desc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 50);
        const r = rng("cs:detlist:" + (ctx.query.filter || "") + limit);
        const ids = Array.from({ length: limit }).map(() => `ldt:${shortId("")}:${int(r, 1e9, 9e9)}`);
        return { status: 200, body: { meta: { query_time: 0.02, pagination: { offset: 0, limit, total: int(r, limit, 240) } }, resources: ids, errors: [] } };
      },
    },
    {
      method: "POST",
      path: "/detects/entities/summaries/GET/v1",
      operation: "getDetectionSummaries",
      summary: "Resolve detection ids to full detection summaries.",
      aiTool: true,
      request: { ids: ["ldt:abc:12345"] },
      params: [
        { name: "ids[]", in: "body", type: "array", required: true, description: "Detection ids to resolve to full detection summaries.", format: "detection id (ldt:<cid>:<id>)", example: "ldt:abc:12345" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ids: string[] = ctx.body?.ids || [];
        return { status: 200, body: { meta: { query_time: 0.03 }, resources: ids.map(detection), errors: [] } };
      },
    },
    {
      method: "GET",
      path: "/devices/queries/devices/v1",
      operation: "listDevices",
      summary: "Search managed device ids (query: filter, limit).",
      aiTool: true,
      request: { filter: "platform_name:'Windows'", limit: "5" },
      params: [
        { name: "filter", in: "query", type: "string", description: "FQL filter over device fields, e.g. platform_name, hostname, status.", format: "FQL filter", example: "platform_name:'Windows'" },
        { name: "limit", in: "query", type: "integer", description: "Max device ids to return (capped at 50).", default: 10, example: 5 },
        { name: "offset", in: "query", type: "integer", description: "Starting index for pagination.", default: 0 },
        { name: "sort", in: "query", type: "string", description: "FQL sort expression.", format: "FQL sort", example: "hostname|asc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 50);
        const offset = Math.max(0, Number(ctx.query.offset) || 0);
        const ids = fleetEndpoints().map((d) => extId("crowdstrike", d.fleetId));
        return { status: 200, body: { meta: { pagination: { offset, limit, total: ids.length } }, resources: ids.slice(offset, offset + limit), errors: [] } };
      },
    },
    {
      method: "GET",
      path: "/devices/entities/devices/v2",
      operation: "getDeviceEntities",
      summary: "Resolve device ids (aids) to full device records; omit ids to return every managed device.",
      aiTool: true,
      params: [
        { name: "ids", in: "query", type: "array", description: "Device ids (aids) to resolve, as returned by listDevices. Repeat the parameter (ids=..&ids=..) or pass a comma-separated list. Omit to return every managed device.", format: "device id (aid), 24-char hex", example: "<device_id>" },
      ],
      responseExample: {
        meta: { query_time: 0.042, powered_by: "device-api", trace_id: "5f6ff9e2-6c4a-4a91-b7d0-1f2e3a4b5c6d" },
        resources: [
          {
            device_id: "1a2b3c4d5e6f7a8b9c0d1e2f",
            cid: FALCON_CID,
            hostname: "LT-FIN-001",
            mac_address: "0A-1B-2C-3D-4E-5F",
            serial_number: "5CG1234ABCD",
            os_version: "Windows 11 Pro 23H2",
            platform_name: "Windows",
            product_type_desc: "Workstation",
            local_ip: "10.12.34.56",
            external_ip: "198.51.100.24",
            agent_version: "7.14.1802",
            status: "normal",
            first_seen: "2024-11-02T09:15:00.000Z",
            last_seen: "2026-07-05T08:41:00.000Z",
            tags: ["vip"],
          },
        ],
        errors: [],
      },
      respond: (ctx: MockContext): MockResult => {
        const wanted = (ctx.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
        const all = fleetEndpoints().map(fleetFalconDevice);
        const resources = wanted.length ? all.filter((d) => wanted.includes(d.device_id)) : all;
        return { status: 200, body: { meta: { query_time: 0.04, powered_by: "device-api", trace_id: uuid() }, resources, errors: [] } };
      },
    },
    {
      method: "POST",
      path: "/devices/entities/devices-actions/v2",
      operation: "deviceAction",
      summary: "Take a response action on hosts, e.g. network-contain or lift-containment.",
      aiTool: true,
      emits: "host.contained",
      request: { action_name: "contain", ids: ["<device_id>"] },
      params: [
        { name: "action_name", in: "query", type: "string", required: true, description: "Response action to perform on the target hosts; anything other than 'contain' is treated as lift-containment.", enum: ["contain", "lift_containment", "hide_host", "unhide_host", "detection_suppress", "detection_unsuppress"], example: "contain" },
        { name: "ids[]", in: "body", type: "array", required: true, description: "Device ids (aids) to act on.", format: "device id (aid)", example: "<device_id>" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ids: string[] = ctx.body?.ids || [];
        const action = ctx.query.action_name || ctx.body?.action_name || "contain";
        return {
          status: 202,
          body: {
            meta: { query_time: 0.05 },
            resources: ids.map((id) => ({ id, path: `/devices/entities/devices/v1`, ...device(id), status: action === "contain" ? "containment_pending" : "lift_containment_pending" })),
            errors: [],
          },
        };
      },
    },
    {
      method: "GET",
      path: "/alerts/queries/alerts/v2",
      operation: "listAlerts",
      summary: "Search alert (Epp) composite ids (query: filter, limit, sort).",
      aiTool: true,
      request: { filter: "status:'new'+severity_name:'High'", limit: "5" },
      params: [
        { name: "filter", in: "query", type: "string", description: "FQL filter over alert fields; status accepts new/in_progress/true_positive/false_positive/closed, severity_name accepts Critical/High/Medium/Low/Informational.", format: "FQL filter", example: "status:'new'+severity_name:'High'" },
        { name: "limit", in: "query", type: "integer", description: "Max alert composite ids to return (capped at 100).", default: 10, example: 5 },
        { name: "offset", in: "query", type: "integer", description: "Starting index for pagination.", default: 0 },
        { name: "sort", in: "query", type: "string", description: "FQL sort expression.", format: "FQL sort", example: "created_timestamp|desc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 100);
        const r = rng("cs:alertlist:" + (ctx.query.filter || "") + limit);
        const ids = Array.from({ length: limit }).map(() => `${shortId("")}:ind:${int(r, 1e12, 9e12)}`);
        return { status: 200, body: { meta: { query_time: 0.02, pagination: { offset: 0, limit, total: int(r, limit, 500) } }, resources: ids, errors: [] } };
      },
    },
    {
      method: "POST",
      path: "/alerts/entities/alerts/v2",
      operation: "getAlerts",
      summary: "Resolve alert composite ids to full alert objects.",
      aiTool: true,
      request: { composite_ids: ["<cid>:ind:123456789012"] },
      params: [
        { name: "composite_ids[]", in: "body", type: "array", required: true, description: "Alert composite ids to resolve to full alert objects.", format: "composite id (<cid>:ind:<id>)", example: "<cid>:ind:123456789012" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ids: string[] = ctx.body?.composite_ids || ctx.body?.ids || [];
        return { status: 200, body: { meta: { query_time: 0.03, pagination: { offset: 0, limit: ids.length, total: ids.length } }, resources: ids.map(alert), errors: [] } };
      },
    },
    {
      method: "POST",
      path: "/alerts/entities/alerts/v3",
      operation: "updateAlerts",
      summary: "Take action on alerts, e.g. update_status, assign, add comment.",
      aiTool: true,
      emits: "alert.updated",
      request: { composite_ids: ["<cid>:ind:123456789012"], action_parameters: [{ name: "update_status", value: "in_progress" }] },
      params: [
        { name: "composite_ids[]", in: "body", type: "array", required: true, description: "Alert composite ids to act on.", format: "composite id (<cid>:ind:<id>)", example: "<cid>:ind:123456789012" },
        { name: "action_parameters[].name", in: "body", type: "string", required: true, description: "Alert action to apply.", enum: ["update_status", "assign_to_user_id", "assign_to_uuid", "assign_to_name", "unassign", "append_comment", "add_tag", "remove_tag", "show_in_ui"], example: "update_status" },
        { name: "action_parameters[].value", in: "body", type: "string", required: true, description: "Value for the action; for update_status one of new/in_progress/true_positive/false_positive/closed.", example: "in_progress" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ids: string[] = ctx.body?.composite_ids || ctx.body?.ids || [];
        const params: any[] = ctx.body?.action_parameters || [];
        const statusParam = params.find((p) => p?.name === "update_status");
        const newStatus = statusParam?.value || "in_progress";
        return {
          status: 200,
          body: {
            meta: { query_time: 0.05, pagination: { offset: 0, limit: ids.length, total: ids.length } },
            resources: ids.map((composite_id) => ({ composite_id, status: newStatus, updated_timestamp: nowIso() })),
            errors: [],
          },
        };
      },
    },
    {
      method: "GET",
      path: "/incidents/queries/incidents/v1",
      operation: "listIncidents",
      summary: "Search incident ids (query: filter, limit, sort).",
      aiTool: true,
      request: { filter: "state:'open'", limit: "5" },
      params: [
        { name: "filter", in: "query", type: "string", description: "FQL filter over incident fields, e.g. state (open/closed), status, tactics.", format: "FQL filter", example: "state:'open'" },
        { name: "limit", in: "query", type: "integer", description: "Max incident ids to return (capped at 100).", default: 10, example: 5 },
        { name: "offset", in: "query", type: "integer", description: "Starting index for pagination.", default: 0 },
        { name: "sort", in: "query", type: "string", description: "FQL sort expression.", format: "FQL sort", example: "start|desc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 100);
        const r = rng("cs:inclist:" + (ctx.query.filter || "") + limit);
        const ids = Array.from({ length: limit }).map(() => `inc:${shortId("")}:${int(r, 1e9, 9e9).toString(16)}`);
        return { status: 200, body: { meta: { query_time: 0.02, pagination: { offset: 0, limit, total: int(r, limit, 120) } }, resources: ids, errors: [] } };
      },
    },
    {
      method: "POST",
      path: "/incidents/entities/incidents/GET/v1",
      operation: "getIncidents",
      summary: "Resolve incident ids to full incident objects.",
      aiTool: true,
      request: { ids: ["inc:abc123:1a2b3c"] },
      params: [
        { name: "ids[]", in: "body", type: "array", required: true, description: "Incident ids to resolve to full incident objects.", format: "incident id (inc:<cid>:<id>)", example: "inc:abc123:1a2b3c" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ids: string[] = ctx.body?.ids || [];
        return { status: 200, body: { meta: { query_time: 0.03, pagination: { offset: 0, limit: ids.length, total: ids.length } }, resources: ids.map(incident), errors: [] } };
      },
    },
    {
      method: "GET",
      path: "/iocs/queries/indicators/v1",
      operation: "listIndicators",
      summary: "Search custom IOC (indicator) ids (query: filter, limit).",
      aiTool: true,
      request: { filter: "type:'sha256'+action:'prevent'", limit: "5" },
      params: [
        { name: "filter", in: "query", type: "string", description: "FQL filter over IOC fields; type accepts sha256/sha1/md5/ipv4/ipv6/domain, action accepts no_action/allow/detect/prevent_no_ui/prevent.", format: "FQL filter", example: "type:'sha256'+action:'prevent'" },
        { name: "limit", in: "query", type: "integer", description: "Max indicator ids to return (capped at 100).", default: 10, example: 5 },
        { name: "offset", in: "query", type: "integer", description: "Starting index for pagination.", default: 0 },
        { name: "sort", in: "query", type: "string", description: "FQL sort expression.", format: "FQL sort", example: "created_on|desc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 100);
        const r = rng("cs:ioclist:" + (ctx.query.filter || "") + limit);
        const ids = Array.from({ length: limit }).map((_, i) => fakeSha256("ioc:" + (ctx.query.filter || "") + i));
        return { status: 200, body: { meta: { query_time: 0.02, pagination: { offset: 0, limit, total: int(r, limit, 300) } }, resources: ids, errors: [] } };
      },
    },
    {
      method: "POST",
      path: "/iocs/entities/indicators/v1",
      operation: "createIndicator",
      summary: "Create custom IOC indicators (sha256/ipv4/domain) with a detect or prevent action.",
      aiTool: true,
      emits: "ioc.created",
      request: { indicators: [{ type: "sha256", value: "<sha256>", action: "prevent", severity: "high", description: "Known malicious binary" }] },
      params: [
        { name: "indicators[].type", in: "body", type: "string", required: true, description: "Indicator type.", enum: ["sha256", "sha1", "md5", "ipv4", "ipv6", "domain"], example: "sha256" },
        { name: "indicators[].value", in: "body", type: "string", required: true, description: "Indicator value matching the type (hash, ip or domain).", format: "sha256 hash / ipv4 / domain", example: "<sha256>" },
        { name: "indicators[].action", in: "body", type: "string", description: "Action Falcon takes when the indicator matches.", enum: ["no_action", "allow", "detect", "prevent_no_ui", "prevent"], default: "detect", example: "prevent" },
        { name: "indicators[].severity", in: "body", type: "string", description: "Severity assigned to matches (required for detect/prevent actions).", enum: ["informational", "low", "medium", "high", "critical"], default: "high", example: "high" },
        { name: "indicators[].description", in: "body", type: "string", description: "Human-readable note for the indicator.", example: "Known malicious binary" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const indicators: any[] = ctx.body?.indicators || [];
        return {
          status: 201,
          body: {
            meta: { query_time: 0.04, pagination: { offset: 0, limit: indicators.length, total: indicators.length } },
            resources: indicators.map((ind, i) => ({
              id: fakeSha256("ioc:" + (ind?.value || "") + i),
              type: ind?.type || "sha256",
              value: ind?.value || "",
              action: ind?.action || "detect",
              severity: ind?.severity || "high",
              description: ind?.description || "",
              created_on: nowIso(),
              created_by: "api-client@falcon",
            })),
            errors: [],
          },
        };
      },
    },
    {
      method: "GET",
      path: "/spotlight/queries/vulnerabilities/v1",
      operation: "listVulnerabilities",
      summary: "Search Spotlight vulnerabilities; returns full vulnerability records (query: filter, limit).",
      aiTool: true,
      request: { filter: "status:'open'+cve.severity:'CRITICAL'", limit: "5" },
      params: [
        { name: "filter", in: "query", type: "string", description: "FQL filter over vulnerability fields; status accepts open/closed/reopen, cve.severity accepts CRITICAL/HIGH/MEDIUM/LOW.", format: "FQL filter", example: "status:'open'+cve.severity:'CRITICAL'" },
        { name: "limit", in: "query", type: "integer", description: "Max vulnerability records to return (capped at 100).", default: 10, example: 5 },
        { name: "offset", in: "query", type: "integer", description: "Starting index for pagination.", default: 0 },
        { name: "sort", in: "query", type: "string", description: "FQL sort expression.", format: "FQL sort", example: "created_timestamp|desc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 100);
        const offset = Math.max(0, Number(ctx.query.offset) || 0);
        const all = fleetEndpoints().flatMap(fleetVulnerabilities);
        return { status: 200, body: { meta: { query_time: 0.02, pagination: { offset, limit, total: all.length } }, resources: all.slice(offset, offset + limit), errors: [] } };
      },
    },
    {
      method: "POST",
      path: "/spotlight/entities/vulnerabilities/v1",
      operation: "getVulnerabilities",
      summary: "Resolve Spotlight vulnerability ids to full vulnerability details (CVE, host, apps).",
      aiTool: true,
      request: { ids: ["<vuln_id>"] },
      params: [
        { name: "ids[]", in: "body", type: "array", required: true, description: "Spotlight vulnerability ids to resolve to full details.", format: "vulnerability id", example: "<vuln_id>" },
        { name: "ids", in: "query", type: "string", description: "Alternative to the body: comma-separated vulnerability ids.", format: "comma-separated vulnerability ids" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ids: string[] = ctx.body?.ids || (ctx.query.ids ? ctx.query.ids.split(",") : []);
        return { status: 200, body: { meta: { query_time: 0.03, pagination: { offset: 0, limit: ids.length, total: ids.length } }, resources: ids.map(vulnerability), errors: [] } };
      },
    },
  ],
  events: [
    { type: "detection.created", summary: "A new endpoint detection was raised by Falcon.", sample: () => detection(`ldt:${shortId("")}:${Date.now()}`) },
    { type: "host.contained", summary: "A host was network-contained.", sample: () => ({ ...device(shortId("")), status: "contained" }) },
    { type: "alert.updated", summary: "A Falcon alert status was updated.", sample: () => ({ ...alert(`${shortId("")}:ind:${Date.now()}`), status: "in_progress", updated_timestamp: nowIso() }) },
    {
      type: "ioc.created",
      summary: "A custom IOC was created.",
      sample: () => {
        const value = fakeSha256(uuid());
        return { id: fakeSha256("ioc:" + value), type: "sha256", value, action: "prevent", severity: "high", created_on: nowIso(), created_by: "api-client@falcon" };
      },
    },
  ],
};
