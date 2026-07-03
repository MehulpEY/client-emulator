"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Spinner } from "@/components/ui";

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const r = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setError(j.error || "Setup failed.");
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error - please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="panel p-6">
      <div className="mb-5">
        <div className="eyebrow mb-2">First-time setup</div>
        <h1 className="text-[18px] font-bold tracking-[-0.01em]">Create the administrator</h1>
        <p className="mt-1 text-[12.5px] text-text3">This is the first account. It gets full administrator access and can onboard others.</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label mb-1.5 block">Name</span>
          <input className="field" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Email</span>
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Password</span>
          <input className="field" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Confirm password</span>
          <input className="field" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" />
        </label>
        <p className="text-[11px] text-text3">At least 10 characters, including a letter.</p>
        {error && <div className="border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner label="Creating..." /> : <><ShieldCheck size={14} /> Create administrator</>}
        </button>
      </form>
    </div>
  );
}
