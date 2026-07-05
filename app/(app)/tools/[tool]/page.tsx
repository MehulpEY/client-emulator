import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Tool detail moved into the adapter detail (PLAN §4.7 / §6 W7) — the adapter
// page absorbs the old tabs (endpoints, events, automation, state, keys, logs).
export default function ToolRedirect({ params }: { params: { tool: string } }) {
  redirect(`/adapters/${encodeURIComponent(params.tool)}`);
}
