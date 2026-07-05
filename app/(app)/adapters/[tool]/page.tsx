import { notFound } from "next/navigation";
import { getTool, endpointViews, basePath } from "@/lib/tools/registry";
import { getBaseUrl } from "@/lib/base-url";
import { isServerless } from "@/lib/db";
import { adapterMeta } from "@/lib/adapters/meta";
import type { AdapterMeta } from "@/lib/adapters/types";
import { AdapterDetail } from "@/components/adapters/AdapterDetail";

export const dynamic = "force-dynamic";

// Adapter detail (PLAN §6 W7). The registry + AdapterMeta (code) render the
// chrome server-side; live connection data streams in client-side through
// lib/api-adapters. The old /tools/[tool] tabs (endpoints console, events,
// automation, state, keys, logs) are absorbed as tabs here.
export default function AdapterDetailPage({ params }: { params: { tool: string } }) {
  const tool = getTool(params.tool);
  if (!tool) notFound();

  // Fallback mirrors the API's metaOrFallback for tools without meta entries.
  const meta: AdapterMeta = adapterMeta(tool.id) ?? {
    toolId: tool.id,
    blurb: tool.summary,
    categories: [tool.category],
    assetTypes: [],
    connectionParams: [],
    fetchSteps: [],
    heartbeat: { operation: tool.endpoints[0]?.operation ?? "unknown" },
  };

  return (
    <AdapterDetail
      toolId={tool.id}
      name={tool.name}
      vendor={tool.vendor}
      blurb={meta.blurb}
      docsUrl={tool.docsUrl}
      auth={tool.auth ?? { type: "none" }}
      basePath={basePath(tool.id)}
      baseUrl={getBaseUrl() + basePath(tool.id)}
      endpoints={endpointViews(tool)}
      meta={meta}
      serverless={isServerless()}
    />
  );
}
