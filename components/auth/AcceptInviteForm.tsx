"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserCheck, AlertTriangle } from "lucide-react";
import { Spinner, Chip } from "@/components/ui";
import type { Role } from "@/lib/auth/types";

export function AcceptInviteForm({ token, valid, email, name, role }: { token: string; valid: boolean; email: string; name: string; role: Role }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!valid) {
    return (
      <div className="panel p-6 text-center">
        <span className="mx-auto mb-3 grid h-10 w-10 place-items-center bg-danger-bg text-danger"><AlertTriangle size={18} /></span>
        <h1 className="text-[16px] font-bold">Invitation not valid</h1>
        <p className="mt-1.5 text-[12.5px] text-text3">This invitation link is invalid or has expired. Ask an administrator to send a new one.</p>
        <Link href="/login" className="btn-ghost mt-4 inline-flex">Go to sign in</Link>
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
      const r = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setError(j.error || "Could not activate your account.");
        setBusy(false);
        return;
      }
      router.push("/overview");
      router.refresh();
    } catch {
      setError("Network error - please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="panel p-6">
      <div className="mb-5">
        <div className="eyebrow mb-2">Accept invitation</div>
        <h1 className="text-[18px] font-bold tracking-[-0.01em]">Set your password</h1>
        <p className="mt-1 text-[12.5px] text-text3">
          {name ? `Hi ${name}, ` : ""}activate your account to sign in.
        </p>
      </div>
      <div className="sunk mb-4 flex items-center justify-between p-3">
        <div className="min-w-0">
          <div className="mono truncate text-[12.5px] font-bold">{email}</div>
          <div className="text-[10.5px] text-text3">Your account</div>
        </div>
        <Chip variant={role === "administrator" ? "accent" : "muted"}>{role === "administrator" ? "Administrator" : "Consumer"}</Chip>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label mb-1.5 block">Password</span>
          <input className="field" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Confirm password</span>
          <input className="field" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" />
        </label>
        <p className="text-[11px] text-text3">At least 10 characters, including a letter and a number.</p>
        {error && <div className="border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner label="Activating..." /> : <><UserCheck size={14} /> Activate account</>}
        </button>
      </form>
    </div>
  );
}
