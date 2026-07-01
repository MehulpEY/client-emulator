import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, HOSTNAMES, USERS, MALWARE_FAMILIES, fakeSha256, fakeIp, minutesAgoIso, uuid, shortId } from "../helpers";

// CrowdStrike Falcon — EDR. OAuth2 token, detections and device management.

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
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 50);
        const r = rng("cs:devlist:" + limit);
        return { status: 200, body: { meta: { pagination: { offset: 0, limit, total: int(r, limit, 1800) } }, resources: Array.from({ length: limit }).map(() => shortId("")), errors: [] } };
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
  ],
  events: [
    { type: "detection.created", summary: "A new endpoint detection was raised by Falcon.", sample: () => detection(`ldt:${shortId("")}:${Date.now()}`) },
    { type: "host.contained", summary: "A host was network-contained.", sample: () => ({ ...device(shortId("")), status: "contained" }) },
  ],
};
