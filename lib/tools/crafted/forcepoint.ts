import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, uuid } from "../helpers";
import { dbAvailable } from "../../db";
import { listResources, patchResource, ensureSeeded } from "../../engine/store";

// Forcepoint DLP via the Data Security REST API (v1). Bearer (JWT) auth obtained
// from /auth/refresh-token (credentials passed as username/password *headers*)
// and refreshed via /auth/access-token. Responses reproduce Forcepoint's real
// field names (event_id, partition_index, maximum_matches, day-first timestamps).
// Incidents are stateful (persisted resource store) so a generator, a manual
// emit, or an incidents/update action all show up on the next search.

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock.";
const mockJwt = () => JWT + Buffer.from(uuid()).toString("base64url");

const SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
const ACTIONS = ["BLOCKED", "QUARANTINED", "RELEASED", "AUDITED", "ENCRYPTED"] as const;
const CHANNELS = ["EMAIL", "HTTP", "HTTPS", "FTP", "ENDPOINT_REMOVABLE_MEDIA", "ENDPOINT_PRINTING", "ENDPOINT_APPLICATION", "CASB_REAL_TIME"] as const;
const POLICY_POOL = ["PCI", "Credit Cards", "HIPAA", "Source Code Protection", "GDPR - EU Personal Data", "Confidential - Financials"] as const;
const DESTINATIONS = ["external@gmail.com", "personal.inbox@yahoo.com", "Windows Portable Device (WPD)", "wetransfer.com", "dropbox.com", "\\\\share\\public\\upload"] as const;
const DETECTED_BY = ["Endpoint Agent", "Protector on 1272021", "Web Content Gateway", "Email Gateway on 1272044"] as const;
const ANALYZED_BY = ["Policy Engine 100190120a", "Policy Engine 100190120b", "Policy Engine fp-pe01"] as const;
const FILE_NAMES = ["cardholder_data.txt - 1.09 KB", "customer_ssn_list.xlsx - 42.5 KB", "q3_source_release.zip - 3.2 MB", "patient_records.csv - 128 KB", "financials_fy26.pdf - 892 KB", "employee_pii.docx - 61 KB"] as const;
const DETAILS = ["Automatic Email Subject: Q3 financials", "File upload to external web destination", "Copy to removable media (USB)", "Print job containing cardholder data", "Attachment matched PCI classifier"] as const;
const FP_USERS = ["jdoe", "asmith", "mgarcia", "rkumar", "lchen", "tbrown", "kowalski"] as const;
const FP_HOSTS = ["DESKTOP-3NG4NN6", "LAPTOP-8HD2KP1", "WKS-FIN-042", "DESKTOP-QW9ZX2", "LT-SALES-07"] as const;

const pad = (n: number): string => String(n).padStart(2, "0");
/** Forcepoint uses day-first "dd/MM/yyyy HH:mm:ss" timestamps. */
const fpDate = (d: Date): string => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
/** yyyyMMdd integer partition index (the physical DB partition an incident lives in). */
const partitionIndex = (d: Date): number => Number(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`);

/** A realistic Forcepoint DLP incident with the API's real field names. */
function incident() {
  const r = rng("forcepoint:incident:" + uuid());
  const channel = pick(r, CHANNELS);
  const user = pick(r, FP_USERS);
  const isEndpoint = channel.startsWith("ENDPOINT");
  const source = isEndpoint ? `${pick(r, FP_HOSTS)}\\${user}` : { email_address: `${user}@client.com` };
  const eventDate = new Date(Date.now() - int(r, 60_000, 30 * 86_400_000));
  const incidentDate = new Date(eventDate.getTime() + int(r, 2_000, 900_000));
  return {
    id: int(r, 100000, 9999999),
    event_id: String(int(r, 100_000_000, 999_999_999)),
    severity: pick(r, SEVERITIES),
    action: pick(r, ACTIONS),
    status: "NEW",
    channel,
    source,
    destination: pick(r, DESTINATIONS),
    policies: sample(r, POLICY_POOL, int(r, 1, 2)).join("; "),
    maximum_matches: int(r, 1, 240),
    violation_triggers: int(r, 1, 5),
    transaction_size: int(r, 1024, 52_428_800),
    event_time: fpDate(eventDate),
    incident_time: fpDate(incidentDate),
    partition_index: partitionIndex(eventDate),
    detected_by: pick(r, DETECTED_BY),
    analyzed_by: pick(r, ANALYZED_BY),
    details: pick(r, DETAILS),
    file_name: pick(r, FILE_NAMES),
    tag: chance(r, 0.3) ? pick(r, ["reviewed", "priority", "legal-hold"]) : null,
    released_incident: false,
    ignored_incidents: false,
  };
}

// -- policy metadata ----------------------------------------------------------
const ENABLED_POLICIES = ["PCI", "Credit Cards", "HIPAA", "Source Code Protection", "GDPR - EU Personal Data"] as const;
const CLASSIFIERS: Record<string, string[]> = {
  "PCI": ["Credit Card Number (default)", "PCI DSS - Cardholder Data", "Magnetic Strip Data"],
  "Credit Cards": ["Credit Card Number (default)", "CCN - Wide", "PAN Regex Pattern"],
  "HIPAA": ["US: Protected Health Information (PHI)", "Medical Record Number", "ICD-10 Diagnosis Codes"],
  "Source Code Protection": ["Source Code: C/C++", "Source Code: Java", "Source Code: Python"],
  "GDPR - EU Personal Data": ["EU: Personal Data (combination)", "EU: National ID Numbers", "IBAN"],
  "Confidential - Financials": ["Confidential Marker", "Financial Statements", "Key Financial Terms"],
};
const classifiersFor = (name: string): string[] => CLASSIFIERS[name] || ["Default Classifier", "Custom Dictionary", "Regular Expression"];

export const forcepoint: ToolDef = {
  id: "forcepoint-dlp",
  name: "Forcepoint DLP",
  vendor: "Forcepoint",
  category: "dlp",
  crafted: true,
  aiTool: true,
  summary:
    "Forcepoint Data Loss Prevention via the Data Security REST API - search and remediate policy-violation incidents across email, web, endpoint and CASB channels, and inspect enabled policies and their rules. Incidents are stateful and persisted.",
  tags: ["dlp", "data-security", "incidents", "forcepoint", "policy", "endpoint", "casb"],
  auth: { type: "bearer" },
  docsUrl: "https://help.forcepoint.com/dlp/90/restapi/",
  defaultLatencyMs: 350,
  endpoints: [
    {
      method: "POST",
      path: "/dlp/rest/v1/auth/refresh-token",
      operation: "getRefreshToken",
      summary: "Obtain the initial refresh + access token pair. Credentials are passed as `username` and `password` HTTP request HEADERS (not in the body).",
      request: {},
      params: [
        { name: "username", in: "header", type: "string", required: true, description: "DLP admin account username (sent as an HTTP header, not in the body)." },
        { name: "password", in: "header", type: "string", required: true, description: "Password for that admin account (sent as an HTTP header)." },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: {
          refresh_token: mockJwt(),
          refresh_expires_in: "86400",
          access_token: mockJwt(),
          access_expires_in: "900",
          token_type: "JWT",
        },
      }),
    },
    {
      method: "POST",
      path: "/dlp/rest/v1/auth/access-token",
      operation: "getAccessToken",
      summary: "Refresh the short-lived access token using the refresh token (sent as the Authorization bearer). Note the response field name intentionally differs from refresh-token (access_token_expires_in vs access_expires_in).",
      request: {},
      params: [
        { name: "Authorization", in: "header", type: "string", required: true, format: "Bearer <refresh_token>", description: "The refresh_token returned by /auth/refresh-token, sent as a bearer token." },
      ],
      respond: (): MockResult => ({
        status: 200,
        body: {
          access_token: mockJwt(),
          access_token_expires_in: 900,
          token_type: "JWT",
        },
      }),
    },
    {
      method: "POST",
      path: "/dlp/rest/v1/incidents",
      operation: "searchIncidents",
      summary: "Search DLP incidents over a time window with filters (severity, action, channel, status) or by explicit ids. Stateful - returns the persisted incident collection, optionally filtered by status.",
      aiTool: true,
      request: { type: "INCIDENTS", from_date: "01/08/2021 16:00:00", to_date: "12/08/2021 20:00:00", severity: "HIGH", action: "BLOCKED", channel: "EMAIL", status: "NEW", sort_by: "INSERT_DATE" },
      params: [
        { name: "type", in: "body", type: "string", required: true, enum: ["INCIDENTS"], default: "INCIDENTS", description: "Report type to query." },
        { name: "from_date", in: "body", type: "string", format: "dd/MM/yyyy HH:mm:ss", example: "01/08/2021 16:00:00", description: "Start of the time window (day-first timestamp)." },
        { name: "to_date", in: "body", type: "string", format: "dd/MM/yyyy HH:mm:ss", example: "12/08/2021 20:00:00", description: "End of the time window (day-first timestamp)." },
        { name: "severity", in: "body", type: "string", enum: ["HIGH", "MEDIUM", "LOW"], description: "Filter by incident severity." },
        { name: "action", in: "body", type: "string", enum: ["BLOCKED", "QUARANTINED", "RELEASED", "AUDITED", "ENCRYPTED"], description: "Filter by the enforcement action taken." },
        { name: "channel", in: "body", type: "string", enum: ["EMAIL", "HTTP", "HTTPS", "FTP", "ENDPOINT_REMOVABLE_MEDIA", "ENDPOINT_PRINTING", "ENDPOINT_APPLICATION", "CASB_REAL_TIME"], description: "Filter by the egress channel the violation occurred on." },
        { name: "status", in: "body", type: "string", enum: ["NEW", "IN_PROCESS", "ESCALATED", "FALSE_POSITIVE", "CLOSED"], description: "Workflow status - this is the active server-side filter." },
        { name: "sort_by", in: "body", type: "string", enum: ["INSERT_DATE", "EVENT_TIME", "SEVERITY"], default: "INSERT_DATE", description: "Sort field for the result set." },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        if (!dbAvailable()) {
          const incidents = Array.from({ length: 6 }, incident);
          return { status: 200, body: { total_count: incidents.length, total_returned: incidents.length, not_found_ids: [], incidents, note: "database offline - synthetic, not persisted" } };
        }
        await ensureSeeded("forcepoint-dlp", "incidents", 6, () => { const d = incident(); return { id: String(d.id), data: d }; });
        const status = ctx.body?.status ? String(ctx.body.status).toUpperCase() : null;
        const { items, total } = await listResources("forcepoint-dlp", "incidents", { limit: 200, status });
        const incidents = items.map((row) => row.data);
        return { status: 200, body: { total_count: total, total_returned: incidents.length, not_found_ids: [], incidents } };
      },
    },
    {
      method: "POST",
      path: "/dlp/rest/v1/incidents/update",
      operation: "updateIncidents",
      summary: "Update one or more incidents - change status, severity, assignee, tag, mark false-positive, or release. Stateful mutation persisted to the incident collection.",
      aiTool: true,
      emits: "incident.updated",
      request: { type: "INCIDENTS", action_type: "STATUS", value: "ESCALATED", incident_keys: [{ incident_id: 1234567, partition_index: 20260701 }] },
      params: [
        { name: "type", in: "body", type: "string", required: true, enum: ["INCIDENTS"], default: "INCIDENTS", description: "Report type being updated." },
        { name: "action_type", in: "body", type: "string", required: true, enum: ["STATUS", "SEVERITY", "ASSIGN_TO", "TAG", "FALSE_POSITIVE", "RELEASE"], description: "Which field to change on the target incidents." },
        { name: "value", in: "body", type: "string", description: "New value; meaning depends on action_type (a status for STATUS, a severity for SEVERITY, a username for ASSIGN_TO, a label for TAG). Ignored for FALSE_POSITIVE / RELEASE." },
        { name: "incident_keys", in: "body", type: "array", required: true, description: "The incidents to update (one entry per incident)." },
        { name: "incident_keys[].incident_id", in: "body", type: "integer", required: true, example: 1234567, description: "Incident id - the `id` field from a search result." },
        { name: "incident_keys[].partition_index", in: "body", type: "integer", format: "yyyyMMdd", example: 20260701, description: "DB partition the incident lives in - the `partition_index` from a search result." },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const actionType = String(ctx.body?.action_type || "STATUS").toUpperCase();
        const value = ctx.body?.value;
        const keys: Array<{ incident_id: number | string; partition_index: number }> = ctx.body?.incident_keys || [];
        const patch: Record<string, any> = (() => {
          switch (actionType) {
            case "SEVERITY": return { severity: value };
            case "ASSIGN_TO": return { assigned_to: value };
            case "TAG": return { tag: value };
            case "FALSE_POSITIVE": return { status: "FALSE_POSITIVE" };
            case "RELEASE": return { released_incident: true, action: "RELEASED" };
            case "STATUS":
            default: return { status: String(value ?? "").toUpperCase() };
          }
        })();
        const updated: Array<{ incident_id: number | string; partition_index: number; result: string }> = [];
        const notFound: Array<number | string> = [];
        for (const key of keys) {
          const res = await patchResource("forcepoint-dlp", "incidents", String(key.incident_id), patch);
          if (res) updated.push({ incident_id: key.incident_id, partition_index: key.partition_index, result: "SUCCESS" });
          else notFound.push(key.incident_id);
        }
        return { status: 200, body: { total_count: keys.length, total_returned: updated.length, updated_incidents: updated, not_found_ids: notFound } };
      },
    },
    {
      method: "GET",
      path: "/dlp/rest/v1/policy/enabled-names",
      operation: "listEnabledPolicies",
      summary: "List the names of all enabled policies for a policy type (type=DLP or DISCOVERY).",
      aiTool: true,
      request: { type: "DLP" },
      params: [
        { name: "type", in: "query", type: "string", required: true, enum: ["DLP", "DISCOVERY"], default: "DLP", description: "Policy type to list." },
      ],
      respond: (): MockResult => ({ status: 200, body: { policies: [...ENABLED_POLICIES] } }),
    },
    {
      method: "GET",
      path: "/dlp/rest/v1/policy/rules",
      operation: "getPolicyRules",
      summary: "Get the rules (classifiers + match condition) configured for a named policy.",
      aiTool: true,
      request: { policyName: "PCI" },
      params: [
        { name: "policyName", in: "query", type: "string", required: true, enum: ["PCI", "Credit Cards", "HIPAA", "Source Code Protection", "GDPR - EU Personal Data", "Confidential - Financials"], default: "PCI", description: "Policy whose rules to return. These are the seeded policies; other names return a generic rule set." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const name = ctx.query.policyName || "PCI";
        const r = rng("forcepoint:rules:" + name);
        const rules = classifiersFor(name).map((c, i) => ({
          rule_name: `${name} - Rule ${i + 1}`,
          enabled: true,
          classifiers: [c],
          condition: { operator: "AND", match_type: "AT_LEAST", threshold: int(r, 1, 10) },
        }));
        return { status: 200, body: { policyName: name, total_count: rules.length, rules } };
      },
    },
    {
      method: "GET",
      path: "/dlp/rest/v1/policy/rules/severity-action",
      operation: "getPolicyRulesSeverityAction",
      summary: "Get the severity thresholds and enforcement actions configured on a named policy's rules.",
      aiTool: true,
      request: { policyName: "PCI" },
      params: [
        { name: "policyName", in: "query", type: "string", required: true, enum: ["PCI", "Credit Cards", "HIPAA", "Source Code Protection", "GDPR - EU Personal Data", "Confidential - Financials"], default: "PCI", description: "Policy whose severity/action configuration to return." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const name = ctx.query.policyName || "PCI";
        const r = rng("forcepoint:sevaction:" + name);
        const rules = classifiersFor(name).map((c, i) => ({
          rule_name: `${name} - Rule ${i + 1}`,
          classifier: c,
          severity_thresholds: [
            { severity: "LOW", from_matches: 1, to_matches: 9 },
            { severity: "MEDIUM", from_matches: 10, to_matches: 99 },
            { severity: "HIGH", from_matches: 100, to_matches: null },
          ],
          action_plan: pick(r, ["Audit Only", "Block All", "Quarantine", "Encrypt", "Audit and Notify Manager"]),
        }));
        return { status: 200, body: { policyName: name, rules } };
      },
    },
    {
      method: "GET",
      path: "/dlp/rest/v1/policy/rules/source-destination",
      operation: "getPolicyRulesSourceDestination",
      summary: "Get the source and destination configuration for a named policy's rules.",
      aiTool: true,
      request: { policyName: "PCI" },
      params: [
        { name: "policyName", in: "query", type: "string", required: true, enum: ["PCI", "Credit Cards", "HIPAA", "Source Code Protection", "GDPR - EU Personal Data", "Confidential - Financials"], default: "PCI", description: "Policy whose source/destination configuration to return." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const name = ctx.query.policyName || "PCI";
        const rules = classifiersFor(name).map((c, i) => ({
          rule_name: `${name} - Rule ${i + 1}`,
          classifier: c,
          sources: { directory_entries: ["All Users"], excluded_entries: ["Security Administrators"] },
          destinations: {
            channels: ["EMAIL", "HTTP", "HTTPS", "ENDPOINT_REMOVABLE_MEDIA"],
            networks: ["Any External Domain"],
            excluded_domains: ["client.com", "partner.example.com"],
          },
        }));
        return { status: 200, body: { policyName: name, rules } };
      },
    },
    {
      method: "GET",
      path: "/dlp/rest/v1/policy/rules/exceptions/all",
      operation: "listRuleExceptions",
      summary: "List all rule exceptions defined across policies of a given type (type=DLP or DISCOVERY).",
      aiTool: true,
      request: { type: "DLP" },
      params: [
        { name: "type", in: "query", type: "string", required: true, enum: ["DLP", "DISCOVERY"], default: "DLP", description: "Policy type whose rule exceptions to list." },
      ],
      respond: (): MockResult => {
        const exceptions = [
          { exception_name: "Executive Whitelist", policy: "PCI", rule: "PCI - Rule 1", type: "SOURCE", entries: ["CFO", "CEO"], action: "PERMIT" },
          { exception_name: "Approved Partners", policy: "GDPR - EU Personal Data", rule: "GDPR - EU Personal Data - Rule 1", type: "DESTINATION", entries: ["partner.example.com"], action: "PERMIT" },
          { exception_name: "Legal Hold Bypass", policy: "HIPAA", rule: "HIPAA - Rule 2", type: "SOURCE", entries: ["Legal Department"], action: "AUDIT" },
        ];
        return { status: 200, body: { total_count: exceptions.length, exceptions } };
      },
    },
  ],
  events: [
    {
      type: "incident.created",
      summary: "A DLP policy violation incident was raised.",
      persist: { collection: "incidents", idOf: (d) => String(d.id) },
      sample: incident,
    },
    {
      type: "incident.updated",
      summary: "A DLP incident was updated.",
      sample: () => ({ ...incident(), status: "ESCALATED" }),
    },
  ],
};
