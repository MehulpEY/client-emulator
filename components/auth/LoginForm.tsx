"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Spinner } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error - please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="panel p-6">
      <div className="mb-5">
        <div className="eyebrow mb-2">Sign in</div>
        <h1 className="text-[18px] font-bold tracking-[-0.01em]">Welcome back</h1>
        <p className="mt-1 text-[12.5px] text-text3">Sign in to the Client Tool Emulator.</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label mb-1.5 block">Email</span>
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Password</span>
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
        </label>
        {error && <div className="border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner label="Signing in..." /> : <><LogIn size={14} /> Sign in</>}
        </button>
      </form>
    </div>
  );
}
