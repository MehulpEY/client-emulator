// Thin CLI wrapper: seeds the catalog by calling the running app's admin route
// (the route imports the TypeScript registry directly). Start the app first
// (`npm run dev`), then run `npm run db:seed`.
import "dotenv/config";

const base = process.env.NEXT_PUBLIC_EMULATOR_BASE_URL || "http://localhost:3001";
const url = `${base}/api/admin/seed`;

try {
  const r = await fetch(url, { method: "POST" });
  const body = await r.json();
  if (!r.ok || !body.ok) {
    console.error("[x] Seed failed:", body.error || r.status);
    process.exit(1);
  }
  console.log(`[ok] Seeded ${body.tools} tools, ${body.endpoints} endpoints.`);
  if (body.masterKey) console.log(`  Master API key: ${body.masterKey}`);
} catch (err) {
  console.error(`[x] Could not reach ${url}. Is the app running? (npm run dev)\n  ${err.message}`);
  process.exit(1);
}
