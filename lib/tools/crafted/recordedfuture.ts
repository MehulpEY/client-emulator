import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, fakeIp, fakeSha256, fakeSha1, fakeMd5, minutesAgoIso, daysAgoIso, uuid, MALWARE_FAMILIES, type RNG } from "../helpers";
import { dbAvailable } from "../../db";
import { listResources, getResource, ensureSeeded } from "../../engine/store";

// Recorded Future - Connect API v2 (enrichment) + Alert API v3. Auth is a static
// API token in the `X-RFToken` header (no token exchange). Every enrichment
// lookup is DETERMINISTIC: the risk score, level, criticality and evidence are
// seeded from the indicator itself, so the same IP / domain / hash / URL / CVE
// always yields the same intelligence card across calls - like the real service.
// Responses reproduce RF's `{ data: { entity, risk, timestamps, intelCard, ... } }`
// envelope and real field names. Triggered alerts are stateful (persisted store)
// so a generator emit or a manual `alert.triggered` shows up on re-read.

// ----------------------------------------------------------------------------
// Risk model
// ----------------------------------------------------------------------------

interface Rule {
  rule: string;
  criticality: number; // 1..4
  mitigation: string;
}

// score band per max criticality (0..4) - mirrors RF's Unusual/Suspicious/
// Malicious/Very Malicious risk bands.
const SCORE_BAND: Record<number, [number, number]> = {
  0: [0, 4],
  1: [5, 24],
  2: [25, 64],
  3: [65, 89],
  4: [90, 99],
};

function critLabel(c: number, vuln = false): string {
  const std = ["None", "Unusual", "Suspicious", "Malicious", "Very Malicious"];
  const vul = ["None", "Unusual", "Suspicious", "Malicious", "Very Critical"];
  return (vuln ? vul : std)[c] ?? "None";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// Rule pools per entity type (real RF risk-rule names + criticality).
const IP_RULES: Rule[] = [
  { rule: "Current C&C Server", criticality: 4, mitigation: "Block all traffic to and from this IP address at the perimeter." },
  { rule: "Actively Communicating C&C Server", criticality: 4, mitigation: "Block outbound connections and hunt for internal hosts beaconing to this IP." },
  { rule: "Recently Active C&C Server", criticality: 3, mitigation: "Block traffic and review firewall logs for prior connections." },
  { rule: "Historical Threat List Membership", criticality: 1, mitigation: "Monitor for renewed activity; historical listing only." },
];
const DOMAIN_RULES: Rule[] = [
  { rule: "Historically Reported as a Malware Distribution Domain", criticality: 3, mitigation: "Block DNS resolution and sinkhole the domain." },
  { rule: "Cyber Exploit Signal: Critical", criticality: 3, mitigation: "Prioritize investigation of hosts resolving this domain." },
  { rule: "Recently Registered Domain", criticality: 2, mitigation: "Treat with heightened suspicion; newly registered domains are high-risk." },
];
const HASH_RULES: Rule[] = [
  { rule: "Positive Malware Verdict", criticality: 3, mitigation: "Quarantine any endpoint where this file is present." },
  { rule: "Linked to Malware", criticality: 2, mitigation: "Hunt for related indicators across the estate." },
  { rule: "Observed in Underground Virus Testing Sites", criticality: 2, mitigation: "Add hash to EDR block list." },
];
const URL_RULES: Rule[] = [
  { rule: "Recently Reported by Insikt Group", criticality: 3, mitigation: "Block the URL at the web proxy and email gateway." },
  { rule: "Historically Reported in Threat List", criticality: 2, mitigation: "Block and review historical access logs." },
];
const VULN_RULES: Rule[] = [
  { rule: "Actively Exploited in the Wild", criticality: 4, mitigation: "Patch immediately or apply vendor mitigations; assume active exploitation." },
  { rule: "Linked to Recent Cyber Exploit", criticality: 3, mitigation: "Prioritize remediation; exploit code is circulating." },
  { rule: "Web Reporting Prior to CVSS Score", criticality: 2, mitigation: "Track for score updates; early chatter observed." },
];

const IP_SOURCES = ["Recorded Future Command & Control Reports", "Recorded Future Network Traffic Analysis", "Abuse.ch Feodo Tracker", "Insikt Group", "Spamhaus DROP"];
const DOMAIN_SOURCES = ["Recorded Future Malware Detonation Sandbox", "PhishTank", "Insikt Group", "OpenPhish", "Abuse.ch URLhaus"];
const HASH_SOURCES = ["Recorded Future Malware Detonation Sandbox", "ReversingLabs", "VirusTotal", "Insikt Group", "MalwareBazaar"];
const URL_SOURCES = ["Recorded Future Threat List", "Insikt Group", "OpenPhish", "PhishTank"];
const VULN_SOURCES = ["National Vulnerability Database", "Recorded Future Analyst Note", "Insikt Group", "Exploit Database", "Twitter"];

interface RiskConf {
  pool: Rule[];
  total: number;
  sources: readonly string[];
  vuln: boolean;
}
function riskConf(type: string): RiskConf | null {
  switch (type) {
    case "IpAddress": return { pool: IP_RULES, total: 56, sources: IP_SOURCES, vuln: false };
    case "InternetDomainName": return { pool: DOMAIN_RULES, total: 46, sources: DOMAIN_SOURCES, vuln: false };
    case "Hash": return { pool: HASH_RULES, total: 12, sources: HASH_SOURCES, vuln: false };
    case "URL": return { pool: URL_RULES, total: 16, sources: URL_SOURCES, vuln: false };
    case "CyberVulnerability": return { pool: VULN_RULES, total: 34, sources: VULN_SOURCES, vuln: true };
    default: return null;
  }
}

function evString(er: RNG, sources: readonly string[], sightings: number): string {
  const nSrc = int(er, 1, Math.min(4, sources.length));
  const chosen = sample(er, sources, nSrc);
  const date = fmtDate(daysAgoIso(int(er, 0, 21)));
  const phrase = nSrc > 1 ? `${nSrc} sources including ${chosen.slice(0, 2).join(", ")}` : `1 source: ${chosen[0]}`;
  return `${sightings} sighting${sightings === 1 ? "" : "s"} on ${phrase}. Most recent link (${date}).`;
}

/** Deterministic risk block (score/level/criticality/evidence) for an indicator. */
function riskFrom(seed: string, pool: Rule[], total: number, sources: readonly string[], vuln = false) {
  const r = rng("rf:risk:" + seed);
  const n = int(r, 1, Math.min(pool.length, 4));
  const chosen = sample(r, pool, n).sort((a, b) => b.criticality - a.criticality);
  const evidenceDetails = chosen.map((t) => {
    const er = rng("rf:ev:" + seed + ":" + t.rule);
    const sightingsCount = int(er, 1, 60);
    return {
      rule: t.rule,
      criticality: t.criticality,
      criticalityLabel: critLabel(t.criticality, vuln),
      evidenceString: evString(er, sources, sightingsCount),
      timestamp: daysAgoIso(int(er, 0, 21)),
      sightingsCount,
      mitigationString: t.mitigation,
    };
  });
  const maxCrit = chosen[0].criticality;
  const [lo, hi] = SCORE_BAND[maxCrit] ?? [5, 24];
  const score = int(r, lo, hi);
  return {
    score,
    level: Math.min(3, maxCrit),
    criticality: maxCrit,
    criticalityLabel: critLabel(maxCrit, vuln),
    riskString: `${n}/${total}`,
    rules: n,
    riskSummary: `${n} of ${total} Risk Rules currently observed.`,
    evidenceDetails,
  };
}

function timestamps(seed: string) {
  const r = rng("rf:ts:" + seed);
  return { firstSeen: daysAgoIso(int(r, 60, 720)), lastSeen: minutesAgoIso(int(r, 5, 4320)) };
}

// ----------------------------------------------------------------------------
// Entities & enrichment envelope
// ----------------------------------------------------------------------------

function entityId(type: string, name: string): string {
  switch (type) {
    case "IpAddress": return "ip:" + name;
    case "InternetDomainName": return "idn:" + name;
    case "Hash": return "hash:" + name;
    case "URL": return "url:" + name;
    default: return name; // CyberVulnerability -> CVE id, Company -> opaque id
  }
}

const intelCardFor = (id: string) => `https://app.recordedfuture.com/live/sc/entity/${encodeURIComponent(id)}`;

/** Common `{ data: { entity, risk, timestamps, intelCard, ...extra } }` envelope. */
function enrich(type: string, name: string, extra: Record<string, any> = {}) {
  const conf = riskConf(type)!;
  const id = entityId(type, name);
  return {
    data: {
      entity: { id, name, type },
      timestamps: timestamps(name),
      risk: riskFrom(name, conf.pool, conf.total, conf.sources, conf.vuln),
      intelCard: intelCardFor(id),
      ...extra,
    },
  };
}

const COUNTRY_PAIRS: [string, string][] = [
  ["US", "United States"], ["RU", "Russia"], ["CN", "China"], ["DE", "Germany"], ["NL", "Netherlands"],
  ["BR", "Brazil"], ["FR", "France"], ["GB", "United Kingdom"], ["UA", "Ukraine"], ["IR", "Iran (Islamic Republic of)"],
];
const ORGS = ["Google LLC", "Amazon.com, Inc.", "OVH SAS", "DigitalOcean, LLC", "Hetzner Online GmbH", "M247 Ltd", "Contabo GmbH", "Alibaba Cloud"];
const IP_THREATLISTS = [
  { id: "report:tG_cv0", name: "Recent Botnet Traffic", type: "EntityList" },
  { id: "report:tHR8f2", name: "Historical Command and Control Servers", type: "EntityList" },
  { id: "report:uCl1nQ", name: "Recent Active C&C", type: "EntityList" },
  { id: "report:tS_a0b", name: "Recently Reported by Insikt Group", type: "EntityList" },
];
const DOMAIN_THREATLISTS = [
  { id: "report:dMw_01", name: "Historical Malware Distribution Domains", type: "EntityList" },
  { id: "report:dPh_02", name: "Recent Phishing Domains", type: "EntityList" },
  { id: "report:dRr_03", name: "Recently Registered Suspicious Domains", type: "EntityList" },
];

function ipExtra(ip: string) {
  const r = rng("rf:ipx:" + ip);
  const parts = ip.split(".");
  const cidr = parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : `${ip}/24`;
  const [, country] = pick(r, COUNTRY_PAIRS);
  return {
    location: {
      asn: "AS" + int(r, 1000, 65000),
      cidr: { id: "ip:" + cidr, name: cidr },
      organization: pick(r, ORGS),
      location: { country },
    },
    threatLists: sample(r, IP_THREATLISTS, int(r, 1, 3)),
    counts: [
      { id: "openPorts", count: int(r, 0, 12) },
      { id: "resolvedDomains", count: int(r, 0, 400) },
    ],
    metrics: [
      { type: "publicSourceCount", value: int(r, 1, 30) },
      { type: "linksSuspicious", value: int(r, 0, 20) },
      { type: "totalHits", value: int(r, 5, 900) },
      { type: "criticality", value: int(r, 1, 4) },
    ],
  };
}

function domainExtra(domain: string) {
  const r = rng("rf:dx:" + domain);
  return {
    threatLists: sample(r, DOMAIN_THREATLISTS, int(r, 1, 2)),
    metrics: [
      { type: "publicSourceCount", value: int(r, 1, 25) },
      { type: "linksSuspicious", value: int(r, 0, 15) },
      { type: "totalHits", value: int(r, 3, 600) },
    ],
  };
}

function hashExtra(hash: string) {
  const seed = "rf:hx:" + hash;
  const algorithm = hash.length === 32 ? "MD5" : hash.length === 40 ? "SHA-1" : "SHA-256";
  return {
    hashAlgorithm: algorithm,
    fileHashes: [
      { algorithm: "MD5", hash: hash.length === 32 ? hash : fakeMd5(seed) },
      { algorithm: "SHA-1", hash: hash.length === 40 ? hash : fakeSha1(seed) },
      { algorithm: "SHA-256", hash: hash.length === 64 ? hash : fakeSha256(seed) },
    ],
  };
}

const CVE_VENDORS = ["Apache", "Microsoft", "Cisco", "Fortinet", "VMware", "Atlassian", "Oracle", "Citrix"];
const CVE_PRODUCTS = ["HTTP Server", "Exchange Server", "IOS XE", "FortiOS", "vCenter Server", "Confluence Data Center", "WebLogic Server", "ADC"];
function vulnExtra(cve: string) {
  const r = rng("rf:vx:" + cve);
  const impacts = ["execute arbitrary code", "cause a denial of service", "escalate privileges", "bypass authentication"];
  const vectors = ["a crafted HTTP request", "a malformed packet", "an unauthenticated API call", "specially crafted input"];
  return {
    cvssv3: {
      baseScore: +(int(r, 40, 99) / 10).toFixed(1),
      attackVector: pick(r, ["NETWORK", "ADJACENT_NETWORK", "LOCAL", "PHYSICAL"]),
      attackComplexity: pick(r, ["LOW", "HIGH"]),
      privilegesRequired: pick(r, ["NONE", "LOW", "HIGH"]),
      availabilityImpact: pick(r, ["NONE", "LOW", "HIGH"]),
      created: daysAgoIso(int(r, 30, 1200)),
    },
    cvss: {
      score: +(int(r, 40, 100) / 10).toFixed(1),
      accessVector: pick(r, ["NETWORK", "ADJACENT_NETWORK", "LOCAL"]),
      authentication: pick(r, ["NONE", "SINGLE", "MULTIPLE"]),
      availability: pick(r, ["NONE", "PARTIAL", "COMPLETE"]),
      published: daysAgoIso(int(r, 30, 1200)),
    },
    nvdDescription: `A vulnerability in ${pick(r, CVE_VENDORS)} ${pick(r, CVE_PRODUCTS)} allows a remote attacker to ${pick(r, impacts)} via ${pick(r, vectors)}.`,
    commonNames: [cve],
    relatedLinks: [
      `https://nvd.nist.gov/vuln/detail/${cve}`,
      `https://cve.mitre.org/cgi-bin/cvename.cgi?name=${cve}`,
    ],
  };
}

// ----------------------------------------------------------------------------
// Alerts (v3)
// ----------------------------------------------------------------------------

const AB62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function rfId(seed: string, len = 6): string {
  const r = rng("rf:id:" + seed);
  let s = "";
  for (let i = 0; i < len; i++) s += AB62[Math.floor(r() * AB62.length)];
  return s;
}

const ALERT_RULES = [
  "Typosquat Domain Registered for Contoso",
  "New Critical Vulnerability Affecting Technology Stack",
  "New Malware Sample Observed",
  "Data Leakage on Public Code Repository",
  "Domain Abuse - Suspected Phishing",
  "Company Mentioned in Cyber Attack Context",
  "Compromised Credentials Posted",
];
const ALERT_STATUSES = ["New", "Resolved", "Pending", "Dismissed"];
const ALERT_SOURCES = ["Twitter", "PasteBin", "GitHub", "Recorded Future Analyst Note", "Dark Web Forum", "Telegram", "OpenPhish"];
const ANALYSTS = ["mchen", "asingh", "dkumar", "rlopez", "jwolfe"];
const HEADLINES = ["Threat actor infrastructure update:", "New indicator observed:", "Credential dump referencing", "Malware sample linked to", "Phishing campaign using"];
const COMPANIES = ["Contoso", "Fabrikam", "Northwind Traders", "Adventure Works"];
const DOMAIN_WORDS = ["secure", "login", "update", "account", "cloud", "portal", "mail", "vault"];
const DOMAIN_TLDS = ["com", "net", "xyz", "top", "info", "ru", "cn"];

interface FabEntity {
  name: string;
  type: string;
  id: string;
  enrichable: boolean;
}
function fabEntity(seed: string): FabEntity {
  const r = rng("rf:fab:" + seed);
  const kind = pick(r, ["domain", "ip", "hash", "cve", "company"]);
  if (kind === "ip") {
    const ip = fakeIp(r);
    return { name: ip, type: "IpAddress", id: "ip:" + ip, enrichable: true };
  }
  if (kind === "domain") {
    const d = `${pick(r, DOMAIN_WORDS)}${pick(r, DOMAIN_WORDS)}.${pick(r, DOMAIN_TLDS)}`;
    return { name: d, type: "InternetDomainName", id: "idn:" + d, enrichable: true };
  }
  if (kind === "hash") {
    const h = fakeSha256("rf:fabhash:" + seed);
    return { name: h, type: "Hash", id: "hash:" + h, enrichable: true };
  }
  if (kind === "cve") {
    const c = `CVE-${int(r, 2018, 2024)}-${int(r, 1000, 49999)}`;
    return { name: c, type: "CyberVulnerability", id: c, enrichable: true };
  }
  const co = pick(r, COMPANIES);
  return { name: co, type: "Company", id: rfId("co:" + co), enrichable: false };
}

/** A triggered-alert result object (list shape). */
function alert(seed: string) {
  const r = rng("rf:alert:" + seed);
  const id = rfId("alert:" + seed);
  const ruleName = pick(r, ALERT_RULES);
  const triggered = minutesAgoIso(int(r, 5, 20160));
  const status = pick(r, ALERT_STATUSES);
  const family = pick(r, MALWARE_FAMILIES);
  const ents = Array.from({ length: int(r, 1, 2) }, (_, i) => fabEntity("e:" + seed + ":" + i));
  const src = pick(r, ALERT_SOURCES);
  const first = ents[0];
  const note =
    status === "Resolved" ? "Confirmed true positive; blocked at perimeter and closed." :
    status === "Dismissed" ? "Reviewed - false positive, no action required." :
    chance(r, 0.3) ? "Under investigation." : null;
  return {
    id,
    title: `${ruleName}${ruleName.includes("Malware") ? ` (${family})` : ""} - ${fmtDate(triggered)}`,
    triggered,
    type: "ENTITY",
    url: { portal: `https://app.recordedfuture.com/live/sc/notification/${id}` },
    rule: { id: rfId("rule:" + ruleName), name: ruleName },
    review: {
      status,
      assignee: status === "New" ? null : `${pick(r, ANALYSTS)}@contoso.com`,
      note,
    },
    hits: [
      {
        id: rfId("hit:" + seed),
        entities: ents.map((e) => ({ id: e.id, name: e.name, type: e.type })),
        document: {
          title: `${pick(r, HEADLINES)} ${first.name}`,
          source: { id: rfId("src:" + src), name: src },
        },
      },
    ],
    enriched_entities: ents
      .filter((e) => e.enrichable)
      .map((e) => {
        const conf = riskConf(e.type)!;
        const rk = riskFrom(e.name, conf.pool, conf.total, conf.sources, conf.vuln);
        return { entity: { name: e.name, type: e.type }, risk: { score: rk.score, criticalityLabel: rk.criticalityLabel } };
      }),
  };
}

/** Expand a list-shape alert into full detail (hit fragments + AI insights). */
function alertDetail(base: any) {
  const r = rng("rf:aidetail:" + base.id);
  const maxScore = Math.max(0, ...(base.enriched_entities || []).map((e: any) => e.risk.score));
  const enrichedCount = (base.enriched_entities || []).length;
  return {
    ...base,
    hits: (base.hits || []).map((h: any) => ({
      ...h,
      fragment: `${pick(r, HEADLINES)} ${h.entities?.[0]?.name ?? "the observed entity"}. Reported ${fmtDate(base.triggered)} via ${h.document?.source?.name ?? "an external source"}.`,
    })),
    ai_insights: {
      text: `Recorded Future AI: this alert triggered on rule "${base.rule?.name}". ${enrichedCount} enriched entit${enrichedCount === 1 ? "y" : "ies"} observed, maximum risk score ${maxScore}. Recommended action: validate exposure of the referenced entities and block any malicious indicators.`,
      comment: null,
    },
  };
}

// ----------------------------------------------------------------------------
// SOAR (XSOAR gateway) multi-entity enrichment
// ----------------------------------------------------------------------------

function soarEntity(type: string, name: string) {
  const conf = riskConf(type)!;
  const rk = riskFrom(name, conf.pool, conf.total, conf.sources, conf.vuln);
  const id = entityId(type, name);
  return {
    entity: { id, name, type },
    riskScore: rk.score,
    riskLevel: rk.level,
    criticalityLabel: rk.criticalityLabel,
    rules: rk.riskString,
    ruleCount: rk.rules,
    Evidence: rk.evidenceDetails.map((e) => ({
      rule: e.rule,
      level: e.criticality,
      timestamp: e.timestamp,
      description: e.evidenceString,
    })),
    intelCard: intelCardFor(id),
  };
}

// ----------------------------------------------------------------------------
// Tool definition
// ----------------------------------------------------------------------------

export const recordedFuture: ToolDef = {
  id: "recorded-future",
  name: "Recorded Future",
  vendor: "Recorded Future",
  category: "threat-intel",
  crafted: true,
  aiTool: true,
  summary:
    "Recorded Future Intelligence Cloud - deterministic threat-intelligence enrichment for IPs, domains, file hashes, URLs and CVEs (risk score, criticality and evidence), bulk risk lists, triggered alerts, and SOAR multi-entity enrichment via the Connect API v2 and Alert API v3.",
  tags: ["threat-intel", "enrichment", "risk-score", "ioc", "alerts", "cve", "soar"],
  auth: { type: "api_key_header", param: "X-RFToken" },
  docsUrl: "https://docs.recordedfuture.com/reference",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "GET",
      path: "/v2/ip/{ip}",
      operation: "enrichIp",
      summary: "Enrich an IP address - risk score, evidence, ASN/location, threat-list membership and metrics.",
      aiTool: true,
      request: { ip: "89.248.165.52", fields: "entity,risk,timestamps,intelCard,location,threatLists,metrics" },
      params: [
        { name: "ip", in: "path", type: "string", required: true, format: "IPv4 address", example: "89.248.165.52", description: "IP address to enrich." },
        { name: "fields", in: "query", type: "string", description: "Comma-separated subset of response fields to return.", example: "entity,risk,timestamps,intelCard,location,threatLists,metrics" },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: enrich("IpAddress", ctx.params.ip, ipExtra(ctx.params.ip)) }),
    },
    {
      method: "GET",
      path: "/v2/domain/{domain}",
      operation: "enrichDomain",
      summary: "Enrich a domain - risk score, evidence, threat-list membership and metrics.",
      aiTool: true,
      request: { domain: "secure-login-update.top", fields: "entity,risk,timestamps,intelCard,threatLists" },
      params: [
        { name: "domain", in: "path", type: "string", required: true, format: "domain name", example: "secure-login-update.top", description: "Domain name to enrich." },
        { name: "fields", in: "query", type: "string", description: "Comma-separated subset of response fields to return.", example: "entity,risk,timestamps,intelCard,threatLists" },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: enrich("InternetDomainName", ctx.params.domain, domainExtra(ctx.params.domain)) }),
    },
    {
      method: "GET",
      path: "/v2/hash/{hash}",
      operation: "enrichHash",
      summary: "Enrich a file hash (MD5/SHA-1/SHA-256) - malware verdict, evidence and related file hashes.",
      aiTool: true,
      request: { hash: "44d88612fea8a8f36de82e1278abb02f" },
      params: [
        { name: "hash", in: "path", type: "string", required: true, format: "MD5, SHA-1 or SHA-256 hash", example: "44d88612fea8a8f36de82e1278abb02f", description: "File hash to enrich; algorithm is inferred from length (32=MD5, 40=SHA-1, 64=SHA-256)." },
        { name: "fields", in: "query", type: "string", description: "Comma-separated subset of response fields to return.", example: "entity,risk,timestamps,intelCard,hashAlgorithm,fileHashes" },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: enrich("Hash", ctx.params.hash, hashExtra(ctx.params.hash)) }),
    },
    {
      method: "GET",
      path: "/v2/url/{url}",
      operation: "enrichUrl",
      summary: "Enrich a URL - risk score and evidence (URL-encode the value in the path).",
      aiTool: true,
      request: { url: "http%3A%2F%2Fsecure-mailvault.xyz%2Flogin" },
      params: [
        { name: "url", in: "path", type: "string", required: true, format: "URL-encoded URL", example: "http%3A%2F%2Fsecure-mailvault.xyz%2Flogin", description: "URL to enrich; URL-encode the value in the path." },
        { name: "fields", in: "query", type: "string", description: "Comma-separated subset of response fields to return.", example: "entity,risk,timestamps,intelCard" },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: (ctx: MockContext): MockResult => {
        let url = ctx.params.url;
        try { url = decodeURIComponent(ctx.params.url); } catch { /* leave as-is */ }
        return { status: 200, body: enrich("URL", url) };
      },
    },
    {
      method: "GET",
      path: "/v2/vulnerability/{cve}",
      operation: "enrichVulnerability",
      summary: "Enrich a CVE - risk score, exploitation evidence, CVSS v2/v3 and NVD description.",
      aiTool: true,
      request: { cve: "CVE-2023-34362" },
      params: [
        { name: "cve", in: "path", type: "string", required: true, format: "CVE id", example: "CVE-2023-34362", description: "CVE identifier to enrich." },
        { name: "fields", in: "query", type: "string", description: "Comma-separated subset of response fields to return.", example: "entity,risk,timestamps,intelCard,cvssv3,cvss,nvdDescription" },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: enrich("CyberVulnerability", ctx.params.cve, vulnExtra(ctx.params.cve)) }),
    },
    {
      method: "GET",
      path: "/v2/ip/risklist",
      operation: "getIpRiskList",
      summary: "Download the bulk IP risk list (default/large) - array of scored entities with encoded evidence.",
      aiTool: true,
      request: { list: "default", format: "json" },
      params: [
        { name: "list", in: "query", type: "string", enum: ["default", "large"], default: "default", description: "Which IP risk list to download; 'large' returns more rows than 'default'." },
        { name: "format", in: "query", type: "string", enum: ["csv", "xml", "json"], default: "json", description: "Requested output format (this mock always returns JSON)." },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = ctx.query.list === "large" ? 30 : 12;
        const rows = Array.from({ length: n }, (_, i) => {
          const ip = fakeIp(rng("rf:risklist:" + (ctx.query.list || "default") + ":" + i));
          const rk = riskFrom(ip, IP_RULES, 56, IP_SOURCES);
          return {
            Name: ip,
            Risk: rk.score,
            RiskString: rk.riskString,
            EvidenceDetails: JSON.stringify(rk.evidenceDetails),
          };
        });
        return { status: 200, body: rows, headers: { "Content-Type": "application/json" } };
      },
    },
    {
      method: "GET",
      path: "/alert/v3",
      operation: "searchAlerts",
      summary: "Search triggered alerts (filter by triggered range, statusInPortal, limit). Stateful - persisted.",
      aiTool: true,
      request: { triggered: "-24h to now", statusInPortal: "New", limit: "10" },
      params: [
        { name: "triggered", in: "query", type: "string", format: "relative or ISO 8601 date range", example: "-24h to now", description: "Filter alerts by their triggered time range." },
        { name: "statusInPortal", in: "query", type: "string", enum: ["New", "Assigned", "Pending", "Dismissed", "Resolved"], example: "New", description: "Filter by portal review status; mock alerts are assigned New/Pending/Dismissed/Resolved." },
        { name: "limit", in: "query", type: "integer", default: 10, example: 10, description: "Maximum number of alerts to return (capped at 100)." },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 100);
        const statusFilter = ctx.query.statusInPortal;
        const filter = (rows: any[]) => (statusFilter ? rows.filter((a) => a.review?.status === statusFilter) : rows);
        if (!dbAvailable()) {
          const rows = filter(Array.from({ length: limit }, (_, i) => alert("a:" + i)));
          return { status: 200, body: { counts: { returned: rows.length, total: rows.length }, data: { results: rows }, note: "database offline - synthetic, not persisted" } };
        }
        await ensureSeeded("recorded-future", "alerts", 8, () => { const d = alert("seed:" + uuid()); return { id: d.id, data: d }; });
        const { items, total } = await listResources("recorded-future", "alerts", { limit: 100 });
        const rows = filter(items.map((x) => x.data));
        const returned = rows.slice(0, limit);
        return { status: 200, body: { counts: { returned: returned.length, total }, data: { results: returned } } };
      },
    },
    {
      method: "GET",
      path: "/alert/v3/{id}",
      operation: "getAlert",
      summary: "Get the full detail for a single triggered alert (hit fragments + AI insights).",
      aiTool: true,
      request: { id: "cRcC2c" },
      params: [
        { name: "id", in: "path", type: "string", required: true, format: "alert id", example: "cRcC2c", description: "Identifier of the triggered alert to retrieve." },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const id = ctx.params.id;
        if (dbAvailable()) {
          const rec = await getResource("recorded-future", "alerts", id);
          if (rec) return { status: 200, body: { data: alertDetail(rec.data) } };
        }
        const base = alert("id:" + id);
        base.id = id;
        base.url = { portal: `https://app.recordedfuture.com/live/sc/notification/${id}` };
        return { status: 200, body: { data: alertDetail(base) } };
      },
    },
    {
      method: "POST",
      path: "/gw/xsoar/",
      operation: "soarEnrich",
      summary: "SOAR multi-entity enrichment - submit arrays of ip/domain/url/file/cve and get per-entity risk + evidence.",
      aiTool: true,
      request: { ip: ["89.248.165.52"], domain: ["secure-login-update.top"], file: ["44d88612fea8a8f36de82e1278abb02f"], cve: ["CVE-2023-34362"], url: [] },
      params: [
        { name: "ip[]", in: "body", type: "array", description: "IP addresses to enrich.", example: "89.248.165.52" },
        { name: "domain[]", in: "body", type: "array", description: "Domain names to enrich.", example: "secure-login-update.top" },
        { name: "url[]", in: "body", type: "array", description: "URLs to enrich.", example: "http://secure-mailvault.xyz/login" },
        { name: "file[]", in: "body", type: "array", description: "File hashes (MD5/SHA-1/SHA-256) to enrich.", example: "44d88612fea8a8f36de82e1278abb02f" },
        { name: "cve[]", in: "body", type: "array", description: "CVE identifiers to enrich.", example: "CVE-2023-34362" },
        { name: "X-RFToken", in: "header", type: "string", required: true, description: "Recorded Future API token." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const b = ctx.body || {};
        const out: any[] = [];
        const add = (list: any, type: string) => (Array.isArray(list) ? list : []).forEach((name: any) => out.push(soarEntity(type, String(name))));
        add(b.ip, "IpAddress");
        add(b.domain, "InternetDomainName");
        add(b.url, "URL");
        add(b.file, "Hash");
        add(b.cve, "CyberVulnerability");
        return { status: 200, body: { data: out } };
      },
    },
  ],
  events: [
    {
      type: "alert.triggered",
      summary: "A Recorded Future alert was triggered.",
      persist: { collection: "alerts", idOf: (d) => d.id },
      sample: () => alert("evt:" + uuid()),
    },
  ],
};
