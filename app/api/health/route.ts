import { NextResponse } from "next/server";
import { dbHealth } from "@/lib/db";
import { catalogStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await dbHealth();
  return NextResponse.json({
    ok: true,
    catalog: catalogStats(),
    db,
    baseUrl: process.env.NEXT_PUBLIC_EMULATOR_BASE_URL || "",
  });
}
