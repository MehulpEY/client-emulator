"use client";

import { useMemo, useState } from "react";
import { Search, Cpu, X } from "lucide-react";
import type { ToolSummary } from "@/lib/tools/registry";
import type { CategoryId } from "@/lib/tools/types";
import { CATEGORIES } from "@/lib/tools/categories";
import { ToolCard } from "./ToolCard";
import { EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { Boxes } from "lucide-react";

export function CatalogClient({ tools, initialCategory }: { tools: ToolSummary[]; initialCategory?: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(initialCategory && CATEGORIES.some((c) => c.id === initialCategory) ? initialCategory : "all");
  const [aiOnly, setAiOnly] = useState(false);

  const cats = useMemo(() => CATEGORIES.map((c) => ({ ...c, count: tools.filter((t) => t.category === c.id).length })).filter((c) => c.count > 0), [tools]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (aiOnly && !t.aiTool) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.vendor || "").toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [tools, query, category, aiOnly]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools, vendors, capabilities..."
              className="field !h-9 pl-9"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text3 hover:text-text">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setAiOnly((v) => !v)}
            className={cn("btn-ghost !h-9", aiOnly && "border-accent !text-accent-fg !bg-accent-soft")}
            title="Show only tools with an AI-tool surface"
          >
            <Cpu size={14} /> AI tools
          </button>
        </div>

        <div className="emu-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip active={category === "all"} onClick={() => setCategory("all")} label="All" count={tools.length} />
          {cats.map((c) => (
            <FilterChip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)} label={c.label} count={c.count} />
          ))}
        </div>
      </div>

      <div className="mb-3 text-[11.5px] text-text3">
        {filtered.length} of {tools.length} tools
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Boxes} title="No tools match" sub="Try a different search term or category." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {filtered.map((t) => <ToolCard key={t.id} tool={t} />)}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "chip shrink-0 cursor-pointer transition-colors",
        active ? "border-accent !bg-accent-soft !text-accent-fg" : "hover:border-borderStrong"
      )}
    >
      {label}
      <span className="tabular-nums text-text3">{count}</span>
    </button>
  );
}
