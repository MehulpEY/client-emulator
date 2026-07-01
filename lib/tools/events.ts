import type { ToolDef } from "./types";
import { expandTemplates } from "../engine/templating";

export interface EventTypeView {
  type: string;
  summary: string;
  /** Where the event comes from: an explicit domain event or a mutating call. */
  source: "tool" | "activity";
}

/**
 * The events a tool can publish: explicit domain events (`tool.events`) plus
 * "activity" events derived from its non-GET endpoints (an agent mutating data
 * through the tool publishes `<operation>` / the endpoint's `emits`). Explicit
 * events win on type collisions.
 */
export function toolEventTypes(tool: ToolDef): EventTypeView[] {
  const out: EventTypeView[] = [];
  const seen = new Set<string>();
  for (const e of tool.events ?? []) {
    if (seen.has(e.type)) continue;
    seen.add(e.type);
    out.push({ type: e.type, summary: e.summary, source: "tool" });
  }
  for (const ep of tool.endpoints) {
    if (ep.method === "GET") continue;
    const type = ep.emits || ep.operation;
    if (seen.has(type)) continue;
    seen.add(type);
    out.push({ type, summary: `Published when ${ep.operation} succeeds.`, source: "activity" });
  }
  return out;
}

/** Build a representative `data` payload for a (tool, event type) pair. */
export function buildEventPayload(tool: ToolDef, type: string): any {
  const explicit = (tool.events ?? []).find((e) => e.type === type);
  if (explicit) {
    try { return explicit.sample(); } catch { /* fall through */ }
  }
  const ep = tool.endpoints.find((e) => (e.emits || e.operation) === type);
  if (ep) return expandTemplates(ep.responseExample ?? ep.request ?? {});
  return { event: type, tool: tool.id, note: "synthetic emulator event" };
}
