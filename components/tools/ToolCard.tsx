import Link from "next/link";
import { Cpu, Sparkles } from "lucide-react";
import type { ToolSummary } from "@/lib/tools/registry";
import { categoryLabel } from "@/lib/tools/categories";
import { CategoryIcon } from "@/lib/icons";
import { Chip } from "@/components/ui";

export function ToolCard({ tool }: { tool: ToolSummary }) {
  return (
    <Link href={`/tools/${tool.id}`} className="card animate-fade-rise flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center bg-surface-sunk text-accent-fg">
          <CategoryIcon id={tool.category} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[13.5px] font-bold">{tool.name}</h3>
            {tool.crafted ? <Sparkles size={12} className="shrink-0 text-accent-fg" /> : null}
          </div>
          <div className="truncate text-[11px] text-text3">{tool.vendor || categoryLabel(tool.category)}</div>
        </div>
        {tool.aiTool ? <Cpu size={14} className="shrink-0 text-accent-fg" /> : null}
      </div>
      <p className="line-clamp-2 text-[12px] leading-relaxed text-text2">{tool.summary}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <Chip className="text-[10px] uppercase tracking-[0.05em]">{categoryLabel(tool.category)}</Chip>
        <Chip variant="muted">{tool.endpointCount} endpoints</Chip>
        {tool.crafted ? <Chip variant="ok">high-fidelity</Chip> : null}
      </div>
    </Link>
  );
}
