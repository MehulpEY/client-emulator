"use client";

import { useCallback, useState } from "react";
import { UserPlus, Mail, Trash2, Power, Send, ShieldCheck, UserRound, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import type { PublicUser, Role } from "@/lib/auth/types";
import { Panel, Chip, Spinner, CopyButton, EmptyState, useConfirm } from "@/components/ui";
import { relativeTime } from "@/lib/format";

type InviteInfo = { url: string; emailed: boolean; error?: string; email: string };

function StatusChip({ status }: { status: PublicUser["status"] }) {
  if (status === "active") return <Chip variant="ok">active</Chip>;
  if (status === "invited") return <Chip variant="accent">invited</Chip>;
  return <Chip variant="danger">disabled</Chip>;
}

export function UsersClient({ initialUsers, meId }: { initialUsers: PublicUser[]; meId: string }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState<PublicUser[]>(initialUsers);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("consumer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const reload = useCallback(() => api.users().then((r) => setUsers(r.users)).catch(() => {}), []);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setInvite(null);
    const r = await api.inviteUser({ email: email.trim(), name: name.trim(), role });
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Could not invite user.");
      return;
    }
    if (r.invite) setInvite({ ...r.invite, email: email.trim() });
    setEmail("");
    setName("");
    setRole("consumer");
    reload();
  }

  async function changeRole(u: PublicUser, next: Role) {
    if (next === u.role) return;
    setRowBusy(u.user_id);
    const r = await api.updateUser(u.user_id, { role: next });
    setRowBusy(null);
    if (!r.ok) { await confirm({ title: "Cannot change role", message: r.error || "Update failed.", confirmLabel: "OK" }); return; }
    reload();
  }

  async function toggleStatus(u: PublicUser) {
    const disabling = u.status !== "disabled";
    if (disabling && !(await confirm({ title: "Disable user", message: <>Disable <span className="mono text-text">{u.email}</span>? They will be signed out and blocked from signing in.</>, confirmLabel: "Disable", danger: true }))) return;
    setRowBusy(u.user_id);
    const r = await api.updateUser(u.user_id, { status: disabling ? "disabled" : "active" });
    setRowBusy(null);
    if (!r.ok) { await confirm({ title: "Cannot update user", message: r.error || "Update failed.", confirmLabel: "OK" }); return; }
    reload();
  }

  async function resend(u: PublicUser) {
    setRowBusy(u.user_id);
    const r = await api.resendInvite(u.user_id);
    setRowBusy(null);
    if (!r.ok) { await confirm({ title: "Could not resend", message: r.error || "Failed.", confirmLabel: "OK" }); return; }
    if (r.invite) setInvite({ ...r.invite, email: u.email });
  }

  async function remove(u: PublicUser) {
    if (!(await confirm({ title: "Delete user", message: <>Permanently delete <span className="mono text-text">{u.email}</span>? This cannot be undone.</>, confirmLabel: "Delete", danger: true }))) return;
    setRowBusy(u.user_id);
    const r = await api.deleteUser(u.user_id);
    setRowBusy(null);
    if (!r.ok) { await confirm({ title: "Cannot delete user", message: r.error || "Delete failed.", confirmLabel: "OK" }); return; }
    reload();
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[360px_1fr]">
      {/* Invite */}
      <Panel title="Invite a user" icon={<UserPlus size={14} />}>
        <form onSubmit={sendInvite} className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Email</span>
            <input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Name <span className="text-text3">(optional)</span></span>
            <input className="field" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Role</span>
            <select className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="consumer">Consumer - observe + configure pub/sub</option>
              <option value="administrator">Administrator - full control</option>
            </select>
          </label>
          {error && <div className="border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner label="Sending invite..." /> : <><Send size={14} /> Send invite</>}
          </button>
          <p className="text-[11px] leading-relaxed text-text3">
            An invitation email is sent via Resend with a link to set a password (valid 72 hours). The account stays <span className="text-text2">invited</span> until accepted.
          </p>
        </form>

        {invite && (
          <div className="sunk mt-3 space-y-2 p-3">
            <div className="flex items-center gap-2 text-[12px] font-bold">
              {invite.emailed ? <Mail size={13} className="text-ok" /> : <Link2 size={13} className="text-accent-fg" />}
              {invite.emailed ? "Invitation emailed" : "Share this invite link"}
            </div>
            <div className="text-[11.5px] text-text3">
              {invite.emailed
                ? <>Sent to <span className="mono text-text2">{invite.email}</span>.</>
                : <>Email could not be sent{invite.error ? ` (${invite.error})` : ""}. Share this link with <span className="mono text-text2">{invite.email}</span>:</>}
            </div>
            <div className="flex items-center gap-2">
              <input readOnly value={invite.url} className="field mono !h-8 flex-1 text-[11px]" onFocus={(e) => e.target.select()} />
              <CopyButton value={invite.url} label="Copy" className="h-8 shrink-0 !text-[11px]" />
            </div>
          </div>
        )}
      </Panel>

      {/* Team list */}
      <Panel title="Team" noPadding actions={<span className="chip">{users.length}</span>}>
        {users.length === 0 ? (
          <EmptyState icon={UserRound} title="No users yet" sub="Invite your first teammate on the left." />
        ) : (
          <div className="divide-y divide-hair">
            {users.map((u) => {
              const isSelf = u.user_id === meId;
              const admin = u.role === "administrator";
              return (
                <div key={u.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center bg-surface-sunk text-accent-fg">
                    {admin ? <ShieldCheck size={15} /> : <UserRound size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-bold">{u.name || u.email}</span>
                      {isSelf && <Chip variant="muted">you</Chip>}
                      <StatusChip status={u.status} />
                    </div>
                    <div className="mono mt-0.5 truncate text-[11px] text-text3">{u.email}</div>
                  </div>

                  <span className="hidden text-[11px] text-text3 lg:block">
                    {u.status === "active" && u.last_login_at ? `seen ${relativeTime(u.last_login_at)}` : `added ${relativeTime(u.created_at)}`}
                  </span>

                  {/* Role selector (locked on your own row) */}
                  <select
                    className="field !h-8 w-auto text-[11.5px]"
                    value={u.role}
                    disabled={isSelf || rowBusy === u.user_id}
                    onChange={(e) => changeRole(u, e.target.value as Role)}
                    title={isSelf ? "You cannot change your own role" : "Change role"}
                  >
                    <option value="consumer">Consumer</option>
                    <option value="administrator">Administrator</option>
                  </select>

                  <div className="flex items-center gap-1">
                    {u.status === "invited" && (
                      <button onClick={() => resend(u)} disabled={rowBusy === u.user_id} className="btn-ghost h-7 !text-[11px]" title="Resend invite">
                        <Send size={12} /> Resend
                      </button>
                    )}
                    {!isSelf && (
                      <button onClick={() => toggleStatus(u)} disabled={rowBusy === u.user_id} className="btn-ghost h-7 w-7 !px-0" title={u.status === "disabled" ? "Enable" : "Disable"}>
                        <Power size={13} className={u.status === "disabled" ? "text-text3" : "text-ok"} />
                      </button>
                    )}
                    {!isSelf && (
                      <button onClick={() => remove(u)} disabled={rowBusy === u.user_id} className="btn-danger h-7 w-7 !px-0" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
