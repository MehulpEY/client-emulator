import type { ToolDef, ToolEndpoint, HttpMethod } from "../tools/types";

/** Split a path into clean segments: "/files/{id}/" → ["files","{id}"]. */
function segments(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

export interface MatchResult {
  endpoint: ToolEndpoint;
  params: Record<string, string>;
}

/**
 * Match an incoming (method, pathSegments) against a tool's endpoints. A
 * `{param}` template segment captures any single path segment. Returns the first
 * matching endpoint with extracted params, or null.
 */
export function matchEndpoint(tool: ToolDef, method: HttpMethod, incoming: string[]): MatchResult | null {
  let pathOnlyMatch: MatchResult | null = null;
  for (const endpoint of tool.endpoints) {
    const tmpl = segments(endpoint.path);
    if (tmpl.length !== incoming.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < tmpl.length; i++) {
      const t = tmpl[i];
      if (t.startsWith("{") && t.endsWith("}")) {
        params[t.slice(1, -1)] = decodeURIComponent(incoming[i]);
      } else if (t.toLowerCase() !== incoming[i].toLowerCase()) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (endpoint.method === method) return { endpoint, params };
    // Remember a path match under a different method so we can return 405.
    if (!pathOnlyMatch) pathOnlyMatch = { endpoint, params };
  }
  // Signal "path exists, wrong method" by returning the path-only match with a flag.
  return pathOnlyMatch ? { ...pathOnlyMatch, params: { __wrongMethod: "1", ...pathOnlyMatch.params } } : null;
}

export { segments };
