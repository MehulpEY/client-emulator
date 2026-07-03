import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, fakeIp, unixNow, uuid, type RNG } from "../helpers";

// Zscaler Private Access (ZPA) Config API. Auth is OAuth2 client-credentials:
// POST form-encoded client_id/client_secret to /signin at the host root, which
// returns a short-lived Bearer token used on the mgmtconfig endpoints. Responses
// reproduce ZPA's real shapes: 18-digit snowflake-style numeric *string* ids,
// epoch-second timestamps as strings, and the { totalPages, totalCount, list }
// envelope on every collection. Lookups are seeded from the input so the same
// application / connector id returns a stable object across calls.

/** Deterministic 18-digit numeric (snowflake-style) id string from a seed. */
function zid(seed: string): string {
  const r = rng("zpa:id:" + seed);
  let s = String(int(r, 1, 9)); // leading digit is non-zero
  for (let i = 0; i < 17; i++) s += String(int(r, 0, 9));
  return s;
}

/** Deterministic GUID-shaped id from a seed (8-4-4-4-12 hex). */
function guid(seed: string): string {
  const r = rng("zpa:guid:" + seed);
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${h(8)}-${h(4)}-${h(4)}-${h(4)}-${h(12)}`;
}

/** Epoch-seconds timestamp (as a string) between min/max days ago. */
function epochAgo(r: RNG, minDays: number, maxDays: number): string {
  return String(unixNow() - int(r, minDays * 86400, maxDays * 86400));
}

/** ZPA collection envelope. */
const wrap = (list: any[]) => ({ totalPages: "1", totalCount: String(list.length), list });

const CUSTOMER_ID = "72058304855015424";

// [name, domainName]
const APPS: readonly [string, string][] = [
  ["Internal Wiki", "wiki.internal.acme.com"],
  ["HR Portal", "hr.corp.acme.com"],
  ["Jenkins CI", "jenkins.corp.acme.com"],
  ["GitLab Enterprise", "gitlab.corp.acme.com"],
  ["Finance ERP", "erp.finance.acme.com"],
  ["SharePoint Intranet", "sharepoint.acme.com"],
  ["Confluence", "confluence.corp.acme.com"],
  ["Jira", "jira.corp.acme.com"],
  ["Grafana", "grafana.corp.acme.com"],
  ["Payroll App", "payroll.finance.acme.com"],
  ["RDP Jump Hosts", "jump.corp.acme.com"],
  ["SSH Bastion", "bastion.corp.acme.com"],
];
const SEG_GROUPS = ["IT Applications", "Finance Apps", "HR Systems", "Engineering Tools", "Corporate Web", "Infrastructure Access"] as const;
const SRV_GROUPS = ["SG - Datacenter East", "SG - AWS us-east-1", "SG - Azure West Europe", "SG - GCP us-central1", "SG - Datacenter West"] as const;
// [acgName, location(city, state, country), cityCountry, countryCode, latitude, longitude]
const LOCATIONS: readonly [string, string, string, string, number, number][] = [
  ["ACG - Ashburn", "Ashburn, VA, US", "Ashburn, US", "US", 39.0438, -77.4874],
  ["ACG - AWS us-east-1", "Ashburn, VA, US", "Ashburn, US", "US", 39.0438, -77.4874],
  ["ACG - Azure West Europe", "Amsterdam, North Holland, NL", "Amsterdam, NL", "NL", 52.3676, 4.9041],
  ["ACG - Singapore", "Singapore, SG", "Singapore, SG", "SG", 1.3521, 103.8198],
  ["ACG - London", "London, England, GB", "London, GB", "GB", 51.5074, -0.1278],
];
const POSTURE_NAMES = ["CrowdStrike Present (ZTA)", "Domain Joined", "Firewall Enabled", "Disk Encryption Enabled", "OS Version Check", "Antivirus Running"] as const;
// [attributeName, samlName]
const SAML_ATTRS: readonly [string, string][] = [
  ["Email_OktaIdP", "email"],
  ["FirstName_OktaIdP", "firstName"],
  ["LastName_OktaIdP", "lastName"],
  ["GroupName_OktaIdP", "groups"],
  ["DepartmentName_OktaIdP", "department"],
];
const OBJECT_TYPES = ["APP", "APP_GROUP", "CLIENT_TYPE", "SCIM", "SCIM_GROUP", "POSTURE", "TRUSTED_NETWORK", "IDP"] as const;
const GROUP_NAMES = ["Finance", "Engineering", "HR", "Contractors", "IT-Admins", "Sales"] as const;

function appSegment(seed: string) {
  const r = rng("zpa:appseg:" + seed);
  const [name, domain] = pick(r, APPS);
  const port = pick(r, ["443", "8080", "22", "3389", "80", "8443"]);
  const sgName = pick(r, SEG_GROUPS);
  return {
    id: zid("appseg:" + seed),
    name,
    description: `${name} application segment`,
    enabled: chance(r, 0.9),
    domainNames: [domain],
    tcpPortRanges: [port, port],
    tcpPortRange: [{ from: port, to: port }],
    udpPortRanges: [] as string[],
    segmentGroupId: zid("seggrp:" + sgName),
    segmentGroupName: sgName,
    serverGroups: [{ id: zid("srvgrp:" + pick(r, SRV_GROUPS)), name: pick(r, SRV_GROUPS) }],
    bypassType: pick(r, ["ALWAYS", "NEVER", "ON_NET"]),
    isCnameEnabled: chance(r, 0.8),
    healthReporting: pick(r, ["NONE", "ON_ACCESS", "CONTINUOUS"]),
    healthCheckType: "DEFAULT",
    icmpAccessType: pick(r, ["PING", "NONE"]),
    doubleEncrypt: chance(r, 0.15),
    ipAnchored: chance(r, 0.1),
    passiveHealthEnabled: chance(r, 0.85),
    tcpKeepAlive: chance(r, 0.5) ? "1" : "0",
    configSpace: "DEFAULT",
    creationTime: epochAgo(r, 30, 720),
    modifiedTime: epochAgo(r, 0, 29),
    modifiedBy: zid("admin"),
  };
}

function segmentGroup(seed: string) {
  const r = rng("zpa:seggrp:" + seed);
  const name = pick(r, SEG_GROUPS);
  const applications = Array.from({ length: int(r, 1, 4) }, (_, i) => {
    const [an] = pick(r, APPS);
    return { id: zid("app:" + seed + ":" + i), name: an };
  });
  return {
    id: zid("seggrp:" + name),
    name,
    description: `${name} segment group`,
    enabled: chance(r, 0.95),
    configSpace: "DEFAULT",
    policyMigrated: chance(r, 0.5),
    applications,
    creationTime: epochAgo(r, 60, 900),
    modifiedTime: epochAgo(r, 0, 59),
    modifiedBy: zid("admin"),
  };
}

function serverGroup(seed: string) {
  const r = rng("zpa:srvgrp:" + seed);
  const name = pick(r, SRV_GROUPS);
  const dynamicDiscovery = chance(r, 0.7);
  const [acgName] = pick(r, LOCATIONS);
  return {
    id: zid("srvgrp:" + name),
    name,
    description: `${name} server group`,
    enabled: chance(r, 0.95),
    dynamicDiscovery,
    ipAnchored: chance(r, 0.1),
    appConnectorGroups: [{ id: zid("acg:" + acgName), name: acgName }],
    servers: dynamicDiscovery
      ? ([] as any[])
      : [{ id: zid("srv:" + seed), name: `srv-${name.split(" ").pop()?.toLowerCase()}-${int(r, 1, 20)}`, address: fakeIp(r), enabled: true }],
    configSpace: "DEFAULT",
    creationTime: epochAgo(r, 60, 900),
    modifiedTime: epochAgo(r, 0, 59),
  };
}

function connector(seed: string) {
  const r = rng("zpa:conn:" + seed);
  const [acgName, location, , cc] = pick(r, LOCATIONS);
  const idx = int(r, 1, 4);
  const version = pick(r, ["23.65.1", "23.170.2", "24.7.1"]);
  return {
    id: zid("conn:" + seed),
    name: `${acgName.replace("ACG - ", "")} Connector ${idx}`,
    description: `App Connector for ${acgName}`,
    enabled: chance(r, 0.95),
    appConnectorGroupId: zid("acg:" + acgName),
    appConnectorGroupName: acgName,
    controlChannelStatus: "ZPN_STATUS_AUTHENTICATED",
    ctrlBrokerName: `broker-${cc.toLowerCase()}-${int(r, 1, 9)}.prod.zpath.net`,
    currentVersion: version,
    expectedVersion: version,
    platform: "el8",
    privateIp: fakeIp(r),
    publicIp: fakeIp(r),
    location,
    upgradeStatus: "COMPLETE",
    upgradeAttempt: "0",
    lastBrokerConnectTime: epochAgo(r, 0, 2),
    creationTime: epochAgo(r, 30, 400),
    modifiedTime: epochAgo(r, 0, 29),
  };
}

function appConnectorGroup(seed: string) {
  const r = rng("zpa:acg:" + seed);
  const [name, location, cityCountry, cc, lat, lon] = pick(r, LOCATIONS);
  const connectors = Array.from({ length: int(r, 1, 3) }, (_, i) => ({
    id: zid("conn:" + name + ":" + i),
    name: `${name.replace("ACG - ", "")} Connector ${i + 1}`,
  }));
  return {
    id: zid("acg:" + name),
    name,
    description: `${name} app connector group`,
    enabled: chance(r, 0.95),
    cityCountry,
    countryCode: cc,
    latitude: String(lat),
    longitude: String(lon),
    location,
    dnsQueryType: "IPV4_IPV6",
    versionProfileId: "0",
    versionProfileName: "Default",
    upgradeDay: "SUNDAY",
    upgradeTimeInSecs: "66600",
    overrideVersionProfile: false,
    connectors,
    creationTime: epochAgo(r, 60, 900),
    modifiedTime: epochAgo(r, 0, 59),
  };
}

function policyRule(seed: string, policySetId: string) {
  const r = rng("zpa:rule:" + seed);
  const action = pick(r, ["ALLOW", "DENY"]);
  const [appName] = pick(r, APPS);
  const appId = zid("app:" + seed);
  const groupName = pick(r, GROUP_NAMES);
  const idpId = zid("idp:okta");
  const order = int(r, 1, 10);
  return {
    id: zid("rule:" + seed),
    name: `${action === "ALLOW" ? "Allow" : "Block"} ${groupName} to ${appName}`,
    description: `Access rule for ${groupName}`,
    action,
    policyType: "1",
    policySetId,
    operator: "AND",
    ruleOrder: String(order),
    priority: String(order),
    conditions: [
      {
        id: zid("cond:" + seed + ":app"),
        operator: "OR",
        operands: [
          { id: zid("op:" + seed + ":app"), objectType: "APP", lhs: "id", rhs: appId, name: appName },
        ],
      },
      {
        id: zid("cond:" + seed + ":grp"),
        operator: "OR",
        operands: [
          { id: zid("op:" + seed + ":grp"), objectType: "SCIM_GROUP", lhs: zid("grp:" + groupName), rhs: groupName, idpId },
        ],
      },
    ],
    creationTime: epochAgo(r, 30, 400),
    modifiedTime: epochAgo(r, 0, 29),
  };
}

function posture(seed: string) {
  const r = rng("zpa:posture:" + seed);
  return {
    id: zid("posture:" + seed),
    name: pick(r, POSTURE_NAMES),
    postureUdid: guid("posture:" + seed),
    masterCustomerId: CUSTOMER_ID,
    zscalerCloud: "zscalertwo",
    applyToMachineTunnelEnabled: chance(r, 0.3),
    creationTime: epochAgo(r, 60, 700),
    modifiedTime: epochAgo(r, 0, 59),
  };
}

function samlAttribute(seed: string) {
  const r = rng("zpa:saml:" + seed);
  const [name, samlName] = pick(r, SAML_ATTRS);
  return {
    id: zid("saml:" + seed),
    name,
    userAttribute: chance(r, 0.3),
    samlName,
    idpId: zid("idp:okta"),
    idpName: "Okta-IdP",
    creationTime: epochAgo(r, 90, 800),
    modifiedTime: epochAgo(r, 0, 59),
  };
}

export const zscalerZpa: ToolDef = {
  id: "zscaler-zpa",
  name: "Zscaler Private Access",
  vendor: "Zscaler",
  category: "network",
  crafted: true,
  aiTool: true,
  summary:
    "Zscaler Private Access (ZPA) Config API - inventory and manage application segments, segment/server groups, App Connectors, access policy rules, posture profiles and SAML attributes for zero-trust private application access.",
  tags: ["network", "zero-trust", "ztna", "zpa", "private-access", "app-segments", "access-policy"],
  auth: { type: "bearer" },
  docsUrl: "https://help.zscaler.com/zpa",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/signin",
      operation: "signin",
      summary: "OAuth2 client-credentials sign-in - POST form-encoded client_id/client_secret to the host root; returns a short-lived Bearer access token.",
      request: { client_id: "<client-id>", client_secret: "<client-secret>" },
      params: [
        { name: "client_id", in: "body", type: "string", required: true, description: "OAuth2 API client id; posted form-encoded to the host-root /signin.", format: "client id" },
        { name: "client_secret", in: "body", type: "string", required: true, description: "OAuth2 API client secret; posted form-encoded alongside client_id.", format: "client secret" },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: {
          access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock." + Buffer.from(uuid()).toString("base64url"),
          token_type: "Bearer",
          expires_in: "3600",
        },
      }),
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/application",
      operation: "listApplicationSegments",
      summary: "List all application segments (defined private apps) for the customer.",
      aiTool: true,
      request: { customerId: CUSTOMER_ID, page: "1", pagesize: "20" },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page (mock caps at 100).", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching name/domain.", format: "search expression" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = Math.min(Number(ctx.query.pagesize) || 20, 100);
        const list = Array.from({ length: n }, (_, i) => appSegment("list:" + i));
        return { status: 200, body: wrap(list) };
      },
    },
    {
      method: "POST",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/application",
      operation: "createAppSegment",
      summary: "Create a new application segment.",
      aiTool: true,
      emits: "appSegment.created",
      request: {
        name: "New App Segment",
        domainNames: ["newapp.corp.acme.com"],
        tcpPortRanges: ["443", "443"],
        enabled: true,
        segmentGroupId: "216196257331370848",
        serverGroups: [{ id: "216196257331370848" }],
      },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "name", in: "body", type: "string", required: true, description: "Application segment name.", example: "New App Segment" },
        { name: "description", in: "body", type: "string", required: false, description: "Free-text description of the segment." },
        { name: "enabled", in: "body", type: "boolean", required: false, description: "Whether the segment is active.", default: true },
        { name: "domainNames[]", in: "body", type: "array", required: true, description: "FQDNs / wildcard domains this segment matches.", format: "fqdn", example: "newapp.corp.acme.com" },
        { name: "tcpPortRanges[]", in: "body", type: "array", required: false, description: "Flat [from, to, ...] list of TCP port ranges as strings.", format: "port range strings", example: "443" },
        { name: "udpPortRanges[]", in: "body", type: "array", required: false, description: "Flat [from, to, ...] list of UDP port ranges as strings.", format: "port range strings" },
        { name: "segmentGroupId", in: "body", type: "string", required: true, description: "Id of the segment group this app belongs to.", format: "segment group id", example: "216196257331370848" },
        { name: "serverGroups[].id", in: "body", type: "string", required: false, description: "Ids of server groups that serve this segment.", format: "server group id", example: "216196257331370848" },
        { name: "bypassType", in: "body", type: "string", required: false, description: "Client bypass behavior for the segment.", enum: ["ALWAYS", "NEVER", "ON_NET"], default: "NEVER" },
        { name: "healthReporting", in: "body", type: "string", required: false, description: "Connector health reporting mode for the segment.", enum: ["NONE", "ON_ACCESS", "CONTINUOUS"], default: "NONE" },
        { name: "icmpAccessType", in: "body", type: "string", required: false, description: "Whether ICMP/ping is allowed to the segment.", enum: ["PING", "NONE"], default: "NONE" },
        { name: "isCnameEnabled", in: "body", type: "boolean", required: false, description: "Allow CNAME resolution for the domain names." },
        { name: "doubleEncrypt", in: "body", type: "boolean", required: false, description: "Enable double encryption for traffic to the segment." },
        { name: "ipAnchored", in: "body", type: "boolean", required: false, description: "Enable source-IP anchoring for server-initiated flows." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const b = ctx.body || {};
        const base = appSegment("created:" + (b.name || uuid()));
        const now = String(unixNow());
        const created = {
          ...base,
          id: zid("created:" + uuid()),
          name: b.name || base.name,
          description: b.description ?? base.description,
          domainNames: b.domainNames || base.domainNames,
          enabled: b.enabled ?? true,
          creationTime: now,
          modifiedTime: now,
        };
        return { status: 201, body: created };
      },
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/application/{applicationId}",
      operation: "getAppSegment",
      summary: "Get a single application segment by id.",
      aiTool: true,
      request: { customerId: CUSTOMER_ID, applicationId: "216196257331370848" },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "applicationId", in: "path", type: "string", required: true, description: "Application segment id to fetch.", format: "application segment id", example: "216196257331370848" },
      ],
      respond: (ctx: MockContext): MockResult => ({
        status: 200,
        body: { ...appSegment("id:" + ctx.params.applicationId), id: ctx.params.applicationId },
      }),
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/segmentGroup",
      operation: "listSegmentGroups",
      summary: "List segment groups (logical groupings of application segments).",
      aiTool: true,
      request: { customerId: CUSTOMER_ID },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page.", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching segment group name.", format: "search expression" },
      ],
      respond: (): MockResult => {
        const list = Array.from({ length: 6 }, (_, i) => segmentGroup("list:" + i));
        return { status: 200, body: wrap(list) };
      },
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/serverGroup",
      operation: "listServerGroups",
      summary: "List server groups (backend servers reachable via App Connectors).",
      aiTool: true,
      request: { customerId: CUSTOMER_ID },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page.", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching server group name.", format: "search expression" },
      ],
      respond: (): MockResult => {
        const list = Array.from({ length: 5 }, (_, i) => serverGroup("list:" + i));
        return { status: 200, body: wrap(list) };
      },
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/connector",
      operation: "listAppConnectors",
      summary: "List App Connectors with health, version and broker connection state.",
      aiTool: true,
      request: { customerId: CUSTOMER_ID, page: "1", pagesize: "20" },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page (mock returns 12 when omitted, caps at 100).", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching connector name.", format: "search expression" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const n = Math.min(Number(ctx.query.pagesize) || 12, 100);
        const list = Array.from({ length: n }, (_, i) => connector("list:" + i));
        return { status: 200, body: wrap(list) };
      },
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/appConnectorGroup",
      operation: "listAppConnectorGroups",
      summary: "List App Connector groups (location-based groupings of connectors).",
      aiTool: true,
      request: { customerId: CUSTOMER_ID },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page.", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching connector group name.", format: "search expression" },
      ],
      respond: (): MockResult => {
        const list = Array.from({ length: 5 }, (_, i) => appConnectorGroup("list:" + i));
        return { status: 200, body: wrap(list) };
      },
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/policySet/rules/policyType/{policyType}",
      operation: "listPolicyRules",
      summary: "List access policy rules for the given policy type (e.g. ACCESS_POLICY) with their app/group conditions.",
      aiTool: true,
      request: { customerId: CUSTOMER_ID, policyType: "ACCESS_POLICY" },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "policyType", in: "path", type: "string", required: true, description: "Policy type whose rules to list.", enum: ["ACCESS_POLICY", "TIMEOUT_POLICY", "CLIENT_FORWARDING_POLICY", "INSPECTION_POLICY", "ISOLATION_POLICY", "CREDENTIAL_POLICY", "CAPABILITIES_POLICY", "REDIRECTION_POLICY", "SIEM_POLICY"], example: "ACCESS_POLICY" },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page.", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching rule name.", format: "search expression" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const policySetId = zid("policyset:" + (ctx.params.policyType || "ACCESS_POLICY"));
        const list = Array.from({ length: 6 }, (_, i) => policyRule("list:" + i, policySetId));
        return { status: 200, body: wrap(list) };
      },
    },
    {
      method: "POST",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/policySet/{policySetId}/rule",
      operation: "createPolicyRule",
      summary: "Create a new access policy rule within a policy set.",
      emits: "policyRule.created",
      request: {
        name: "Allow Finance to ERP",
        action: "ALLOW",
        conditions: [
          { operator: "OR", operands: [{ objectType: "APP", lhs: "id", rhs: "216196257331370848" }] },
        ],
      },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "policySetId", in: "path", type: "string", required: true, description: "Id of the policy set the rule is created in.", format: "policy set id", example: "216196257331370848" },
        { name: "name", in: "body", type: "string", required: true, description: "Rule name.", example: "Allow Finance to ERP" },
        { name: "description", in: "body", type: "string", required: false, description: "Free-text description of the rule." },
        { name: "action", in: "body", type: "string", required: true, description: "Action applied when the rule matches.", enum: ["ALLOW", "DENY"], default: "ALLOW" },
        { name: "operator", in: "body", type: "string", required: false, description: "Boolean operator combining the rule's conditions.", enum: ["AND", "OR"], default: "AND" },
        { name: "conditions[].operator", in: "body", type: "string", required: false, description: "Boolean operator combining operands within a condition.", enum: ["AND", "OR"], default: "OR" },
        { name: "conditions[].operands[].objectType", in: "body", type: "string", required: false, description: "Type of object the operand matches on.", enum: ["APP", "APP_GROUP", "CLIENT_TYPE", "SCIM", "SCIM_GROUP", "POSTURE", "TRUSTED_NETWORK", "IDP"] },
        { name: "conditions[].operands[].lhs", in: "body", type: "string", required: false, description: "Left-hand side of the operand (attribute key or 'id' depending on objectType).", example: "id" },
        { name: "conditions[].operands[].rhs", in: "body", type: "string", required: false, description: "Right-hand side value to match (e.g. an app/group/posture id).", format: "object id or value", example: "216196257331370848" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const psid = ctx.params.policySetId;
        const b = ctx.body || {};
        const base = policyRule("created:" + (b.name || uuid()), psid);
        const now = String(unixNow());
        const created = {
          ...base,
          id: zid("createdrule:" + uuid()),
          name: b.name || base.name,
          action: b.action || base.action,
          description: b.description ?? base.description,
          policySetId: psid,
          conditions: Array.isArray(b.conditions) && b.conditions.length ? b.conditions : base.conditions,
          creationTime: now,
          modifiedTime: now,
        };
        return { status: 201, body: created };
      },
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/posture",
      operation: "listPostureProfiles",
      summary: "List posture (device trust) profiles referenced by access policies.",
      aiTool: true,
      request: { customerId: CUSTOMER_ID },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page.", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching posture profile name.", format: "search expression" },
      ],
      respond: (): MockResult => {
        const list = Array.from({ length: 6 }, (_, i) => posture("list:" + i));
        return { status: 200, body: wrap(list) };
      },
    },
    {
      method: "GET",
      path: "/mgmtconfig/v1/admin/customers/{customerId}/samlAttribute",
      operation: "listSamlAttributes",
      summary: "List SAML attributes imported from the configured identity providers.",
      aiTool: true,
      request: { customerId: CUSTOMER_ID },
      params: [
        { name: "customerId", in: "path", type: "string", required: true, description: "ZPA customer (tenant) id.", format: "customer id", example: CUSTOMER_ID },
        { name: "page", in: "query", type: "integer", required: false, description: "1-based page number.", default: 1, example: 1 },
        { name: "pagesize", in: "query", type: "integer", required: false, description: "Results per page.", default: 20, example: 20 },
        { name: "search", in: "query", type: "string", required: false, description: "Filter expression matching SAML attribute name.", format: "search expression" },
      ],
      respond: (): MockResult => {
        const list = Array.from({ length: 5 }, (_, i) => samlAttribute("list:" + i));
        return { status: 200, body: wrap(list) };
      },
    },
  ],
  events: [
    {
      type: "appSegment.created",
      summary: "A ZPA application segment was created.",
      sample: () => appSegment("evt:" + uuid()),
    },
    {
      type: "policyRule.created",
      summary: "A ZPA access policy rule was created.",
      sample: () => policyRule("evt:" + uuid(), zid("policyset:ACCESS_POLICY")),
    },
  ],
};
