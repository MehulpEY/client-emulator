import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, fakeIp, minutesAgoIso, daysAgoIso, nowIso, uuid, COUNTRIES } from "../helpers";
import { dbAvailable } from "../../db";
import { listResources, getResource, patchResource, ensureSeeded } from "../../engine/store";
import { fleetUsers, extId, type FleetUser } from "../../fleet/fleet";

// Microsoft Entra ID via Microsoft Graph v1.0. App-only (client-credentials)
// bearer auth. Responses reproduce Graph's OData envelope (@odata.context /
// value[] / @odata.nextLink) and real property names. Lookups are seeded from
// the input so the same user id / filter returns a stable object across calls.
// Identity Protection "risky users" are stateful (persisted resource store) so a
// generator, a manual emit, or a confirm/dismiss action all show up on re-read.

const V1 = "https://graph.microsoft.com/v1.0";
const CTX = (frag: string) => `${V1}/$metadata#${frag}`;

/** Deterministic GUID-shaped id from a seed (8-4-4-4-12 hex). */
function guid(seed: string): string {
  const r = rng("entra:guid:" + seed);
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${h(8)}-${h(4)}-${h(4)}-${h(4)}-${h(12)}`;
}

const FIRST = ["Adele", "Alex", "Diego", "Isaiah", "Lynne", "Megan", "Nestor", "Patti", "Pradeep", "Grady", "Lidia", "Joni", "Lee", "Miriam", "Henrietta"] as const;
const LAST = ["Vance", "Wilber", "Siciliani", "Langford", "Robbins", "Bowen", "Wilke", "Fernandez", "Gupta", "Archie", "Holloway", "Sherman", "Gu", "Graham", "Mueller"] as const;
const TITLES = ["Retail Manager", "Sales Representative", "Software Engineer", "Accountant", "HR Specialist", "Director", "Security Analyst", "VP Operations", "Support Engineer"] as const;
const DEPTS = ["Sales & Marketing", "Finance", "Engineering", "Human Resources", "Retail", "IT", "Legal", "Operations"] as const;
const CITIES: readonly [string, string | null, string][] = [
  ["Seattle", "Washington", "US"], ["Redmond", "Washington", "US"], ["London", null, "GB"],
  ["Berlin", null, "DE"], ["Bengaluru", "Karnataka", "IN"], ["Sao Paulo", null, "BR"], ["Amsterdam", null, "NL"],
];
const RISK_EVENTS = ["unlikelyTravel", "anonymizedIPAddress", "maliciousIPAddress", "unfamiliarFeatures", "leakedCredentials", "suspiciousIPAddress", "passwordSpray"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const CLOUD_APPS: readonly [string, string][] = [
  ["Microsoft Graph PowerShell", "14d82eec-204b-4c2f-b7e8-296a70dab67e"],
  ["Office 365 Exchange Online", "00000002-0000-0ff1-ce00-000000000000"],
  ["Microsoft Teams", "1fec8e78-bce4-4aaf-ab1b-5451cc387264"],
  ["Azure Portal", "c44b4083-3bb0-49c1-b47d-974e53cbdf3c"],
  ["Graph explorer", "de8bc8b5-d9f9-48b1-a8ad-b748da725064"],
];
const SIGNIN_ERRORS: readonly [number, string][] = [
  [50126, "Invalid username or password."],
  [50053, "Account is locked because the user tried to sign in too many times with an incorrect user ID or password."],
  [50074, "Strong Authentication is required."],
  [53003, "Access has been blocked by Conditional Access policies."],
  [50131, "Sign-in was blocked because it came from an IP address with malicious activity."],
];

/** A directory user with Graph's default property set (+ accountEnabled). */
function user(seed: string) {
  const r = rng("entra:user:" + seed);
  const first = pick(r, FIRST);
  const last = pick(r, LAST);
  const upn = `${first}${last.charAt(0)}@contoso.com`;
  return {
    businessPhones: [`+1 425 555 01${int(r, 10, 99)}`],
    displayName: `${first} ${last}`,
    givenName: first,
    jobTitle: pick(r, TITLES),
    mail: upn,
    mobilePhone: chance(r, 0.5) ? `+1 425 555 01${int(r, 10, 99)}` : null,
    officeLocation: `${int(r, 1, 36)}/${int(r, 1000, 3999)}`,
    preferredLanguage: "en-US",
    surname: last,
    userPrincipalName: upn,
    id: guid("user:" + seed),
    accountEnabled: chance(r, 0.9),
    department: pick(r, DEPTS),
  };
}

// ---- fleet projection (directory users, PLAN §4.4) --------------------------
// /users serves the canonical fleet's user directory (lib/fleet/fleet.ts) so
// UPNs line up with Zscaler ZIA and the scaffold identity adapters (email
// correlation). Deterministic per fleetId.

/** Stable GUID-shaped object id for a fleet user (extId chunked 8-4-4-4-12). */
function fleetObjectId(fleetId: string): string {
  const h = extId("entra-id", fleetId, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Project a fleet user into Graph's default user property set. */
function fleetGraphUser(u: FleetUser) {
  const r = rng("entra:fleetuser:" + u.fleetId);
  const [givenName, ...rest] = u.displayName.split(" ");
  return {
    businessPhones: [`+1 425 555 01${int(r, 10, 99)}`],
    displayName: u.displayName,
    givenName,
    jobTitle: u.title,
    mail: u.upn,
    mobilePhone: chance(r, 0.5) ? `+1 425 555 01${int(r, 10, 99)}` : null,
    officeLocation: u.site,
    preferredLanguage: "en-US",
    surname: rest.join(" ") || givenName,
    userPrincipalName: u.upn,
    id: fleetObjectId(u.fleetId),
    accountEnabled: u.enabled,
    department: u.department,
    createdDateTime: daysAgoIso(int(r, 90, 1500)),
  };
}

function signIn(seed: string) {
  const r = rng("entra:signin:" + seed);
  const u = user("s:" + seed);
  const fail = chance(r, 0.22);
  const [code, reason] = fail ? pick(r, SIGNIN_ERRORS) : [0, null];
  const risky = chance(r, 0.28);
  const level = risky ? pick(r, RISK_LEVELS) : "none";
  const [city, state, country] = pick(r, CITIES);
  const caBlocked = code === 53003;
  return {
    id: guid("signin:" + seed) + "-" + int(r, 1000, 9999),
    createdDateTime: minutesAgoIso(int(r, 1, 4320)),
    userDisplayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
    userId: u.id,
    appId: CLOUD_APPS[0][1],
    appDisplayName: pick(r, CLOUD_APPS)[0],
    ipAddress: fakeIp(r),
    clientAppUsed: pick(r, ["Browser", "Mobile Apps and Desktop clients", "Exchange ActiveSync", "IMAP4"]),
    correlationId: guid("corr:" + seed),
    conditionalAccessStatus: caBlocked ? "failure" : chance(r, 0.5) ? "success" : "notApplied",
    isInteractive: chance(r, 0.8),
    riskDetail: "none",
    riskLevelAggregated: level,
    riskLevelDuringSignIn: level,
    riskState: risky ? "atRisk" : "none",
    riskEventTypes_v2: risky ? sample(r, RISK_EVENTS, int(r, 1, 2)) : [],
    resourceDisplayName: "Microsoft Graph",
    resourceId: "00000003-0000-0000-c000-000000000000",
    status: { errorCode: code, failureReason: reason, additionalDetails: fail ? null : "MFA requirement satisfied by claim in the token" },
    deviceDetail: {
      deviceId: chance(r, 0.6) ? guid("dev:" + seed) : "",
      displayName: null,
      operatingSystem: pick(r, ["Windows 10", "Windows 11", "MacOs", "iOs", "Android"]),
      browser: pick(r, ["Edge 126.0", "Chrome 127.0", "Safari 17.5", "Firefox 128.0"]),
      isCompliant: chance(r, 0.5),
      isManaged: chance(r, 0.5),
      trustType: pick(r, ["Azure AD joined", "Hybrid Azure AD joined", "Azure AD registered", null as any]),
    },
    location: { city, state, countryOrRegion: country, geoCoordinates: { latitude: +(r() * 180 - 90).toFixed(5), longitude: +(r() * 360 - 180).toFixed(5) } },
    appliedConditionalAccessPolicies: caBlocked
      ? [{ id: guid("ca:" + seed), displayName: "Block legacy authentication", enforcedGrantControls: ["Block"], enforcedSessionControls: [], result: "failure" }]
      : [],
  };
}

function directoryAudit(seed: string) {
  const r = rng("entra:audit:" + seed);
  const actor = user("a:" + seed);
  const target = user("t:" + seed);
  const activities: [string, string][] = [
    ["Add member to group", "GroupManagement"], ["Reset user password", "UserManagement"],
    ["Update conditional access policy", "Policy"], ["Add app role assignment to service principal", "ApplicationManagement"],
    ["Disable account", "UserManagement"], ["Add member to role", "RoleManagement"],
  ];
  const [activity, category] = pick(r, activities);
  return {
    id: `Directory_${guid("aud:" + seed)}_${int(r, 1e7, 9e7)}`,
    category,
    correlationId: guid("corr:" + seed),
    result: chance(r, 0.9) ? "success" : "failure",
    resultReason: chance(r, 0.9) ? `Successfully completed: ${activity}` : "Insufficient privileges",
    activityDisplayName: activity,
    activityDateTime: minutesAgoIso(int(r, 1, 10080)),
    loggedByService: "Core Directory",
    operationType: pick(r, ["Add", "Update", "Delete"]),
    initiatedBy: { app: null, user: { id: actor.id, displayName: actor.displayName, userPrincipalName: actor.userPrincipalName, ipAddress: fakeIp(r) } },
    targetResources: [{ id: target.id, displayName: target.displayName, type: "User", userPrincipalName: target.userPrincipalName, modifiedProperties: [] }],
    additionalDetails: [],
  };
}

function riskyUser() {
  const r = rng("entra:risky:" + uuid());
  const u = user("r:" + uuid());
  const level = pick(r, RISK_LEVELS);
  return {
    id: u.id,
    isDeleted: false,
    isProcessing: false,
    riskLastUpdatedDateTime: nowIso(),
    riskLevel: level,
    riskState: "atRisk",
    riskDetail: "none",
    userDisplayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
  };
}

function riskDetection(seed: string) {
  const r = rng("entra:rd:" + seed);
  const u = user("rd:" + seed);
  const evt = pick(r, RISK_EVENTS);
  const [city, state, country] = pick(r, CITIES);
  return {
    id: guid("rd:" + seed),
    requestId: guid("req:" + seed),
    correlationId: guid("corr:" + seed),
    riskType: evt,
    riskEventType: evt,
    riskState: pick(r, ["atRisk", "remediated", "dismissed"]),
    riskLevel: pick(r, RISK_LEVELS),
    riskDetail: "none",
    source: "IdentityProtection",
    detectionTimingType: pick(r, ["realtime", "offline"]),
    activity: "signin",
    tokenIssuerType: "AzureAD",
    ipAddress: fakeIp(r),
    location: { city, state, countryOrRegion: country, geoCoordinates: null },
    activityDateTime: minutesAgoIso(int(r, 5, 2880)),
    detectedDateTime: minutesAgoIso(int(r, 1, 2880)),
    lastUpdatedDateTime: minutesAgoIso(int(r, 0, 60)),
    userId: u.id,
    userDisplayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
    additionalInfo: '[{"Key":"userAgent","Value":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}]',
  };
}

function servicePrincipal(seed: string) {
  const r = rng("entra:sp:" + seed);
  const names = ["Contoso Payroll Connector", "Salesforce", "ServiceNow", "Datadog", "GitHub Enterprise", "Backup Automation", "Legacy Reporting App"];
  const name = pick(r, names);
  const expDays = int(r, -30, 400);
  return {
    id: guid("sp:" + seed),
    appId: guid("app:" + seed),
    displayName: name,
    servicePrincipalType: "Application",
    accountEnabled: chance(r, 0.92),
    appOwnerOrganizationId: guid("tenant"),
    signInAudience: pick(r, ["AzureADMyOrg", "AzureADMultipleOrgs"]),
    tags: ["WindowsAzureActiveDirectoryIntegratedApp"],
    keyCredentials: [],
    passwordCredentials: [{
      keyId: guid("kid:" + seed),
      displayName: "client-secret",
      startDateTime: daysAgoIso(365 - expDays),
      endDateTime: daysAgoIso(-expDays),
      hint: sample(r, ["A1b", "z9Q", "k3P", "m7R"], 1)[0],
    }],
  };
}

const CA_POLICIES = [
  {
    id: "2b31ac51-b855-40a5-a986-0a4ed23e9008", templateId: null,
    displayName: "CA001: Require multifactor authentication for admins",
    createdDateTime: daysAgoIso(180), modifiedDateTime: daysAgoIso(20), state: "enabled", sessionControls: null,
    conditions: {
      userRiskLevels: [], signInRiskLevels: [], clientAppTypes: ["all"], servicePrincipalRiskLevels: [], platforms: null, locations: null, devices: null,
      applications: { includeApplications: ["All"], excludeApplications: [], includeUserActions: [], applicationFilter: null },
      users: { includeUsers: [], excludeUsers: [], includeGroups: [], excludeGroups: [], includeRoles: ["62e90394-69f5-4237-9190-012177145e10", "194ae4cb-b126-40b2-bd5b-6091b380977d"], excludeRoles: [] },
    },
    grantControls: { operator: "OR", builtInControls: ["mfa"], customAuthenticationFactors: [], termsOfUse: [], authenticationStrength: null },
  },
  {
    id: "10ef4fe6-5e51-4f5e-b5a2-8fed19d0be67", templateId: null,
    displayName: "CA008: Require password change for high-risk users",
    createdDateTime: daysAgoIso(120), modifiedDateTime: daysAgoIso(5), state: "enabled",
    conditions: { userRiskLevels: ["high"], signInRiskLevels: [], clientAppTypes: ["all"], applications: { includeApplications: ["All"] }, users: { includeUsers: ["All"], excludeGroups: [] } },
    grantControls: { operator: "AND", builtInControls: ["passwordChange"], customAuthenticationFactors: [], termsOfUse: [], authenticationStrength: null },
    sessionControls: { signInFrequency: { authenticationType: "primaryAndSecondaryAuthentication", frequencyInterval: "everyTime", isEnabled: true } },
  },
  {
    id: "8f1c2a3d-77aa-42bb-9c11-a1b2c3d4e5f6", templateId: null,
    displayName: "CA015: Block legacy authentication", createdDateTime: daysAgoIso(200), modifiedDateTime: daysAgoIso(60), state: "enabled", sessionControls: null,
    conditions: { userRiskLevels: [], signInRiskLevels: [], clientAppTypes: ["exchangeActiveSync", "other"], applications: { includeApplications: ["All"] }, users: { includeUsers: ["All"], excludeGroups: [] } },
    grantControls: { operator: "OR", builtInControls: ["block"], customAuthenticationFactors: [], termsOfUse: [], authenticationStrength: null },
  },
];

const DIRECTORY_ROLES = [
  { id: "9ed3a0c4-53e1-498c-ab4d-2473476fde14", deletedDateTime: null, description: "Can manage all aspects of Microsoft Entra ID and Microsoft services that use Entra identities.", displayName: "Global Administrator", roleTemplateId: "62e90394-69f5-4237-9190-012177145e10" },
  { id: "fe8f10bf-c9c2-47eb-95cb-c26cc85f1830", deletedDateTime: null, description: "Can read basic directory information. Commonly used to grant directory read access to applications and guests.", displayName: "Directory Readers", roleTemplateId: "88d8e3e3-8f55-4a1e-953a-9b9898b8876b" },
  { id: "c4e39bd9-1100-46d3-8c65-fb160da0071f", deletedDateTime: null, description: "Can manage all aspects of the Exchange product.", displayName: "Exchange Administrator", roleTemplateId: "29232cdf-9323-42fd-ade2-1d097af3e4de" },
  { id: "729827e3-9c14-49f7-bb1b-9608f156bbb8", deletedDateTime: null, description: "Can reset passwords for non-administrators and Helpdesk Administrators.", displayName: "Helpdesk Administrator", roleTemplateId: "729827e3-9c14-49f7-bb1b-9608f156bbb8" },
];

const paged = <T>(items: T[], frag: string, extra: Record<string, any> = {}) => ({ "@odata.context": CTX(frag), ...extra, value: items });

export const entra: ToolDef = {
  id: "entra-id",
  name: "Microsoft Entra ID",
  vendor: "Microsoft",
  category: "identity",
  crafted: true,
  aiTool: true,
  summary:
    "Microsoft Entra ID (Azure AD) identity and access management via Microsoft Graph - users, groups, sign-in and audit logs, Identity Protection risk, Conditional Access, and account containment actions.",
  tags: ["identity", "azure-ad", "graph", "sign-in-logs", "conditional-access", "identity-protection"],
  auth: { type: "bearer" },
  docsUrl: "https://learn.microsoft.com/en-us/graph/api/overview",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "POST",
      path: "/{tenant}/oauth2/v2.0/token",
      operation: "getToken",
      summary: "Exchange client_id/client_secret for an app-only OAuth2 bearer token (client credentials).",
      request: { client_id: "<app-id>", scope: "https://graph.microsoft.com/.default", client_secret: "<secret>", grant_type: "client_credentials" },
      params: [
        { name: "tenant", in: "path", type: "string", required: true, description: "Directory (tenant) id or verified domain.", format: "uuid (tenant id) or domain", example: "contoso.onmicrosoft.com" },
        { name: "client_id", in: "body", type: "string", required: true, description: "Application (client) id of the app registration.", format: "uuid (app id)" },
        { name: "scope", in: "body", type: "string", required: true, description: "Space-delimited scopes; app-only uses the resource .default scope.", example: "https://graph.microsoft.com/.default" },
        { name: "client_secret", in: "body", type: "string", required: true, description: "Client secret credential of the app registration." },
        { name: "grant_type", in: "body", type: "string", required: true, enum: ["client_credentials"], description: "OAuth2 grant type; app-only auth uses client credentials.", example: "client_credentials" },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: { token_type: "Bearer", expires_in: 3599, ext_expires_in: 3599, access_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.mock." + Buffer.from(uuid()).toString("base64url") },
      }),
    },
    {
      method: "GET",
      path: "/users",
      operation: "listUsers",
      summary: "List directory users (supports $filter, $select, $top, $count).",
      aiTool: true,
      request: { $filter: "accountEnabled eq true", $top: "5" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. accountEnabled is boolean; also filter on displayName, userPrincipalName, mail, department, jobTitle.", example: "accountEnabled eq true" },
        { name: "$top", in: "query", type: "integer", description: "Page size; capped at 100.", default: 25, example: 5 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,displayName,userPrincipalName,accountEnabled" },
        { name: "$count", in: "query", type: "boolean", enum: ["true", "false"], description: "When 'true', include @odata.count of the total collection.", example: "true" },
        { name: "$search", in: "query", type: "string", description: "Free-text search; requires the ConsistencyLevel: eventual header.", example: "\"displayName:Adele\"" },
        { name: "$orderby", in: "query", type: "string", description: "Sort expression.", example: "displayName asc" },
        { name: "ConsistencyLevel", in: "header", type: "string", enum: ["eventual"], description: "Required for advanced queries ($count, $search, some $filter/$orderby)." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const top = Math.min(Number(ctx.query.$top) || 25, 100);
        let users = fleetUsers().map(fleetGraphUser);
        const enabledMatch = /^accountEnabled\s+eq\s+(true|false)$/i.exec((ctx.query.$filter || "").trim());
        if (enabledMatch) users = users.filter((u) => u.accountEnabled === (enabledMatch[1].toLowerCase() === "true"));
        const withCount = ctx.query.$count === "true";
        return { status: 200, body: paged(users.slice(0, top), "users", withCount ? { "@odata.count": users.length } : {}) };
      },
    },
    {
      method: "GET",
      path: "/users/{id}",
      operation: "getUser",
      summary: "Get a single user by object id or userPrincipalName.",
      aiTool: true,
      request: { id: "AdeleV@contoso.com" },
      params: [
        { name: "id", in: "path", type: "string", required: true, description: "User object id (GUID) or userPrincipalName.", format: "uuid (object id) or userPrincipalName (email)", example: "AdeleV@contoso.com" },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,displayName,accountEnabled,department" },
      ],
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: { "@odata.context": CTX("users/$entity"), ...user(ctx.params.id) } }),
    },
    {
      method: "GET",
      path: "/users/{id}/memberOf",
      operation: "listMemberOf",
      summary: "List the groups and directory roles a user is a direct member of.",
      aiTool: true,
      request: { id: "AdeleV@contoso.com" },
      params: [
        { name: "id", in: "path", type: "string", required: true, description: "User object id (GUID) or userPrincipalName.", format: "uuid (object id) or userPrincipalName (email)", example: "AdeleV@contoso.com" },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties on the returned directory objects.", example: "id,displayName" },
        { name: "$top", in: "query", type: "integer", description: "Page size.", example: 20 },
        { name: "$count", in: "query", type: "boolean", enum: ["true", "false"], description: "Include @odata.count; requires the ConsistencyLevel: eventual header." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const r = rng("entra:memberof:" + ctx.params.id);
        const groups = Array.from({ length: int(r, 1, 3) }, (_, i) => ({
          "@odata.type": "#microsoft.graph.group", id: guid("g:" + ctx.params.id + i),
          displayName: pick(r, ["All Users", "Sales Team", "Finance", "Engineering", "VPN Users", "Admins"]),
          mailEnabled: chance(r, 0.5), securityEnabled: true,
        }));
        if (chance(r, 0.3)) groups.push({ "@odata.type": "#microsoft.graph.directoryRole", id: guid("dr:" + ctx.params.id), displayName: "Global Administrator", mailEnabled: false, securityEnabled: true } as any);
        return { status: 200, body: paged(groups, "directoryObjects") };
      },
    },
    {
      method: "GET",
      path: "/groups",
      operation: "listGroups",
      summary: "List groups (security, Microsoft 365, mail-enabled).",
      aiTool: true,
      request: { $filter: "securityEnabled eq true", $top: "5" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. securityEnabled and mailEnabled are boolean; groupTypes contains 'Unified' for Microsoft 365 groups.", example: "securityEnabled eq true" },
        { name: "$top", in: "query", type: "integer", description: "Page size; capped at 100.", default: 15, example: 5 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,displayName,mail,groupTypes,securityEnabled" },
        { name: "$count", in: "query", type: "boolean", enum: ["true", "false"], description: "When 'true', include @odata.count; requires the ConsistencyLevel: eventual header." },
        { name: "$search", in: "query", type: "string", description: "Free-text search; requires the ConsistencyLevel: eventual header.", example: "\"displayName:Sales\"" },
        { name: "$orderby", in: "query", type: "string", description: "Sort expression.", example: "displayName asc" },
        { name: "ConsistencyLevel", in: "header", type: "string", enum: ["eventual"], description: "Required for advanced queries ($count, $search)." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const top = Math.min(Number(ctx.query.$top) || 15, 100);
        const groups = Array.from({ length: top }, (_, i) => {
          const r = rng("entra:group:" + i);
          const unified = chance(r, 0.5);
          const name = pick(r, ["Golf Assist", "Sales & Marketing", "Finance", "Engineering", "Retail", "All Company", "VPN Users", "Security Admins"]);
          const nick = name.replace(/[^a-z]/gi, "").toLowerCase();
          return {
            id: guid("group:" + i), deletedDateTime: null, classification: null, createdDateTime: daysAgoIso(int(r, 30, 1200)),
            description: `${name} group`, displayName: name, expirationDateTime: null,
            groupTypes: unified ? ["Unified"] : [], isAssignableToRole: null,
            mail: unified ? `${nick}@contoso.com` : null, mailEnabled: unified, mailNickname: nick,
            securityEnabled: !unified, visibility: unified ? "Public" : null,
          };
        });
        return { status: 200, body: paged(groups, "groups") };
      },
    },
    {
      method: "GET",
      path: "/auditLogs/signIns",
      operation: "listSignIns",
      summary: "List interactive sign-in events (filter by $filter on createdDateTime, riskLevelDuringSignIn, status/errorCode).",
      aiTool: true,
      request: { $filter: "riskLevelDuringSignIn eq 'high'", $top: "10" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. Filterable fields: createdDateTime, userPrincipalName, userId, appId, riskLevelDuringSignIn/riskLevelAggregated (low|medium|high|none|hidden), riskState (none|atRisk|confirmedCompromised|remediated|dismissed), conditionalAccessStatus (success|failure|notApplied), status/errorCode.", example: "riskLevelDuringSignIn eq 'high'" },
        { name: "$top", in: "query", type: "integer", description: "Page size; capped at 100.", default: 25, example: 10 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "createdDateTime,userPrincipalName,ipAddress,status,riskState" },
        { name: "$orderby", in: "query", type: "string", description: "Sort expression.", example: "createdDateTime desc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const top = Math.min(Number(ctx.query.$top) || 25, 100);
        const rows = Array.from({ length: top }, (_, i) => signIn("s:" + (ctx.query.$filter || "") + i));
        return { status: 200, body: paged(rows, "auditLogs/signIns", { "@odata.nextLink": `${V1}/auditLogs/signIns?$skiptoken=${Buffer.from(uuid()).toString("base64url")}` }) };
      },
    },
    {
      method: "GET",
      path: "/auditLogs/directoryAudits",
      operation: "listDirectoryAudits",
      summary: "List directory audit events (who changed what across Entra).",
      aiTool: true,
      request: { $top: "10" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. Filterable: activityDateTime, activityDisplayName, category (UserManagement|GroupManagement|Policy|ApplicationManagement|RoleManagement), result (success|failure), operationType (Add|Update|Delete), loggedByService.", example: "result eq 'failure'" },
        { name: "$top", in: "query", type: "integer", description: "Page size; capped at 100.", default: 25, example: 10 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "activityDateTime,activityDisplayName,initiatedBy,result" },
        { name: "$orderby", in: "query", type: "string", description: "Sort expression.", example: "activityDateTime desc" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const top = Math.min(Number(ctx.query.$top) || 25, 100);
        const rows = Array.from({ length: top }, (_, i) => directoryAudit("a:" + i));
        return { status: 200, body: paged(rows, "auditLogs/directoryAudits") };
      },
    },
    {
      method: "GET",
      path: "/identityProtection/riskyUsers",
      operation: "listRiskyUsers",
      summary: "List users flagged as risky by Identity Protection (stateful - persisted).",
      aiTool: true,
      request: { $filter: "riskState eq 'atRisk'", $top: "10" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. riskState (none|atRisk|confirmedCompromised|remediated|dismissed|confirmedSafe), riskLevel (low|medium|high|none).", example: "riskState eq 'atRisk'" },
        { name: "$top", in: "query", type: "integer", description: "Page size; capped at 200.", default: 50, example: 10 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,userPrincipalName,riskLevel,riskState" },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        if (!dbAvailable()) {
          const rows = Array.from({ length: 5 }, riskyUser);
          return { status: 200, body: paged(rows, "identityProtection/riskyUsers", { note: "database offline - synthetic, not persisted" }) };
        }
        await ensureSeeded("entra-id", "riskyUsers", 5, () => { const d = riskyUser(); return { id: d.id, data: d }; });
        const top = Math.min(Number(ctx.query.$top) || 50, 200);
        const { items } = await listResources("entra-id", "riskyUsers", { limit: top });
        return { status: 200, body: paged(items.map((r) => r.data), "identityProtection/riskyUsers") };
      },
    },
    {
      method: "GET",
      path: "/identityProtection/riskDetections",
      operation: "listRiskDetections",
      summary: "List individual Identity Protection risk detections.",
      aiTool: true,
      request: { $top: "10" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. riskState (atRisk|remediated|dismissed), riskLevel (low|medium|high), riskEventType (unlikelyTravel|anonymizedIPAddress|maliciousIPAddress|unfamiliarFeatures|leakedCredentials|suspiciousIPAddress|passwordSpray), detectionTimingType (realtime|offline).", example: "riskLevel eq 'high'" },
        { name: "$top", in: "query", type: "integer", description: "Page size; capped at 100.", default: 20, example: 10 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,riskEventType,riskLevel,riskState,userPrincipalName" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const top = Math.min(Number(ctx.query.$top) || 20, 100);
        const rows = Array.from({ length: top }, (_, i) => riskDetection("rd:" + i));
        return { status: 200, body: paged(rows, "identityProtection/riskDetections") };
      },
    },
    {
      method: "POST",
      path: "/identityProtection/riskyUsers/confirmCompromised",
      operation: "confirmCompromised",
      summary: "Confirm one or more risky users as compromised (stateful mutation).",
      aiTool: true,
      emits: "riskyUser.confirmedCompromised",
      request: { userIds: ["<user-object-id>"] },
      params: [
        { name: "userIds[]", in: "body", type: "array", required: true, description: "Object ids of the risky users to confirm compromised.", format: "array of uuid (user object id)", example: "[\"<user-object-id>\"]" },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const ids: string[] = ctx.body?.userIds || [];
        for (const id of ids) await patchResource("entra-id", "riskyUsers", id, { riskState: "confirmedCompromised", riskLevel: "high", riskDetail: "adminConfirmedUserCompromised", riskLastUpdatedDateTime: nowIso() });
        return { status: 204, body: null };
      },
    },
    {
      method: "POST",
      path: "/identityProtection/riskyUsers/dismiss",
      operation: "dismissRiskyUsers",
      summary: "Dismiss the risk on one or more users (stateful mutation).",
      aiTool: true,
      emits: "riskyUser.dismissed",
      request: { userIds: ["<user-object-id>"] },
      params: [
        { name: "userIds[]", in: "body", type: "array", required: true, description: "Object ids of the risky users to dismiss (clear the risk).", format: "array of uuid (user object id)", example: "[\"<user-object-id>\"]" },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const ids: string[] = ctx.body?.userIds || [];
        for (const id of ids) await patchResource("entra-id", "riskyUsers", id, { riskState: "dismissed", riskDetail: "adminDismissedAllRiskForUser", riskLastUpdatedDateTime: nowIso() });
        return { status: 204, body: null };
      },
    },
    {
      method: "GET",
      path: "/identity/conditionalAccess/policies",
      operation: "listConditionalAccessPolicies",
      summary: "List all Conditional Access policies (conditions + grant/session controls).",
      aiTool: true,
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter, e.g. by state or displayName. state: enabled|disabled|enabledForReportingButNotEnforced.", example: "state eq 'enabled'" },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,displayName,state,conditions,grantControls" },
      ],
      respond: (): MockResult => ({ status: 200, body: paged(CA_POLICIES, "identity/conditionalAccess/policies") }),
    },
    {
      method: "GET",
      path: "/directoryRoles",
      operation: "listDirectoryRoles",
      summary: "List activated directory (admin) roles in the tenant.",
      aiTool: true,
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter on the activated roles, e.g. by displayName or roleTemplateId.", example: "displayName eq 'Global Administrator'" },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,displayName,roleTemplateId" },
        { name: "$expand", in: "query", type: "string", enum: ["members"], description: "Expand the members navigation property.", example: "members" },
      ],
      respond: (): MockResult => ({ status: 200, body: paged(DIRECTORY_ROLES, "directoryRoles") }),
    },
    {
      method: "GET",
      path: "/servicePrincipals",
      operation: "listServicePrincipals",
      summary: "List service principals / enterprise apps (with credential expiry for over-privilege auditing).",
      aiTool: true,
      request: { $top: "10" },
      params: [
        { name: "$filter", in: "query", type: "string", description: "OData filter. accountEnabled is boolean; signInAudience (AzureADMyOrg|AzureADMultipleOrgs|AzureADandPersonalMicrosoftAccount); also servicePrincipalType, displayName, appId.", example: "accountEnabled eq true" },
        { name: "$top", in: "query", type: "integer", description: "Page size; capped at 100.", default: 15, example: 10 },
        { name: "$select", in: "query", type: "string", description: "Comma-separated properties to return.", example: "id,appId,displayName,accountEnabled,passwordCredentials" },
        { name: "$count", in: "query", type: "boolean", enum: ["true", "false"], description: "When 'true', include @odata.count; requires the ConsistencyLevel: eventual header." },
        { name: "$search", in: "query", type: "string", description: "Free-text search; requires the ConsistencyLevel: eventual header.", example: "\"displayName:Salesforce\"" },
        { name: "$orderby", in: "query", type: "string", description: "Sort expression.", example: "displayName asc" },
        { name: "ConsistencyLevel", in: "header", type: "string", enum: ["eventual"], description: "Required for advanced queries ($count, $search)." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const top = Math.min(Number(ctx.query.$top) || 15, 100);
        const rows = Array.from({ length: top }, (_, i) => servicePrincipal("sp:" + i));
        return { status: 200, body: paged(rows, "servicePrincipals") };
      },
    },
    {
      method: "POST",
      path: "/users/{id}/revokeSignInSessions",
      operation: "revokeSignInSessions",
      summary: "Invalidate all refresh tokens and browser sessions for a user (containment).",
      aiTool: true,
      emits: "user.sessionsRevoked",
      request: { id: "<user-object-id>" },
      params: [
        { name: "id", in: "path", type: "string", required: true, description: "Object id or userPrincipalName of the user whose sessions to revoke.", format: "uuid (object id) or userPrincipalName (email)", example: "AdeleV@contoso.com" },
      ],
      respond: (): MockResult => ({ status: 200, body: { "@odata.context": CTX("Edm.Boolean"), value: true } }),
    },
    {
      method: "PATCH",
      path: "/users/{id}",
      operation: "updateUser",
      summary: "Update a user - e.g. disable the account (accountEnabled:false) or force a password reset.",
      aiTool: true,
      emits: "user.updated",
      request: { accountEnabled: false },
      params: [
        { name: "id", in: "path", type: "string", required: true, description: "Object id or userPrincipalName of the user to update.", format: "uuid (object id) or userPrincipalName (email)", example: "AdeleV@contoso.com" },
        { name: "accountEnabled", in: "body", type: "boolean", description: "Set false to disable (block sign-in for) the account, true to re-enable.", example: false },
        { name: "displayName", in: "body", type: "string", description: "User's display name (free text)." },
        { name: "jobTitle", in: "body", type: "string", description: "User's job title (free text)." },
        { name: "department", in: "body", type: "string", description: "User's department (free text)." },
        { name: "passwordProfile.password", in: "body", type: "string", description: "New password to set for the user." },
        { name: "passwordProfile.forceChangePasswordNextSignIn", in: "body", type: "boolean", description: "Require the user to change their password at next sign-in.", example: true },
      ],
      respond: (): MockResult => ({ status: 204, body: null }),
    },
  ],
  events: [
    { type: "signIn.risky", summary: "A risky sign-in was recorded by Identity Protection.", sample: () => signIn("evt:" + uuid()) },
    {
      type: "riskyUser.detected",
      summary: "Identity Protection flagged a user as risky.",
      persist: { collection: "riskyUsers", idOf: (d) => d.id },
      sample: riskyUser,
    },
    { type: "riskyUser.confirmedCompromised", summary: "A risky user was confirmed compromised.", sample: () => ({ ...riskyUser(), riskState: "confirmedCompromised" }) },
    { type: "user.sessionsRevoked", summary: "A user's sign-in sessions were revoked.", sample: () => ({ ...user("evt:" + uuid()), value: true }) },
  ],
};
