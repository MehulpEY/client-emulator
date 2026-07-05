"use client";

// Add / Edit connection modal (PLAN §6 W7). The form is GENERATED from the
// adapter's ConnectionParamSpec list (string/password/number/boolean/select)
// plus the Axonius-standard fields: Label, Notes (≤250), fetch interval and a
// display-only "Verify SSL". Footer mirrors Axonius: "Check connectivity"
// (dry-run — no auth, nothing persisted), "Save" and "Save & fetch"; after a
// create the modal runs a real test and shows the landed status before closing.
//
// Mount it fresh per open (the parent renders it conditionally) so state
// re-initializes from props each time.

import { useEffect, useRef, useState } from "react";
import { Plug, ShieldCheck } from "lucide-react";
import { adaptersApi } from "@/lib/api-adapters";
import type {
  AdapterMeta, ConnectionParamSpec, ConnectionRow, ConnectionSimulate, ConnectionStatus,
} from "@/lib/adapters/types";
import { Chip, Modal, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { SIMULATE_META, STATUS_CHIP } from "./shared";

/** What the API layer shows for password params — also our "keep as-is" sentinel. */
const REDACTED = "•••";
const NOTES_MAX = 250;
const FETCH_FLOOR_S = 60;
const DEFAULT_FETCH_S = 900; // mirrors the schema default (15 min discovery cycle)
const CLOSE_AFTER_TEST_MS = 1800;

const SIMULATE_VALUES = Object.keys(SIMULATE_META) as ConnectionSimulate[];

type Phase = "idle" | "checking" | "saving" | "testing" | "done";

interface ResultBox {
  tone: "ok" | "danger";
  lines: string[];
}

export interface ConnectionModalProps {
  toolId: string;
  toolName: string;
  meta: AdapterMeta;
  onClose: () => void;
  /** Refresh the connections list — called after save and again after the landed test. */
  onSaved: () => Promise<void> | void;
  /** Present → edit mode (form pre-filled, simulate + toggles shown). */
  connection?: ConnectionRow;
}

export function AddConnectionModal({ toolId, toolName, meta, onClose, onSaved, connection }: ConnectionModalProps) {
  const isEdit = !!connection;
  const canFetch = meta.fetchSteps.length > 0;

  // -- form state ---------------------------------------------------------------
  const [label, setLabel] = useState(connection?.label ?? "");
  const [notes, setNotes] = useState(connection?.notes ?? "");
  const [fetchIntervalS, setFetchIntervalS] = useState<string>(
    String(Math.round((connection?.fetchIntervalMs ?? DEFAULT_FETCH_S * 1000) / 1000)),
  );
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const v: Record<string, string | boolean> = {};
    for (const spec of meta.connectionParams) {
      if (spec.type === "password") {
        v[spec.key] = ""; // edit: blank = keep the stored secret
        continue;
      }
      const existing = connection?.params?.[spec.key];
      if (existing !== undefined && existing !== null && existing !== "") {
        v[spec.key] = spec.type === "boolean" ? existing === true || existing === "true" : String(existing);
      } else if (spec.default !== undefined) {
        v[spec.key] = spec.type === "boolean" ? Boolean(spec.default) : String(spec.default);
      } else {
        v[spec.key] = spec.type === "boolean" ? false : "";
      }
    }
    return v;
  });
  const [dirtyParams, setDirtyParams] = useState(false);

  // edit-only extras
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [fetchEnabled, setFetchEnabled] = useState(connection?.fetchEnabled ?? true);
  const [simulate, setSimulate] = useState<ConnectionSimulate>(connection?.simulate ?? "none");

  // -- flow state -----------------------------------------------------------------
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ResultBox | null>(null);
  const [landed, setLanded] = useState<{ status: ConnectionStatus; reason: string | null } | null>(null);
  const closeTimer = useRef<number | null>(null);
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);

  const busy = phase === "checking" || phase === "saving" || phase === "testing";

  function setParam(key: string, value: string | boolean) {
    setValues((s) => ({ ...s, [key]: value }));
    setDirtyParams(true);
  }

  /**
   * Build the params payload from the form. Password fields left blank in edit
   * mode are sent as the "•••" sentinel (`withPasswordSentinel`) purely so the
   * full-replace PATCH still validates — the real credential the engine checks
   * is the server-side provisioned `__secret`, which every param update keeps.
   */
  function buildParams(withPasswordSentinel: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const spec of meta.connectionParams) {
      const raw = values[spec.key];
      if (spec.type === "boolean") {
        out[spec.key] = raw === true;
        continue;
      }
      const s = typeof raw === "string" ? raw.trim() : "";
      if (spec.type === "password") {
        if (s) out[spec.key] = s;
        else if (isEdit && withPasswordSentinel) out[spec.key] = REDACTED;
        continue;
      }
      if (s !== "") out[spec.key] = s; // server coerces numeric strings per spec type
    }
    return out;
  }

  /** Client-side pre-flight so obvious misses don't round-trip. */
  function requiredProblems(): string[] {
    const problems: string[] = [];
    if (!label.trim()) problems.push("label is required");
    for (const spec of meta.connectionParams) {
      if (!spec.required || spec.type === "boolean") continue;
      if (spec.type === "password" && isEdit) continue; // blank keeps the stored value
      const raw = values[spec.key];
      const s = typeof raw === "string" ? raw.trim() : "";
      if (!s && spec.default === undefined) problems.push(`missing required parameter "${spec.key}"`);
    }
    return problems;
  }

  function clampedIntervalMs(): number {
    const n = Number(fetchIntervalS);
    const s = Number.isFinite(n) && n > 0 ? Math.max(FETCH_FLOOR_S, Math.round(n)) : DEFAULT_FETCH_S;
    return s * 1000;
  }

  // -- actions ---------------------------------------------------------------------
  async function checkConnectivity() {
    setPhase("checking");
    setResult(null);
    try {
      const r = await adaptersApi.dryRunTest(toolId, { params: buildParams(true) });
      if (r.ok) {
        setResult({ tone: "ok", lines: ["Parameters look valid and the tool is reachable. No authentication or fetch was performed."] });
      } else {
        setResult({ tone: "danger", lines: r.problems?.length ? r.problems : [r.error ?? "check failed"] });
      }
    } catch {
      setResult({ tone: "danger", lines: ["Connectivity check failed — is the emulator API reachable?"] });
    } finally {
      setPhase("idle");
    }
  }

  async function saveCreate(andFetch: boolean) {
    const problems = requiredProblems();
    if (problems.length > 0) {
      setResult({ tone: "danger", lines: problems });
      return;
    }
    setPhase("saving");
    setResult(null);

    // Create — a failure HERE leaves nothing behind, so retrying is safe.
    let createdId: string;
    try {
      const r = await adaptersApi.createConnection(toolId, {
        label: label.trim(),
        notes: notes.trim() || undefined,
        params: buildParams(false),
        ...(canFetch ? { fetchIntervalMs: clampedIntervalMs() } : {}),
        saveAndFetch: andFetch,
      });
      if (!r.ok || !r.connection) {
        setPhase("idle");
        setResult({ tone: "danger", lines: [r.error ?? "create failed"] });
        return;
      }
      createdId = r.connection.connectionId;
    } catch {
      setPhase("idle");
      setResult({ tone: "danger", lines: ["create failed — request error"] });
      return;
    }

    // The connection now EXISTS — never report a follow-up failure as a save
    // failure (that reads as "retry", which would create a duplicate).
    await onSaved(); // the new row appears (pending) while we test it
    setPhase("testing");
    try {
      const t = await adaptersApi.testConnection(createdId);
      setLanded({
        status: t.status ?? (t.ok ? "connected" : "error"),
        reason: t.statusReason ?? (t.ok ? null : t.error ?? null),
      });
    } catch {
      setResult({ tone: "ok", lines: ["Connection saved. The follow-up test could not run — use Test in the table."] });
    }
    setPhase("done");
    await onSaved();
    closeTimer.current = window.setTimeout(onClose, CLOSE_AFTER_TEST_MS);
  }

  async function saveEdit() {
    if (!connection) return;
    const body: Parameters<typeof adaptersApi.updateConnection>[1] = {};
    if (label.trim() && label.trim() !== connection.label) body.label = label.trim();
    if (notes.trim() !== (connection.notes ?? "")) body.notes = notes.trim();
    if (dirtyParams) body.params = buildParams(true); // sentinel keeps untouched passwords
    if (canFetch && clampedIntervalMs() !== connection.fetchIntervalMs) body.fetchIntervalMs = clampedIntervalMs();
    if (enabled !== connection.enabled) body.enabled = enabled;
    if (fetchEnabled !== connection.fetchEnabled) body.fetchEnabled = fetchEnabled;
    if (simulate !== connection.simulate) body.simulate = simulate;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setPhase("saving");
    setResult(null);
    try {
      const r = await adaptersApi.updateConnection(connection.connectionId, body);
      if (!r.ok) {
        setPhase("idle");
        setResult({ tone: "danger", lines: [r.error ?? "update failed"] });
        return;
      }
      await onSaved();
      onClose();
    } catch {
      setPhase("idle");
      setResult({ tone: "danger", lines: ["update failed — request error"] });
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissable={!busy}
      size="lg"
      icon={<Plug size={14} />}
      title={isEdit ? `Edit connection — ${connection?.label}` : `Add connection — ${toolName}`}
      footer={
        <>
          <button className="btn-ghost mr-auto" onClick={checkConnectivity} disabled={busy || phase === "done"} title="Reachability + parameter shape only — no authentication, nothing persisted">
            {phase === "checking" ? <Spinner label="Checking..." /> : "Check connectivity"}
          </button>
          {isEdit ? (
            <button className="btn-primary" onClick={saveEdit} disabled={busy}>
              {phase === "saving" ? <Spinner label="Saving..." /> : "Save changes"}
            </button>
          ) : (
            <>
              <button className={canFetch ? "btn-ghost" : "btn-primary"} onClick={() => saveCreate(false)} disabled={busy || phase === "done"}>
                {phase === "saving" ? <Spinner label="Saving..." /> : "Save"}
              </button>
              {canFetch ? (
                <button className="btn-primary" onClick={() => saveCreate(true)} disabled={busy || phase === "done"} title="Save, then queue the first discovery fetch immediately">
                  Save & fetch
                </button>
              ) : null}
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Standard field: label */}
        <Field label="Connection label" required>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. production tenant" maxLength={120} />
        </Field>

        {/* Generated fields from the adapter's connectionParams spec */}
        {meta.connectionParams.length > 0 ? (
          <div className="space-y-3 border-t border-hair pt-4">
            <div className="label">{toolName} parameters</div>
            {meta.connectionParams.map((spec) => (
              <ParamField
                key={spec.key}
                spec={spec}
                value={values[spec.key]}
                isEdit={isEdit}
                onChange={(v) => setParam(spec.key, v)}
              />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-text3">This adapter needs no vendor parameters — the emulator provisions its credential automatically.</p>
        )}

        {/* Standard fields: notes / fetch interval / verify SSL */}
        <div className="space-y-3 border-t border-hair pt-4">
          <Field
            label="Notes"
            trailing={<span className={cn("text-[10.5px] tnum", notes.length >= NOTES_MAX ? "text-warn" : "text-text3")}>{notes.length}/{NOTES_MAX}</span>}
          >
            <textarea
              className="field min-h-[64px] text-[12.5px]"
              value={notes}
              maxLength={NOTES_MAX}
              onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
              placeholder="Optional context for teammates (max 250 characters)"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            {canFetch ? (
              <Field label="Fetch interval (seconds)" help={`Discovery cycle cadence — minimum ${FETCH_FLOOR_S}s.`}>
                <input
                  type="number"
                  min={FETCH_FLOOR_S}
                  className="field"
                  value={fetchIntervalS}
                  onChange={(e) => setFetchIntervalS(e.target.value)}
                  onBlur={() => setFetchIntervalS(String(Math.round(clampedIntervalMs() / 1000)))}
                />
              </Field>
            ) : (
              <p className="self-end pb-1 text-[11px] leading-relaxed text-text3">
                Enrichment-only adapter — it heartbeats but has no discovery fetch steps.
              </p>
            )}
            <label className="flex items-end gap-2 pb-1.5" title="Standard adapter field — the emulator always verifies (mock) TLS, so this cannot be turned off.">
              <span className="inline-flex items-center gap-2 text-[12.5px] text-text2">
                <input type="checkbox" checked readOnly disabled className="h-3.5 w-3.5 cursor-not-allowed accent-[var(--ok)]" />
                <ShieldCheck size={13} className="text-ok" /> Verify SSL
                <span className="text-[10.5px] text-text3">always on</span>
              </span>
            </label>
          </div>
        </div>

        {/* Edit-only: lifecycle toggles + fault injection */}
        {isEdit ? (
          <div className="space-y-3 border-t border-hair pt-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <CheckRow checked={enabled} onChange={setEnabled} label="Active" help="Disabled connections skip heartbeats and fetches." />
              <CheckRow checked={fetchEnabled} onChange={setFetchEnabled} label="Scheduled fetch" help="Include this connection in discovery cycles." disabled={!canFetch} />
            </div>
            <Field label="Simulate fault" help={SIMULATE_META[simulate].help}>
              <select className="field" value={simulate} onChange={(e) => setSimulate(e.target.value as ConnectionSimulate)}>
                {SIMULATE_VALUES.map((v) => (
                  <option key={v} value={v}>{SIMULATE_META[v].label}</option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        {/* Inline feedback: dry-run result / validation problems / landed status */}
        {result ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-[12px] leading-relaxed",
              result.tone === "ok" ? "border-ok-line bg-ok-bg text-ok" : "border-danger-line bg-danger-bg text-danger",
            )}
          >
            {result.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        ) : null}

        {phase === "testing" ? (
          <div className="flex items-center gap-2 text-[12px] text-text2">
            <Spinner /> Saved — testing the connection...
          </div>
        ) : null}
        {landed ? (
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-text2">
            <span className="shrink-0">Connection saved — landed status:</span>
            <Chip variant={STATUS_CHIP[landed.status]}>{landed.status}</Chip>
            {landed.reason ? (
              <span className="min-w-0 truncate text-text3" title={landed.reason}>{landed.reason}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// -- small form primitives -------------------------------------------------------

function Field({
  label, required, help, trailing, children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label">
          {label}
          {required ? <span className="ml-0.5 text-danger" title="required">*</span> : null}
        </span>
        {trailing}
      </span>
      {children}
      {help ? <span className="mt-1 block text-[11px] leading-relaxed text-text3">{help}</span> : null}
    </label>
  );
}

function CheckRow({
  checked, onChange, label, help, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("sunk flex cursor-pointer items-start gap-2.5 p-3", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold">{label}</span>
        {help ? <span className="mt-0.5 block text-[11px] leading-relaxed text-text3">{help}</span> : null}
      </span>
    </label>
  );
}

/** One generated form field from a ConnectionParamSpec. */
function ParamField({
  spec, value, isEdit, onChange,
}: {
  spec: ConnectionParamSpec;
  value: string | boolean | undefined;
  isEdit: boolean;
  onChange: (v: string | boolean) => void;
}) {
  if (spec.type === "boolean") {
    return (
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-[12.5px] text-text2">
            {spec.label}
            {spec.required ? <span className="ml-0.5 text-danger" title="required">*</span> : null}
          </span>
          {spec.description ? <span className="mt-0.5 block text-[11px] text-text3">{spec.description}</span> : null}
        </span>
      </label>
    );
  }

  const strValue = typeof value === "string" ? value : "";
  return (
    <Field label={spec.label} required={spec.required} help={spec.description}>
      {spec.type === "select" ? (
        <select className="field" value={strValue} onChange={(e) => onChange(e.target.value)}>
          {strValue === "" ? <option value="">Select...</option> : null}
          {(spec.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          className={cn("field", spec.type === "password" && "mono")}
          type={spec.type === "password" ? "password" : spec.type === "number" ? "number" : "text"}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.type === "password" && isEdit ? "••• (leave blank to keep)" : spec.placeholder}
          autoComplete={spec.type === "password" ? "new-password" : "off"}
        />
      )}
    </Field>
  );
}

export default AddConnectionModal;
