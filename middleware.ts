import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

// Edge gate: the first line of defense. Every non-public route requires a valid
// session; admin-only areas require the administrator role. This is verified
// again server-side in each route handler / layout (against the DB), so a
// bypass here alone can't grant access - defense in depth.

const PUBLIC_PAGES = ["/login", "/setup", "/accept-invite"];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/api/auth/")) return true; // login / setup / accept-invite / logout
  if (pathname.startsWith("/api/mock/")) return true; // agents authenticate with per-tool API keys
  if (pathname.startsWith("/api/consumer/")) return true; // inbound webhook receiver (server-to-server delivery)
  if (pathname.startsWith("/api/cron/")) return true; // scheduler trigger (protected by CRON_SECRET)
  return PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAdminOnly(pathname: string): boolean {
  return (
    pathname === "/keys" || pathname.startsWith("/keys/") ||
    pathname === "/users" || pathname.startsWith("/users/") ||
    pathname.startsWith("/api/keys") ||
    pathname.startsWith("/api/users") ||
    pathname.startsWith("/api/admin")
  );
}

const isApi = (pathname: string) => pathname.startsWith("/api/");

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!user) {
    if (isApi(pathname)) return NextResponse.json({ ok: false, error: "authentication required" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }

  if (isAdminOnly(pathname) && user.role !== "administrator") {
    if (isApi(pathname)) return NextResponse.json({ ok: false, error: "administrator role required" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
