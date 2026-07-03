import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cpu, Sparkles, BookOpen, ShieldCheck } from "lucide-react";
import { getTool, endpointViews, basePath } from "@/lib/tools/registry";
import { getBaseUrl } from "@/lib/base-url";
import { isServerless } from "@/lib/db";
import { categoryLabel } from "@/lib/tools/categories";
import { CategoryIcon } from "@/lib/icons";
import { Chip, CopyButton, Eyebrow } from "@/components/ui";
import { EndpointConsole } from "@/components/tools/EndpointConsole";
import { ToolKeys } from "@/components/tools/ToolKeys";
import { ToolLogs } from "@/components/tools/ToolLogs";
import { ToolEvents } from "@/components/tools/ToolEvents";
import { ToolAutomation } from "@/components/tools/ToolAutomation";
import { ToolState } from "@/components/tools/ToolState";

export const dynamic = "force-dynamic";

const AUTH_LABEL: Record<string, string> = {
  api_key_header: "API key (header)",
  api_key_query: "API key (query)",
  bearer: "Bearer token",
  basic: "Basic auth",
  none: "No auth",
};

export default function ToolDetailPage({ params }: { params: { tool: string } }) {
  const tool = getTool(params.tool);
  if (!tool) notFound();

  const endpoints = endpointViews(tool);
  const base = getBaseUrl() + basePath(tool.id);

  return (
    <div>
      <Link href="/tools" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-text3 hover:text-text">
        <ArrowLeft size={14} /> Catalog
      </Link>

      {/* Header */}
      <div className="panel mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center bg-surface-sunk text-accent-fg">
            <CategoryIcon id={tool.category} size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <Eyebrow>{categoryLabel(tool.category)}</Eyebrow>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-[-0.01em]">{tool.name}</h1>
              {tool.vendor ? <span className="text-[13px] text-text3">by {tool.vendor}</span> : null}
              {tool.crafted ? <Chip variant="ok" icon={<Sparkles size={11} />}>high-fidelity</Chip> : null}
              {tool.aiTool ? <Chip variant="accent" icon={<Cpu size={11} />}>AI tool</Chip> : null}
            </div>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-text2">{tool.summary}</p>
            {tool.tags && tool.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tool.tags.map((t) => <Chip key={t} variant="muted">{t}</Chip>)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hair pt-3">
          <span className="chip" title="Authentication scheme"><ShieldCheck size={12} /> {AUTH_LABEL[tool.auth?.type ?? "none"]}{tool.auth?.param ? ` | ${tool.auth.param}` : ""}</span>
          <span className="chip">{endpoints.length} endpoints</span>
          <div className="mono flex min-w-0 items-center gap-2 text-[11.5px] text-text2">
            <span className="label shrink-0">Base URL</span>
            <span className="truncate">{base}</span>
          </div>
          <CopyButton value={base} label="Copy" className="h-7 !text-[11px]" />
          {tool.docsUrl ? (
            <a href={tool.docsUrl} target="_blank" rel="noreferrer" className="btn-ghost h-7 !text-[11px]"><BookOpen size={12} /> Real docs</a>
          ) : null}
        </div>
      </div>

      {/* Interactive console - the primary surface, full width */}
      <div className="min-w-0">
        <EndpointConsole toolId={tool.id} basePath={basePath(tool.id)} auth={tool.auth ?? { type: "none" }} endpoints={endpoints} />
      </div>

      {/* Supporting panels - balanced two-column grid so nothing runs off in a lone tall rail.
          Columns pair a taller panel with a shorter one to keep heights even. */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <ToolEvents toolId={tool.id} />
          <ToolState toolId={tool.id} />
        </div>
        <div className="min-w-0 space-y-4">
          <ToolAutomation toolId={tool.id} serverless={isServerless()} />
          <ToolKeys toolId={tool.id} />
        </div>
      </div>

      {/* Request trace - full width; a log list reads best wide */}
      <div className="mt-4 min-w-0">
        <ToolLogs toolId={tool.id} />
      </div>
    </div>
  );
}
