import { tryQuery, SCHEMA } from "../db";
import type { EngineOutcome } from "./engine";

const SECRET_HEADERS = ["authorization", "x-apikey", "x-api-key", "key", "apikey", "x-auth-token", "x-otx-api-key", "x-rftoken", "x-dc-devkey", "x-cisco-meraki-api-key", "anchor-api-key", "api-key", "sec"];

/** Redact obvious credential headers before persisting. */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADERS.includes(k.toLowerCase()) && v ? v.slice(0, 4) + "…redacted" : v;
  }
  return out;
}

/** Cap a JSON value's serialized size so a huge body can't bloat the log table. */
function cap(value: any, maxLen = 16_000): any {
  if (value === undefined) return null;
  try {
    const s = JSON.stringify(value);
    if (s.length <= maxLen) return value;
    return { _truncated: true, preview: s.slice(0, maxLen) };
  } catch {
    return { _unserializable: true };
  }
}

export interface LogInput {
  toolId: string | null;
  toolSlug: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
  outcome: EngineOutcome;
}

/** Best-effort insert into request_logs. Never throws into the request path. */
export async function logRequest(input: LogInput): Promise<void> {
  const o = input.outcome;
  await tryQuery(
    `insert into ${SCHEMA}.request_logs
       (tool_id, tool_slug, operation, method, path, query, request_headers, request_body,
        status, response_body, latency_ms, matched, authorized, scenario)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.toolId,
      input.toolSlug,
      o.operation ?? null,
      input.method,
      input.path,
      JSON.stringify(input.query ?? {}),
      JSON.stringify(redactHeaders(input.headers ?? {})),
      input.body === undefined ? null : JSON.stringify(cap(input.body)),
      o.status,
      JSON.stringify(cap(o.body)),
      o.latencyMs,
      o.matched,
      o.authorized,
      o.scenario ?? null,
    ]
  );
}
