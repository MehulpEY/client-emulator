import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, fakeSha256, fakeSha1, fakeMd5, fakeIp, AV_ENGINES, MALWARE_FAMILIES, COUNTRIES, unixNow, shortId } from "../helpers";

// VirusTotal v3 - file/URL/IP/domain reputation. Verdicts are seeded from the
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

// Pools for URL/behaviour/relationship synthesis - kept small so seeded lookups
// return stable, plausible infrastructure for the same indicator.
const URL_HOSTS = ["login-secure.example.net", "cdn.assets-delivery.com", "pay-portal.co", "download.freeapps.io", "account-verify.info", "tracking.metrics-hub.net"] as const;
const URL_PATHS = ["/", "/login", "/verify", "/download/setup.exe", "/wp-content/uploads/x.php", "/cgi-bin/gate.php"] as const;
const C2_DOMAINS = ["cdn-analytics.top", "update-svc.xyz", "telemetry-hub.net", "secure-login.info", "exfil-node.ru", "badactor.cn", "api.tracking.io", "assets.delivery-cdn.com"] as const;
const MITRE = [
  { id: "T1059.001", signature_description: "PowerShell command execution" },
  { id: "T1547.001", signature_description: "Registry Run Keys / Startup Folder persistence" },
  { id: "T1055", signature_description: "Process injection into a remote process" },
  { id: "T1071.001", signature_description: "Application layer protocol: web protocols used for C2" },
  { id: "T1112", signature_description: "Modify Registry" },
  { id: "T1105", signature_description: "Ingress tool transfer" },
  { id: "T1082", signature_description: "System information discovery" },
] as const;
const DEST_PORTS = [443, 80, 8080, 4444, 53] as const;

function urlReport(id: string): any {
  const r = rng("vt:url:" + id);
  const malicious = int(r, 0, 8);
  const suspicious = int(r, 0, 3);
  const url = `https://${pick(r, URL_HOSTS)}${pick(r, URL_PATHS)}`;
  return {
    data: {
      id,
      type: "url",
      links: { self: `https://www.virustotal.com/api/v3/urls/${id}` },
      attributes: {
        url,
        last_final_url: url,
        title: pick(r, ["Sign in", "Account Verification", "Download", "Invoice", "Document Viewer"]),
        last_analysis_stats: { harmless: 80 - malicious - suspicious, malicious, suspicious, undetected: int(r, 0, 5), timeout: 0 },
        last_analysis_results: analysisResults(id, malicious),
        reputation: malicious > 2 ? -int(r, 5, 70) : int(r, 0, 30),
        times_submitted: int(r, 1, 3800),
        categories: {
          "Forcepoint ThreatSeeker": pick(r, ["business", "phishing", "malware sites", "newly registered"]),
          BitDefender: pick(r, ["marketing", "phishing", "malware", "computersandsoftware"]),
        },
        last_analysis_date: unixNow() - int(r, 60, 86_400),
      },
    },
  };
}

function analysisReport(id: string): any {
  const r = rng("vt:analysis:" + id);
  const malicious = int(r, 0, 12);
  const suspicious = int(r, 0, 3);
  const total = AV_ENGINES.length + 50;
  const isFile = chance(r, 0.6);
  return {
    data: {
      id,
      type: "analysis",
      attributes: {
        status: "completed",
        stats: { harmless: 0, malicious, suspicious, undetected: total - malicious - suspicious, timeout: 0 },
        results: analysisResults(id, malicious),
      },
      meta: isFile ? { file_info: { sha256: fakeSha256(id), size: int(r, 12_000, 8_500_000) } } : {},
    },
  };
}

function behaviours(id: string): any {
  const r = rng("vt:behave:" + id);
  const family = pick(r, MALWARE_FAMILIES);
  const dnsLookups = sample(r, C2_DOMAINS, int(r, 1, 4)).map((hostname) => ({
    hostname,
    resolved_ips: Array.from({ length: int(r, 1, 3) }, () => fakeIp(r)),
  }));
  return {
    data: [
      {
        attributes: {
          sandbox_name: "VirusTotal Jujubox",
          processes_created: [
            `C:\\Windows\\System32\\cmd.exe /c "${pick(r, ["schtasks /create /tn Updater", "reg add HKCU\\...\\Run", "powershell -enc <base64>"])}"`,
            `C:\\Users\\admin\\AppData\\Local\\Temp\\${family.toLowerCase()}.exe`,
            "C:\\Windows\\System32\\wscript.exe",
          ].slice(0, int(r, 1, 3)),
          files_written: [
            `C:\\Users\\admin\\AppData\\Roaming\\${fakeMd5(id).slice(0, 12)}.dll`,
            `C:\\ProgramData\\${family}\\config.bin`,
            "C:\\Windows\\Temp\\svchost.log",
          ].slice(0, int(r, 1, 3)),
          registry_keys_set: [
            { key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Updater", value: `C:\\Users\\admin\\AppData\\Roaming\\${family.toLowerCase()}.exe` },
            { key: `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${family}`, value: "2" },
          ].slice(0, int(r, 1, 2)),
          dns_lookups: dnsLookups,
          ip_traffic: Array.from({ length: int(r, 1, 4) }, () => ({
            destination_ip: fakeIp(r),
            destination_port: pick(r, DEST_PORTS),
            transport_layer_protocol: "tcp",
          })),
          mitre_attack_techniques: sample(r, MITRE, int(r, 2, 5)),
          verdicts: ["MALWARE"],
        },
      },
    ],
  };
}

function contactedDomains(id: string): any {
  const r = rng("vt:contacted-dom:" + id);
  const data = sample(r, C2_DOMAINS, int(r, 2, 6)).map((domain) => {
    const dr = rng("vt:dom:" + domain);
    const malicious = int(dr, 0, 9);
    return {
      type: "domain",
      id: domain,
      attributes: {
        reputation: malicious > 2 ? -int(dr, 5, 60) : int(dr, 0, 30),
        last_analysis_stats: { harmless: 75 - malicious, malicious, suspicious: int(dr, 0, 2), undetected: int(dr, 3, 10), timeout: 0 },
      },
    };
  });
  return { data, meta: { count: data.length } };
}

function communicatingFiles(ip: string): any {
  const r = rng("vt:comm-files:" + ip);
  const n = int(r, 2, 6);
  const data = Array.from({ length: n }, (_, i) => {
    const sha = fakeSha256(ip + ":" + i);
    const fr = rng("vt:file:" + sha);
    const malicious = int(fr, 0, 14);
    return {
      type: "file",
      id: sha,
      attributes: {
        meaningful_name: pick(fr, ["invoice_0492.exe", "update.dll", "resume.pdf", "setup.msi", "report.docx"]),
        last_analysis_stats: { harmless: 0, malicious, suspicious: int(fr, 0, 4), undetected: int(fr, 20, 60), timeout: 0 },
      },
    };
  });
  return { data, meta: { count: data.length } };
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
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "id", in: "path", type: "string", required: true, description: "File identifier — an MD5, SHA-1 or SHA-256 hash of the file.", format: "md5/sha1/sha256 hash", example: "44d88612fea8a8f36de82e1278abb02f" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: fileReport(ctx.params.id) }),
    },
    {
      method: "POST",
      path: "/files",
      operation: "uploadFile",
      summary: "Submit a file for analysis; returns an analysis id to poll.",
      request: { file: "<binary>" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "file", in: "body", type: "string", required: true, description: "The file to scan, uploaded as multipart/form-data.", format: "binary (multipart/form-data)" },
      ],
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
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "ip", in: "path", type: "string", required: true, description: "IP address to look up.", format: "IPv4 address", example: "8.8.8.8" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: ipReport(ctx.params.ip) }),
    },
    {
      method: "GET",
      path: "/domains/{domain}",
      operation: "getDomainReport",
      summary: "Reputation, categories and WHOIS-derived data for a domain.",
      aiTool: true,
      request: { domain: "example.com" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "domain", in: "path", type: "string", required: true, description: "Domain name to look up.", format: "domain name", example: "example.com" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: domainReport(ctx.params.domain) }),
    },
    {
      method: "GET",
      path: "/urls/{id}",
      operation: "getUrlReport",
      summary: "Retrieve the analysis report for a URL by its VirusTotal URL id.",
      aiTool: true,
      request: { id: "aHR0cHM6Ly9leGFtcGxlLmNvbQ" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "id", in: "path", type: "string", required: true, description: "URL identifier — either the SHA-256 of the URL or its unpadded base64url encoding.", format: "base64url-encoded URL or sha256 hash", example: "aHR0cHM6Ly9leGFtcGxlLmNvbQ" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: urlReport(ctx.params.id) }),
    },
    {
      method: "POST",
      path: "/urls",
      operation: "submitUrl",
      summary: "Submit a URL for scanning; returns an analysis id to poll.",
      request: { url: "https://example.com" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "url", in: "body", type: "string", required: true, description: "The URL to scan (sent as a form field).", format: "url", example: "https://example.com" },
      ],
      respond: (): MockResult => {
        const id = Buffer.from(shortId("u-")).toString("base64").replace(/=+$/, "");
        return { status: 200, body: { data: { type: "analysis", id, links: { self: `https://www.virustotal.com/api/v3/analyses/${id}` } } } };
      },
    },
    {
      method: "GET",
      path: "/analyses/{id}",
      operation: "getAnalysis",
      summary: "Poll a file/URL analysis by id for status, stats and per-engine results.",
      aiTool: true,
      request: { id: "u-2f1a9c3e4b5d6f70" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "id", in: "path", type: "string", required: true, description: "Analysis identifier returned by POST /files or POST /urls.", format: "analysis id", example: "u-2f1a9c3e4b5d6f70" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: analysisReport(ctx.params.id) }),
    },
    {
      method: "GET",
      path: "/files/{id}/behaviours",
      operation: "getFileBehaviours",
      summary: "Sandbox behaviour summary for a file: processes, files, registry, network and MITRE ATT&CK mappings.",
      aiTool: true,
      request: { id: "44d88612fea8a8f36de82e1278abb02f" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "id", in: "path", type: "string", required: true, description: "File identifier — an MD5, SHA-1 or SHA-256 hash of the file.", format: "md5/sha1/sha256 hash", example: "44d88612fea8a8f36de82e1278abb02f" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: behaviours(ctx.params.id) }),
    },
    {
      method: "GET",
      path: "/files/{id}/relationships/contacted_domains",
      operation: "getContactedDomains",
      summary: "Domains contacted by a file during sandbox detonation, with reputation stats.",
      aiTool: true,
      request: { id: "44d88612fea8a8f36de82e1278abb02f" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "id", in: "path", type: "string", required: true, description: "File identifier — an MD5, SHA-1 or SHA-256 hash of the file.", format: "md5/sha1/sha256 hash", example: "44d88612fea8a8f36de82e1278abb02f" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: contactedDomains(ctx.params.id) }),
    },
    {
      method: "GET",
      path: "/ip_addresses/{ip}/relationships/communicating_files",
      operation: "getCommunicatingFiles",
      summary: "Files observed communicating with an IP address, with detection stats.",
      request: { ip: "8.8.8.8" },
      params: [
        { name: "x-apikey", in: "header", type: "string", required: true, description: "VirusTotal API key used to authenticate the request.", example: "<api-key>" },
        { name: "ip", in: "path", type: "string", required: true, description: "IP address to look up.", format: "IPv4 address", example: "8.8.8.8" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: communicatingFiles(ctx.params.ip) }),
    },
  ],
  events: [
    { type: "analysis.completed", summary: "A file analysis finished and a verdict is available.", sample: () => fileReport(fakeSha256(shortId(""))) },
  ],
};
