import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, fakeSha256, fakeSha1, fakeMd5, AV_ENGINES, MALWARE_FAMILIES, COUNTRIES, unixNow, shortId } from "../helpers";

// VirusTotal v3 — file/URL/IP/domain reputation. Verdicts are seeded from the
// looked-up indicator so the same hash/IP always returns the same posture.

function analysisResults(seed: string, malicious: number) {
  const r = rng("av:" + seed);
  const engines = AV_ENGINES;
  const flagged = sample(r, engines, malicious);
  const family = pick(r, MALWARE_FAMILIES);
  const out: Record<string, any> = {};
  for (const e of engines) {
    const isMal = flagged.includes(e);
    out[e] = {
      category: isMal ? "malicious" : "undetected",
      engine_name: e,
      engine_version: `${int(r, 1, 9)}.${int(r, 0, 9)}.${int(r, 0, 99)}`,
      result: isMal ? `Trojan.${family}.gen` : null,
      method: "blacklist",
      engine_update: `${2024}${String(int(r, 1, 12)).padStart(2, "0")}${String(int(r, 1, 28)).padStart(2, "0")}`,
    };
  }
  return out;
}

function fileReport(id: string): any {
  const r = rng("vt:file:" + id);
  const malicious = int(r, 0, 14);
  const suspicious = int(r, 0, 4);
  const total = AV_ENGINES.length + 60;
  return {
    data: {
      id,
      type: "file",
      links: { self: `https://www.virustotal.com/api/v3/files/${id}` },
      attributes: {
        sha256: id.length === 64 ? id : fakeSha256(id),
        sha1: fakeSha1(id),
        md5: fakeMd5(id),
        size: int(r, 12_000, 8_500_000),
        type_description: pick(r, ["Win32 EXE", "PDF", "MS Word Document", "ZIP", "ELF", "HTML"]),
        meaningful_name: pick(r, ["invoice_0492.exe", "update.dll", "resume.pdf", "setup.msi", "report.docx"]),
        reputation: malicious > 4 ? -int(r, 10, 90) : int(r, 0, 40),
        times_submitted: int(r, 1, 4200),
        last_analysis_stats: {
          harmless: 0,
          "type-unsupported": int(r, 0, 3),
          suspicious,
          "confirmed-timeout": 0,
          timeout: 0,
          failure: 0,
          malicious,
          undetected: total - malicious - suspicious,
        },
        last_analysis_results: analysisResults(id, malicious),
        last_analysis_date: unixNow() - int(r, 60, 86_400),
        popular_threat_classification:
          malicious > 4
            ? { suggested_threat_label: `trojan.${pick(r, MALWARE_FAMILIES).toLowerCase()}/win32`, popular_threat_category: [{ count: malicious, value: "trojan" }] }
            : undefined,
      },
    },
  };
}

function ipReport(ip: string): any {
  const r = rng("vt:ip:" + ip);
  const malicious = int(r, 0, 11);
  return {
    data: {
      id: ip,
      type: "ip_address",
      attributes: {
        country: pick(r, COUNTRIES),
        as_owner: pick(r, ["DIGITALOCEAN-ASN", "AMAZON-02", "OVH SAS", "Hetzner Online", "CHINANET", "Google LLC"]),
        asn: int(r, 1000, 65000),
        network: ip.replace(/\.\d+$/, ".0/24"),
        reputation: malicious > 3 ? -int(r, 5, 80) : int(r, 0, 25),
        last_analysis_stats: { harmless: 70 - malicious, malicious, suspicious: int(r, 0, 3), undetected: int(r, 4, 12), timeout: 0 },
      },
    },
  };
}

function domainReport(domain: string): any {
  const r = rng("vt:dom:" + domain);
  const malicious = int(r, 0, 9);
  return {
    data: {
      id: domain,
      type: "domain",
      attributes: {
        registrar: pick(r, ["GoDaddy.com, LLC", "NameCheap, Inc.", "Cloudflare, Inc.", "Tucows Domains Inc."]),
        creation_date: unixNow() - int(r, 86_400, 86_400 * 3000),
        reputation: malicious > 2 ? -int(r, 5, 60) : int(r, 0, 30),
        last_analysis_stats: { harmless: 75 - malicious, malicious, suspicious: int(r, 0, 2), undetected: int(r, 3, 10), timeout: 0 },
        categories: { "Forcepoint ThreatSeeker": pick(r, ["business", "malware sites", "newly registered", "phishing"]) },
      },
    },
  };
}

export const virustotal: ToolDef = {
  id: "virustotal",
  name: "VirusTotal",
  vendor: "Google",
  category: "forensics",
  crafted: true,
  aiTool: true,
  summary:
    "VirusTotal analyzes files and URLs for malware and security threats, aggregating 70+ antivirus engines and threat-intel signals into one verdict.",
  tags: ["malware", "reputation", "file-scan", "url-scan", "threat-intel"],
  auth: { type: "api_key_header", param: "x-apikey" },
  docsUrl: "https://docs.virustotal.com/reference/overview",
  defaultLatencyMs: 350,
  endpoints: [
    {
      method: "GET",
      path: "/files/{id}",
      operation: "getFileReport",
      summary: "Retrieve the analysis report for a file by SHA-256/SHA-1/MD5.",
      aiTool: true,
      request: { id: "44d88612fea8a8f36de82e1278abb02f" },
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: fileReport(ctx.params.id) }),
    },
    {
      method: "POST",
      path: "/files",
      operation: "uploadFile",
      summary: "Submit a file for analysis; returns an analysis id to poll.",
      request: { file: "<binary>" },
      respond: (): MockResult => {
        const id = Buffer.from(shortId("f-")).toString("base64").replace(/=+$/, "");
        return { status: 200, body: { data: { type: "analysis", id, links: { self: `https://www.virustotal.com/api/v3/analyses/${id}` } } } };
      },
    },
    {
      method: "GET",
      path: "/ip_addresses/{ip}",
      operation: "getIpReport",
      summary: "Reputation and analysis stats for an IP address.",
      aiTool: true,
      request: { ip: "8.8.8.8" },
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: ipReport(ctx.params.ip) }),
    },
    {
      method: "GET",
      path: "/domains/{domain}",
      operation: "getDomainReport",
      summary: "Reputation, categories and WHOIS-derived data for a domain.",
      aiTool: true,
      request: { domain: "example.com" },
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: domainReport(ctx.params.domain) }),
    },
  ],
  events: [
    { type: "analysis.completed", summary: "A file analysis finished and a verdict is available.", sample: () => fileReport(fakeSha256(shortId(""))) },
  ],
};
