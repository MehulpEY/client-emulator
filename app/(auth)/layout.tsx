import Link from "next/link";
import { Brand } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";
import { toolCount, endpointCount } from "@/lib/tools/registry";
import { FLEET_DEVICES, FLEET_USERS } from "@/lib/fleet/fleet";
import { AuthShowcase } from "@/components/auth/AuthShowcase";

// Split shell for the signed-out screens (login / setup / invite / reset).
// Left: a quiet product panel — real registry numbers and a small simulated
// connection lifecycle, so the front door looks like the platform behind it.
// Right: the form column. On small screens the left panel collapses and the
// shell falls back to the simple centered layout.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const stats = {
    tools: toolCount(),
    endpoints: endpointCount(),
    fleet: FLEET_DEVICES.length + FLEET_USERS.length,
  };

  return (
    <div className="bg-aurora flex min-h-screen">
      {/* left — product panel (lg+) */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between border-r border-hair p-10 lg:flex">
        <div className="bg-dotted pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative">
          <Link href="/"><Brand /></Link>
        </div>

        <div className="relative max-w-[440px]">
          <div className="eyebrow accent mb-4">Client Tool Emulator</div>
          <h2 className="text-[26px] font-bold leading-[1.15] tracking-[-0.015em]">
            The client&apos;s security stack, emulated end to end.
          </h2>
          <p className="mt-3 text-[13px] leading-[1.65] text-text2">
            Vendor-faithful mock APIs behind an adapter platform — credentialed
            connections, scheduled discovery, one session-reusing gateway, and a
            correlated asset inventory.
          </p>
          <AuthShowcase />
        </div>

        <div className="relative flex items-center gap-5 text-[11.5px] text-text3">
          <span><span className="tnum font-bold text-text2">{stats.tools}</span> tools emulated</span>
          <span className="h-3 w-px bg-border" aria-hidden />
          <span><span className="tnum font-bold text-text2">{stats.endpoints}</span> endpoints</span>
          <span className="h-3 w-px bg-border" aria-hidden />
          <span><span className="tnum font-bold text-text2">{stats.fleet}</span> fleet assets</span>
        </div>
      </aside>

      {/* right — the form column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
          <Link href="/" className="lg:invisible"><Brand /></Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-[400px] pb-14">{children}</div>
        </main>
        <footer className="px-6 pb-5 text-center text-[11px] text-text3 lg:text-left">
          Internal engineering sandbox · invitation-only ·{" "}
          <Link href="/" className="transition-colors hover:text-accent-fg">about</Link>
        </footer>
      </div>
    </div>
  );
}
