"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Extra classes on the modal card. */
  className?: string;
  /** Disable closing on backdrop click / Esc (e.g. a required choice). */
  dismissable?: boolean;
}

const SIZES: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/**
 * Themed modal dialog - a frosted `.glass-modal` card over a dimmed scrim.
 * Renders through a portal so it's never clipped by a panel's overflow, and it
 * inherits the design tokens so it adapts to light / dark automatically.
 */
export function Modal({ open, onClose, title, icon, children, footer, size = "md", className, dismissable = true }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissable) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, dismissable, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4"
      onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn("panel glass-modal animate-card-in relative flex max-h-[85vh] w-full flex-col overflow-hidden", SIZES[size], className)}
      >
        {(title || dismissable) && (
          <header className="panel-head shrink-0">
            <div className="flex min-w-0 items-center gap-2">
              {icon ? <span className="shrink-0 text-accent-fg">{icon}</span> : null}
              {typeof title === "string" ? <h2 className="truncate text-[14px] font-semibold">{title}</h2> : title}
            </div>
            {dismissable ? (
              <button onClick={onClose} className="btn-ghost h-7 w-7 !px-0" aria-label="Close"><X size={14} /></button>
            ) : null}
          </header>
        )}
        <div className="emu-scroll min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-hair px-5 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
