import { notFound } from "next/navigation";
import { getTool, endpointViews, basePath } from "@/lib/tools/registry";
import { getBaseUrl } from "@/lib/base-url";
import { isServerless } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { metaOrFallback } from "@/lib/adapters/connections";
import { AdapterDetail } from "@/components/adapters/AdapterDetail";

export const dynamic = "force-dynamic";

// Adapter detail (PLAN §6 W7). The registry + AdapterMeta (code) render the
// chrome server-side; live connection data streams in client-side through
// lib/api-adapters. The old /tools/[tool] tabs (endpoints console, events,
// automation, state, keys, logs) are absorbed as tabs here.
export default async function AdapterDetailPage({ params }: { params: { tool: string } }) {
  const user = await requireUser();
  const tool = getTool(params.tool);
  if (!tool) notFound();

  const meta = metaOrFallback(tool); // same fallback the API layer uses

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
      isAdmin={user.role === "administrator"}
    />
  );
}
