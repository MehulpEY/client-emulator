import Link from "next/link";
import { Boxes, BookOpen } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { DbStatus } from "./DbStatus";

/** Top chrome: mobile brand, live DB status, theme toggle. */
export function Topbar() {
  return (
    <header className="glass-chrome sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <Link href="/" className="flex items-center gap-2 lg:hidden">
        <span className="grid h-7 w-7 place-items-center bg-accent">
          <Boxes size={16} className="text-accent-ink" />
        </span>
        <span className="text-[13px] font-bold">Client Emulator</span>
      </Link>
      <div className="hidden items-center gap-2 lg:flex">
        <span className="eyebrow">Tool Emulator Console</span>
      </div>
      <div className="flex items-center gap-2">
        <a href="https://docs.n8n.io/integrations/" target="_blank" rel="noreferrer" className="btn-ghost hidden sm:inline-flex" title="Integrations reference">
          <BookOpen size={14} /> Integrations
        </a>
        <DbStatus />
        <ThemeToggle />
      </div>
    </header>
  );
}
