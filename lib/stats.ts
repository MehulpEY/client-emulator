import { TOOLS, toolCount, endpointCount, aiToolCount } from "./tools/registry";
import { CATEGORIES } from "./tools/categories";
import type { CatalogStats } from "./types";

export function catalogStats(): CatalogStats {
  return {
    tools: toolCount(),
    endpoints: endpointCount(),
    aiTools: aiToolCount(),
    crafted: TOOLS.filter((t) => t.crafted).length,
    categories: CATEGORIES.length,
  };
}
