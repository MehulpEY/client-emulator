import type { ToolDef, ToolEndpoint, EndpointParam } from "./types";
import { basePath } from "./types";
import { virustotal } from "./crafted/virustotal";
import { crowdstrike } from "./crafted/crowdstrike";
import { qualys } from "./crafted/qualys";
import { entra } from "./crafted/entra";
import { forcepoint } from "./crafted/forcepoint";
import { recordedFuture } from "./crafted/recordedfuture";
import { trellixEpo } from "./crafted/trellix";
import { ciscoMeraki } from "./crafted/meraki";
import { ciscoUmbrella } from "./crafted/umbrella";
import { digicert } from "./crafted/digicert";
import { zscalerZpa } from "./crafted/zscaler-zpa";
import { zscalerZia } from "./crafted/zscaler-zia";
import { zscalerRba } from "./crafted/zscaler-rba";
import { zscalerAiGuard } from "./crafted/zscaler-aiguard";
import { appomniAgentGuard } from "./crafted/appomni";

// The catalog is a curated set of high-fidelity, hand-crafted tools. Each one
// mirrors its real vendor API (paths, auth, field names) with deterministic,
// seeded responses; several are stateful (persisted resource store).
const CRAFTED: ToolDef[] = [
  virustotal,
  crowdstrike,
  qualys,
  entra,
  forcepoint,
  recordedFuture,
  trellixEpo,
  ciscoMeraki,
  ciscoUmbrella,
  digicert,
  zscalerZpa,
  zscalerZia,
  zscalerRba,
  zscalerAiGuard,
  appomniAgentGuard,
];

/** The full catalog, alphabetical by display name. Code is the source of truth. */
export const TOOLS: ToolDef[] = [...CRAFTED].sort((a, b) =>
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

/** Full endpoint view for the detail page (no `respond` fn - not serializable). */
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
  params?: EndpointParam[];
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
    params: e.params,
  }));
}

export { basePath };
