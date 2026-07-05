"use client";

// A small, quiet simulation of the platform's connection lifecycle for the
// auth shell's product panel. Product-true states only; loops slowly; renders
// a static "connected" frame under prefers-reduced-motion.

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PlugZap, RefreshCw, ShieldCheck, GitMerge, Radar } from "lucide-react";

const FRAMES = [
  { key: "created", chip: "pending", tone: "muted", icon: PlugZap, line: "connection created · credential provisioned" },
  { key: "probe", chip: "connecting", tone: "info", icon: RefreshCw, line: "heartbeat probing through the gateway…" },
  { key: "ok", chip: "connected", tone: "ok", icon: ShieldCheck, line: "session issued · tok_9d41c2 · ttl 30m" },
  { key: "fetch", chip: "discovery", tone: "accent", icon: Radar, line: "fetch run: 62 records across 2 steps · session reused" },
  { key: "merge", chip: "correlated", tone: "ok", icon: GitMerge, line: "LT-FIN-001 merged from 4 sources · rule: serial" },
] as const;

const CHIP_CLASS: Record<string, string> = {
  muted: "bg-sunk text-text3 border-border",
  info: "bg-info-bg text-info border-info-line",
  ok: "bg-ok-bg text-ok border-ok-line",
  accent: "bg-accent-soft text-accent-fg border-border",
};

export function AuthShowcase() {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 2600);
    return () => clearInterval(t);
  }, [reduced]);

  const frame = reduced ? FRAMES[2] : FRAMES[i];
  const Icon = frame.icon;

  return (
    <div className="panel mt-8 overflow-hidden">
      <div className="panel-head">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-text2">
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full ${frame.tone === "ok" ? "bg-ok" : frame.tone === "info" ? "bg-info animate-blink" : frame.tone === "accent" ? "bg-accent" : "bg-text3"}`} />
          </span>
          CrowdStrike Falcon · <span className="mono text-text3">con_9f27c1</span>
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={frame.key + "-chip"}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className={`inline-flex h-[22px] items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold ${CHIP_CLASS[frame.tone]}`}
          >
            <Icon size={11} />
            {frame.chip}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="mono relative h-[46px] px-4 text-[12px] leading-[46px] text-text2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={frame.key}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-x-4 truncate"
          >
            <span className="text-text3">$</span> {frame.line}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
