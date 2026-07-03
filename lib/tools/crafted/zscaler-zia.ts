import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, fakeSha1, fakeSha256, nowIso, daysAgoIso, unixNow } from "../helpers";
import { dbAvailable } from "../../db";
import { listResources, putResource, ensureSeeded } from "../../engine/store";

// Zscaler Internet Access (ZIA) admin API. Auth is a proprietary session: an
// obfuscated apiKey plus admin username/password are POSTed to
// /authenticatedSession, which returns a JSESSIONID cookie carried on every
// subsequent call (there is no clean cookie AuthType, so this is modelled as an
// api_key_header on "cookie"). ZIA object ids are plain integers and list
// endpoints return BARE JSON ARRAYS (no envelope). URL lookups and sandbox
// verdicts are seeded from the input so the same URL / hash is stable across
// calls. The org URL denylist (blacklist) is stateful: URLs added via
// /security/advanced/blacklistUrls persist and reappear on /security/advanced.

const HEXU = "0123456789ABCDEF";
/** Deterministic uppercase-hex JSESSIONID-shaped token from a seed. */
function sessionId(seed: string): string {
  const r = rng("zia:sess:" + seed);
  let s = "";
  for (let i = 0; i < 32; i++) s += HEXU[Math.floor(r() * 16)];
  return s;
}

const URL_CATEGORIES = [
  "PROFESSIONAL_SERVICES", "WEB_SEARCH", "SOCIAL_NETWORKING", "NEWS_AND_MEDIA",
  "STREAMING_MEDIA", "WEB_HOSTING", "INTERNET_SERVICES", "CORPORATE_MARKETING",
  "FINANCE", "SHAREWARE_AND_FREEWARE", "MISCELLANEOUS_OR_UNKNOWN",
] as const;
const SECURITY_CATEGORIES = ["MALWARE_SITE", "PHISHING", "SPYWARE_OR_ADWARE", "BOTNET", "CRYPTOMINING", "OTHER_SECURITY"] as const;
const APPLICATIONS = ["GOOGLE_GEN", "OFFICE365", "DROPBOX", "SALESFORCE", "GITHUB", "SLACK", "YOUTUBE"] as const;
const USER_AGENT_TYPES = ["CHROME", "FIREFOX", "MSEDGE", "SAFARI", "MSIE", "OTHER"] as const;
const REQUEST_METHODS = ["CONNECT", "GET", "POST", "PUT", "DELETE", "HEAD"] as const;
const NW_SERVICES: readonly [number, string][] = [
  [774003, "HTTP"], [774004, "HTTPS"], [774006, "DNS"], [774008, "FTP"], [774010, "SSH"], [774012, "SMTP"],
];
const LOCATIONS: readonly [number, string][] = [
  [61234001, "HQ - San Jose"], [61234002, "London Branch"], [61234003, "Frankfurt DC"], [61234004, "Remote Users"],
];
const GROUPS: readonly [number, string][] = [
  [88001, "Engineering"], [88002, "Sales"], [88003, "Finance"], [88004, "Executives"], [88005, "Contractors"],
];
const DEPARTMENTS: readonly [number, string][] = [
  [90001, "IT"], [90002, "Sales & Marketing"], [90003, "Finance"], [90004, "Human Resources"], [90005, "Operations"],
];
const FIRST = ["Adam", "Beth", "Carlos", "Dana", "Ethan", "Fatima", "Grace", "Hiro", "Ivy", "Jamal", "Kira", "Liam"] as const;
const LAST = ["Chen", "Kumar", "Silva", "Novak", "Okafor", "Rossi", "Haddad", "Yang", "Muller", "Ferreira", "Kowalski", "Nguyen"] as const;
const COUNTRY_CODES = ["US", "GB", "DE", "NL", "FR", "IN", "BR", "SG", "CN", "RU"] as const;

const MALWARE_URL_RE = /malware|phish|trojan|ransom|botnet|c2|exploit|keygen|crack|warez|badsite|evil|hack|\.tk\b|\.top\b/i;

/** Deterministic URL Lookup verdict for a single URL. */
function urlLookup(url: string) {
  const r = rng("zia:lookup:" + url);
  const malicious = MALWARE_URL_RE.test(url) || chance(r, 0.1);
  const item: Record<string, any> = {
    url,
    urlClassifications: [pick(r, URL_CATEGORIES)],
    urlClassificationsWithSecurityAlert: malicious ? [pick(r, SECURITY_CATEGORIES)] : [],
  };
  if (chance(r, 0.6)) item.application = pick(r, APPLICATIONS);
  return item;
}

/** Deterministic Cloud Sandbox report for an MD5 hash. */
function sandboxReport(md5: string) {
  const r = rng("zia:sandbox:" + md5);
  const malicious = chance(r, 0.5);
  const fileSize = int(r, 24_000, 4_500_000);
  const started = unixNow() - int(r, 3600, 864_000);
  const cat = malicious ? pick(r, ["MALWARE", "ADWARE_OR_SPYWARE", "ANONYMIZER"] as const) : "BENIGN";
  return {
    "Full Details": {
      Summary: {
        Status: "COMPLETED",
        Category: malicious ? "MALWARE" : "BENIGN",
        FileType: "exe",
        StartTime: started,
        Duration: int(r, 45_000, 210_000),
        Md5: md5.toUpperCase(),
        Sha1: fakeSha1(md5).toUpperCase(),
        Sha256: fakeSha256(md5).toUpperCase(),
        FileSize: fileSize,
      },
      Classification: {
        Type: malicious ? "MALICIOUS" : "BENIGN",
        Category: cat,
        Score: malicious ? int(r, 70, 100) : int(r, 0, 30),
        DetectedMalware: malicious ? pick(r, ["Win32.Trojan.Emotet", "Win32.Ransom.LockBit", "Win32.Backdoor.Cobalt", "Win32.Spyware.AgentTesla"] as const) : "None",
      },
      FileProperties: {
        FileType: "PE32 executable",
        FileSize: fileSize,
        Md5: md5.toUpperCase(),
        Sha1: fakeSha1(md5).toUpperCase(),
      },
    },
  };
}

/** A URL Filtering policy rule (stable per index). */
function urlFilteringRule(i: number) {
  const r = rng("zia:ufr:" + i);
  const admin = `${pick(r, FIRST).toLowerCase()}.${pick(r, LAST).toLowerCase()}@acme.com`;
  return {
    id: 900001 + i,
    name: pick(r, ["Block Malware Categories", "Block Anonymizers", "Allow Business Apps", "Caution Streaming", "Block Uncategorized", "Block P2P"]),
    order: i + 1,
    rank: 7,
    state: chance(r, 0.85) ? "ENABLED" : "DISABLED",
    action: pick(r, ["BLOCK", "ALLOW", "CAUTION"] as const),
    protocols: ["ANY_RULE"],
    urlCategories: sample(r, [...SECURITY_CATEGORIES, ...URL_CATEGORIES], int(r, 1, 3)),
    requestMethods: sample(r, REQUEST_METHODS, int(r, 2, 4)),
    userAgentTypes: sample(r, USER_AGENT_TYPES, int(r, 1, 3)),
    locations: sample(r, LOCATIONS, int(r, 0, 2)).map(([id, name]) => ({ id, name })),
    groups: sample(r, GROUPS, int(r, 0, 2)).map(([id, name]) => ({ id, name })),
    blockOverride: false,
    lastModifiedTime: unixNow() - int(r, 3600, 5_184_000),
    lastModifiedBy: { id: 111100 + int(r, 1, 40), name: admin },
  };
}

/** A firewall filtering rule (stable per index). */
function firewallRule(i: number) {
  const r = rng("zia:fw:" + i);
  return {
    id: 800001 + i,
    name: pick(r, ["Default Firewall Filtering Rule", "Block Malicious Countries", "Allow DNS", "Block Torrent", "Allow Internal", "Block SSH Outbound"]),
    order: i + 1,
    rank: 7,
    action: pick(r, ["ALLOW", "BLOCK"] as const),
    state: "ENABLED",
    srcIps: chance(r, 0.5) ? [`10.${int(r, 0, 254)}.${int(r, 0, 254)}.0/24`] : [],
    destCountries: sample(r, COUNTRY_CODES, int(r, 0, 3)).map((c) => "COUNTRY_" + c),
    nwServices: sample(r, NW_SERVICES, int(r, 1, 3)).map(([id, name]) => ({ id, name })),
    enableFullLogging: true,
  };
}

/** A report user (stable per index). */
function reportUser(i: number) {
  const r = rng("zia:user:" + i);
  const first = pick(r, FIRST);
  const last = pick(r, LAST);
  const [dId, dName] = pick(r, DEPARTMENTS);
  return {
    id: 700001 + i,
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@acme.com`,
    groups: sample(r, GROUPS, int(r, 1, 2)).map(([id, name]) => ({ id, name })),
    department: { id: dId, name: dName },
    adminUser: false,
    type: "REPORT_USER",
  };
}

// Predefined + custom URL categories returned by GET /urlCategories.
const URL_CATEGORY_LIST = [
  { id: "PROFESSIONAL_SERVICES", superCategory: "BUSINESS_AND_ECONOMY", customCategory: false, type: "URL_CATEGORY" },
  { id: "WEB_SEARCH", superCategory: "INTERNET_COMMUNICATION", customCategory: false, type: "URL_CATEGORY" },
  {
    id: "CUSTOM_01",
    configuredName: "Blocked Partners",
    customCategory: true,
    superCategory: "USER_DEFINED",
    type: "URL_CATEGORY",
    urls: ["competitor.example.com", ".unsanctioned-saas.io"],
    dbCategorizedUrls: [".example.edu"],
    keywords: ["confidential", "insider"],
    customUrlsCount: 2,
    urlKeywordCounts: { totalUrlCount: 2, retainParentUrlCount: 0, totalKeywordCount: 2, retainParentKeywordCount: 0 },
    editable: true,
  },
];

// Seed URLs used to populate the stateful denylist on first read.
const SEED_BLACKLIST = ["malware-c2.example.io", "phishing-login.example.net", "known-bad.example.ru"] as const;

export const zscalerZia: ToolDef = {
  id: "zscaler-zia",
  name: "Zscaler Internet Access (ZIA)",
  vendor: "Zscaler",
  category: "network",
  crafted: true,
  aiTool: true,
  summary:
    "Zscaler Internet Access (ZIA) secure web gateway admin API - URL categories & filtering rules, URL/reputation lookup, Cloud Sandbox verdicts, firewall rules, the org allow/deny lists, and staged-config activation. List endpoints return bare JSON arrays and object ids are plain integers.",
  tags: ["network", "secure-web-gateway", "proxy", "url-filtering", "cloud-sandbox", "zscaler"],
  auth: { type: "api_key_header", param: "cookie" },
  docsUrl: "https://help.zscaler.com/zia",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/authenticatedSession",
      operation: "authenticate",
      summary:
        "Establish an admin session. Send the obfuscated apiKey (timestamp-scrambled) with the admin username/password; ZIA returns a JSESSIONID cookie (Set-Cookie) that must be sent on every subsequent request.",
      request: { apiKey: "<obfuscated-api-key>", username: "admin@acme.com", password: "<password>", timestamp: "<epoch-millis>" },
      params: [
        { name: "apiKey", in: "body", type: "string", required: true, description: "Obfuscated (timestamp-scrambled) API key.", example: "<obfuscated-api-key>" },
        { name: "username", in: "body", type: "string", required: true, description: "Admin login username (email).", format: "email", example: "admin@acme.com" },
        { name: "password", in: "body", type: "string", required: true, description: "Admin password." },
        { name: "timestamp", in: "body", type: "string", required: true, description: "Epoch milliseconds used to obfuscate the apiKey.", format: "epoch milliseconds", example: "1710000000000" },
      ],
      respond: (ctx: MockContext): MockResult => ({
        status: 200,
        body: { authType: "ADMIN_LOGIN", obfuscateApiKey: false, passwordExpiryTime: 0, passwordExpiryDays: 0 },
        headers: { "Set-Cookie": "JSESSIONID=" + sessionId((ctx.body?.username || "admin") + unixNow()) + "; Path=/; HttpOnly" },
      }),
    },
    {
      method: "GET",
      path: "/urlCategories",
      operation: "listUrlCategories",
      summary: "List all URL categories - predefined categories plus custom (USER_DEFINED) ones. Returns a bare array.",
      request: { customOnly: "false" },
      params: [
        { name: "customOnly", in: "query", type: "boolean", required: false, description: "If true, return only custom (USER_DEFINED) categories; otherwise return predefined + custom.", enum: ["true", "false"], default: "false" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const list = ctx.query.customOnly === "true" ? URL_CATEGORY_LIST.filter((c) => (c as any).customCategory) : URL_CATEGORY_LIST;
        return { status: 200, body: list };
      },
    },
    {
      method: "POST",
      path: "/urlCategories",
      operation: "createUrlCategory",
      summary: "Create a custom URL category (superCategory USER_DEFINED). Returns the created category with a generated CUSTOM_0N id.",
      emits: "urlCategory.created",
      request: { configuredName: "Blocked Sites", superCategory: "USER_DEFINED", urls: ["bad.example.com"], keywords: ["exfil"] },
      params: [
        { name: "configuredName", in: "body", type: "string", required: true, description: "Display name of the custom URL category.", example: "Blocked Sites" },
        { name: "superCategory", in: "body", type: "string", required: false, description: "Super category for a custom (user-defined) URL category.", enum: ["USER_DEFINED"], default: "USER_DEFINED" },
        { name: "urls[]", in: "body", type: "string", required: false, description: "Custom URLs/domains to include in the category.", format: "url or domain name", example: "bad.example.com" },
        { name: "dbCategorizedUrls[]", in: "body", type: "string", required: false, description: "URLs retained from their Zscaler-categorized parent category.", format: "url or domain name", example: ".example.edu" },
        { name: "keywords[]", in: "body", type: "string", required: false, description: "Keywords that classify a page into this category.", example: "exfil" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const body = ctx.body || {};
        const r = rng("zia:cat:new:" + (body.configuredName || "") + unixNow());
        const urls: string[] = body.urls || [];
        const dbUrls: string[] = body.dbCategorizedUrls || [];
        const keywords: string[] = body.keywords || [];
        return {
          status: 200,
          body: {
            id: "CUSTOM_0" + int(r, 2, 9),
            configuredName: body.configuredName || "New Custom Category",
            customCategory: true,
            superCategory: body.superCategory || "USER_DEFINED",
            type: "URL_CATEGORY",
            urls,
            dbCategorizedUrls: dbUrls,
            keywords,
            customUrlsCount: urls.length,
            urlKeywordCounts: {
              totalUrlCount: urls.length,
              retainParentUrlCount: 0,
              totalKeywordCount: keywords.length,
              retainParentKeywordCount: 0,
            },
            editable: true,
          },
        };
      },
    },
    {
      method: "POST",
      path: "/urlLookup",
      operation: "urlLookup",
      summary: "Look up the category and security classification of up to 100 URLs. Body is a raw JSON array of URL strings; response is a bare array of results.",
      aiTool: true,
      request: ["www.google.com", "malware-c2.example.io", "www.wikipedia.org"],
      params: [
        { name: "[]", in: "body", type: "string", required: true, description: "URL to look up (up to 100 per request). Body is a bare JSON array of URL strings.", format: "url", example: "www.google.com" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const urls: string[] = Array.isArray(ctx.body) ? ctx.body.slice(0, 100) : [];
        return { status: 200, body: urls.map(urlLookup) };
      },
    },
    {
      method: "GET",
      path: "/urlFilteringRules",
      operation: "listUrlFilteringRules",
      summary: "List URL filtering policy rules (BLOCK/ALLOW/CAUTION by category, location, group). Returns a bare array.",
      aiTool: true,
      params: [],
      respond: (): MockResult => ({ status: 200, body: Array.from({ length: 6 }, (_, i) => urlFilteringRule(i)) }),
    },
    {
      method: "POST",
      path: "/urlFilteringRules",
      operation: "createUrlFilteringRule",
      summary: "Create a URL filtering rule. Returns the created rule with a generated integer id.",
      emits: "urlFilteringRule.created",
      request: { name: "Block Malware Categories", order: 1, action: "BLOCK", state: "ENABLED", protocols: ["ANY_RULE"], urlCategories: ["MALWARE_SITE", "PHISHING"] },
      params: [
        { name: "name", in: "body", type: "string", required: true, description: "Rule name.", example: "Block Malware Categories" },
        { name: "order", in: "body", type: "integer", required: false, description: "Rule evaluation order.", default: 1 },
        { name: "rank", in: "body", type: "integer", required: false, description: "Admin rank of the rule.", default: 7 },
        { name: "action", in: "body", type: "string", required: false, description: "Action applied to matching web traffic.", enum: ["BLOCK", "ALLOW", "CAUTION"], default: "BLOCK" },
        { name: "state", in: "body", type: "string", required: false, description: "Whether the rule is enabled.", enum: ["ENABLED", "DISABLED"], default: "ENABLED" },
        { name: "protocols[]", in: "body", type: "string", required: false, description: "Protocols the rule applies to.", enum: ["ANY_RULE"], example: "ANY_RULE" },
        { name: "urlCategories[]", in: "body", type: "string", required: false, description: "URL / security category ids to match.", enum: ["MALWARE_SITE", "PHISHING", "SPYWARE_OR_ADWARE", "BOTNET", "CRYPTOMINING", "OTHER_SECURITY", "PROFESSIONAL_SERVICES", "WEB_SEARCH", "SOCIAL_NETWORKING", "NEWS_AND_MEDIA", "STREAMING_MEDIA", "WEB_HOSTING", "INTERNET_SERVICES", "CORPORATE_MARKETING", "FINANCE", "SHAREWARE_AND_FREEWARE", "MISCELLANEOUS_OR_UNKNOWN"] },
        { name: "requestMethods[]", in: "body", type: "string", required: false, description: "HTTP request methods to match.", enum: ["CONNECT", "GET", "POST", "PUT", "DELETE", "HEAD"], example: "GET" },
        { name: "userAgentTypes[]", in: "body", type: "string", required: false, description: "User-agent types to match.", enum: ["CHROME", "FIREFOX", "MSEDGE", "SAFARI", "MSIE", "OTHER"], example: "CHROME" },
        { name: "locations[]", in: "body", type: "object", required: false, description: "Locations the rule applies to ({ id, name })." },
        { name: "locations[].id", in: "body", type: "integer", required: false, description: "Location id.", example: 61234001 },
        { name: "groups[]", in: "body", type: "object", required: false, description: "User groups the rule applies to ({ id, name })." },
        { name: "groups[].id", in: "body", type: "integer", required: false, description: "Group id.", example: 88001 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const body = ctx.body || {};
        const r = rng("zia:ufr:new:" + (body.name || "") + unixNow());
        return {
          status: 200,
          body: {
            id: int(r, 900100, 999999),
            name: body.name || "New URL Filtering Rule",
            order: body.order ?? 1,
            rank: body.rank ?? 7,
            state: body.state || "ENABLED",
            action: body.action || "BLOCK",
            protocols: body.protocols || ["ANY_RULE"],
            urlCategories: body.urlCategories || [],
            requestMethods: body.requestMethods || ["CONNECT", "GET", "POST"],
            userAgentTypes: body.userAgentTypes || [],
            locations: body.locations || [],
            groups: body.groups || [],
            blockOverride: false,
            lastModifiedTime: unixNow(),
            lastModifiedBy: { id: 111101, name: "admin@acme.com" },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/sandbox/report/{md5Hash}",
      operation: "getSandboxReport",
      summary: "Get the Cloud Sandbox behavioral analysis report (Full Details) for a file by MD5 hash. Verdict is deterministic per hash.",
      aiTool: true,
      request: { md5Hash: "a94a8fe5ccb19ba61c4c0873d391e987" },
      params: [
        { name: "md5Hash", in: "path", type: "string", required: true, description: "MD5 hash of the file to fetch the Cloud Sandbox report for.", format: "md5", example: "a94a8fe5ccb19ba61c4c0873d391e987" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: sandboxReport(ctx.params.md5Hash) }),
    },
    {
      method: "GET",
      path: "/security",
      operation: "getWhitelist",
      summary: "Get the organization URL allowlist (whitelist). Returns { whitelistUrls: [...] }.",
      params: [],
      respond: (): MockResult => ({
        status: 200,
        body: { whitelistUrls: ["acme.com", "partner-portal.example.com", "cdn.trusted.example.net", "docs.zscaler.com"] },
      }),
    },
    {
      method: "GET",
      path: "/security/advanced",
      operation: "getBlacklist",
      summary: "Get the organization URL denylist (blacklist). Stateful - reflects URLs added via /security/advanced/blacklistUrls. Returns { blacklistUrls: [...] }.",
      aiTool: true,
      params: [],
      respond: async (): Promise<MockResult> => {
        if (!dbAvailable()) {
          return { status: 200, body: { blacklistUrls: [...SEED_BLACKLIST], note: "database offline - synthetic, not persisted" } };
        }
        let seedIdx = 0;
        await ensureSeeded("zscaler-zia", "blacklist", SEED_BLACKLIST.length, () => {
          const url = SEED_BLACKLIST[seedIdx++ % SEED_BLACKLIST.length];
          return { id: url, data: { url, addedAt: daysAgoIso(int(rng("zia:bl:" + url), 1, 90)) } };
        });
        const { items } = await listResources("zscaler-zia", "blacklist", { limit: 200 });
        return { status: 200, body: { blacklistUrls: items.map((it) => it.data.url) } };
      },
    },
    {
      method: "POST",
      path: "/security/advanced/blacklistUrls",
      operation: "updateBlacklist",
      summary: "Add URLs to the organization denylist (query action=ADD_TO_LIST). Stateful - added URLs persist and reappear on GET /security/advanced.",
      aiTool: true,
      // Persist happens directly (putResource) below; emit a non-persist activity
      // event (the persist-mapped `blacklist.updated` is reserved for generators).
      emits: "blacklist.changed",
      request: { blacklistUrls: ["malware-example.io", "phish.example.net"] },
      params: [
        { name: "action", in: "query", type: "string", required: false, description: "Whether to add the URLs to or remove them from the denylist.", enum: ["ADD_TO_LIST", "REMOVE_FROM_LIST"], default: "ADD_TO_LIST" },
        { name: "blacklistUrls[]", in: "body", type: "string", required: true, description: "URLs/domains to add to (or remove from) the org denylist.", format: "url or domain name", example: "malware-example.io" },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const urls: string[] = ctx.body?.blacklistUrls || [];
        const addedAt = nowIso();
        for (const url of urls) await putResource("zscaler-zia", "blacklist", String(url), { url, addedAt });
        return { status: 204, body: null };
      },
    },
    {
      method: "GET",
      path: "/users",
      operation: "listUsers",
      summary: "List end users known to ZIA (for policy and reporting). Returns a bare array.",
      aiTool: true,
      request: { pageSize: "10" },
      params: [
        { name: "pageSize", in: "query", type: "integer", required: false, description: "Number of users to return (capped at 100).", default: 10, example: 10 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = Math.min(Number(ctx.query.pageSize) || 10, 100);
        return { status: 200, body: Array.from({ length: n }, (_, i) => reportUser(i)) };
      },
    },
    {
      method: "GET",
      path: "/firewallFilteringRules",
      operation: "listFirewallFilteringRules",
      summary: "List cloud firewall filtering rules (ALLOW/BLOCK by source, destination country, network service). Returns a bare array.",
      params: [],
      respond: (): MockResult => ({ status: 200, body: Array.from({ length: 5 }, (_, i) => firewallRule(i)) }),
    },
    {
      method: "GET",
      path: "/status",
      operation: "getActivationStatus",
      summary: "Get the current admin-session activation status of staged configuration changes.",
      params: [],
      respond: (): MockResult => ({ status: 200, body: { status: pick(rng("zia:status:" + unixNow()), ["ACTIVE", "PENDING", "INPROGRESS"] as const) } }),
    },
    {
      method: "POST",
      path: "/status/activate",
      operation: "activate",
      summary: "Activate (commit) staged configuration changes so they take effect across the ZIA cloud.",
      emits: "config.activated",
      params: [],
      respond: (): MockResult => ({ status: 200, body: { status: "ACTIVE" } }),
    },
  ],
  events: [
    {
      type: "blacklist.updated",
      summary: "URLs were added to the ZIA denylist.",
      persist: { collection: "blacklist", idOf: (d) => String(d.url) },
      sample: () => ({ url: "malware-example.io", addedAt: nowIso() }),
    },
    {
      type: "urlCategory.created",
      summary: "A custom URL category was created.",
      sample: () => ({ id: "CUSTOM_02", configuredName: "Blocked Sites", customCategory: true, superCategory: "USER_DEFINED", type: "URL_CATEGORY" }),
    },
    {
      type: "urlFilteringRule.created",
      summary: "A URL filtering rule was created.",
      sample: () => urlFilteringRule(0),
    },
    {
      type: "config.activated",
      summary: "Staged ZIA configuration changes were activated.",
      sample: () => ({ status: "ACTIVE", activatedAt: nowIso() }),
    },
  ],
};
