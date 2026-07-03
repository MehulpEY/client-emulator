import { headers } from "next/headers";

/**
 * The public origin the app is served from. Derived from the incoming request
 * host so it is correct on ANY domain (localhost, a Vercel preview, or a custom
 * production domain) without depending on the build-time NEXT_PUBLIC_ env var -
 * the mock endpoints are always served from the app's own origin.
 *
 * NEXT_PUBLIC_EMULATOR_BASE_URL still wins when set to a real (non-localhost)
 * value, e.g. if the mock API is fronted by a different hostname.
 *
 * Server-only (reads request headers) - call it from server components / route
 * handlers, not client components.
 */
export function getBaseUrl(): string {
  const override = process.env.NEXT_PUBLIC_EMULATOR_BASE_URL?.trim().replace(/\/+$/, "");
  if (override && !/localhost|127\.0\.0\.1/.test(override)) return override;

  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  if (host) {
    const proto =
      (h.get("x-forwarded-proto") || "").split(",")[0].trim() ||
      (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  }
  return override || "http://localhost:3002";
}
