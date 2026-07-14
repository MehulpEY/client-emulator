"use client";

import { useCallback, useState } from "react";
import { Trash2, Power, ShieldCheck, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import type { PublicUser } from "@/lib/auth/types";
import { Panel, Chip, EmptyState, useConfirm } from "@/components/ui";
import { relativeTime } from "@/lib/format";

function StatusChip({ status }: { status: PublicUser["status"] }) {
  if (status === "active") return <Chip variant="ok">active</Chip>;
  if (status === "invited") return <Chip variant="accent">invited</Chip>;
  return <Chip variant="danger">disabled</Chip>;
}

export function UsersClient({ initialUsers, meId }: { initialUsers: PublicUser[]; meId: string }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState<PublicUser[]>(initialUsers);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const reload = useCallback(() => api.users().then((r) => setUsers(r.users)).catch(() => {}), []);

  async function toggleStatus(u: PublicUser) {
    const disabling = u.status !== "disabled";
    if (disabling && !(await confirm({ title: "Disable user", message: <>Disable <span className="mono text-text">{u.email}</span>? They will be signed out and blocked from signing in.</>, confirmLabel: "Disable", danger: true }))) return;
    setRowBusy(u.user_id);
    const r = await api.updateUser(u.user_id, { status: disabling ? "disabled" : "active" });
    setRowBusy(null);
    if (!r.ok) { await confirm({ title: "Cannot update user", message: r.error || "Update failed.", confirmLabel: "OK" }); return; }
    reload();
  }

  async function remove(u: PublicUser) {
    if (!(await confirm({ title: "Delete user", message: <>Permanently delete <span className="mono text-text">{u.email}</span>? They can sign in again via SSO unless removed there too.</>, confirmLabel: "Delete", danger: true }))) return;
    setRowBusy(u.user_id);
    const r = await api.deleteUser(u.user_id);
    setRowBusy(null);
    if (!r.ok) { await confirm({ title: "Cannot delete user", message: r.error || "Delete failed.", confirmLabel: "OK" }); return; }
    reload();
  }

  return (
    <Panel title="Team" noPadding actions={<span className="chip">{users.length}</span>}>
      {users.length === 0 ? (
        <EmptyState icon={UserRound} title="No users yet" sub="Accounts appear here after teammates first sign in with AutoX SSO." />
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

                {/* Role is assigned in AutoX SSO (autox:app_roles) — read-only here. */}
                <Chip variant={admin ? "accent" : "muted"}>{admin ? "Administrator" : "Consumer"}</Chip>

                <div className="flex items-center gap-1">
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
  );
}
