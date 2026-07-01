import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, fakeIp, HOSTNAMES, daysAgoIso, uuid } from "../helpers";

// Qualys — vulnerability management. The real VM API is XML; for agent ergonomics
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
  ],
  events: [
    { type: "scan.finished", summary: "A vulnerability scan finished and detections are available.", sample: () => ({ scan_ref: `scan/${Date.now()}`, status: "Finished", host: detectionForHost(uuid()) }) },
  ],
};
