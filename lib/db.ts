import { Pool, type PoolClient } from "pg";

/**
 * Postgres access for the emulator (Supabase). Mirrors the ZTPA pattern but adds
 * a small circuit breaker: if a connection fails, we stop hammering the DB for a
 * few seconds so a paused/unreachable Supabase never blocks the mock engine -
 * the catalog is served from the code registry, and DB-backed data (logs, keys,
 * scenarios) simply degrades to empty until the database is reachable again.
 */

const SCHEMA = process.env.DB_SCHEMA || "emulator";

/** True on Vercel / AWS Lambda, where each instance keeps its own pg pool. */
export function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV);
}

function connectionString(): string {
  let url = (process.env.DATABASE_URL || "")
    // node-postgres can choke on Neon/Supabase `channel_binding=require`; strip it.
    .replace(/([?&])channel_binding=[^&]*/g, "$1")
    .replace(/[?&]$/, "");
  // On serverless (Vercel), the Supabase SESSION pooler (port 5432) allocates a
  // dedicated connection per client and is capped (pool_size 15), so concurrent
  // function instances exhaust it -> "EMAXCONNSESSION". The TRANSACTION pooler
  // (port 6543) multiplexes over few backend connections and has no per-client
  // cap; auto-upgrade recognized Supabase pooler hosts so serverless deploys work.
  if (isServerless()) {
    url = url.replace(/(\.pooler\.supabase\.com):5432\b/i, "$1:6543");
  }
  return url;
}

let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    const serverless = isServerless();
    _pool = new Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      // Serverless: each instance serves one request at a time, so a single
      // connection per instance keeps total usage tiny across the fleet. A
      // long-lived server can afford a small pool.
      max: serverless ? 1 : 5,
      // The Supabase pooler's first TLS+auth handshake from a distant network can
      // take ~10s; give it room so a cold start doesn't trip the breaker. Queries
      // schema-qualify their tables, so no search_path/`options` is needed.
      connectionTimeoutMillis: 15000,
      // Retire idle connections before the pooler drops them server-side (a
      // dropped idle connection otherwise surfaces as an intermittent error on
      // the next reuse). keepAlive keeps live sockets from going idle-stale.
      idleTimeoutMillis: serverless ? 10000 : 30000,
      // Let the pool release its connection when idle so a frozen/reused
      // serverless instance doesn't hold a backend connection between invocations.
      allowExitOnIdle: serverless,
      keepAlive: true,
    });
    _pool.on("error", () => { /* swallow idle-client errors; breaker handles it */ });
  }
  return _pool;
}

// -- circuit breaker ----------------------------------------------------------
// A single transient failure - the Supabase session pooler closing an idle
// connection, or a momentary timeout - must NOT black out the whole app. So we
// (a) retry a query once on a connection-level error (which grabs a fresh pooled
// socket), and (b) only open the breaker after several *consecutive* failures,
// resetting the streak on any success. This stops one blip from flipping every
// DB-backed panel to "offline" for the full window.
let breakerOpenUntil = 0;
let consecutiveFailures = 0;
const BREAKER_MS = 6000;
const FAILURE_THRESHOLD = 3;

/** A likely-transient connection error where a retry on a fresh socket helps. */
function isConnectionError(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EHOSTUNREACH", "57P01", "08006", "08003"].includes(code) ||
    /connection terminated|connection closed|connection reset|timeout|terminating connection|server closed|socket hang up|not queryable/.test(msg)
  );
}

export function dbConfigured(): boolean {
  return !!process.env.DATABASE_URL && !/\[YOUR-PASSWORD\]/.test(process.env.DATABASE_URL);
}

export function dbAvailable(): boolean {
  return dbConfigured() && Date.now() >= breakerOpenUntil;
}

/** Throws on failure (opening the breaker after repeated failures). Use `tryQuery` for best-effort. */
export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  if (!dbConfigured()) throw new Error("DATABASE_URL not configured");
  if (Date.now() < breakerOpenUntil) throw new Error("db circuit open");

  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await pool().query(text, params);
      consecutiveFailures = 0; // any success clears the streak
      return res.rows as T[];
    } catch (err) {
      lastErr = err;
      // Retry once on a transient connection error: pg drops the dead socket on
      // error, so the second attempt is served by a fresh connection.
      if (attempt === 0 && isConnectionError(err)) continue;
      break;
    }
  }
  if (++consecutiveFailures >= FAILURE_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_MS;
    consecutiveFailures = 0;
  }
  throw lastErr;
}

/** Best-effort query - returns `fallback` (default []) instead of throwing. */
export async function tryQuery<T = any>(text: string, params: any[] = [], fallback: T[] = []): Promise<T[]> {
  try {
    return await q<T>(text, params);
  } catch {
    return fallback;
  }
}

/**
 * Run `fn` while holding a Postgres transaction-scoped ADVISORY LOCK keyed on
 * `key`, serializing it across every instance/process on the same database. Used
 * to make AutoX refresh-token rotation safe on serverless: without a cross-instance
 * lock, two Vercel instances can present the same rotating refresh token
 * concurrently, tripping AutoX's reuse detection and killing the whole grant.
 *
 * `fn` receives the SAME pooled client that holds the lock — it MUST run its DB
 * work on that client (not the pool) because a serverless pool has one connection,
 * so a second checkout would deadlock. `fn` should return a value, not throw, for
 * anything it wants committed. The lock releases on COMMIT/ROLLBACK. A bounded
 * `lock_timeout` keeps a wedged holder from blocking everyone indefinitely.
 */
export async function withAdvisoryLock<T>(key: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '8s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [key]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
    throw e;
  } finally {
    client.release();
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
