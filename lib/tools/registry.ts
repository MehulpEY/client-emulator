import type { ToolDef, ToolEndpoint } from "./types";
import { basePath } from "./types";
import { GENERIC_TOOLS } from "./generic";
import { virustotal } from "./crafted/virustotal";
import { abuseipdb } from "./crafted/abuseipdb";
import { crowdstrike } from "./crafted/crowdstrike";
import { twocaptcha } from "./crafted/twocaptcha";
import { qradar } from "./crafted/qradar";
import { qualys } from "./crafted/qualys";
import { hybridanalysis } from "./crafted/hybridanalysis";
import { nightfall } from "./crafted/nightfall";

const CRAFTED: ToolDef[] = [virustotal, abuseipdb, crowdstrike, twocaptcha, qradar, qualys, hybridanalysis, nightfall];

/** The full catalog, alphabetical by display name. Code is the source of truth. */
export const TOOLS: ToolDef[] = [...CRAFTED, ...GENERIC_TOOLS].sort((a, b) =>
  a.name.localeCompare(b.name)
);

const BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): ToolDef | undefined {
  return BY_ID.get(id);
}

export function toolCount(): number {
  return TOOLS.length;
}

export function endpointCount(): number {
  return TOOLS.reduce((n, t) => n + t.endpoints.length, 0);
}

export function aiToolCount(): number {
  return TOOLS.filter((t) => t.aiTool).length;
}

export interface ToolSummary {
  id: string;
  name: string;
  vendor?: string;
  category: ToolDef["category"];
  summary: string;
  tags: string[];
  aiTool: boolean;
  crafted: boolean;
  authType: string;
  basePath: string;
  endpointCount: number;
  aiEndpointCount: number;
}

/** Lightweight catalog row for list/grid views. */
export function toolSummary(t: ToolDef): ToolSummary {
  return {
    id: t.id,
    name: t.name,
    vendor: t.vendor,
    category: t.category,
    summary: t.summary,
    tags: t.tags ?? [],
    aiTool: t.aiTool ?? false,
    crafted: t.crafted ?? false,
    authType: t.auth?.type ?? "none",
    basePath: basePath(t.id),
    endpointCount: t.endpoints.length,
    aiEndpointCount: t.endpoints.filter((e) => e.aiTool).length,
  };
}

export function allSummaries(): ToolSummary[] {
  return TOOLS.map(toolSummary);
}

/** Full endpoint view for the detail page (no `respond` fn — not serializable). */
export interface EndpointView {
  method: ToolEndpoint["method"];
  path: string;
  fullPath: string;
  operation: string;
  summary: string;
  aiTool: boolean;
  hasHandler: boolean;
  request?: any;
  responseExample?: any;
}

export function endpointViews(t: ToolDef): EndpointView[] {
  return t.endpoints.map((e) => ({
    method: e.method,
    path: e.path,
    fullPath: basePath(t.id) + e.path,
    operation: e.operation,
    summary: e.summary,
    aiTool: e.aiTool ?? false,
    hasHandler: typeof e.respond === "function",
    request: e.request,
    responseExample: e.responseExample,
  }));
}

export { basePath };
