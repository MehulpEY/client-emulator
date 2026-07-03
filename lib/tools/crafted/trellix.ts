import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, chance, fakeIp, minutesAgoIso, daysAgoIso, uuid, HOSTNAMES, USERS, MALWARE_FAMILIES } from "../helpers";

// Trellix ePolicy Orchestrator (ePO) - classic on-prem Web API. Commands are
// invoked as GET/POST /remote/<command> and secured with HTTP Basic auth. The
// distinctive wire quirk of this API is reproduced faithfully: a *successful*
// response is NOT pure JSON - the body is the literal "OK:" followed by a
// newline and then the payload (JSON for structured commands, plain text for
// help/actions); failures come back as "Error <code>: <message>". Responses are
// seeded from the request input so the same searchText / names return a stable
// result across calls, and the values use real ePO column names (dotted
// EPOComputerProperties.* / EPOLeafNode.* / EPOEvents.* fields).

/** ePO agent GUID - 8-4-4-4-12 hex, upper-cased like the console shows it. */
function agentGuid(seed: string): string {
  const r = rng("trellix:guid:" + seed);
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${h(8)}-${h(4)}-${h(4)}-${h(4)}-${h(12)}`.toUpperCase();
}

/** Wrap a payload the way ePO does: `OK:` + newline + serialized body. */
const okJson = (data: any): MockResult => ({
  status: 200,
  body: "OK:\n" + JSON.stringify(data, null, 0),
  headers: { "content-type": "text/plain" },
});
const okText = (text: string): MockResult => ({
  status: 200,
  body: "OK:\n" + text,
  headers: { "content-type": "text/plain" },
});

const OS_TYPES: readonly [string, string][] = [
  ["Windows 10", "10.0.19045"],
  ["Windows 11", "10.0.22631"],
  ["Windows Server 2019", "10.0.17763"],
  ["Windows Server 2022", "10.0.20348"],
  ["macOS", "14.5"],
  ["Linux", "5.15.0-101-generic"],
];
const CPU_TYPES = [
  "Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz",
  "Intel(R) Core(TM) i5-1145G7 @ 2.60GHz",
  "Intel(R) Xeon(R) Gold 6226R CPU @ 2.90GHz",
  "AMD Ryzen 7 PRO 5850U",
  "Apple M2",
] as const;
const AGENT_VERSIONS = ["5.7.9.190", "5.7.8.221", "5.7.6.180", "5.8.0.220"] as const;
const TAGS = ["Server", "Workstation", "Laptop", "FinanceDept", "Quarantine", "Managed", "SCAN_PENDING"] as const;
const GROUP_PATHS = [
  "My Organization\\Customers\\Finance",
  "My Organization\\Customers\\Sales",
  "My Organization\\Servers\\Domain Controllers",
  "My Organization\\Workstations\\Corporate",
  "My Organization\\Lost&Found",
] as const;

const THREAT_NAMES = [...MALWARE_FAMILIES, "EICAR test file", "GenericRXAA-FA!D4C3B2A1", "Artemis!1A2B3C4D5E6F"] as const;
const THREAT_TYPES = ["Trojan", "Virus", "Potentially Unwanted Program", "Ransomware", "Exploit", "Backdoor"] as const;
const THREAT_ACTIONS: readonly [string, string][] = [
  ["IDS_ALERT_ACT_TAK_DEL", "deleted"],
  ["IDS_ALERT_ACT_TAK_CLE", "cleaned"],
  ["IDS_ALERT_ACT_TAK_BLK", "blocked"],
  ["IDS_ALERT_ACT_TAK_QUA", "quarantined"],
  ["IDS_ALERT_ACT_TAK_CON", "would be blocked"],
];
const ANALYZERS: readonly [string, string][] = [
  ["Endpoint Security Threat Prevention", "10.7.0.5312"],
  ["VirusScan Enterprise", "8.8.0.2302"],
  ["ENSLTP", "10.7.9"],
  ["Endpoint Security Adaptive Threat Protection", "10.7.0.5312"],
];
const SOURCE_PROCESSES = ["powershell.exe", "winword.exe", "chrome.exe", "explorer.exe", "cmd.exe", "outlook.exe", "wscript.exe", "rundll32.exe"] as const;

/** A managed system row: EPOComputerProperties.* joined with EPOLeafNode.* / EPOBranchNode.*. */
function systemRecord(seed: string, hostname: string) {
  const r = rng("trellix:system:" + seed);
  const [osType, osVersion] = pick(r, OS_TYPES);
  const user = pick(r, USERS);
  return {
    "EPOComputerProperties.ComputerName": hostname,
    "EPOComputerProperties.IPAddress": fakeIp(r),
    "EPOComputerProperties.IPHostName": `${hostname.toLowerCase()}.corp.local`,
    "EPOComputerProperties.OSType": osType,
    "EPOComputerProperties.OSVersion": osVersion,
    "EPOComputerProperties.CPUType": pick(r, CPU_TYPES),
    "EPOComputerProperties.UserName": `CORP\\${user}`,
    "EPOComputerProperties.LastUpdate": daysAgoIso(int(r, 0, 6)),
    "EPOLeafNode.NodeName": hostname,
    "EPOLeafNode.AutoID": int(r, 100, 9999),
    "EPOLeafNode.AgentGUID": agentGuid(seed),
    "EPOLeafNode.Tags": sample(r, TAGS, int(r, 1, 3)).join(", "),
    "EPOLeafNode.ManagedState": 1,
    "EPOLeafNode.AgentVersion": pick(r, AGENT_VERSIONS),
    "EPOBranchNode.AutoID": int(r, 2, 40),
  };
}

/** A threat/product event row (EPOEvents.*). */
function epoEvent(seed: string) {
  const r = rng("trellix:event:" + seed);
  const hostname = pick(r, HOSTNAMES);
  const user = pick(r, USERS);
  const [analyzer, analyzerVersion] = pick(r, ANALYZERS);
  const [actionCode] = pick(r, THREAT_ACTIONS);
  const proc = pick(r, SOURCE_PROCESSES);
  return {
    "EPOEvents.DetectedUTC": minutesAgoIso(int(r, 1, 20160)),
    "EPOEvents.ThreatName": pick(r, THREAT_NAMES),
    "EPOEvents.ThreatType": pick(r, THREAT_TYPES),
    "EPOEvents.ThreatSeverity": int(r, 1, 7),
    "EPOEvents.ThreatActionTaken": actionCode,
    "EPOEvents.AnalyzerName": analyzer,
    "EPOEvents.AnalyzerVersion": analyzerVersion,
    "EPOEvents.SourceProcessName": proc,
    "EPOEvents.TargetFileName": `C:\\Users\\${user}\\Downloads\\${pick(r, ["invoice_2024", "statement", "scan_0042", "update_setup", "resume"])}.${pick(r, ["exe", "docm", "js", "vbs", "dll"])}`,
    "EPOEvents.TargetHostName": hostname,
    "EPOEvents.SourceIPV4": fakeIp(r),
    "EPOEvents.AgentGUID": agentGuid("evt:" + seed),
  };
}

const HELP_TEXT = [
  "core.executeQuery queryId | target [where] [order] - Runs a saved or ad-hoc query and returns the results.",
  "core.help [command] - Displays a list of all commands, or help for a single command.",
  "core.listQueries - Displays all queries the current user can run.",
  "core.listTables - Displays all databases tables that can be queried.",
  "clienttask.find searchText - Finds client tasks matching the search text.",
  "policy.find searchText - Finds policies matching the search text.",
  "repository.pullNow [sourceRepository] - Pulls content from the source site into the master repository.",
  "system.applyTag names tagName - Applies the named tag to the specified systems.",
  "system.clearTag names tagName - Clears the named tag from the specified systems.",
  "system.find searchText - Finds systems in the System Tree.",
  "system.findGroups searchText - Finds groups in the System Tree.",
  "system.wakeupAgent names [fullProps] - Sends an agent wake-up call to the specified systems.",
].join("\n");

const TABLES = [
  {
    name: "EPOLeafNode",
    target: "EPOLeafNode",
    type: "target",
    description: "Managed systems (leaf nodes) in the System Tree.",
    columns: ["NodeName", "AutoID", "AgentGUID", "Tags", "ManagedState", "AgentVersion", "LastUpdate"],
  },
  {
    name: "EPOComputerProperties",
    target: "EPOComputerProperties",
    type: "table",
    description: "Reported computer properties for each managed system.",
    columns: ["ComputerName", "IPAddress", "IPHostName", "OSType", "OSVersion", "CPUType", "UserName", "LastUpdate"],
  },
  {
    name: "EPOEvents",
    target: "EPOEvents",
    type: "table",
    description: "Threat and product events reported to ePO by managed endpoints.",
    columns: ["DetectedUTC", "ThreatName", "ThreatType", "ThreatSeverity", "ThreatActionTaken", "AnalyzerName", "AnalyzerVersion", "SourceProcessName", "TargetFileName", "TargetHostName", "SourceIPV4", "AgentGUID"],
  },
  {
    name: "EPOBranchNode",
    target: "EPOBranchNode",
    type: "target",
    description: "System Tree groups (branch nodes).",
    columns: ["AutoID", "NodeName", "NodeTextPath2", "ParentID"],
  },
];

const CLIENT_TASKS = [
  { objectId: 3, objectName: "Daily Full Scan", productId: "ENDP_AM_1000", productName: "Endpoint Security Threat Prevention", typeId: 1, typeName: "Policy Based On-Demand Scan" },
  { objectId: 7, objectName: "Weekly Quick Scan", productId: "ENDP_AM_1000", productName: "Endpoint Security Threat Prevention", typeId: 1, typeName: "Policy Based On-Demand Scan" },
  { objectId: 12, objectName: "Product Update", productId: "EPOAGENTMETA", productName: "McAfee Agent", typeId: 8, typeName: "Product Update" },
  { objectId: 18, objectName: "Ad-Hoc Full Scan (Incident 4821)", productId: "ENDP_AM_1000", productName: "Endpoint Security Threat Prevention", typeId: 1, typeName: "Policy Based On-Demand Scan" },
];

const POLICIES = [
  { objectId: 42, objectName: "My Default", productId: "ENDP_AM_1000", featureId: "GENERAL", typeId: 3, typeName: "On-Access Scan" },
  { objectId: 55, objectName: "High Protection - Servers", productId: "ENDP_AM_1000", featureId: "EAM_General", typeId: 3, typeName: "On-Access Scan" },
  { objectId: 61, objectName: "Firewall Rules - Corporate", productId: "ENDP_FW_META", featureId: "FW_Rules", typeId: 5, typeName: "Rules" },
  { objectId: 73, objectName: "Adaptive Threat Protection - Balanced", productId: "ENDP_ATP_META", featureId: "ATP_Options", typeId: 2, typeName: "Options" },
];

export const trellixEpo: ToolDef = {
  id: "trellix-epo",
  name: "Trellix ePolicy Orchestrator (ePO)",
  vendor: "Trellix",
  category: "edr",
  crafted: true,
  aiTool: true,
  summary:
    "Trellix ePolicy Orchestrator (ePO) classic on-prem Web API - query the managed-system inventory, run ad-hoc EPOEvents threat queries, apply/clear tags, wake up agents, and trigger master-repository pulls. Every /remote/<command> response uses ePO's OK:-prefixed body convention.",
  tags: ["edr", "epo", "epolicy-orchestrator", "endpoint-security", "trellix", "mcafee", "antivirus"],
  auth: { type: "basic" },
  docsUrl: "https://docs.trellix.com/bundle/epolicy-orchestrator-web-api-reference-guide/",
  defaultLatencyMs: 350,
  endpoints: [
    {
      method: "GET",
      path: "/remote/core.help",
      operation: "coreHelp",
      summary: "List every available remote command with a one-line description (OK:-prefixed text).",
      request: {},
      params: [
        { name: "command", in: "query", type: "string", required: false, description: "Show help for a single command instead of listing all commands.", example: "system.find" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg).", enum: ["json", "xml", "terse", "verbose"], default: "terse" },
      ],
      respond: (): MockResult => okText(HELP_TEXT),
    },
    {
      method: "GET",
      path: "/remote/system.find",
      operation: "systemFind",
      summary: "Find managed systems in the System Tree by name, IP, or MAC (OK:-prefixed JSON array of property records).",
      aiTool: true,
      request: { searchText: "WIN-FIN" },
      params: [
        { name: "searchText", in: "query", type: "string", required: true, description: "Free-text match against system name, IP address, or MAC address.", example: "WIN-FIN" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const q = (ctx.query.searchText || "").trim();
        const matches = q ? HOSTNAMES.filter((h) => h.toLowerCase().includes(q.toLowerCase())) : HOSTNAMES.slice();
        const hosts = matches.length ? matches : HOSTNAMES.slice(0, 4);
        const rows = hosts.map((h, i) => systemRecord("find:" + q + ":" + i, h));
        return okJson(rows);
      },
    },
    {
      method: "GET",
      path: "/remote/system.findGroups",
      operation: "systemFindGroups",
      summary: "Find System Tree groups matching the search text (OK:-prefixed JSON array of { groupId, groupPath }).",
      aiTool: true,
      request: { searchText: "Finance" },
      params: [
        { name: "searchText", in: "query", type: "string", required: true, description: "Free-text match against System Tree group names/paths.", example: "Finance" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const q = (ctx.query.searchText || "").trim().toLowerCase();
        const matches = q ? GROUP_PATHS.filter((p) => p.toLowerCase().includes(q)) : GROUP_PATHS.slice();
        const groups = (matches.length ? matches : GROUP_PATHS.slice()).map((groupPath, i) => ({
          groupId: int(rng("trellix:group:" + groupPath), 2, 999),
          groupPath,
        }));
        return okJson(groups);
      },
    },
    {
      method: "GET",
      path: "/remote/system.applyTag",
      operation: "systemApplyTag",
      summary: "Apply a tag to one or more systems (comma-separated names). Returns the count of systems tagged.",
      aiTool: true,
      emits: "system.tagged",
      request: { names: "WIN-FIN-07,LT-SALES-22", tagName: "Quarantine" },
      params: [
        { name: "names", in: "query", type: "string", required: true, description: "Comma-separated list of system (node) names to tag.", example: "WIN-FIN-07,LT-SALES-22" },
        { name: "tagName", in: "query", type: "string", required: true, description: "Name of the tag to apply (free text; must already exist in ePO). Common tags: Server, Workstation, Laptop, Quarantine, Managed.", example: "Quarantine" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const names = (ctx.query.names || "").split(",").map((s) => s.trim()).filter(Boolean);
        return okJson(names.length || 1);
      },
    },
    {
      method: "GET",
      path: "/remote/system.clearTag",
      operation: "systemClearTag",
      summary: "Remove a tag from one or more systems (comma-separated names). Returns the count of systems cleared.",
      aiTool: true,
      emits: "system.tagCleared",
      request: { names: "WIN-FIN-07", tagName: "Quarantine" },
      params: [
        { name: "names", in: "query", type: "string", required: true, description: "Comma-separated list of system (node) names to clear the tag from.", example: "WIN-FIN-07" },
        { name: "tagName", in: "query", type: "string", required: true, description: "Name of the tag to remove (free text; must already exist in ePO). Common tags: Server, Workstation, Laptop, Quarantine, Managed.", example: "Quarantine" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const names = (ctx.query.names || "").split(",").map((s) => s.trim()).filter(Boolean);
        return okJson(names.length || 1);
      },
    },
    {
      method: "GET",
      path: "/remote/system.wakeupAgent",
      operation: "systemWakeupAgent",
      summary: "Send an agent wake-up call to force immediate agent-to-server communication.",
      aiTool: true,
      emits: "agent.wakeup",
      request: { names: "WIN-FIN-07,SRV-DC01" },
      params: [
        { name: "names", in: "query", type: "string", required: true, description: "Comma-separated list of system (node) names to send an agent wake-up call to.", example: "WIN-FIN-07,SRV-DC01" },
        { name: "fullProps", in: "query", type: "boolean", required: false, description: "When true, the agent sends full properties (not just deltas) on the forced check-in.", default: false, example: false },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg).", enum: ["json", "xml", "terse", "verbose"], default: "terse" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const names = (ctx.query.names || "").split(",").map((s) => s.trim()).filter(Boolean);
        const n = names.length || 1;
        return okText(`Wakeup agent call completed for ${n} system(s).`);
      },
    },
    {
      method: "POST",
      path: "/remote/core.executeQuery",
      operation: "coreExecuteQuery",
      summary: "Run an ad-hoc query against a table target (e.g. target=EPOEvents) and return matching rows.",
      aiTool: true,
      request: { target: "EPOEvents", order: "EPOEvents.DetectedUTC desc" },
      params: [
        { name: "queryId", in: "query", type: "string", required: false, description: "ID of a saved query to run. Provide either queryId (saved query) or target (ad-hoc query).", example: "3" },
        { name: "target", in: "query", type: "string", required: false, description: "Table/target to run an ad-hoc query against (see core.listTables). Only EPOEvents returns event rows; other targets return the managed-system inventory.", enum: ["EPOLeafNode", "EPOComputerProperties", "EPOEvents", "EPOBranchNode"], example: "EPOEvents" },
        { name: "where", in: "query", type: "string", required: false, description: "Optional filter expression restricting which rows are returned.", example: "(where (eq EPOEvents.ThreatType \"Ransomware\"))" },
        { name: "order", in: "query", type: "string", required: false, description: "Optional sort expression for the result rows.", example: "EPOEvents.DetectedUTC desc" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const target = ctx.query.target || ctx.body?.target || "EPOEvents";
        if (target === "EPOEvents") {
          const rows = Array.from({ length: 8 }, (_, i) => epoEvent("q:" + i));
          return okJson(rows);
        }
        // Any non-event target falls back to the managed-system inventory.
        const rows = HOSTNAMES.map((h, i) => systemRecord("q:" + target + ":" + i, h));
        return okJson(rows);
      },
    },
    {
      method: "GET",
      path: "/remote/core.listTables",
      operation: "coreListTables",
      summary: "List the database tables and targets that can be queried with core.executeQuery.",
      aiTool: true,
      request: {},
      params: [
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (): MockResult => okJson(TABLES),
    },
    {
      method: "GET",
      path: "/remote/clienttask.find",
      operation: "clienttaskFind",
      summary: "Find client tasks (e.g. on-demand scan tasks) matching the search text.",
      aiTool: true,
      request: { searchText: "Scan" },
      params: [
        { name: "searchText", in: "query", type: "string", required: true, description: "Free-text match against client-task name or task type.", example: "Scan" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const q = (ctx.query.searchText || "").trim().toLowerCase();
        const rows = q ? CLIENT_TASKS.filter((t) => t.objectName.toLowerCase().includes(q) || t.typeName.toLowerCase().includes(q)) : CLIENT_TASKS.slice();
        return okJson(rows);
      },
    },
    {
      method: "GET",
      path: "/remote/policy.find",
      operation: "policyFind",
      summary: "Find policies matching the search text (returns objectId/objectName/productId/featureId/typeId/typeName).",
      aiTool: true,
      request: { searchText: "Scan" },
      params: [
        { name: "searchText", in: "query", type: "string", required: true, description: "Free-text match against policy name or policy type.", example: "Scan" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg). Mock always returns JSON.", enum: ["json", "xml", "terse", "verbose"], default: "terse", example: "json" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const q = (ctx.query.searchText || "").trim().toLowerCase();
        const rows = q ? POLICIES.filter((p) => p.objectName.toLowerCase().includes(q) || p.typeName.toLowerCase().includes(q)) : POLICIES.slice();
        return okJson(rows);
      },
    },
    {
      method: "GET",
      path: "/remote/repository.pullNow",
      operation: "repositoryPullNow",
      summary: "Trigger an immediate pull of content from the source site into the master repository.",
      aiTool: true,
      emits: "repository.pulled",
      request: {},
      params: [
        { name: "sourceRepository", in: "query", type: "string", required: false, description: "Name of the source (fallback) site to pull content from. Defaults to the configured source site if omitted.", example: "McAfeeHttp" },
        { name: ":output", in: "query", type: "string", required: false, description: "Response serialization format (ePO reserved arg).", enum: ["json", "xml", "terse", "verbose"], default: "terse" },
      ],
      respond: (): MockResult => okText("Global updating pull from the master repository has started."),
    },
  ],
  events: [
    {
      type: "threat.detected",
      summary: "A threat event was reported to ePO.",
      sample: () => epoEvent("evt:" + uuid()),
    },
    {
      type: "system.tagged",
      summary: "A tag was applied to systems.",
      sample: () => ({ names: pick(rng("trellix:tagged:" + uuid()), HOSTNAMES), tagName: "Quarantine", applied: 1 }),
    },
  ],
};
