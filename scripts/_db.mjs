// Shared DB helper for the Node maintenance scripts (apply-schema, seed).
// Mirrors lib/db.ts: strip channel_binding, force the emulator search_path,
// tolerate Supabase's self-signed chain.
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

export const SCHEMA = process.env.DB_SCHEMA || "emulator";

function connectionString() {
  const raw = process.env.DATABASE_URL || "";
  if (!raw) {
    console.error("✖ DATABASE_URL is not set. Copy .env.example → .env and fill it in.");
    process.exit(1);
  }
  return raw.replace(/([?&])channel_binding=[^&]*/g, "$1").replace(/[?&]$/, "");
}

export async function withClient(fn) {
  const client = new Client({
    connectionString: connectionString(),
    ssl: { rejectUnauthorized: false },
    // Fail fast so an IPv6-only direct host doesn't hang for minutes.
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000,
  });
  try {
    await client.connect();
  } catch (err) {
    console.error("\n✖ Could not connect to Postgres:", err.message);
    if (/ENETUNREACH|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND/.test(err.code || err.message || "")) {
      console.error(
        "\n  The direct host (db.<ref>.supabase.co:5432) is reachable over IPv6 only.\n" +
        "  On an IPv4-only network, switch DATABASE_URL to the Supabase connection pooler:\n" +
        "    Project → Settings → Database → Connection pooling → Session mode (port 5432)\n" +
        "    e.g. postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres\n"
      );
    }
    process.exit(1);
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
