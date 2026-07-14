import { NextResponse } from "next/server";

// Same-origin proxy for the IdP's cold-start health probe. The IdP's /health has
// no CORS headers, so the browser can't read it cross-origin (a 200 that shows as
// a failed/red request). The login screen polls THIS instead; the server does the
// cross-origin check on its behalf. Returns 200 {status:"ok"} only when the IdP
// itself answered live (not Render's HTML 503 "waking up" page).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISSUER = process.env.AUTOX_ISSUER || "https://sso.autogrc.cloud";

export async function GET() {
  try {
    const r = await fetch(`${ISSUER}/health`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000), // don't hang; the client polls with backoff
    });
    if (r.ok) {
      const body = await r.json().catch(() => null); // Render's 503 page isn't JSON
      if (body && body.status === "ok") return NextResponse.json({ status: "ok" });
    }
  } catch {
    /* still waking / unreachable */
  }
  return NextResponse.json({ status: "waking" }, { status: 503 });
}
