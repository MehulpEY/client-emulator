import { Boxes } from "lucide-react";
import { cn } from "@/lib/cn";

/** Squared brand mark - the glyph in a flat yellow tile + wordmark. */
export function Brand({ size = "md", showSub = true, className }: { size?: "sm" | "md"; showSub?: boolean; className?: string }) {
  const tile = size === "sm" ? 26 : 30;
  const glyph = Math.round(tile * 0.56);
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="grid shrink-0 place-items-center bg-accent" style={{ width: tile, height: tile }}>
        <Boxes size={glyph} className="text-accent-ink" />
      </span>
      <div className="leading-[1.15]">
        <div className={cn("font-bold tracking-[-0.01em]", size === "sm" ? "text-[13px]" : "text-[14px]")}>Client Emulator</div>
        {showSub && <div className="text-[10px] uppercase tracking-[0.14em] text-text3">Tool Sandbox</div>}
      </div>
    </div>
  );
}

export default Brand;
