"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import type { SessionUser } from "@/lib/auth/types";

export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const admin = user.role === "administrator";

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore - clear client state regardless */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden leading-tight sm:block">
        <div className="max-w-[150px] truncate text-[12px] font-semibold">{user.name || user.email}</div>
        <div className="text-[11px] text-text3">{admin ? "Administrator" : "Consumer"}</div>
      </div>
      <span className="grid h-8 w-8 place-items-center rounded bg-surface-sunk text-accent-fg" title={user.email}>
        {admin ? <ShieldCheck size={15} /> : <UserRound size={15} />}
      </span>
      <button onClick={logout} disabled={busy} className="btn-ghost h-8 w-8 !px-0" title="Sign out" aria-label="Sign out">
        <LogOut size={14} />
      </button>
    </div>
  );
}
