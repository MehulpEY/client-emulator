"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

/** Click-to-copy. Shows a brief check on success. */
export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (insecure context) — no-op */
    }
  }
  return (
    <button type="button" onClick={onCopy} className={cn("btn-ghost", className)} title={`Copy ${label || "value"}`}>
      {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
      {label}
    </button>
  );
}

export default CopyButton;
