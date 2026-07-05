import type { CategoryId } from "./types";

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  /** lucide-react icon name, resolved in the UI via lib/icons. */
  icon: string;
  blurb: string;
}

/** Ordered for display in the sidebar / catalog filter. */
export const CATEGORIES: CategoryMeta[] = [
  { id: "ai-security", label: "AI Security & Guardrails", icon: "ShieldHalf", blurb: "Prompt-injection, PII, jailbreak and content guardrails for LLM workflows." },
  { id: "threat-intel", label: "Threat Intelligence", icon: "Radar", blurb: "IP/domain/file reputation, CVE and threat-actor enrichment." },
  { id: "edr", label: "Endpoint (EDR)", icon: "Laptop", blurb: "Detections, devices and response actions on endpoints." },
  { id: "siem", label: "SIEM & Logging", icon: "ScrollText", blurb: "Offenses, searches and event analytics." },
  { id: "network", label: "Network & Firewall", icon: "Network", blurb: "Firewall policy, web gateways and managed networking." },
  { id: "cloud-security", label: "Cloud Security", icon: "CloudCog", blurb: "Cloud resource inventory, posture findings and issue management." },
  { id: "identity", label: "Identity & Access", icon: "KeyRound", blurb: "Users, sign-ins, verification and access management." },
  { id: "dlp", label: "Data Loss Prevention", icon: "FileLock2", blurb: "Detect and redact sensitive data (PII/PHI/PCI)." },
  { id: "vuln-mgmt", label: "Vulnerability Management", icon: "ShieldAlert", blurb: "Asset scans, findings and remediation tracking." },
  { id: "monitoring", label: "Monitoring & Observability", icon: "Gauge", blurb: "Metrics, logs and telemetry from infrastructure." },
  { id: "soar", label: "SOAR & Incident Response", icon: "Workflow", blurb: "Playbooks, incidents and security automation." },
  { id: "awareness", label: "Security Awareness", icon: "GraduationCap", blurb: "Phishing simulation and training programs." },
  { id: "pki", label: "Certificates & PKI", icon: "BadgeCheck", blurb: "Certificate issuance, inventory and validation." },
  { id: "forensics", label: "DFIR & Malware Analysis", icon: "Microscope", blurb: "Sandbox detonation, file analysis and investigations." },
  { id: "automation", label: "Automation & Browser", icon: "MousePointerClick", blurb: "Browser agents and captcha solving." },
  { id: "data-security", label: "Data Security", icon: "Lock", blurb: "Data-centric protection, rights and encryption." },
  { id: "device-mgmt", label: "Device & Fleet", icon: "Smartphone", blurb: "Track, secure and act on a device fleet." },
  { id: "itam", label: "ITAM & CMDB", icon: "Boxes", blurb: "IT asset inventory, configuration items and CMDB records." },
  { id: "enrichment", label: "Identity Enrichment", icon: "Contact", blurb: "Resolve and enrich person/company identifiers." },
];

export const CATEGORY_MAP: Record<CategoryId, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c])
) as Record<CategoryId, CategoryMeta>;

export function categoryLabel(id: CategoryId): string {
  return CATEGORY_MAP[id]?.label ?? id;
}
