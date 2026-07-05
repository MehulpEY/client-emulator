import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The tool catalog became the adapters catalog (PLAN §4.7 / §6 W7) — keep old
// links and bookmarks working, category filter included.
export default function ToolsRedirect({ searchParams }: { searchParams: { category?: string } }) {
  redirect(
    searchParams.category
      ? `/adapters?category=${encodeURIComponent(searchParams.category)}`
      : "/adapters",
  );
}
