"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Spinner } from "@/components/ui";

export function ResetPasswordForm({ token, valid, email }: { token: string; valid: boolean; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!valid) {
    return (
      <div className="panel p-6 text-center">
        <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-danger-bg text-danger"><AlertTriangle size={18} /></span>
        <h1 className="text-[16px] font-bold">Reset link not valid</h1>
        <p className="mt-1.5 text-[12.5px] text-text3">This password reset link is invalid, already used, or has expired. Reset links are valid for one hour.</p>
        <Link href="/forgot-password" className="btn-primary mt-4 inline-flex">Request a new link</Link>
        <div className="mt-3">
          <Link href="/login" className="text-[12px] text-text3 transition-colors hover:text-accent-fg">Back to sign in</Link>
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setError(j.error || "Could not reset your password.");
        setBusy(false);
        return;
      }
      router.push("/overview");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="panel p-6">
      <div className="mb-5">
        <div className="eyebrow mb-2">Reset password</div>
        <h1 className="text-[18px] font-bold tracking-[-0.01em]">Choose a new password</h1>
        <p className="mt-1 text-[12.5px] text-text3">
          Resetting the password for <span className="mono font-bold text-text2">{email}</span>. You&apos;ll be signed in right after.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label mb-1.5 block">New password</span>
          <input className="field" type="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Confirm password</span>
          <input className="field" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" />
        </label>
        <p className="text-[11px] text-text3">At least 10 characters, including a letter and a number.</p>
        {error && <div className="rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner label="Resetting..." /> : <><ShieldCheck size={14} /> Reset password &amp; sign in</>}
        </button>
      </form>
    </div>
  );
}
