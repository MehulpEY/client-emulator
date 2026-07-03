import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, USERS, minutesAgoIso, daysAgoIso, nowIso, uuid, type RNG } from "../helpers";

// Zscaler RBA (Risk-Based Access). This surface maps to Zscaler Risk360 org /
// entity risk analytics plus ZIA dynamic user risk, reconstructed as a
// OneAPI-style REST API. Auth is OneAPI OAuth2 client-credentials against a
// zslogin.net token endpoint, exchanged for a Bearer JWT used on api.zsapi.net.
// Every score/entity/factor lookup is seeded from its input so the same org,
// entity type, factor list, or ZIA user id returns a stable answer across calls.

const API = "https://api.zsapi.net";
const ORG_ID = "org_8f4c21a9";

/** Attack-stage categories used throughout Risk360. */
const CATEGORY_KEYS = ["EXTERNAL_ATTACK_SURFACE", "COMPROMISE", "LATERAL_PROPAGATION", "DATA_LOSS"] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** Risk360 severity band from a 0-100 score (100 = critical). */
function sevBand(score: number): string {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

/** ZIA dynamic user risk uses three levels only. */
function ziaLevel(score: number): string {
  if (score >= 67) return "HIGH";
  if (score >= 34) return "MEDIUM";
  return "LOW";
}

/** Deterministic lowercase hex fragment (for entity/app/report ids). */
function hid(r: RNG, len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(r() * 16).toString(16);
  return s;
}

const ENTITY_TOTALS: Record<string, number> = { workforce: 1240, thirdParty: 87, applications: 342, assets: 5610 };
const ENTITY_PREFIX: Record<string, string> = { workforce: "usr_", thirdParty: "tp_", applications: "app_", assets: "ast_" };

const THIRD_PARTIES = ["Acme Logistics Inc", "Globex Consulting", "Initech Payroll", "Umbrella Health", "Stark Supply Co", "Wayne Data Services", "Soylent Foods", "Hooli Cloud"] as const;

/** SaaS / private apps: [name, appType, category]. */
const APPS: readonly [string, "SAAS" | "PRIVATE", string][] = [
  ["Dropbox", "SAAS", "Cloud Storage"],
  ["Slack", "SAAS", "Collaboration"],
  ["Salesforce", "SAAS", "CRM"],
  ["Microsoft 365", "SAAS", "Productivity"],
  ["GitHub", "SAAS", "Developer Tools"],
  ["ChatGPT", "SAAS", "Generative AI"],
  ["Zoom", "SAAS", "Collaboration"],
  ["Box", "SAAS", "Cloud Storage"],
  ["Workday", "SAAS", "HR"],
  ["Internal HR Portal", "PRIVATE", "HR"],
  ["Legacy Finance App", "PRIVATE", "Finance"],
  ["Jenkins CI", "PRIVATE", "Developer Tools"],
];

const FACTOR_PREFIX: Record<CategoryKey, string> = {
  EXTERNAL_ATTACK_SURFACE: "EAS",
  COMPROMISE: "CMP",
  LATERAL_PROPAGATION: "LP",
  DATA_LOSS: "DL",
};
const FACTOR_NAMES: Record<CategoryKey, readonly string[]> = {
  EXTERNAL_ATTACK_SURFACE: ["Expired TLS certificate on public host", "Exposed RDP port to internet", "Vulnerable VPN gateway (CVE-2024-3400)", "Unpatched public web server", "Shadow IT SaaS exposure"],
  COMPROMISE: ["Credential leak on dark web", "Malware beacon detected", "Confirmed phishing victim", "Impossible-travel sign-in", "MFA fatigue attack observed"],
  LATERAL_PROPAGATION: ["Excessive east-west connectivity", "Over-privileged service account", "Flat network segment", "Reused local-admin password", "Unrestricted SMB share"],
  DATA_LOSS: ["Unsanctioned cloud storage upload", "Sensitive data in public bucket", "Missing DLP policy on egress", "Large transfer to personal email", "Unencrypted PII at rest"],
};
const FACTOR_ACTIONS: Record<CategoryKey, string> = {
  EXTERNAL_ATTACK_SURFACE: "Patch or decommission the exposed asset and restrict inbound access",
  COMPROMISE: "Isolate the endpoint and force a credential reset",
  LATERAL_PROPAGATION: "Apply microsegmentation and remove standing privileges",
  DATA_LOSS: "Enable DLP inspection and block the egress destination",
};
const POLICY_REF: Record<CategoryKey, string> = {
  EXTERNAL_ATTACK_SURFACE: "ZIA-FW-INBOUND",
  COMPROMISE: "ZIA-URL-FILTERING",
  LATERAL_PROPAGATION: "ZPA-ACCESS-POLICY",
  DATA_LOSS: "ZIA-DLP-EGRESS",
};
const EVENT_DESC: Record<CategoryKey, string> = {
  EXTERNAL_ATTACK_SURFACE: "Internet-exposed asset with an exploitable vulnerability detected",
  COMPROMISE: "Endpoint exhibited command-and-control beaconing behavior",
  LATERAL_PROPAGATION: "Anomalous east-west movement toward a crown-jewel asset",
  DATA_LOSS: "Sensitive data exfiltration attempt to an unsanctioned destination",
};

/** Locations with region for risk-event geolocation. */
const LOCATIONS: readonly [string, string][] = [
  ["Moscow", "Europe"], ["Beijing", "Asia"], ["Lagos", "Africa"], ["Sao Paulo", "South America"],
  ["New York", "North America"], ["Mumbai", "Asia"], ["London", "Europe"], ["Kyiv", "Europe"],
];

/** ZIA user-risk indicators: [category, name]. */
const ZIA_INDICATORS: readonly [string, string][] = [
  ["PRE_INFECTION", "Blocked access to malicious URL"],
  ["PRE_INFECTION", "Visited newly registered domain"],
  ["PRE_INFECTION", "Blocked known exploit kit"],
  ["POST_INFECTION", "Botnet callback blocked"],
  ["POST_INFECTION", "Command-and-control traffic detected"],
  ["SUSPICIOUS_BEHAVIOR", "Anomalous data upload volume"],
  ["SUSPICIOUS_BEHAVIOR", "Access via anonymizer/VPN"],
];

function entityRow(entityType: string, i: number) {
  const r = rng("zscaler-rba:entity:" + entityType + ":" + i);
  const riskScore = int(r, 28, 98);
  const topCategory = pick(r, CATEGORY_KEYS);
  const name =
    entityType === "workforce"
      ? `${pick(r, USERS)}@acme.com`
      : entityType === "thirdParty"
      ? pick(r, THIRD_PARTIES)
      : entityType === "applications"
      ? pick(r, APPS)[0]
      : `${pick(r, ["srv", "lt", "ws", "db"])}-${pick(r, ["fin", "hr", "eng", "ops"])}-${int(r, 1, 99)}`;
  return {
    entityId: (ENTITY_PREFIX[entityType] ?? "ent_") + hid(r),
    name,
    riskScore,
    severity: sevBand(riskScore),
    topCategory,
    contributingFactorCount: int(r, 1, 12),
    lastActivity: minutesAgoIso(int(r, 5, 4320)),
  };
}

function factor(i: number) {
  const r = rng("zscaler-rba:factor:" + i);
  const category = pick(r, CATEGORY_KEYS);
  const score = int(r, 20, 98);
  return {
    factorId: `${FACTOR_PREFIX[category]}-${String(int(r, 1, 99)).padStart(3, "0")}`,
    name: pick(r, FACTOR_NAMES[category]),
    category,
    severity: sevBand(score),
    weight: +(r() * 9 + 1).toFixed(1),
    affectedEntities: int(r, 1, 500),
    status: pick(r, ["OPEN", "OPEN", "OPEN", "RESOLVED"]),
    recommendedAction: FACTOR_ACTIONS[category],
    policyReference: POLICY_REF[category],
  };
}

function appRisk(i: number) {
  const [name, appType, category] = APPS[i % APPS.length];
  const r = rng("zscaler-rba:app:" + name);
  const riskScore = int(r, 12, 96);
  const action = riskScore >= 75 ? "BLOCK" : riskScore >= 50 ? "CAUTION" : "ALLOW";
  return { appId: "app_" + hid(r), name, appType, category, riskScore, severity: sevBand(riskScore), action };
}

function riskEvent(i: number) {
  const r = rng("zscaler-rba:event:" + i);
  const category = pick(r, CATEGORY_KEYS);
  const score = int(r, 30, 98);
  const [location] = pick(r, LOCATIONS);
  return {
    eventId: "evt_" + hid(r, 8),
    category,
    severity: sevBand(score),
    entityId: "usr_" + hid(r),
    location,
    timestamp: minutesAgoIso(int(r, 1, 10080)),
    description: EVENT_DESC[category],
  };
}

export const zscalerRba: ToolDef = {
  id: "zscaler-rba",
  name: "Zscaler RBA (Risk360)",
  vendor: "Zscaler",
  category: "monitoring",
  crafted: true,
  aiTool: true,
  summary:
    "Zscaler Risk-Based Access - org and entity risk analytics from Zscaler Risk360 (organization risk score, entity/factor/application risk, financial exposure, risk events, CISO board reports) plus ZIA dynamic user risk, reconstructed as a OneAPI-style surface.",
  tags: ["risk360", "risk-based-access", "risk-analytics", "zia", "oneapi", "zero-trust", "monitoring"],
  auth: { type: "bearer" },
  docsUrl: "https://help.zscaler.com/risk360",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/oauth2/v1/token",
      operation: "getToken",
      summary: "OneAPI OAuth2 client-credentials grant against the zslogin.net token endpoint - exchange client_id/client_secret for a Bearer JWT.",
      request: { grant_type: "client_credentials", client_id: "<client-id>", client_secret: "<client-secret>", audience: "https://api.zscaler.com" },
      params: [
        { name: "grant_type", in: "body", type: "string", required: true, description: "OAuth2 grant type - OneAPI app auth only supports client_credentials.", enum: ["client_credentials"], default: "client_credentials", example: "client_credentials" },
        { name: "client_id", in: "body", type: "string", required: true, description: "OneAPI API client id issued in the Zscaler admin console.", format: "client id", example: "<client-id>" },
        { name: "client_secret", in: "body", type: "string", required: true, description: "Client secret paired with the client_id.", format: "client secret" },
        { name: "audience", in: "body", type: "string", required: true, description: "Target audience for the issued token - the Zscaler API gateway.", format: "audience url", example: "https://api.zscaler.com" },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: {
          access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock." + Buffer.from(uuid()).toString("base64url"),
          token_type: "Bearer",
          expires_in: 7199,
        },
      }),
    },
    {
      method: "GET",
      path: "/risk360/v1/organization/riskScore",
      operation: "getOrganizationRiskScore",
      summary: "Get the overall organization risk score (0-100) with per-category breakdown, peer benchmark, zero-trust journey score, and trend.",
      aiTool: true,
      params: [],
      respond: (): MockResult => {
        const r = rng("zscaler-rba:org:riskScore");
        const categories = CATEGORY_KEYS.map((key) => {
          const score = int(r, 22, 78);
          return { key, score, severity: sevBand(score) };
        });
        const trend = Array.from({ length: 12 }, (_, i) => ({
          date: daysAgoIso((11 - i) * 30).slice(0, 10),
          score: int(r, 38, 58),
        }));
        return {
          status: 200,
          body: {
            orgId: ORG_ID,
            overallRiskScore: 46,
            severity: "MEDIUM",
            scoreScale: "0-100",
            asOf: nowIso(),
            categories,
            peerRiskScore: 53,
            zeroTrustJourneyScore: 61,
            trend,
          },
        };
      },
    },
    {
      method: "GET",
      path: "/risk360/v1/entities/{entityType}/riskScores",
      operation: "getEntityRiskScores",
      summary: "List risk scores for entities of a given type (workforce | thirdParty | applications | assets), sorted by risk descending.",
      aiTool: true,
      request: { entityType: "workforce", page: "1", pageSize: "50" },
      params: [
        { name: "entityType", in: "path", type: "string", required: true, description: "Class of entity to score.", enum: ["workforce", "thirdParty", "applications", "assets"], example: "workforce" },
        { name: "page", in: "query", type: "integer", description: "1-based page number for pagination.", default: 1, example: 1 },
        { name: "pageSize", in: "query", type: "integer", description: "Number of entities to return per page.", default: 50, example: 50 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const entityType = ctx.params.entityType;
        const items = Array.from({ length: 20 }, (_, i) => entityRow(entityType, i)).sort((a, b) => b.riskScore - a.riskScore);
        const totalContributingFactors = items.reduce((s, it) => s + it.contributingFactorCount, 0);
        return {
          status: 200,
          body: {
            entityType,
            totalEntities: ENTITY_TOTALS[entityType] ?? 100,
            totalContributingFactors,
            page: 1,
            pageSize: 50,
            items,
          },
        };
      },
    },
    {
      method: "GET",
      path: "/risk360/v1/factors",
      operation: "listRiskFactors",
      summary: "List contributing risk factors across all attack-stage categories with severity, weight, affected entities, and recommended remediation.",
      aiTool: true,
      params: [],
      respond: (): MockResult => ({
        status: 200,
        body: { totalFactors: 100, items: Array.from({ length: 25 }, (_, i) => factor(i)) },
      }),
    },
    {
      method: "GET",
      path: "/risk360/v1/applications/riskScores",
      operation: "getApplicationRiskScores",
      summary: "List discovered SaaS and private applications with their risk score and enforced access action (ALLOW | CAUTION | BLOCK).",
      aiTool: true,
      params: [],
      respond: (): MockResult => {
        const items = Array.from({ length: APPS.length }, (_, i) => appRisk(i)).sort((a, b) => b.riskScore - a.riskScore);
        return { status: 200, body: { totalApplications: 342, items } };
      },
    },
    {
      method: "GET",
      path: "/risk360/v1/financialRisk",
      operation: "getFinancialRisk",
      summary: "Get the estimated annual loss exposure (in USD) with a confidence interval and a breakdown by attack-stage category.",
      params: [],
      respond: (): MockResult => {
        const r = rng("zscaler-rba:financialRisk");
        const breakdownByCategory = CATEGORY_KEYS.map((key) => ({ key, estimatedLoss: int(r, 300_000, 4_000_000) }));
        const estimatedAnnualLossExposure = breakdownByCategory.reduce((s, b) => s + b.estimatedLoss, 0);
        return {
          status: 200,
          body: {
            orgId: ORG_ID,
            currency: "USD",
            estimatedAnnualLossExposure,
            confidenceInterval: { low: Math.round(estimatedAnnualLossExposure * 0.82), high: Math.round(estimatedAnnualLossExposure * 1.24) },
            breakdownByCategory,
          },
        };
      },
    },
    {
      method: "GET",
      path: "/risk360/v1/riskEvents",
      operation: "listRiskEvents",
      summary: "List recent risk events with the top risky locations contributing to organizational risk.",
      aiTool: true,
      params: [],
      respond: (): MockResult => {
        const r = rng("zscaler-rba:riskEvents:locations");
        const events = Array.from({ length: 20 }, (_, i) => riskEvent(i)).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
        const locs = [...LOCATIONS].sort(() => r() - 0.5).slice(0, 4);
        let remaining = 100;
        const topRiskyLocations = locs.map(([location, region], i) => {
          const percent = i === locs.length - 1 ? remaining : int(r, 8, Math.max(9, Math.floor(remaining / 2)));
          remaining -= percent;
          return { location, region, percent };
        });
        return { status: 200, body: { totalEvents: 4187, topRiskyLocations, events } };
      },
    },
    {
      method: "GET",
      path: "/risk360/v1/reports/ciso-board",
      operation: "generateCisoBoardReport",
      summary: "Generate a CISO board-ready risk report (PDF) and return a time-limited download URL.",
      params: [],
      respond: (): MockResult => {
        const r = rng("zscaler-rba:report:" + uuid());
        const reportId = "rpt_" + hid(r, 10);
        return {
          status: 200,
          body: {
            reportId,
            format: "PDF",
            generatedAt: nowIso(),
            downloadUrl: `${API}/risk360/v1/reports/${reportId}/download`,
            expiresAt: daysAgoIso(-7),
          },
        };
      },
    },
    {
      method: "GET",
      path: "/zia/api/v1/users/{userId}/riskScore",
      operation: "getZiaUserRiskScore",
      summary: "Get ZIA dynamic user risk for a user - baseline vs. real-time score, risk level, pre/post-infection and suspicious-behavior indicators, and enforced controls.",
      aiTool: true,
      request: { userId: "12058291" },
      params: [
        { name: "userId", in: "path", type: "string", required: true, description: "ZIA internal user id whose dynamic risk score to fetch.", format: "user id", example: "12058291" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const userId = ctx.params.userId;
        const r = rng("zscaler-rba:zia:user:" + userId);
        const baselineScore = int(r, 0, 70);
        const realTimeScore = Math.min(100, baselineScore + int(r, 0, 40));
        const riskScore = Math.max(baselineScore, realTimeScore);
        const indicators = [...ZIA_INDICATORS]
          .sort(() => r() - 0.5)
          .slice(0, int(r, 2, 4))
          .map(([category, name]) => ({ category, name, count: int(r, 1, 40) }));
        return {
          status: 200,
          body: {
            userId,
            email: `${pick(r, USERS)}@acme.com`,
            riskScore,
            riskLevel: ziaLevel(riskScore),
            baselineScore,
            realTimeScore,
            lastBaselineUpdate: daysAgoIso(int(r, 1, 7)),
            lastRealTimeUpdate: minutesAgoIso(int(r, 1, 120)),
            indicators,
            enforcedControls: ["URL_FILTERING", "FIREWALL", "DLP", "BROWSER_ISOLATION", "ZPA_ACCESS"],
          },
        };
      },
    },
  ],
  events: [
    {
      type: "riskScore.changed",
      summary: "An entity's risk score changed.",
      sample: () => ({ entityId: "usr_9f2a71", name: "j.rivera@acme.com", riskScore: 88, severity: "CRITICAL", topCategory: "COMPROMISE" }),
    },
  ],
};
