// ============================================================================
// Adapter metadata for every tool in the registry (PLAN §4). This is the
// adapters-catalog layer: connection form specs, asset types, fetch steps
// ("APIs used"), heartbeat probes, vendor permissions for the docs.
//
// W6 appends scaffold-adapter entries here; nobody else edits this file.
// ============================================================================

import type { AdapterMeta, ConnectionParamSpec } from "./types";

const p = (spec: ConnectionParamSpec) => spec;
const domain = (label: string, placeholder: string, def?: string) =>
  p({ key: "domain", label, type: "string", required: true, placeholder, default: def });
const password = (key: string, label: string, description?: string) =>
  p({ key, label, type: "password", required: true, description });
const username = (label = "User Name") => p({ key: "username", label, type: "string", required: true });

export const ADAPTER_META: AdapterMeta[] = [
  {
    toolId: "virustotal",
    blurb: "File, URL, IP and domain reputation from 70+ AV engines — enrichment-only adapter.",
    categories: ["forensics", "threat-intel"],
    assetTypes: [],
    connectionParams: [password("api_key", "VirusTotal API Key")],
    fetchSteps: [],
    heartbeat: { operation: "getIpReport", pathParams: { ip: "8.8.8.8" } },
    permissionsRequired: ["Standard API key (public or premium)"],
    sessionTtlMinutes: 60,
  },
  {
    toolId: "crowdstrike",
    blurb: "EDR devices, detections and Spotlight vulnerabilities from the Falcon platform.",
    categories: ["edr", "vuln-mgmt"],
    assetTypes: ["device", "vulnerability", "alert"],
    connectionParams: [
      p({ key: "domain", label: "CrowdStrike Cloud Domain", type: "select", required: true, options: ["api.crowdstrike.com", "api.us-2.crowdstrike.com", "api.eu-1.crowdstrike.com"], default: "api.crowdstrike.com" }),
      p({ key: "client_id", label: "Client ID", type: "string", required: true, placeholder: "OAuth2 API client id" }),
      password("client_secret", "Client Secret", "OAuth2 API client secret"),
    ],
    fetchSteps: [
      { operation: "getDeviceEntities", assetType: "device", recordsPath: "resources", summary: "Full device records (hosts) — GET /devices/entities/devices/v2" },
      { operation: "listVulnerabilities", assetType: "vulnerability", recordsPath: "resources", summary: "Spotlight vulnerabilities — GET /spotlight/queries/vulnerabilities/v1" },
    ],
    heartbeat: { operation: "listDetections" },
    permissionsRequired: ["Hosts: Read", "Detections: Read", "Vulnerabilities (Spotlight): Read"],
    sessionTtlMinutes: 30,
  },
  {
    toolId: "qualys",
    blurb: "VMDR host inventory and vulnerability detections from the Qualys Cloud Platform.",
    categories: ["vuln-mgmt"],
    assetTypes: ["device", "vulnerability"],
    connectionParams: [
      domain("Qualys API Server", "qualysapi.qualys.com"),
      username(),
      password("password", "Password"),
    ],
    fetchSteps: [
      { operation: "listHosts", assetType: "device", recordsPath: "HOST_LIST_OUTPUT.RESPONSE.HOST_LIST", summary: "Host inventory — GET /api/2.0/fo/asset/host/" },
      { operation: "listDetections", assetType: "vulnerability", recordsPath: "HOST_LIST_VM_DETECTION_OUTPUT.RESPONSE.HOST_LIST", summary: "Per-host VM detections — GET /api/2.0/fo/asset/host/vm/detection/" },
    ],
    heartbeat: { operation: "listScans" },
    permissionsRequired: ["Manager or Reader role with API access"],
    sessionTtlMinutes: 30,
  },
  {
    toolId: "entra-id",
    blurb: "Users, groups, sign-ins and identity risk from Microsoft Entra ID (Graph).",
    categories: ["identity"],
    assetTypes: ["user"],
    connectionParams: [
      p({ key: "tenant_id", label: "Azure Tenant ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" }),
      p({ key: "client_id", label: "Azure Client ID", type: "string", required: true, placeholder: "App registration (client) id" }),
      password("client_secret", "Azure Client Secret"),
    ],
    fetchSteps: [
      { operation: "listUsers", assetType: "user", recordsPath: "value", summary: "Directory users — GET /v1.0/users" },
    ],
    heartbeat: { operation: "listUsers", query: { $top: "1" } },
    permissionsRequired: ["User.Read.All", "Directory.Read.All", "AuditLog.Read.All"],
    sessionTtlMinutes: 60,
  },
  {
    toolId: "forcepoint-dlp",
    blurb: "DLP incidents and policy telemetry from Forcepoint Data Security.",
    categories: ["dlp", "data-security"],
    assetTypes: [],
    connectionParams: [
      domain("Forcepoint Security Manager URL", "fsm.company.example"),
      username(),
      password("password", "Password"),
    ],
    fetchSteps: [],
    heartbeat: { operation: "listEnabledPolicies" },
    permissionsRequired: ["DLP REST API application account"],
    sessionTtlMinutes: 15,
  },
  {
    toolId: "recorded-future",
    blurb: "Threat-intel enrichment for IPs, domains, hashes, URLs and CVEs.",
    categories: ["threat-intel"],
    assetTypes: [],
    connectionParams: [password("api_token", "Recorded Future API Token")],
    fetchSteps: [],
    heartbeat: { operation: "enrichIp", pathParams: { ip: "8.8.8.8" } },
    permissionsRequired: ["API token with Connect API access"],
    sessionTtlMinutes: 60,
  },
  {
    toolId: "trellix-epo",
    blurb: "Managed endpoint inventory, tags and tasks from Trellix ePolicy Orchestrator.",
    categories: ["edr", "device-mgmt"],
    assetTypes: ["device"],
    connectionParams: [
      domain("ePO Server", "epo.company.example"),
      p({ key: "port", label: "Port", type: "number", default: 8443 }),
      username(),
      password("password", "Password"),
    ],
    fetchSteps: [
      { operation: "systemFind", assetType: "device", recordsPath: "$", summary: "Managed systems — GET /remote/system.find" },
    ],
    heartbeat: { operation: "coreHelp" },
    permissionsRequired: ["ePO user with Systems view permission"],
    sessionTtlMinutes: 20,
  },
  {
    toolId: "cisco-meraki",
    blurb: "Organization networks, network devices and clients from the Meraki Dashboard.",
    categories: ["network", "device-mgmt"],
    assetTypes: ["device"],
    connectionParams: [
      domain("Cisco Meraki Domain", "api.meraki.com", "api.meraki.com"),
      password("api_key", "API Key", "Dashboard API key (Organization: Read)"),
    ],
    fetchSteps: [
      { operation: "getOrganizationDevices", assetType: "device", recordsPath: "$", pathParams: { organizationId: "org-emu-1" }, summary: "Org device inventory — GET /organizations/{organizationId}/devices" },
    ],
    heartbeat: { operation: "getOrganizations" },
    permissionsRequired: ["Organization (Read) access"],
    sessionTtlMinutes: 45,
  },
  {
    toolId: "cisco-umbrella",
    blurb: "DNS-layer security activity, destinations and policy from Cisco Umbrella.",
    categories: ["network"],
    assetTypes: [],
    connectionParams: [
      p({ key: "api_key", label: "API Key", type: "string", required: true }),
      password("api_secret", "API Secret"),
    ],
    fetchSteps: [],
    heartbeat: { operation: "listDestinationLists" },
    permissionsRequired: ["Umbrella API key (Reports: Read, Policies: Read)"],
    sessionTtlMinutes: 30,
  },
  {
    toolId: "digicert",
    blurb: "Certificate orders, domains and organizations from DigiCert CertCentral.",
    categories: ["pki"],
    assetTypes: [],
    connectionParams: [password("api_key", "CertCentral API Key")],
    fetchSteps: [],
    heartbeat: { operation: "listOrders" },
    permissionsRequired: ["API key with Orders: View"],
    sessionTtlMinutes: 60,
  },
  {
    toolId: "zscaler-zpa",
    blurb: "Application segments, connectors and access policy from Zscaler Private Access.",
    categories: ["network"],
    assetTypes: [],
    connectionParams: [
      domain("ZPA API Host", "config.private.zscaler.com", "config.private.zscaler.com"),
      p({ key: "client_id", label: "Client ID", type: "string", required: true }),
      password("client_secret", "Client Secret"),
      p({ key: "customer_id", label: "Customer ID", type: "string", required: true }),
    ],
    fetchSteps: [],
    heartbeat: { operation: "listApplicationSegments", pathParams: { customerId: "emu-cust-1" } },
    permissionsRequired: ["Read: Application Segments, Access Policies"],
    sessionTtlMinutes: 30,
  },
  {
    toolId: "zscaler-zia",
    blurb: "Web security users, URL policy and sandbox verdicts from Zscaler Internet Access.",
    categories: ["network", "identity"],
    assetTypes: ["user"],
    connectionParams: [
      domain("ZIA Admin Domain", "admin.zscalerthree.net"),
      username("Admin User Name"),
      password("password", "Password"),
      password("api_key", "API Key", "Obfuscated cloud API key"),
    ],
    fetchSteps: [
      { operation: "listUsers", assetType: "user", recordsPath: "$", summary: "ZIA user directory — GET /users" },
    ],
    heartbeat: { operation: "getActivationStatus" },
    permissionsRequired: ["Admin role: Dashboard View-Only, Usernames Visible"],
    sessionTtlMinutes: 25,
  },
  {
    toolId: "zscaler-rba",
    blurb: "Organization-wide risk scoring and risk events from Zscaler Risk360.",
    categories: ["monitoring"],
    assetTypes: [],
    connectionParams: [
      p({ key: "client_id", label: "Client ID", type: "string", required: true }),
      password("client_secret", "Client Secret"),
    ],
    fetchSteps: [],
    heartbeat: { operation: "listRiskFactors" },
    permissionsRequired: ["Risk360 API client (Read)"],
    sessionTtlMinutes: 30,
  },
  {
    toolId: "zscaler-ai-guard",
    blurb: "GenAI prompt inspection, detectors and AI app risk from Zscaler AI Guard.",
    categories: ["ai-security"],
    assetTypes: [],
    connectionParams: [password("api_key", "AI Guard API Key")],
    fetchSteps: [],
    heartbeat: { operation: "listDetectors" },
    permissionsRequired: ["AI Guard API key (Detection: Execute, Policies: Read)"],
    sessionTtlMinutes: 30,
  },
  {
    toolId: "appomni-agentguard",
    blurb: "SaaS posture findings and AI-agent guardrails from AppOmni AgentGuard.",
    categories: ["ai-security", "data-security"],
    assetTypes: ["saas_app", "alert"],
    connectionParams: [
      domain("AppOmni Tenant URL", "tenant.appomni.example"),
      password("api_token", "API Token"),
    ],
    fetchSteps: [
      { operation: "listMonitoredServices", assetType: "saas_app", recordsPath: "results", summary: "Monitored SaaS services — GET /api/v1/monitored-services" },
    ],
    heartbeat: { operation: "listMonitoredServices" },
    permissionsRequired: ["API token with posture read scope"],
    sessionTtlMinutes: 30,
  },
];

const META_BY_TOOL = new Map(ADAPTER_META.map((m) => [m.toolId, m]));

export function adapterMeta(toolId: string): AdapterMeta | undefined {
  return META_BY_TOOL.get(toolId);
}

export function allAdapterMeta(): AdapterMeta[] {
  return ADAPTER_META;
}

/** Params whose values must be redacted in API responses / UI. */
export function secretParamKeys(meta: AdapterMeta): Set<string> {
  return new Set(meta.connectionParams.filter((cp) => cp.type === "password").map((cp) => cp.key));
}
