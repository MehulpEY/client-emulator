"use client";

// Connections tab (PLAN §6 W7): the adapter's connection table with lifecycle
// actions. Data + 5s polling live in AdapterDetail (one shared poll feeds this
// panel AND the header rollup); every mutation here calls onChanged() to
// refresh immediately.

import { useMemo, useState, type ReactNode } from "react";
import {
  Database, DownloadCloud, FlaskConical, Pencil, PlugZap, Plus, StickyNote, Terminal, Trash2,
} from "lucide-react";
import { adaptersApi } from "@/lib/api-adapters";
import type { AdapterMeta, ConnectionRow } from "@/lib/adapters/types";
import type { EndpointView } from "@/lib/tools/registry";
import { Chip, CopyButton, EmptyState, Panel, SkeletonRows, Spinner, useConfirm, type ChipVariant } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AddConnectionModal } from "./AddConnectionModal";
import { absTime, fmtInt, formatMs, sessionReusePct, SIMULATE_META, STATUS_CHIP, Th } from "./shared";

type RowAction = "test" | "fetch" | "toggle" | "delete";

/**
 * A representative call for the "how to use this connection" example — the same
 * endpoint the server's gateway descriptor picks (heartbeat op, else first GET).
 * Path params are filled from the heartbeat spec so the example is runnable.
 */
interface GatewaySample {
  method: string;
  path: string;
  query: string;
  body?: string;
}
function buildGatewaySample(meta: AdapterMeta, endpoints: EndpointView[]): GatewaySample | null {
  const hb = meta.heartbeat;
  const chosen =
    (hb ? endpoints.find((e) => e.operation === hb.operation) : undefined) ??
    endpoints.find((e) => e.method === "GET") ??
    endpoints[0];
  if (!chosen) return null;
  const usedHb = hb && chosen.operation === hb.operation;
  const path = chosen.path.replace(/\{(\w+)\}/g, (_, name) =>
    encodeURIComponent((usedHb ? hb!.pathParams?.[name] : undefined) ?? `emu-${name}`),
  );
  const query = usedHb && hb!.query ? new URLSearchParams(hb!.query).toString() : "";
  const body = chosen.method !== "GET" && chosen.request !== undefined ? JSON.stringify(chosen.request) : undefined;
  return { method: chosen.method, path, query, body };
}

type NoteTone = "ok" | "warn" | "danger" | "info";

/** Note tint from the canonical §4.7 chip variant (accent/default/muted → danger never applies here). */
const toneOf = (v: ChipVariant): NoteTone => (v === "ok" || v === "warn" || v === "info" ? v : "danger");

interface RowNote {
  id: string;
  tone: NoteTone;
  text: string;
}

interface Props {
  toolId: string;
  toolName: string;
  meta: AdapterMeta;
  /** null while the first load is in flight. */
  connections: ConnectionRow[] | null;
  reachable: boolean;
  /** Create/edit/delete/toggle are admin-only server-side. */
  isAdmin: boolean;
  /** App origin, for the copyable gateway example. */
  baseUrl: string;
  /** Adapter endpoints, for the "how to use" example call. */
  endpoints: EndpointView[];
  onChanged: () => Promise<void> | void;
}

const ADMIN_ONLY = "Administrator role required";

export function ConnectionsPanel({ toolId, toolName, meta, connections, reachable, isAdmin, baseUrl, endpoints, onChanged }: Props) {
  const confirm = useConfirm();
  const [modal, setModal] = useState<{ connection?: ConnectionRow } | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: RowAction } | null>(null);
  const [note, setNote] = useState<RowNote | null>(null);
  const [usageId, setUsageId] = useState<string | null>(null);

  const canFetch = meta.fetchSteps.length > 0;
  const sample = useMemo(() => buildGatewaySample(meta, endpoints), [meta, endpoints]);

  async function doTest(c: ConnectionRow) {
    setBusy({ id: c.connectionId, action: "test" });
    try {
      const r = await adaptersApi.testConnection(c.connectionId);
      if (r.status) {
        setNote({
          id: c.connectionId,
          tone: toneOf(STATUS_CHIP[r.status]),
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
    <button
      className="btn-primary h-8 !text-[12px]"
      onClick={() => setModal({})}
      disabled={!reachable || !isAdmin}
      title={!isAdmin ? ADMIN_ONLY : undefined}
    >
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
            sub={
              isAdmin
                ? "Create a connection to provision a real credential, start heartbeats and run discovery fetches."
                : "An administrator can create a connection to provision a credential and start discovery fetches."
            }
            action={isAdmin ? <button className="btn-primary" onClick={() => setModal({})}><Plus size={14} /> Add connection</button> : undefined}
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
                      canManage={isAdmin}
                      rowBusy={rowBusy}
                      busyAction={rowBusy ? busy!.action : null}
                      note={note?.id === c.connectionId ? note : null}
                      usageOpen={usageId === c.connectionId}
                      usage={sample ? { baseUrl, sample } : null}
                      onTest={() => doTest(c)}
                      onFetch={() => doFetch(c)}
                      onToggle={() => doToggle(c)}
                      onEdit={() => setModal({ connection: c })}
                      onDelete={() => doDelete(c)}
                      onUsage={() => setUsageId((id) => (id === c.connectionId ? null : c.connectionId))}
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

function ConnRow({
  c, canFetch, canManage, rowBusy, busyAction, note, usageOpen, usage,
  onTest, onFetch, onToggle, onEdit, onDelete, onUsage, onDismissNote,
}: {
  c: ConnectionRow;
  canFetch: boolean;
  canManage: boolean;
  rowBusy: boolean;
  busyAction: RowAction | null;
  note: RowNote | null;
  usageOpen: boolean;
  usage: { baseUrl: string; sample: GatewaySample } | null;
  onTest: () => void;
  onFetch: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUsage: () => void;
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
            disabled={rowBusy || !canManage}
            label={!canManage ? ADMIN_ONLY : c.enabled ? "Disable connection" : "Enable connection"}
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
            {usage ? (
              <IconBtn
                title={usageOpen ? "Hide usage" : "How to call this connection"}
                onClick={onUsage}
                active={usageOpen}
              >
                <Terminal size={13} />
              </IconBtn>
            ) : null}
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
            <IconBtn title={canManage ? "Edit connection" : ADMIN_ONLY} onClick={onEdit} disabled={rowBusy || !canManage}>
              <Pencil size={13} />
            </IconBtn>
            <IconBtn title={canManage ? "Delete connection" : ADMIN_ONLY} onClick={onDelete} disabled={rowBusy || !canManage} busy={busyAction === "delete"} danger>
              <Trash2 size={13} />
            </IconBtn>
          </div>
        </td>
      </tr>
      {usageOpen && usage ? (
        <tr className="border-b border-hair last:border-0">
          <td colSpan={8} className="px-4 pb-3 pt-0">
            <UsageBlock connectionId={c.connectionId} baseUrl={usage.baseUrl} sample={usage.sample} disabledConn={disabledConn} />
          </td>
        </tr>
      ) : null}
      {note ? (
        <tr className="border-b border-hair last:border-0">
          <td colSpan={8} className="px-4 pb-2.5 pt-0">
            <div
              className={cn(
                "flex items-start justify-between gap-3 rounded-md border px-3 py-1.5 text-[11.5px] leading-relaxed",
                note.tone === "ok" && "border-ok-line bg-ok-bg text-ok",
                note.tone === "warn" && "border-warn-line bg-warn-bg text-warn",
                note.tone === "danger" && "border-danger-line bg-danger-bg text-danger",
                note.tone === "info" && "border-info-line bg-info-bg text-info",
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
        checked ? "border-accent bg-accent" : "border-borderStrong bg-sunk",
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
  children, title, onClick, disabled, busy, danger, active,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={cn(danger ? "btn-danger" : "btn-ghost", "h-7 w-7 !px-0", active && "border-accent !bg-accent-soft !text-accent-fg")}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {busy ? <Spinner className="!text-[10px]" /> : children}
    </button>
  );
}

/**
 * "How to call this connection" — the gateway URL is the stable, secret-free
 * handle an agent uses; the connection injects its own credential, session and
 * config, so no API key is sent. Append any endpoint path to the base URL.
 */
function UsageBlock({
  connectionId, baseUrl, sample, disabledConn,
}: {
  connectionId: string;
  baseUrl: string;
  sample: GatewaySample;
  disabledConn: boolean;
}) {
  const gatewayBase = `${baseUrl}/api/gateway/${connectionId}`;
  const qs = sample.query ? `?${sample.query}` : "";
  const url = `${gatewayBase}${sample.path}${qs}`;
  const curl =
    sample.method === "GET"
      ? `curl -s "${url}"`
      : `curl -s -X ${sample.method} "${url}" -H "content-type: application/json"${sample.body ? ` -d '${sample.body}'` : ""}`;

  return (
    <div className="rounded-md border border-hair bg-surface-sunk p-3">
      <div className="mb-2 flex items-center gap-2">
        <Terminal size={13} className="text-accent-fg" />
        <span className="text-[12px] font-semibold">Call this connection</span>
        {disabledConn ? <Chip variant="warn">enable it first</Chip> : null}
      </div>
      <p className="mb-2.5 text-[11.5px] leading-relaxed text-text3">
        This is the connection&apos;s gateway URL — the stable handle an agent uses. It injects this connection&apos;s
        credential, session and config, so you send <span className="font-semibold text-text2">no API key</span>. Append
        any endpoint path to the base URL.
      </p>

      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label">Gateway base URL</span>
        <CopyButton value={gatewayBase} label="Copy" className="h-6 !text-[11px]" />
      </div>
      <pre className="emu-scroll mono mb-2.5 overflow-x-auto rounded bg-surface p-2.5 text-[11px] leading-relaxed text-text2">{gatewayBase}</pre>

      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label">Example request ({sample.method})</span>
        <CopyButton value={curl} label="Copy curl" className="h-6 !text-[11px]" />
      </div>
      <pre className="emu-scroll mono overflow-x-auto rounded bg-surface p-2.5 text-[11px] leading-relaxed text-text2">{curl}</pre>
    </div>
  );
}
