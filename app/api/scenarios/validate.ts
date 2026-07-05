// Shared bits for the scenarios API routes (W2). Not a route file — Next only
// treats route.ts specially, so this stays private to /api/scenarios.

/** DB row shape == wire shape (snake_case, matches ScenarioApiRow in lib/api-adapters.ts). */
export interface ScenarioRow {
  scenario_id: string;
  tool_id: string | null;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

/** Only the keys lib/engine/runtime.ts activeScenario() honors. */
const ALLOWED_KEYS = ["latency_ms", "failure_rate", "force_status", "force_body"] as const;
const ALLOWED = new Set<string>(ALLOWED_KEYS);

/** Engine clamps sleeps to 4000ms (MAX_LATENCY) — don't accept more than it honors. */
const MAX_LATENCY_MS = 4000;

/**
 * Validate a scenario `config` payload. Unknown keys are rejected (named in
 * the error); values are range-checked against what the engine implements.
 * Returns the normalized config, or an error message.
 */
export function validateScenarioConfig(input: unknown): { config: Record<string, unknown>; error?: undefined } | { config?: undefined; error: string } {
  if (input === undefined || input === null) return { config: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "config must be a JSON object" };
  }
  const cfg = input as Record<string, unknown>;
  for (const key of Object.keys(cfg)) {
    if (!ALLOWED.has(key)) {
      return { error: `config: unknown key "${key}" (allowed: ${ALLOWED_KEYS.join(", ")})` };
    }
  }

  const out: Record<string, unknown> = {};
  if (cfg.latency_ms !== undefined) {
    const v = cfg.latency_ms;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_LATENCY_MS) {
      return { error: `config.latency_ms must be a number between 0 and ${MAX_LATENCY_MS}` };
    }
    out.latency_ms = Math.round(v);
  }
  if (cfg.failure_rate !== undefined) {
    const v = cfg.failure_rate;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      return { error: "config.failure_rate must be a number between 0 and 1" };
    }
    out.failure_rate = v;
  }
  if (cfg.force_status !== undefined) {
    const v = cfg.force_status;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 100 || v > 599) {
      return { error: "config.force_status must be an integer between 100 and 599" };
    }
    out.force_status = v;
  }
  if (cfg.force_body !== undefined) out.force_body = cfg.force_body; // any JSON, kept verbatim
  return { config: out };
}
