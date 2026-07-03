"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm action as destructive. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Imperative confirm - `const confirm = useConfirm(); if (await confirm({...})) ...`. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

/**
 * App-wide replacement for window.confirm(): a themed modal that adapts to light
 * / dark and resolves a promise with the user's choice. Mount once near the root.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; opts: ConfirmOptions }>({ open: false, opts: { message: "" } });
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setState({ open: true, opts });
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const { opts } = state;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={state.open}
        onClose={() => settle(false)}
        size="sm"
        title={opts.title ?? "Please confirm"}
        icon={<AlertTriangle size={14} className={opts.danger ? "text-danger" : "text-accent-fg"} />}
        footer={
          <>
            <button className="btn-ghost" onClick={() => settle(false)}>{opts.cancelLabel ?? "Cancel"}</button>
            <button className={opts.danger ? "btn-danger" : "btn-primary"} onClick={() => settle(true)}>{opts.confirmLabel ?? "Confirm"}</button>
          </>
        }
      >
        <div className="text-[13px] leading-relaxed text-text2">{opts.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export default ConfirmProvider;
