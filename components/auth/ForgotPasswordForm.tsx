"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck, KeyRound } from "lucide-react";
import { Spinner } from "@/components/ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setError(j.error || "Something went wrong — please try again.");
        setBusy(false);
        return;
      }
      setSent(j.message || "If that account exists, we've emailed a password reset link.");
      setBusy(false);
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="panel p-6 text-center">
        <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-ok-bg text-ok"><MailCheck size={18} /></span>
        <h1 className="text-[16px] font-bold">Check your email</h1>
        <p className="mt-1.5 text-[12.5px] text-text3">{sent}</p>
        <p className="mt-1.5 text-[11.5px] text-text3">Nothing arriving? Check spam, or ask an administrator to re-invite you.</p>
        <Link href="/login" className="btn-ghost mt-4 inline-flex"><ArrowLeft size={13} /> Back to sign in</Link>
      </div>
    );
  }

  return (
    <div className="panel p-6">
      <div className="mb-5">
        <div className="eyebrow mb-2">Reset password</div>
        <h1 className="text-[18px] font-bold tracking-[-0.01em]">Forgot your password?</h1>
        <p className="mt-1 text-[12.5px] text-text3">Enter your account email and we&apos;ll send a reset link that&apos;s valid for one hour.</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label mb-1.5 block">Email</span>
          <input className="field" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        {error && <div className="rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner label="Sending..." /> : <><KeyRound size={14} /> Send reset link</>}
        </button>
      </form>
      <div className="mt-4 text-center">
        <Link href="/login" className="text-[12px] text-text3 transition-colors hover:text-accent-fg">
          <ArrowLeft size={11} className="mr-1 inline" />Back to sign in
        </Link>
      </div>
    </div>
  );
}
