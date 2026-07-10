import { cn } from "@/lib/cn";
import { hasBrandLogo, brandLogoSrc, brandFallbackColor } from "@/lib/brands";
import { monogram } from "@/components/adapters/shared";

/**
 * Product/adapter icon. Renders the vendor's real logo (SVG, so it stays sharp
 * at any size / DPI) on a neutral "logo chip" — a light backing that keeps both
 * colour marks and dark monochrome wordmarks legible in either theme. Adapters
 * with no openly-licensed logo fall back to a brand-tinted monogram tile.
 *
 * Pure render (no hooks) so it works in both server and client components. The
 * SVG is loaded via <img>, which also sandboxes it (no script execution).
 */
export function BrandLogo({
  toolId,
  name,
  size = 40,
  rounded = "rounded-lg",
  className,
}: {
  toolId: string;
  name: string;
  /** Square edge length in px. */
  size?: number;
  /** Tailwind radius class (default rounded-lg). */
  rounded?: string;
  className?: string;
}) {
  const box = { width: size, height: size };

  if (hasBrandLogo(toolId)) {
    return (
      <span
        aria-hidden
        style={box}
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-black/[0.07]",
          rounded,
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG, no optimisation needed */}
        <img
          src={brandLogoSrc(toolId)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ width: "82%", height: "82%", objectFit: "contain" }}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      style={{ ...box, background: brandFallbackColor(toolId), fontSize: Math.round(size * 0.34) }}
      className={cn(
        "grid shrink-0 select-none place-items-center font-semibold tracking-[0.02em] text-white",
        rounded,
        className,
      )}
    >
      {monogram(name)}
    </span>
  );
}
