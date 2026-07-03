import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, fakeIp, HOSTNAMES, USERS, daysAgoIso, uuid, type RNG } from "../helpers";

// Qualys - vulnerability management. The real VM API is XML; for agent ergonomics
// the emulator returns JSON with recognizable Qualys QID/severity semantics.

const VULNS = [
  { qid: 38170, title: "SSL Certificate - Signature Verification Failed", cve: "CVE-2016-2107", severity: 3 },
  { qid: 86002, title: "Apache HTTP Server Multiple Vulnerabilities", cve: "CVE-2021-44790", severity: 5 },
  { qid: 91897, title: "Microsoft Windows RDP Remote Code Execution (BlueKeep)", cve: "CVE-2019-0708", severity: 5 },
  { qid: 150085, title: "Cross-Site Scripting (XSS) Vulnerability", cve: "CVE-2022-0847", severity: 4 },
  { qid: 42430, title: "SSLv3.0/TLSv1.0 Protocol Weak CBC Mode (BEAST)", cve: "CVE-2011-3389", severity: 2 },
  { qid: 13607, title: "OpenSSL Heartbeat Information Disclosure (Heartbleed)", cve: "CVE-2014-0160", severity: 5 },
] as const;

function detectionForHost(host: string) {
  const r = rng("qualys:host:" + host);
  const vulns = sample(r, VULNS, int(r, 1, 4));
  return {
    ID: int(r, 100000, 999999),
    IP: fakeIp(r),
    DNS: pick(r, HOSTNAMES).toLowerCase() + ".corp.local",
    OS: pick(r, ["Windows 2019", "Red Hat Enterprise Linux 8", "Ubuntu 20.04", "Windows 10"]),
    LAST_SCAN_DATETIME: daysAgoIso(int(r, 0, 14)),
    DETECTION_LIST: vulns.map((v) => ({
      QID: v.qid,
      TYPE: "Confirmed",
      SEVERITY: v.severity,
      TITLE: v.title,
      CVE: v.cve,
      STATUS: pick(r, ["Active", "New", "Re-Opened", "Fixed"]),
      FIRST_FOUND_DATETIME: daysAgoIso(int(r, 14, 200)),
      LAST_FOUND_DATETIME: daysAgoIso(int(r, 0, 14)),
      TIMES_FOUND: int(r, 1, 30),
      IS_PATCHABLE: 1,
    })),
  };
}

// --- Additional Qualys VM API record builders (deterministic, seeded) ---------

const SCAN_TITLES = [
  "Weekly DMZ Scan",
  "Monthly PCI Scan",
  "Ad-hoc DMZ scan",
  "Quarterly Internal Audit",
  "Domain Controller Scan",
  "Cloud Perimeter Scan",
] as const;

const SCAN_PRIORITIES = [
  "0 - No Priority",
  "1 - Emergency",
  "3 - Critical",
  "5 - Standard",
  "7 - Medium",
  "9 - Low",
] as const;

const hms = (r: RNG): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(int(r, 0, 4))}:${pad(int(r, 0, 59))}:${pad(int(r, 0, 59))}`;
};

function scanRecord(r: RNG) {
  const state = pick(r, ["Finished", "Finished", "Finished", "Running", "Queued"] as const);
  return {
    REF: `scan/${int(r, 1690000000, 1720000000)}.${int(r, 10000, 99999)}`,
    TYPE: pick(r, ["On-Demand", "Scheduled", "API"] as const),
    TITLE: pick(r, SCAN_TITLES),
    USER_LOGIN: pick(r, USERS),
    LAUNCH_DATETIME: daysAgoIso(int(r, 0, 30)),
    DURATION: state === "Finished" ? hms(r) : "0",
    PROCESSING_PRIORITY: pick(r, SCAN_PRIORITIES),
    STATUS: { STATE: state },
    TARGET: `${fakeIp(r)}-${fakeIp(r)}`,
  };
}

const KB_CATEGORIES = [
  "Web Application",
  "General remote services",
  "Windows",
  "CGI",
  "SSL",
  "Database",
] as const;

function kbEntry(v: (typeof VULNS)[number]) {
  const r = rng("qualys:kb:" + v.qid);
  const base = Math.min(10, Math.max(0.1, v.severity * 2 - r())).toFixed(1);
  const temporal = Math.max(0.1, Number(base) - (0.3 + r() * 0.8)).toFixed(1);
  const v3base = Math.min(10, Number(base) + r() * 0.5).toFixed(1);
  const v3temporal = Math.max(0.1, Number(v3base) - (0.3 + r() * 0.8)).toFixed(1);
  return {
    QID: v.qid,
    VULN_TYPE: "Vulnerability",
    SEVERITY_LEVEL: v.severity,
    TITLE: v.title,
    CATEGORY: pick(r, KB_CATEGORIES),
    CVE_LIST: { CVE: [{ ID: v.cve, URL: `https://cve.mitre.org/cgi-bin/cvename.cgi?name=${v.cve}` }] },
    CVSS: { BASE: base, TEMPORAL: temporal },
    CVSS_V3: { BASE: v3base, TEMPORAL: v3temporal },
    PATCHABLE: 1,
    DIAGNOSIS: `The scanner detected that the remote host is affected by: ${v.title}.`,
    SOLUTION: "Apply the latest vendor patches and follow hardening guidance for the affected component.",
    PUBLISHED_DATETIME: daysAgoIso(int(r, 200, 1500)),
  };
}

const ASSET_GROUP_TITLES = [
  "DMZ Servers",
  "Corporate Workstations",
  "PCI Cardholder Data Environment",
  "Domain Controllers",
  "Cloud Production",
  "Developer Laptops",
] as const;

function assetGroupRecord(r: RNG) {
  return {
    ID: int(r, 1000000, 9999999),
    TITLE: pick(r, ASSET_GROUP_TITLES),
    OWNER_USER_ID: int(r, 100000, 999999),
    LAST_UPDATE: daysAgoIso(int(r, 0, 60)),
    IP_SET: { IP_RANGE: [`${fakeIp(r)}-${fakeIp(r)}`, `${fakeIp(r)}/24`] },
    HOST_IDS: Array.from({ length: int(r, 2, 5) })
      .map(() => int(r, 100000, 999999))
      .join(", "),
  };
}

const REPORT_TITLES = [
  "Monthly Vulnerability Report",
  "PCI Technical Report",
  "Executive Remediation Summary",
  "Patch Report - Windows Servers",
  "Asset Group Scan Report",
  "High Severity Findings",
] as const;

function reportRecord(r: RNG) {
  return {
    ID: int(r, 1000000, 9999999),
    TITLE: pick(r, REPORT_TITLES),
    TYPE: "Scan",
    STATUS: { STATE: "Finished" },
    LAUNCH_DATETIME: daysAgoIso(int(r, 0, 45)),
    OUTPUT_FORMAT: "PDF",
    SIZE: `${(r() * 9 + 0.5).toFixed(2)} MB`,
  };
}

export const qualys: ToolDef = {
  id: "qualys",
  name: "Qualys VMDR",
  vendor: "Qualys",
  category: "vuln-mgmt",
  crafted: true,
  aiTool: true,
  summary:
    "Qualys scans IT infrastructure to identify vulnerabilities and compliance gaps, prioritizing remediation across cloud and on-prem assets.",
  tags: ["vulnerability", "scan", "qid", "cve", "compliance"],
  auth: { type: "basic" },
  docsUrl: "https://docs.qualys.com/en/vm/api/",
  defaultLatencyMs: 500,
  endpoints: [
    {
      method: "GET",
      path: "/api/2.0/fo/asset/host/vm/detection/",
      operation: "listDetections",
      summary: "List vulnerability detections across hosts (query: action=list, ids, severities).",
      aiTool: true,
      request: { action: "list", severities: "4,5" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["list"], default: "list", description: "API action; list detections." },
        { name: "ids", in: "query", type: "string", format: "host ID(s), comma-separated", example: "123456,789012", description: "Restrict results to specific host asset IDs." },
        { name: "ips", in: "query", type: "string", format: "IP / range / CIDR, comma-separated", example: "10.0.0.0/24", description: "Restrict results to specific host IPs." },
        { name: "severities", in: "query", type: "string", format: "severity levels 1-5, comma-separated", example: "4,5", description: "Filter detections by QID severity (1=lowest, 5=highest)." },
        { name: "status", in: "query", type: "string", enum: ["New", "Active", "Re-Opened", "Fixed"], example: "Active,Re-Opened", description: "Filter by detection status; comma-separated values allowed." },
        { name: "truncation_limit", in: "query", type: "integer", example: 1000, default: 1000, description: "Max host records returned; 0 disables truncation." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const r = rng("qualys:det:" + (ctx.query.ids || ""));
        const n = int(r, 2, 5);
        return {
          status: 200,
          body: {
            HOST_LIST_VM_DETECTION_OUTPUT: {
              RESPONSE: {
                DATETIME: daysAgoIso(0),
                HOST_LIST: { HOST: Array.from({ length: n }).map(() => detectionForHost(uuid())) },
              },
            },
          },
        };
      },
    },
    {
      method: "POST",
      path: "/api/2.0/fo/scan/",
      operation: "launchScan",
      summary: "Launch a vulnerability scan (query: action=launch, scan_title, ip).",
      aiTool: true,
      request: { action: "launch", scan_title: "Ad-hoc DMZ scan", ip: "10.0.0.0/24" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["launch"], default: "launch", description: "API action; launch a new scan." },
        { name: "scan_title", in: "query", type: "string", example: "Ad-hoc DMZ scan", description: "Title for the launched scan." },
        { name: "ip", in: "query", type: "string", format: "IP / range / CIDR, comma-separated", example: "10.0.0.0/24", description: "Target host(s) to scan." },
        { name: "iscanner_name", in: "query", type: "string", example: "External01", description: "Scanner appliance used to run the scan." },
        { name: "priority", in: "query", type: "integer", format: "0-9 (0=No Priority, 1=Emergency, 3=Critical, 5=Standard, 7=Medium, 9=Low)", example: 5, description: "Scan processing priority." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const ref = `scan/${Date.now()}.${int(rng(uuid()), 10000, 99999)}`;
        return {
          status: 200,
          body: {
            SIMPLE_RETURN: {
              RESPONSE: {
                DATETIME: daysAgoIso(0),
                TEXT: "New vm scan launched with REF: " + ref,
                ITEM_LIST: { ITEM: [{ KEY: "ID", VALUE: int(rng(ref), 100000, 999999) }, { KEY: "REFERENCE", VALUE: ref }] },
              },
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/api/2.0/fo/asset/host/",
      operation: "listHosts",
      summary: "List host assets in the subscription (query: action=list).",
      request: { action: "list" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["list"], default: "list", description: "API action; list host assets." },
        { name: "ids", in: "query", type: "string", format: "host ID(s), comma-separated", example: "123456,789012", description: "Restrict results to specific host asset IDs." },
        { name: "ips", in: "query", type: "string", format: "IP / range / CIDR, comma-separated", example: "10.0.0.1-10.0.0.254", description: "Restrict results to specific host IPs." },
        { name: "truncation_limit", in: "query", type: "integer", example: 1000, default: 1000, description: "Max host records returned; 0 disables truncation." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (): MockResult => {
        const r = rng("qualys:hosts:" + uuid());
        const n = int(r, 3, 8);
        return {
          status: 200,
          body: {
            HOST_LIST_OUTPUT: {
              RESPONSE: {
                HOST_LIST: {
                  HOST: Array.from({ length: n }).map(() => ({
                    ID: int(r, 100000, 999999),
                    IP: fakeIp(r),
                    DNS: pick(r, HOSTNAMES).toLowerCase() + ".corp.local",
                    OS: pick(r, ["Windows 2019", "RHEL 8", "Ubuntu 20.04"]),
                    LAST_VULN_SCAN_DATETIME: daysAgoIso(int(r, 0, 21)),
                  })),
                },
              },
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/api/2.0/fo/scan/",
      operation: "listScans",
      summary: "List vulnerability scans (query: action=list, state, launched_after_datetime).",
      aiTool: true,
      request: { action: "list", state: "Finished" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["list"], default: "list", description: "API action; list scans." },
        { name: "state", in: "query", type: "string", enum: ["Running", "Queued", "Finished"], example: "Finished", description: "Filter scans by run state." },
        { name: "scan_ref", in: "query", type: "string", format: "scan reference (scan/<epoch>.<id>)", example: "scan/1700000000.12345", description: "Restrict to a specific scan reference." },
        { name: "launched_after_datetime", in: "query", type: "string", format: "date-time (ISO 8601)", example: "2026-06-01T00:00:00Z", description: "Only scans launched after this time." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const r = rng("qualys:scans:" + (ctx.query.state || "all"));
        const n = int(r, 3, 7);
        return {
          status: 200,
          body: {
            SCAN_LIST_OUTPUT: {
              RESPONSE: {
                DATETIME: daysAgoIso(0),
                SCAN_LIST: { SCAN: Array.from({ length: n }).map(() => scanRecord(r)) },
              },
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/api/2.0/fo/knowledge_base/vuln/",
      operation: "listKnowledgeBase",
      summary: "Query the vulnerability KnowledgeBase by QID/severity (query: action=list, ids, details=All).",
      aiTool: true,
      request: { action: "list", details: "All" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["list"], default: "list", description: "API action; list KnowledgeBase entries." },
        { name: "ids", in: "query", type: "string", format: "QID(s), comma-separated", example: "38170,86002", description: "Restrict results to specific QIDs." },
        { name: "details", in: "query", type: "string", enum: ["Basic", "All", "None"], default: "All", description: "Amount of KnowledgeBase detail to return." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (): MockResult => {
        return {
          status: 200,
          body: {
            KNOWLEDGE_BASE_VULN_LIST_OUTPUT: {
              RESPONSE: {
                VULN_LIST: { VULN: VULNS.map((v) => kbEntry(v)) },
              },
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/api/2.0/fo/asset/group/",
      operation: "listAssetGroups",
      summary: "List asset groups and their IP ranges (query: action=list).",
      request: { action: "list" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["list"], default: "list", description: "API action; list asset groups." },
        { name: "ids", in: "query", type: "string", format: "asset group ID(s), comma-separated", example: "1000001,1000002", description: "Restrict results to specific asset group IDs." },
        { name: "truncation_limit", in: "query", type: "integer", example: 1000, default: 1000, description: "Max asset group records returned; 0 disables truncation." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (): MockResult => {
        const r = rng("qualys:assetgroups");
        const n = int(r, 3, 6);
        return {
          status: 200,
          body: {
            ASSET_GROUP_LIST_OUTPUT: {
              RESPONSE: {
                ASSET_GROUP_LIST: { ASSET_GROUP: Array.from({ length: n }).map(() => assetGroupRecord(r)) },
              },
            },
          },
        };
      },
    },
    {
      method: "POST",
      path: "/api/2.0/fo/report/",
      operation: "launchReport",
      summary: "Launch a report (query: action=launch, template_id, report_title, output_format).",
      aiTool: true,
      request: { action: "launch", template_id: "1039995", report_title: "Monthly Vulnerability Report", output_format: "pdf" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["launch"], default: "launch", description: "API action; launch a report." },
        { name: "template_id", in: "query", type: "integer", required: true, format: "report template ID", example: "1039995", description: "ID of the report template to use." },
        { name: "report_title", in: "query", type: "string", example: "Monthly Vulnerability Report", description: "Title for the generated report." },
        { name: "output_format", in: "query", type: "string", enum: ["pdf", "html", "mht", "xml", "csv", "docx"], default: "pdf", description: "Report output file format." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const seed = ctx.query.report_title || ctx.query.template_id || uuid();
        const id = int(rng("qualys:report:" + seed), 1000000, 9999999);
        return {
          status: 200,
          body: {
            SIMPLE_RETURN: {
              RESPONSE: {
                DATETIME: daysAgoIso(0),
                TEXT: "New report launched",
                ITEM_LIST: { ITEM: [{ KEY: "ID", VALUE: id }] },
              },
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/api/2.0/fo/report/",
      operation: "listReports",
      summary: "List generated reports (query: action=list).",
      request: { action: "list" },
      params: [
        { name: "action", in: "query", type: "string", required: true, enum: ["list"], default: "list", description: "API action; list reports." },
        { name: "id", in: "query", type: "integer", format: "report ID", example: 1000001, description: "Restrict results to a specific report ID." },
        { name: "Authorization", in: "header", type: "string", required: true, format: "HTTP Basic auth (base64 user:pass)", description: "Qualys account credentials." },
      ],
      respond: (): MockResult => {
        const r = rng("qualys:reports");
        const n = int(r, 3, 6);
        return {
          status: 200,
          body: {
            REPORT_LIST_OUTPUT: {
              RESPONSE: {
                REPORT_LIST: { REPORT: Array.from({ length: n }).map(() => reportRecord(r)) },
              },
            },
          },
        };
      },
    },
  ],
  events: [
    { type: "scan.finished", summary: "A vulnerability scan finished and detections are available.", sample: () => ({ scan_ref: `scan/${Date.now()}`, status: "Finished", host: detectionForHost(uuid()) }) },
  ],
};
