"use client";

// Cloudflare-style documentation shell, dressed in the app's own design tokens.
// Three columns on wide screens: a searchable, grouped left navigation with a
// scroll-spy active indicator, the article content in the middle, and an
// "On this page" rail on the right. The left nav collapses behind a toggle on
// small screens. All chrome lives here; the article itself is passed as children
// so it can stay server-rendered (with the Mermaid client islands inside it).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LogIn, Search, Menu, X } from "lucide-react";
import { Brand } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

export interface NavItem {
  id: string;
  title: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    if (ids.length === 0) return;
    const seen = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) seen.set(e.target.id, e.boundingClientRect.top);
          else seen.delete(e.target.id);
        }
        // Choose the visible section closest to the top of the viewport.
        let best = "";
        let bestTop = Infinity;
        for (const [id, top] of seen) {
          if (top < bestTop) {
            bestTop = top;
            best = id;
          }
        }
        if (best) setActive(best);
      },
      { rootMargin: "-80px 0px -66% 0px", threshold: 0 },
    );
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as Element[];
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [ids.join("|")]);
  return active;
}

export function DocLayout({
  groups,
  children,
}: {
  groups: NavGroup[];
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const allIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);
  const active = useScrollSpy(allIds);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.title.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="text-[13px]">
      {filtered.map((g) => (
        <div key={g.label} className="mb-5">
          <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-text3">
            {g.label}
          </div>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const isActive = it.id === active;
              return (
                <li key={it.id}>
                  <a
                    href={`#${it.id}`}
                    onClick={onNavigate}
                    className={
                      "flex items-center gap-2 rounded-md border-l-2 py-1.5 pl-3 pr-2 leading-snug transition-colors " +
                      (isActive
                        ? "border-l-accent bg-accent-soft font-semibold text-accent-fg"
                        : "border-l-transparent text-text2 hover:border-l-hair hover:bg-surface2 hover:text-text")
                    }
                  >
                    {it.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {filtered.length === 0 ? (
        <div className="px-2 text-[12px] text-text3">No sections match &quot;{query}&quot;.</div>
      ) : null}
    </nav>
  );

  return (
    <div className="bg-aurora min-h-screen text-text">
      {/* top bar */}
      <header className="glass-chrome sticky top-0 z-50 border-b border-hair">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            className="btn-ghost h-9 w-9 justify-center p-0 lg:hidden"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={16} />
          </button>
          <Link href="/" aria-label="Client Emulator home" className="rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent">
            <Brand />
          </Link>
          <span className="ml-1 hidden rounded-md bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-text3 sm:inline">
            Docs
          </span>

          <div className="relative ml-auto hidden w-full max-w-xs items-center md:flex">
            <Search size={14} className="pointer-events-none absolute left-2.5 text-text3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter sections"
              className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text outline-none placeholder:text-text3 focus:border-accent"
              aria-label="Filter sections"
            />
          </div>

          <div className="flex items-center gap-2 md:ml-2">
            <ThemeToggle />
            <Link href="/login" className="btn-primary h-9 px-4 text-[13px]">
              <LogIn size={14} /> Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* mobile nav drawer */}
      {navOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[280px] overflow-y-auto border-r border-hair bg-surface p-4">
            <div className="mb-4 flex items-center justify-between">
              <Link href="/" aria-label="Client Emulator home" onClick={() => setNavOpen(false)} className="rounded-md outline-none transition-opacity hover:opacity-80">
                <Brand />
              </Link>
              <button
                type="button"
                aria-label="Close navigation"
                className="btn-ghost h-8 w-8 justify-center p-0"
                onClick={() => setNavOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="relative mb-4 flex items-center">
              <Search size={14} className="pointer-events-none absolute left-2.5 text-text3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter sections"
                className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] outline-none focus:border-accent"
                aria-label="Filter sections"
              />
            </div>
            <NavList onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      ) : null}

      {/* three-column body */}
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-8 px-4 sm:px-6 lg:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[236px_minmax(0,1fr)_200px]">
        {/* left nav */}
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto py-8 pr-2 emu-scroll">
            <NavList />
          </div>
        </aside>

        {/* content */}
        <main className="min-w-0 py-8">{children}</main>

        {/* right on-this-page */}
        <aside className="hidden xl:block">
          <div className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto py-8 pl-2 emu-scroll">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text3">
              On this page
            </div>
            <ul className="space-y-1.5 border-l border-hair text-[12.5px]">
              {flat.map((it) => {
                const isActive = it.id === active;
                return (
                  <li key={it.id} className="-ml-px">
                    <a
                      href={`#${it.id}`}
                      className={
                        "block border-l-2 pl-3 leading-snug transition-colors " +
                        (isActive
                          ? "border-l-accent font-semibold text-accent-fg"
                          : "border-l-transparent text-text3 hover:text-text")
                      }
                    >
                      {it.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
