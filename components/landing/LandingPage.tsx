"use client";

// Public landing page. Doctrine: professional and literal — every number comes
// from the code registry (passed in as props), every claim describes a shipped
// feature. Motion is framer-based, restrained (fade/rise, stagger, count-up)
// and fully disabled under prefers-reduced-motion.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, animate, useInView, useReducedMotion, type Variants } from "framer-motion";
import {
  ArrowRight, GitMerge, LogIn, Network,
  ShieldHalf, Terminal, Webhook, FlaskConical, Activity,
} from "lucide-react";
import { Brand } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

export interface LandingStats {
  adapters: number;
  endpoints: number;
  eventTypes: number;
  fleetDevices: number;
  fleetUsers: number;
  categories: number;
  discoveryAdapters: number;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// -- motion helpers -----------------------------------------------------------

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
const riseStill: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.45 } },
};
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

function useVariants() {
  const reduced = useReducedMotion();
  return { item: reduced ? riseStill : rise, group: stagger };
}

/** Section that reveals once when scrolled into view. */
function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const { group } = useVariants();
  return (
    <motion.div className={className} variants={group} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-70px" }}>
      {children}
    </motion.div>
  );
}

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduced) { setDisplay(value); return; }
    const controls = animate(0, value, {
      duration: 1.3,
      ease: EASE,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, reduced, value]);
  return <span ref={ref} className="tnum">{display}</span>;
}

// -- page ----------------------------------------------------------------------

export function LandingPage({ stats }: { stats: LandingStats }) {
  const { item, group } = useVariants();
  const reduced = useReducedMotion();

  const tiles = [
    { value: stats.adapters, label: "Tools emulated", sub: `across ${stats.categories} security categories` },
    { value: stats.endpoints, label: "Vendor-faithful endpoints", sub: "real paths, auth schemes, field names" },
    { value: stats.eventTypes, label: "Emittable event types", sub: "HMAC-signed webhook delivery" },
    { value: stats.fleetDevices + stats.fleetUsers, label: "Simulated fleet assets", sub: `${stats.fleetDevices} devices · ${stats.fleetUsers} users` },
  ];

  const steps = [
    { n: "01", title: "Connect", body: "Add a credentialed connection per tool. A real API key is provisioned behind it — auth is enforced, not painted on." },
    { n: "02", title: "Verify", body: "Heartbeats probe each vendor mock through the gateway. Status reflects what actually answered." },
    { n: "03", title: "Discover", body: "Scheduled fetches pull inventory through one session-reusing endpoint, with per-run history." },
    { n: "04", title: "Correlate", body: "Records from different tools merge into single assets — the matching rule is recorded on every source." },
    { n: "05", title: "Break", body: "Revoke credentials, force outages, inject latency. Watch lifecycle, fetch history and freshness respond." },
  ];

  const features = [
    { icon: ShieldHalf, title: "Vendor-faithful mocks", body: "CrowdStrike, Qualys, Entra, Zscaler and more — real API shapes with deterministic, seeded responses. Same input, same answer, every time." },
    { icon: Network, title: "One gateway, every tool", body: "A single endpoint per connection injects each vendor's auth scheme and reuses live sessions. Issued-vs-reused counters are visible, not implied." },
    { icon: Activity, title: "Honest connection lifecycle", body: "Connections move through pending, connected, degraded and error based on real probe outcomes, with a full event trail." },
    { icon: GitMerge, title: "Explainable correlation", body: "Devices merge on serial, MAC, then hostname; users on email. Every merged source keeps the rule that matched it and the raw evidence." },
    { icon: FlaskConical, title: "Failure on demand", body: "Per-connection faults (revoked credentials, outage, slowness) and per-tool scenarios (latency, error rates, forced statuses) make chaos testing a first-class feature." },
    { icon: Webhook, title: "Events and automation", body: "Domain events publish to subscribers with HMAC signatures; scheduled generators keep the environment alive without anyone touching it." },
  ];

  return (
    <div className="bg-aurora min-h-screen text-text">
      {/* header */}
      <header className="glass-chrome sticky top-0 z-40 border-b border-hair">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className="btn-primary"><LogIn size={14} /> Sign in</Link>
          </div>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <motion.div variants={group} initial="hidden" animate="show" className="max-w-3xl">
            <motion.div variants={item} className="eyebrow accent mb-4">Client Tool Emulator</motion.div>
            <motion.h1 variants={item} className="text-[clamp(30px,5vw,46px)] font-bold leading-[1.08] tracking-[-0.02em]">
              The client&apos;s security stack,<br />emulated <span className="text-gradient-gold">end to end</span>.
            </motion.h1>
            <motion.p variants={item} className="mt-5 max-w-2xl text-[15px] leading-[1.65] text-text2">
              Vendor-faithful mock APIs for {stats.adapters} security tools, wrapped in an adapter
              platform: credentialed connections, scheduled discovery, a session-reusing gateway,
              and a correlated asset inventory. Build and break agent workflows safely — before
              they ever touch a client environment.
            </motion.p>
            <motion.div variants={item} className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn-primary h-10 px-5 text-[13px]">
                Sign in <ArrowRight size={14} />
              </Link>
              <a href="#how-it-works" className="btn-ghost h-10 px-5 text-[13px]">See how it works</a>
              <span className="text-[12px] text-text3">Invitation-only access</span>
            </motion.div>
          </motion.div>

          {/* terminal card — a real gateway exchange */}
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: reduced ? 0 : 0.35 }}
            className="panel mt-12 overflow-hidden"
          >
            <div className="panel-head">
              <span className="flex items-center gap-2 text-[12px] font-semibold text-text2">
                <Terminal size={13} /> One endpoint, any tool — through a connection
              </span>
              <span className="chip">live example</span>
            </div>
            <div className="mono emu-scroll overflow-x-auto p-4 text-[12.5px] leading-[1.75]">
              <motion.div variants={group} initial="hidden" whileInView="show" viewport={{ once: true }}>
                <motion.div variants={item}>
                  <span className="text-text3">$</span> curl -s $BASE<span className="text-accent-fg">/api/gateway/con_9f27c1</span>/devices/entities/devices/v2
                </motion.div>
                <motion.div variants={item} className="mt-2 text-text3">
                  HTTP/1.1 200 · x-emu-tool: crowdstrike · <span className="text-ok">x-emu-session-reused: true</span>
                </motion.div>
                <motion.div variants={item} className="mt-2 text-text2">
                  {"{"} <span className="text-text3">&quot;resources&quot;</span>: [ {"{"} <span className="text-text3">&quot;hostname&quot;</span>: <span className="text-accent-fg">&quot;LT-FIN-001&quot;</span>,{" "}
                  <span className="text-text3">&quot;serial_number&quot;</span>: <span className="text-accent-fg">&quot;5CG2W1014F&quot;</span>,{" "}
                  <span className="text-text3">&quot;platform_name&quot;</span>: <span className="text-accent-fg">&quot;Windows&quot;</span> {"}"}, … ] {"}"}
                </motion.div>
                <motion.div variants={item} className="mt-2 text-text3">
                  # the same serial appears in Qualys, Trellix and Intune — one correlated asset, four sources
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        </section>

        {/* stat band — registry-derived, nothing invented */}
        <section className="border-y border-hair">
          <Reveal className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-4 py-10 sm:px-6 lg:grid-cols-4">
            {tiles.map((t) => (
              <motion.div key={t.label} variants={item} className="px-5 py-4">
                <div className="text-[30px] font-bold leading-none tracking-[-0.02em]">
                  <CountUp value={t.value} />
                </div>
                <div className="mt-2 text-[13px] font-semibold">{t.label}</div>
                <div className="mt-0.5 text-[11.5px] text-text3">{t.sub}</div>
              </motion.div>
            ))}
          </Reveal>
        </section>

        {/* how it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <Reveal>
            <motion.div variants={item} className="eyebrow mb-3">How it works</motion.div>
            <motion.h2 variants={item} className="max-w-xl text-[26px] font-bold leading-[1.15] tracking-[-0.015em]">
              The full adapter loop, from credentials to correlated assets
            </motion.h2>
          </Reveal>
          <Reveal className="mt-10 grid gap-4 md:grid-cols-5">
            {steps.map((s) => (
              <motion.div key={s.n} variants={item} className="card rounded-lg p-4">
                <div className="mono text-[11px] font-bold text-accent-fg">{s.n}</div>
                <div className="mt-2 text-[14px] font-bold">{s.title}</div>
                <p className="mt-1.5 text-[12px] leading-[1.6] text-text2">{s.body}</p>
              </motion.div>
            ))}
          </Reveal>
        </section>

        {/* features */}
        <section className="border-t border-hair">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <Reveal>
              <motion.div variants={item} className="eyebrow mb-3">What&apos;s inside</motion.div>
              <motion.h2 variants={item} className="max-w-xl text-[26px] font-bold leading-[1.15] tracking-[-0.015em]">
                Built like the platforms it stands in for
              </motion.h2>
              <motion.p variants={item} className="mt-3 max-w-2xl text-[13.5px] leading-[1.65] text-text2">
                The emulator mirrors how real asset platforms integrate with security tools —
                {" "}{stats.discoveryAdapters} adapters run scheduled discovery against a shared,
                deterministic fleet, so cross-tool correlation genuinely works.
              </motion.p>
            </Reveal>
            <Reveal className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <motion.div
                  key={f.title}
                  variants={item}
                  whileHover={reduced ? undefined : { y: -3 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="card rounded-lg p-5"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-md bg-accent-soft text-accent-fg">
                    <f.icon size={17} />
                  </span>
                  <div className="mt-3 text-[14px] font-bold">{f.title}</div>
                  <p className="mt-1.5 text-[12.5px] leading-[1.65] text-text2">{f.body}</p>
                </motion.div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* closing CTA */}
        <section className="border-t border-hair">
          <Reveal className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
            <motion.div variants={item}>
              <h2 className="text-[22px] font-bold tracking-[-0.015em]">Ready to point an agent at it?</h2>
              <p className="mt-1.5 max-w-xl text-[13px] text-text2">
                Sign in, add a connection, run a discovery, and query the correlated inventory —
                the whole loop takes about two minutes.
              </p>
            </motion.div>
            <motion.div variants={item} className="flex shrink-0 items-center gap-3">
              <Link href="/login" className="btn-primary h-10 px-5 text-[13px]"><LogIn size={14} /> Sign in</Link>
              <a href="https://github.com/MehulpEY/client-emulator" target="_blank" rel="noreferrer" className="btn-ghost h-10 px-5 text-[13px]">Documentation</a>
            </motion.div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-hair">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-[12px] text-text3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Brand />
          </div>
          <div className="flex items-center gap-5">
            <span>Internal engineering sandbox · invitation-only</span>
            <Link href="/login" className="transition-colors hover:text-accent-fg">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
