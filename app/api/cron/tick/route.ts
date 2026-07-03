import { NextRequest, NextResponse } from "next/server";
import { runDueGenerators } from "@/lib/engine/scheduler";

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
  const result = await runDueGenerators();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
