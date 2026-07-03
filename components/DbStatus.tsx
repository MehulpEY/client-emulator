"use client";

import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

/** Live Supabase connectivity dot, shown in the top bar. */
export function DbStatus() {
  const [state, setState] = useState<"loading" | "ok" | "down">("loading");
  const [detail, setDetail] = useState<string>("Checking database...");

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        if (h.db.reachable) { setState("ok"); setDetail(`Supabase | ${h.db.schema} schema`); }
        else { setState("down"); setDetail(h.db.error ? `DB unreachable: ${h.db.error}` : "Database unreachable"); }
      } catch {
        // Transient (network / 500): keep the last known status rather than
        // flashing "offline". A genuine outage surfaces as reachable:false above.
      }
    };
    check();
    const id = setInterval(check, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const tone = state === "ok" ? "text-ok" : state === "down" ? "text-danger" : "text-text3";
  const dot = state === "ok" ? "bg-ok" : state === "down" ? "bg-danger" : "bg-text3";

  return (
    <span className="chip gap-2" title={detail}>
      <Database size={12} className={tone} />
      <span className={cn("h-1.5 w-1.5 rounded-full", dot, state === "loading" && "animate-blink")} />
      <span className="hidden sm:inline">{state === "ok" ? "DB live" : state === "down" ? "DB offline" : "DB..."}</span>
    </span>
  );
}
