"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Boxes, ListTree, KeyRound, Webhook, Users, type LucideIcon } from "lucide-react";
import { Brand } from "@/components/ui";
import type { Role } from "@/lib/auth/types";

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const BASE_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/tools", label: "Tool Catalog", icon: Boxes },
  { href: "/events", label: "Subscriptions", icon: Webhook },
  { href: "/logs", label: "Request Trace", icon: ListTree },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/keys", label: "API Keys", icon: KeyRound },
  { href: "/users", label: "Users", icon: Users },
];

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + "/"));
  const nav = role === "administrator" ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV;

  return (
    <aside className="glass-chrome hidden w-[232px] shrink-0 flex-col border-r border-border lg:flex">
      <div className="flex h-14 items-center px-4">
        <Link href="/"><Brand /></Link>
      </div>
      <span className="spectrum-line thin" />
      <nav className="flex-1 space-y-0.5 p-3">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="navitem" data-active={isActive(item.href, item.exact)}>
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-hair p-3 text-[10.5px] leading-relaxed text-text3">
        <div className="font-bold uppercase tracking-[0.1em] text-text2">Client Emulator</div>
        <div className="mt-0.5">Mock tool sandbox for agent simulation.</div>
      </div>
    </aside>
  );
}
