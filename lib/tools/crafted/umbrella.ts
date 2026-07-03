import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, fakeIp, minutesAgoIso, daysAgoIso, nowIso, uuid, MALWARE_FAMILIES } from "../helpers";
import { dbAvailable } from "../../db";
import { listResources, putResource } from "../../engine/store";

// Cisco Umbrella (Cloud Security) - the DNS-layer security, Reporting v2,
// Enforcement/Policies v2, and Investigate v2 APIs. Auth is OAuth2 client
// credentials (HTTP Basic api-key:secret -> short-lived bearer). Reporting and
// Investigate lookups are seeded from the input so the same domain returns a
// stable verdict/score across calls, like the real reputation service. The
// enforcement destination lists are stateful: adding a destination persists it
// to the resource store, and listing a list returns what was added.

const ORG_ID = 8912345;
const GLOBAL_BLOCK_ID = 2477857;
const GLOBAL_ALLOW_ID = 2477858;

const DOMAINS = [
  "google.com", "microsoft.com", "office365.com", "salesforce.com", "amazonaws.com",
  "github.com", "slack.com", "zoom.us", "dropbox.com", "cloudflare.com",
  "windowsupdate.com", "apple.com", "linkedin.com", "atlassian.net",
] as const;

const BAD_DOMAINS = [
  "secure-login-verify.top", "update-account-alert.xyz", "cdn-cryptomine.pw",
  "invoice-docs-share.ru", "free-gift-claim.click", "auth-portal-reset.info",
  "tracking-pixel-ads.cc", "malware-c2-node.su", "office365-mfa-check.app",
] as const;

const CONTENT_CATS = [
  { id: 3, type: "content", label: "Software/Technology" },
  { id: 4, type: "content", label: "Business Services" },
  { id: 25, type: "content", label: "Search Engines" },
  { id: 32, type: "content", label: "Ecommerce/Shopping" },
  { id: 23, type: "content", label: "Chat" },
  { id: 24, type: "content", label: "File Storage" },
] as const;

const SECURITY_CATS = [
  { id: 68, type: "security", label: "Malware" },
  { id: 66, type: "security", label: "Phishing" },
  { id: 67, type: "security", label: "Command and Control" },
  { id: 64, type: "security", label: "Cryptomining" },
  { id: 65, type: "security", label: "Dynamic DNS" },
] as const;

const CONTENT_LABELS = ["Business Services", "Software/Technology", "Search Engines", "Ecommerce/Shopping", "File Storage", "Chat"] as const;
const SECURITY_LABELS = ["Malware", "Phishing", "Command and Control", "Cryptomining", "Newly Seen Domains", "Dynamic DNS"] as const;
const THREAT_TYPES = ["Malware", "Command and Control", "Phishing", "Cryptomining", "Dynamic DNS"] as const;
const RISK_INDICATORS = ["Geo Popularity Score", "Keyword Score", "Lexical", "Popularity 1 Day", "TLD Rank Score", "Umbrella Block Status"] as const;

/** A single DNS security-activity row (some blocked by a security policy). */
function dnsActivity(seed: string) {
  const r = rng("umbrella:dns:" + seed);
  const blocked = chance(r, 0.35);
  const domain = pick(r, blocked ? BAD_DOMAINS : DOMAINS);
  const cat = blocked ? pick(r, SECURITY_CATS) : pick(r, CONTENT_CATS);
  const iso = minutesAgoIso(int(r, 1, 1440));
  const ms = Date.parse(iso);
  return {
    type: "dns",
    domain,
    querytype: "A",
    returncode: 0,
    verdict: blocked ? "blocked" : "allowed",
    date: iso.slice(0, 10),
    time: iso.slice(11, 19),
    timestamp: ms,
    externalip: fakeIp(r),
    internalip: `10.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 1, 254)}`,
    categories: [cat],
    policycategories: blocked ? [cat] : [],
    identities: [{ id: int(r, 100000000, 900000000), type: { id: 1, type: "roaming", label: "Roaming Computers" } }],
  };
}

function topDestination(seed: string, rank: number) {
  const r = rng("umbrella:topdest:" + seed);
  const requests = int(r, 500, 50000);
  const blocked = int(r, 0, Math.floor(requests * 0.08));
  return {
    rank,
    domain: pick(r, DOMAINS),
    count: requests,
    categories: [pick(r, CONTENT_CATS)],
    counts: { requests, allowedrequests: requests - blocked, blockedrequests: blocked },
  };
}

function topThreat(seed: string) {
  const r = rng("umbrella:threat:" + seed);
  return { threat: pick(r, MALWARE_FAMILIES), threattype: pick(r, THREAT_TYPES), count: int(r, 10, 5000) };
}

export const ciscoUmbrella: ToolDef = {
  id: "cisco-umbrella",
  name: "Cisco Umbrella",
  vendor: "Cisco",
  category: "network",
  crafted: true,
  aiTool: true,
  summary:
    "Cisco Umbrella cloud security - DNS-layer protection with Reporting v2 (DNS activity, top destinations/threats), Enforcement/Policies v2 destination lists, and Investigate v2 domain intelligence (categorization, security features, risk score).",
  tags: ["network", "dns-security", "secure-web-gateway", "threat-intel", "investigate", "cloud-security"],
  auth: { type: "bearer" },
  docsUrl: "https://developer.cisco.com/docs/cloud-security/",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/auth/v2/token",
      operation: "getToken",
      summary: "OAuth2 client-credentials grant - HTTP Basic (API key : secret) exchanged for a short-lived bearer access token.",
      request: { grant_type: "client_credentials" },
      params: [
        { name: "Authorization", in: "header", type: "string", required: true, description: "HTTP Basic auth carrying the API key and secret.", format: "Basic base64(apiKey:apiSecret)", example: "Basic YXBpS2V5OmFwaVNlY3JldA==" },
        { name: "grant_type", in: "body", type: "string", required: true, description: "OAuth2 grant type - only client_credentials is supported.", enum: ["client_credentials"], default: "client_credentials" },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: {
          token_type: "bearer",
          access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock." + Buffer.from(uuid()).toString("base64url"),
          expires_in: 3600,
        },
      }),
    },
    {
      method: "GET",
      path: "/reports/v2/activity/dns",
      operation: "listDnsActivity",
      summary: "DNS security activity - per-request domain lookups with verdict, categories, and identities.",
      aiTool: true,
      request: { from: "-1days", to: "now", limit: "10" },
      params: [
        { name: "from", in: "query", type: "string", required: true, description: "Start of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. -1days) or Unix epoch ms", example: "-1days" },
        { name: "to", in: "query", type: "string", required: true, description: "End of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. now) or Unix epoch ms", example: "now" },
        { name: "limit", in: "query", type: "integer", description: "Max rows to return (capped at 100).", default: 10, example: 10 },
        { name: "offset", in: "query", type: "integer", description: "Number of records to skip for pagination.", default: 0 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 100);
        const data = Array.from({ length: limit }, (_, i) => dnsActivity("row:" + i));
        return { status: 200, body: { data } };
      },
    },
    {
      method: "GET",
      path: "/reports/v2/top-destinations/dns",
      operation: "listTopDestinations",
      summary: "Top DNS destinations ranked by request volume, with allowed/blocked breakdown.",
      aiTool: true,
      request: { from: "-7days", to: "now", limit: "10" },
      params: [
        { name: "from", in: "query", type: "string", required: true, description: "Start of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. -7days) or Unix epoch ms", example: "-7days" },
        { name: "to", in: "query", type: "string", required: true, description: "End of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. now) or Unix epoch ms", example: "now" },
        { name: "limit", in: "query", type: "integer", description: "Max destinations to return (capped at 100).", default: 10, example: 10 },
        { name: "offset", in: "query", type: "integer", description: "Number of records to skip for pagination.", default: 0 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 100);
        const data = Array.from({ length: limit }, (_, i) => topDestination("d:" + i, i + 1));
        return { status: 200, body: { data } };
      },
    },
    {
      method: "GET",
      path: "/reports/v2/top-threats",
      operation: "listTopThreats",
      summary: "Top threats observed across DNS traffic, by threat family and type.",
      aiTool: true,
      request: { from: "-7days", to: "now", limit: "10" },
      params: [
        { name: "from", in: "query", type: "string", required: true, description: "Start of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. -7days) or Unix epoch ms", example: "-7days" },
        { name: "to", in: "query", type: "string", required: true, description: "End of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. now) or Unix epoch ms", example: "now" },
        { name: "limit", in: "query", type: "integer", description: "Max threats to return (capped at 50).", default: 10, example: 10 },
        { name: "offset", in: "query", type: "integer", description: "Number of records to skip for pagination.", default: 0 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 50);
        const data = Array.from({ length: limit }, (_, i) => topThreat("t:" + i));
        return { status: 200, body: { data } };
      },
    },
    {
      method: "GET",
      path: "/reports/v2/summary",
      operation: "getSummary",
      summary: "Aggregate traffic summary - total, allowed, and blocked requests plus distinct counts.",
      request: { from: "-7days", to: "now" },
      params: [
        { name: "from", in: "query", type: "string", required: true, description: "Start of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. -7days) or Unix epoch ms", example: "-7days" },
        { name: "to", in: "query", type: "string", required: true, description: "End of the time window - relative time or Unix epoch milliseconds.", format: "relative time (e.g. now) or Unix epoch ms", example: "now" },
      ],
      respond: (): MockResult => {
        const r = rng("umbrella:summary");
        const requests = int(r, 500000, 2000000);
        const blocked = int(r, 1000, 50000);
        return {
          status: 200,
          body: {
            data: {
              requests,
              requestsallowed: requests - blocked,
              requestsblocked: blocked,
              applications: int(r, 100, 600),
              categories: int(r, 40, 90),
              identities: int(r, 50, 400),
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/policies/v2/destinationlists",
      operation: "listDestinationLists",
      summary: "List the organization's enforcement destination lists (block / allow).",
      params: [],
      respond: async (): Promise<MockResult> => {
        let blockCount = 14;
        if (dbAvailable()) {
          const { total } = await listResources("cisco-umbrella", "destinations", { limit: 1 });
          if (total > 0) blockCount = total;
        }
        const data = [
          { id: GLOBAL_BLOCK_ID, organizationId: ORG_ID, name: "Global Block List", access: "block", isGlobal: true, createdAt: daysAgoIso(420), modifiedAt: daysAgoIso(2), markedForDeletion: false, meta: { destinationCount: blockCount } },
          { id: GLOBAL_ALLOW_ID, organizationId: ORG_ID, name: "Global Allow List", access: "allow", isGlobal: true, createdAt: daysAgoIso(420), modifiedAt: daysAgoIso(30), markedForDeletion: false, meta: { destinationCount: 6 } },
        ];
        return { status: 200, body: { status: { code: 200, text: "OK" }, data } };
      },
    },
    {
      method: "POST",
      path: "/policies/v2/destinationlists/{destinationListId}/destinations",
      operation: "addDestinations",
      summary: "Add block/allow entries (domains, URLs, or IPs) to a destination list (stateful - persisted).",
      aiTool: true,
      // Persist happens directly (putResource) below; emit a non-persist activity
      // event so the response body (no `destination` field) can't write a stray
      // record via the persist-mapped `destination.added` (reserved for generators).
      emits: "destinationlist.updated",
      request: [{ destination: "malicious-example.io", comment: "IOC from IR case #4821" }],
      params: [
        { name: "destinationListId", in: "path", type: "integer", required: true, description: "ID of the destination list to add entries to (e.g. Global Block/Allow list).", example: 2477857 },
        { name: "[].destination", in: "body", type: "string", required: true, description: "A domain, URL, or IPv4 address to add to the list.", format: "domain name, URL, or IPv4 address", example: "malicious-example.io" },
        { name: "[].comment", in: "body", type: "string", description: "Optional note describing why the entry was added.", example: "IOC from IR case #4821" },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const listId = ctx.params.destinationListId;
        const entries: Array<{ destination?: string; comment?: string }> = Array.isArray(ctx.body) ? ctx.body : [];
        for (const e of entries) {
          if (!e || e.destination == null) continue;
          const dest = String(e.destination);
          await putResource("cisco-umbrella", "destinations", dest, { destination: dest, comment: e.comment ?? "", listId, addedAt: nowIso() });
        }
        let count = entries.length;
        if (dbAvailable()) {
          const { total } = await listResources("cisco-umbrella", "destinations", { limit: 1 });
          if (total > 0) count = total;
        }
        const access = Number(listId) === GLOBAL_ALLOW_ID ? "allow" : "block";
        const name = access === "allow" ? "Global Allow List" : "Global Block List";
        return {
          status: 200,
          body: { status: { code: 200, text: "OK" }, data: { id: Number(listId) || listId, access, name, meta: { destinationCount: count } } },
        };
      },
    },
    {
      method: "GET",
      path: "/policies/v2/destinationlists/{destinationListId}/destinations",
      operation: "listDestinations",
      summary: "List the entries in a destination list (stateful - reflects what was added).",
      params: [
        { name: "destinationListId", in: "path", type: "integer", required: true, description: "ID of the destination list whose entries to return.", example: 2477857 },
      ],
      respond: async (): Promise<MockResult> => {
        if (!dbAvailable()) {
          const data = Array.from({ length: 4 }, (_, i) => {
            const r = rng("umbrella:dest:" + i);
            const dest = pick(r, BAD_DOMAINS);
            return { id: int(r, 1000000000, 9999999999), destination: dest, type: "domain", comment: pick(r, ["IOC from IR", "Blocked by SOC", "Threat intel match", "Phishing domain"]) };
          });
          return { status: 200, body: { status: { code: 200, text: "OK" }, data, note: "database offline - synthetic, not persisted" } };
        }
        const { items } = await listResources("cisco-umbrella", "destinations", { limit: 200 });
        const data = items
          .filter((it: { data: any }) => it?.data && typeof it.data.destination === "string")
          .map((it: { data: any }) => {
            const dest = String(it.data.destination);
            const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(dest);
            return { id: int(rng("umbrella:destid:" + dest), 1000000000, 9999999999), destination: dest, type: isIp ? "ipv4" : "domain", comment: it.data.comment ?? "" };
          });
        return { status: 200, body: { status: { code: 200, text: "OK" }, data } };
      },
    },
    {
      method: "GET",
      path: "/investigate/v2/domains/categorization/{domain}",
      operation: "getDomainCategorization",
      summary: "Investigate categorization for a domain - status (-1 malicious / 0 unclassified / 1 benign) plus category labels.",
      aiTool: true,
      request: { domain: "internetbadguys.com" },
      params: [
        { name: "domain", in: "path", type: "string", required: true, description: "Domain to look up categorization for. Response status is -1 (malicious), 0 (unclassified), or 1 (benign).", format: "domain name", example: "internetbadguys.com" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const domain = ctx.params.domain;
        const r = rng("umbrella:cat:" + domain);
        const roll = r();
        let status: number;
        let security_categories: string[] = [];
        let content_categories: string[] = [];
        if (roll < 0.3) {
          status = -1;
          security_categories = sample(r, SECURITY_LABELS, int(r, 1, 2));
        } else if (roll < 0.5) {
          status = 0;
        } else {
          status = 1;
          content_categories = sample(r, CONTENT_LABELS, int(r, 1, 3));
        }
        return { status: 200, body: { status, security_categories, content_categories } };
      },
    },
    {
      method: "GET",
      path: "/investigate/v2/security/name/{domain}",
      operation: "getDomainSecurityInfo",
      summary: "Investigate security feature set for a domain (DGA/perplexity/entropy, SecureRank2, ASN/prefix/RIP scores, popularity, geoscore).",
      aiTool: true,
      request: { domain: "internetbadguys.com" },
      params: [
        { name: "domain", in: "path", type: "string", required: true, description: "Domain to retrieve the Investigate security feature set for.", format: "domain name", example: "internetbadguys.com" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const domain = ctx.params.domain;
        const r = rng("umbrella:sec:" + domain);
        const malicious = chance(r, 0.4);
        const f4 = () => +r().toFixed(4);
        return {
          status: 200,
          body: {
            dga_score: malicious ? -+(r() * 80).toFixed(4) : +(r() * 5).toFixed(4),
            perplexity: f4(),
            entropy: +(r() * 4).toFixed(4),
            securerank2: malicious ? -int(r, 20, 100) : int(r, 0, 100),
            pagerank: +(r() * 10).toFixed(4),
            asn_score: -f4(),
            prefix_score: -f4(),
            rip_score: -f4(),
            popularity: +(r() * 100).toFixed(4),
            geoscore: f4(),
            attack: malicious ? pick(r, ["Trojan", "Phishing", "Ransomware", ""]) : "",
            threat_type: malicious ? pick(r, THREAT_TYPES) : "",
            found: true,
          },
        };
      },
    },
    {
      method: "GET",
      path: "/investigate/v2/domains/risk-score/{domain}",
      operation: "getDomainRiskScore",
      summary: "Investigate risk score (0-100) for a domain, with the contributing indicators.",
      aiTool: true,
      request: { domain: "internetbadguys.com" },
      params: [
        { name: "domain", in: "path", type: "string", required: true, description: "Domain to score. Returns a risk_score of 0-100 with contributing indicators.", format: "domain name", example: "internetbadguys.com" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const domain = ctx.params.domain;
        const risk_score = int(rng("umbrella:risk:" + domain), 0, 100);
        const indicators = RISK_INDICATORS.map((indicator) => {
          const score = int(rng("umbrella:ind:" + domain + ":" + indicator), 0, 100);
          return { indicator, score, normalized_score: +(score / 100).toFixed(2) };
        });
        return { status: 200, body: { risk_score, indicators } };
      },
    },
  ],
  events: [
    {
      type: "destination.added",
      summary: "A destination was added to an enforcement list.",
      persist: { collection: "destinations", idOf: (d) => String(d.destination) },
      sample: () => ({ destination: "malicious-example.io", comment: "IOC", listId: GLOBAL_BLOCK_ID, addedAt: nowIso() }),
    },
  ],
};
