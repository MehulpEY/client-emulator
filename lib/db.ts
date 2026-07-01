import { Pool } from "pg";

/**
 * Postgres access for the emulator (Supabase). Mirrors the ZTPA pattern but adds
 * a small circuit breaker: if a connection fails, we stop hammering the DB for a
 * few seconds so a paused/unreachable Supabase never blocks the mock engine —
 * the catalog is served from the code registry, and DB-backed data (logs, keys,
 * scenarios) simply degrades to empty until the database is reachable again.
 */

const SCHEMA = process.env.DB_SCHEMA || "emulator";

function connectionString(): string {
  // node-postgres can choke on Neon/Supabase `channel_binding=require`; strip it.
  return (process.env.DATABASE_URL || "")
    .replace(/([?&])channel_binding=[^&]*/g, "$1")
    .replace(/[?&]$/, "");
}

let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      max: 3,
      // The Supabase pooler's first TLS+auth handshake from a distant network can
      // take ~10s; give it room so a cold start doesn't trip the breaker. Queries
      // schema-qualify their tables, so no search_path/`options` is needed.
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 60000,
    });
    _pool.on("error", () => { /* swallow idle-client errors; breaker handles it */ });
  }
  return _pool;
}

// ── circuit breaker ──────────────────────────────────────────────────────────
let breakerOpenUntil = 0;
const BREAKER_MS = 10000;

export function dbConfigured(): boolean {
  return !!process.env.DATABASE_URL && !/\[YOUR-PASSWORD\]/.test(process.env.DATABASE_URL);
}

export function dbAvailable(): boolean {
  return dbConfigured() && Date.now() >= breakerOpenUntil;
}

/** Throws on failure (and trips the breaker). Use `tryQuery` for best-effort. */
export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  if (!dbConfigured()) throw new Error("DATABASE_URL not configured");
  if (Date.now() < breakerOpenUntil) throw new Error("db circuit open");
  try {
    const res = await pool().query(text, params);
    return res.rows as T[];
  } catch (err) {
    breakerOpenUntil = Date.now() + BREAKER_MS;
    throw err;
  }
}

/** Best-effort query — returns `fallback` (default []) instead of throwing. */
export async function tryQuery<T = any>(text: string, params: any[] = [], fallback: T[] = []): Promise<T[]> {
  try {
    return await q<T>(text, params);
  } catch {
    return fallback;
  }
}

export interface DbHealth {
  configured: boolean;
  reachable: boolean;
  schema: string;
  error?: string;
  serverTime?: string;
}

export async function dbHealth(): Promise<DbHealth> {
  const configured = dbConfigured();
  if (!configured) return { configured, reachable: false, schema: SCHEMA, error: "DATABASE_URL not set or placeholder" };
  try {
    const rows = await q<{ now: string }>("select now()::text as now");
    return { configured, reachable: true, schema: SCHEMA, serverTime: rows[0]?.now };
  } catch (err: any) {
    return { configured, reachable: false, schema: SCHEMA, error: err?.message ?? String(err) };
  }
}

export { SCHEMA };
