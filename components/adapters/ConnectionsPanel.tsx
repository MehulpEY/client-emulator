"use client";

// Connections tab (PLAN §6 W7): the adapter's connection table with lifecycle
// actions. Data + 5s polling live in AdapterDetail (one shared poll feeds this
// panel AND the header rollup); every mutation here calls onChanged() to
// refresh immediately.

import { useState, type ReactNode } from "react";
import {
  Database, DownloadCloud, FlaskConical, Pencil, PlugZap, Plus, StickyNote, Trash2,
} from "lucide-react";
import { adaptersApi } from "@/lib/api-adapters";
import type { AdapterMeta, ConnectionRow } from "@/lib/adapters/types";
import { Chip, EmptyState, Panel, SkeletonRows, Spinner, useConfirm } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AddConnectionModal } from "./AddConnectionModal";
import { absTime, fmtInt, formatMs, sessionReusePct, SIMULATE_META, STATUS_CHIP } from "./shared";

type RowAction = "test" | "fetch" | "toggle" | "delete";

interface RowNote {
  id: string;
  tone: "ok" | "warn" | "danger";
  text: string;
}

interface Props {
  toolId: string;
  toolName: string;
  meta: AdapterMeta;
  /** null while the first load is in flight. */
  connections: ConnectionRow[] | null;
  reachable: boolean;
  onChanged: () => Promise<void> | void;
}

export function ConnectionsPanel({ toolId, toolName, meta, connections, reachable, onChanged }: Props) {
  const confirm = useConfirm();
  const [modal, setModal] = useState<{ connection?: ConnectionRow } | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: RowAction } | null>(null);
  const [note, setNote] = useState<RowNote | null>(null);

  const canFetch = meta.fetchSteps.length > 0;

  async function doTest(c: ConnectionRow) {
    setBusy({ id: c.connectionId, action: "test" });
    try {
      const r = await adaptersApi.testConnection(c.connectionId);
      if (r.status) {
        setNote({
          id: c.connectionId,
          tone: r.status === "connected" ? "ok" : r.status === "degraded" ? "warn" : "danger",
          text: `Test landed on ${r.status}${r.statusReason ? ` — ${r.statusReason}` : ""}${r.latencyMs !== undefined ? ` (${formatMs(r.latencyMs)})` : ""}`,
        });
      } else {
        setNote({ id: c.connectionId, tone: "danger", text: r.error ?? "test failed" });
      }
    } catch {
      setNote({ id: c.connectionId, tone: "danger", text: "test failed — request error" });
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  async function doFetch(c: ConnectionRow) {
    setBusy({ id: c.connectionId, action: "fetch" });
    try {
      const r = await adaptersApi.runFetch(c.connectionId);
      if (r.run) {
        const byType = Object.entries(r.run.recordsByType).map(([t, n]) => `${t} ${n}`).join(", ");
        setNote({
          id: c.connectionId,
          tone: r.run.status === "success" ? "ok" : r.run.status === "partial" ? "warn" : "danger",
          text: `Fetch ${r.run.status}: ${fmtInt(r.run.totalRecords)} records${byType ? ` (${byType})` : ""} in ${formatMs(r.run.durationMs)}${r.run.error ? ` — ${r.run.error}` : ""}`,
        });
      } else {
        setNote({ id: c.connectionId, tone: "danger", text: r.error ?? "fetch failed" });
      }
    } catch {
      setNote({ id: c.connectionId, tone: "danger", text: "fetch failed — request error" });
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  async function doToggle(c: ConnectionRow) {
    setBusy({ id: c.connectionId, action: "toggle" });
    try {
      const r = await adaptersApi.updateConnection(c.connectionId, { enabled: !c.enabled });
      if (!r.ok) setNote({ id: c.connectionId, tone: "danger", text: r.error ?? "update failed" });
    } catch {
      setNote({ id: c.connectionId, tone: "danger", text: "update failed — request error" });
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  async function doDelete(c: ConnectionRow) {
    const ok = await confirm({
      title: "Delete connection",
      message: (
        <>
          Delete <span className="font-semibold text-text">{c.label}</span>? Its provisioned credential is removed and
          heartbeats, fetches and gateway calls through it stop immediately.
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy({ id: c.connectionId, action: "delete" });
    try {
      await adaptersApi.deleteConnection(c.connectionId);
      setNote(null);
    } catch {
      setNote({ id: c.connectionId, tone: "danger", text: "delete failed" });
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  const addButton = (
    <button className="btn-primary h-8 !text-[12px]" onClick={() => setModal({})} disabled={!reachable}>
      <Plus size={13} /> Add connection
    </button>
  );

  return (
    <>
      <Panel title="Connections" icon={<PlugZap size={14} />} actions={addButton} noPadding>
        {connections === null ? (
          <SkeletonRows rows={4} />
        ) : !reachable ? (
          <EmptyState
            icon={Database}
            title="Database offline"
            sub="Connections live in Supabase. Reconnect the database to create and manage them."
          />
        ) : connections.length === 0 ? (
          <EmptyState
            icon={PlugZap}
            title="No connections yet"
            sub="Create a connection to provision a real credential, start heartbeats and run discovery fetches."
            action={<button className="btn-primary" onClick={() => setModal({})}><Plus size={14} /> Add connection</button>}
          />
        ) : (
          <div className="emu-scroll overflow-x-auto">
            <table className="w-full min-w-[880px] text-[12.5px]">
              <thead>
                <tr className="border-b border-hair text-left">
                  <Th>Connection</Th>
                  <Th>Status</Th>
                  <Th>Enabled</Th>
                  <Th>Last heartbeat</Th>
                  <Th>Last fetch</Th>
                  <Th className="text-right">Records</Th>
                  <Th className="text-right" title="Sessions reused vs issued — the live-session advantage">Session reuse</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => {
                  const rowBusy = busy?.id === c.connectionId;
                  return (
                    <ConnRow
                      key={c.connectionId}
                      c={c}
                      canFetch={canFetch}
                      rowBusy={rowBusy}
                      busyAction={rowBusy ? busy!.action : null}
                      note={note?.id === c.connectionId ? note : null}
                      onTest={() => doTest(c)}
                      onFetch={() => doFetch(c)}
                      onToggle={() => doToggle(c)}
                      onEdit={() => setModal({ connection: c })}
                      onDelete={() => doDelete(c)}
                      onDismissNote={() => setNote(null)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {modal ? (
        <AddConnectionModal
          toolId={toolId}
          toolName={toolName}
          meta={meta}
          connection={modal.connection}
          onClose={() => setModal(null)}
          onSaved={onChanged}
        />
      ) : null}
    </>
  );
}

function Th({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold text-text3", className)} title={title}>
      {children}
    </th>
  );
}

function ConnRow({
  c, canFetch, rowBusy, busyAction, note,
  onTest, onFetch, onToggle, onEdit, onDelete, onDismissNote,
}: {
  c: ConnectionRow;
  canFetch: boolean;
  rowBusy: boolean;
  busyAction: RowAction | null;
  note: RowNote | null;
  onTest: () => void;
  onFetch: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDismissNote: () => void;
}) {
  const disabledConn = !c.enabled || c.status === "disabled";
  return (
    <>
      <tr className="row border-b border-hair last:border-0">
        <td className="max-w-[220px] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold" title={c.label}>{c.label}</span>
            {c.notes ? <StickyNote size={12} className="shrink-0 text-text3" aria-label="Notes" /> : null}
          </div>
          {c.notes ? (
            <div className="mt-0.5 truncate text-[11px] text-text3" title={c.notes}>{c.notes}</div>
          ) : null}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip variant={STATUS_CHIP[c.status]} title={c.statusReason ?? undefined}>{c.status}</Chip>
            {c.simulate !== "none" ? (
              <Chip variant="warn" icon={<FlaskConical size={11} />} title={SIMULATE_META[c.simulate].help}>
                {SIMULATE_META[c.simulate].short}
              </Chip>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <Switch
            checked={c.enabled}
            onChange={onToggle}
            disabled={rowBusy}
            label={c.enabled ? "Disable connection" : "Enable connection"}
          />
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-text2" title={absTime(c.lastHeartbeatAt)}>
          {c.lastHeartbeatAt ? relativeTime(c.lastHeartbeatAt) : "—"}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-text2" title={absTime(c.lastFetchAt)}>
          {c.lastFetchAt ? relativeTime(c.lastFetchAt) : "—"}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-right text-text2 tnum">{fmtInt(c.totalRecords)}</td>
        <td
          className="whitespace-nowrap px-4 py-2.5 text-right text-text2 tnum"
          title={`${fmtInt(c.sessionReuses)} reused / ${fmtInt(c.sessionsIssued)} issued`}
        >
          {sessionReusePct(c.sessionsIssued, c.sessionReuses)}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5">
          <div className="flex items-center justify-end gap-1">
            <IconBtn
              title={disabledConn ? "Enable the connection to test it" : "Test now — runs a real heartbeat"}
              onClick={onTest}
              disabled={rowBusy || disabledConn}
              busy={busyAction === "test"}
            >
              <PlugZap size={13} />
            </IconBtn>
            <IconBtn
              title={
                !canFetch
                  ? "Enrichment-only adapter — no fetch steps"
                  : disabledConn
                    ? "Enable the connection to fetch"
                    : "Fetch now — run a discovery cycle"
              }
              onClick={onFetch}
              disabled={rowBusy || disabledConn || !canFetch}
              busy={busyAction === "fetch"}
            >
              <DownloadCloud size={13} />
            </IconBtn>
            <IconBtn title="Edit connection" onClick={onEdit} disabled={rowBusy}>
              <Pencil size={13} />
            </IconBtn>
            <IconBtn title="Delete connection" onClick={onDelete} disabled={rowBusy} busy={busyAction === "delete"} danger>
              <Trash2 size={13} />
            </IconBtn>
          </div>
        </td>
      </tr>
      {note ? (
        <tr className="border-b border-hair last:border-0">
          <td colSpan={8} className="px-4 pb-2.5 pt-0">
            <div
              className={cn(
                "flex items-start justify-between gap-3 rounded-md border px-3 py-1.5 text-[11.5px] leading-relaxed",
                note.tone === "ok" && "border-ok-line bg-ok-bg text-ok",
                note.tone === "warn" && "border-warn-line bg-warn-bg text-warn",
                note.tone === "danger" && "border-danger-line bg-danger-bg text-danger",
              )}
            >
              <span className="min-w-0 break-words">{note.text}</span>
              <button onClick={onDismissNote} className="shrink-0 font-semibold opacity-70 hover:opacity-100" aria-label="Dismiss">
                ✕
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Small themed switch (button role=switch) for the enabled toggle. */
function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-accent bg-accent" : "border-borderStrong bg-surface-sunk",
        disabled ? "cursor-default opacity-50" : "cursor-pointer",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full transition-all",
          checked ? "left-[16px] bg-accent-ink" : "left-[2px] bg-text3",
        )}
      />
    </button>
  );
}

function IconBtn({
  children, title, onClick, disabled, busy, danger,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={cn(danger ? "btn-danger" : "btn-ghost", "h-7 w-7 !px-0")}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {busy ? <Spinner className="!text-[10px]" /> : children}
    </button>
  );
}
