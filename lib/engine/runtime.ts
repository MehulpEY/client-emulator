import type { ToolDef } from "../tools/types";
import { tryQuery, dbAvailable, SCHEMA } from "../db";

// Small TTL caches so the hot mock path doesn't hit Postgres on every request
// (and so a degraded DB doesn't add latency). 10s is plenty for an emulator.
const TTL_MS = 10_000;

interface Cached<T> { at: number; val: T; }
let keysCache: Cached<KeyRow[]> | null = null;
let scenCache: Cached<ScenarioRow[]> | null = null;

interface KeyRow { tool_id: string | null; secret: string; active: boolean; }
interface ScenarioRow { tool_id: string | null; name: string; config: any; active: boolean; }

async function loadKeys(): Promise<KeyRow[]> {
  if (keysCache && Date.now() - keysCache.at < TTL_MS) return keysCache.val;
  const rows = await tryQuery<KeyRow>(`select tool_id, secret, active from ${SCHEMA}.api_keys where active = true`);
  keysCache = { at: Date.now(), val: rows };
  return rows;
}

async function loadScenarios(): Promise<ScenarioRow[]> {
  if (scenCache && Date.now() - scenCache.at < TTL_MS) return scenCache.val;
  const rows = await tryQuery<ScenarioRow>(`select tool_id, name, config, active from ${SCHEMA}.scenarios where active = true`);
  scenCache = { at: Date.now(), val: rows };
  return rows;
}

export function invalidateRuntimeCache() {
  keysCache = null;
  scenCache = null;
}

export interface AuthCheck {
  authorized: boolean;
  /** True when no keys are configured for this tool, so auth is open (dev mode). */
  open: boolean;
}

/** Extract the credential the client presented for this tool's auth scheme. */
function presentedCredential(tool: ToolDef, headers: Record<string, string>, query: Record<string, string>): string | null {
  const auth = tool.auth ?? { type: "none" };
  const get = (name?: string) => (name ? headers[name.toLowerCase()] : undefined);
  let raw: string | undefined;
  switch (auth.type) {
    case "none": return "";
    case "api_key_query": raw = query[auth.param || "api_key"]; break;
    case "bearer": raw = get("authorization"); break;
    case "basic": raw = get("authorization"); break;
    case "api_key_header":
    default: raw = get(auth.param || "x-api-key") || get("authorization"); break;
  }
  if (!raw) return null;
  raw = raw.trim();
  if (/^bearer\s+/i.test(raw)) raw = raw.replace(/^bearer\s+/i, "");
  if (/^basic\s+/i.test(raw)) {
    try {
      const decoded = Buffer.from(raw.replace(/^basic\s+/i, ""), "base64").toString("utf8");
      return decoded.includes(":") ? decoded.split(":").slice(1).join(":") : decoded;
    } catch { return raw; }
  }
  return raw;
}

export async function checkAuth(tool: ToolDef, headers: Record<string, string>, query: Record<string, string>): Promise<AuthCheck> {
  if ((tool.auth?.type ?? "none") === "none") return { authorized: true, open: true };
  const keys = await loadKeys();
  const valid = keys.filter((k) => k.tool_id === tool.id || k.tool_id === null).map((k) => k.secret);
  // No keys seeded (or DB unreachable) -> open dev mode so agents work immediately.
  if (valid.length === 0) return { authorized: true, open: true };
  const presented = presentedCredential(tool, headers, query);
  return { authorized: !!presented && valid.includes(presented), open: false };
}

export interface ScenarioEffect {
  name?: string;
  latencyMs?: number;
  failureRate?: number;
  forceStatus?: number;
  forceBody?: any;
}

/** Resolve the active scenario override for a tool (tool-specific wins over global). */
export async function activeScenario(tool: ToolDef): Promise<ScenarioEffect> {
  if (!dbAvailable()) return {};
  const rows = await loadScenarios();
  const match = rows.find((s) => s.tool_id === tool.id) || rows.find((s) => s.tool_id === null);
  if (!match) return {};
  const c = match.config || {};
  return {
    name: match.name,
    latencyMs: typeof c.latency_ms === "number" ? c.latency_ms : undefined,
    failureRate: typeof c.failure_rate === "number" ? c.failure_rate : undefined,
    forceStatus: typeof c.force_status === "number" ? c.force_status : undefined,
    forceBody: c.force_body,
  };
}
