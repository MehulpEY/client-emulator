"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { LogIn, ShieldCheck } from "lucide-react";
import { Spinner } from "@/components/ui";

const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
};
const still: Variants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.35 } } };

export function LoginForm() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const item = reduced ? still : rise;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

  // Surface an error the SSO callback bounced back on (?sso_error=...).
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("sso_error");
    if (e) setSsoError(e);
  }, []);

  // Warm the (possibly cold, scale-to-zero) IdP and confirm it is genuinely
  // live before handing off to the server login route (integration.md). We poll
  // a SAME-ORIGIN proxy (/api/auth/sso/health) because the IdP's own /health has
  // no CORS headers — a browser can't read it cross-origin. The proxy returns
  // 200 {status:"ok"} only once the IdP itself answered live.
  async function signInWithSso() {
    if (warming) return;
    setWarming(true);
    setSsoError(null);
    const next = new URLSearchParams(window.location.search).get("next") || "/overview";
    const dest = `/api/auth/sso/login?next=${encodeURIComponent(next)}`;
    const deadline = Date.now() + 60_000; // allow a cold start up to ~60s
    while (Date.now() < deadline) {
      try {
        const r = await fetch("/api/auth/sso/health", { cache: "no-store" });
        if (r.ok) {
          const body = await r.json().catch(() => null);
          if (body && body.status === "ok") {
            window.location.href = dest;
            return;
          }
        }
      } catch {
        /* server momentarily unreachable — retry */
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    setWarming(false);
    setSsoError("Sign-in is waking up and didn’t respond in time. Please try again in a moment.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setError(j.error || "Sign in failed.");
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/overview";
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error - please try again.");
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
    >
      <motion.div variants={item} className="mb-7">
        <div className="eyebrow mb-3">Sign in</div>
        <h1 className="text-[24px] font-bold leading-[1.15] tracking-[-0.02em]">Welcome back</h1>
        <p className="mt-2 text-[13px] leading-[1.6] text-text3">
          Sign in to manage adapters, connections and the correlated inventory.
        </p>
      </motion.div>

      <motion.div variants={item} className="space-y-3">
        <button
          type="button"
          onClick={signInWithSso}
          disabled={warming}
          className="btn-primary h-10 w-full text-[13px]"
        >
          {warming ? <Spinner label="Connecting to sign-in…" /> : <><ShieldCheck size={14} /> Sign in with AutoX</>}
        </button>

        {ssoError && (
          <div className="rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger" role="alert">
            {ssoError}
          </div>
        )}

        <div className="flex items-center gap-3 py-1 text-[11px] text-text3">
          <span className="h-px flex-1 bg-hair" aria-hidden />
          or sign in with a password
          <span className="h-px flex-1 bg-hair" aria-hidden />
        </div>
      </motion.div>

      <form onSubmit={submit} className="space-y-4">
        <motion.label variants={item} className="block">
          <span className="label mb-1.5 block">Email</span>
          <input
            className="field h-10"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </motion.label>

        <motion.label variants={item} className="block">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label">Password</span>
            <Link href="/forgot-password" tabIndex={-1} className="text-[11.5px] text-text3 transition-colors hover:text-accent-fg">
              Forgot password?
            </Link>
          </div>
          <input
            className="field h-10"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </motion.label>

        {error && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger"
            role="alert"
          >
            {error}
          </motion.div>
        )}

        <motion.div variants={item}>
          <button type="submit" className="btn-ghost h-10 w-full border border-border text-[13px]" disabled={busy}>
            {busy ? <Spinner label="Signing in..." /> : <><LogIn size={14} /> Sign in with a password</>}
          </button>
        </motion.div>
      </form>

      <motion.div variants={item} className="mt-6 border-t border-hair pt-4">
        <p className="text-[11.5px] leading-[1.6] text-text3">
          Access is invitation-only. No account? Ask an administrator to invite you —
          invites arrive by email and expire after 72 hours.
        </p>
      </motion.div>
    </motion.div>
  );
}
