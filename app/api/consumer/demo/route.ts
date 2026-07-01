import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A built-in consumer so pub/sub is testable without standing up your own agent.
// Subscribe with target_url = <base>/api/consumer/demo and inspect what arrives.
// In-memory ring buffer (persists for the life of the `next start` process).
interface Received {
  received_at: string;
  event: string | null;
  tool: string | null;
  delivery: string | null;
  signature: string | null;
  body: any;
}

const g = globalThis as any;
if (!g.__emuDemoInbox) g.__emuDemoInbox = [] as Received[];
const inbox: Received[] = g.__emuDemoInbox;
const MAX = 50;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ _unparsed: true }));
  inbox.unshift({
    received_at: new Date().toISOString(),
    event: req.headers.get("x-emulator-event"),
    tool: req.headers.get("x-emulator-tool"),
    delivery: req.headers.get("x-emulator-delivery"),
    signature: req.headers.get("x-emulator-signature"),
    body,
  });
  if (inbox.length > MAX) inbox.length = MAX;
  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ count: inbox.length, events: inbox });
}

export async function DELETE() {
  inbox.length = 0;
  return NextResponse.json({ ok: true });
}
