import { NextRequest, NextResponse } from "next/server";
import { runDueGenerators } from "@/lib/engine/scheduler";
import { runDueHeartbeats } from "@/lib/adapters/heartbeat";
import { runDueFetches } from "@/lib/adapters/fetch-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serverless replacement for the in-process 1s scheduler tick (which can't run on
// Vercel). A cron service calls this on a schedule; it fires every generator whose
// next_run_at is due. Protected by CRON_SECRET: Vercel Cron sends it as a Bearer
// header automatically; an external cron can pass it as ?key=<secret>.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset -> open (local / dev)
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // One tick drives all DB-coordinated cycles; each runner claims its own due
  // rows atomically, so overlapping cron calls stay exactly-once.
  const [generators, heartbeats, fetches] = await Promise.all([
    runDueGenerators(),
    runDueHeartbeats().catch(() => ({ checked: 0, ran: 0, transitions: 0 })),
    runDueFetches().catch(() => ({ checked: 0, started: 0 })),
  ]);
  return NextResponse.json({ ok: true, generators, heartbeats, fetches });
}

export const GET = handle;
export const POST = handle;
