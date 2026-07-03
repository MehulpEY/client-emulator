// Apply db/schema.sql to the Supabase Postgres. Idempotent - safe to re-run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { withClient, SCHEMA } from "./_db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");

await withClient(async (client) => {
  console.log(`-> applying db/schema.sql to schema "${SCHEMA}" ...`);
  await client.query(sql);
  const { rows } = await client.query(
    `select table_name from information_schema.tables where table_schema = $1 order by table_name`,
    [SCHEMA]
  );
  console.log(`[ok] schema "${SCHEMA}" ready. Tables: ${rows.map((r) => r.table_name).join(", ")}`);
});
