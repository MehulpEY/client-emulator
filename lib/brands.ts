// ============================================================================
// Per-adapter vendor branding. `public/logos/<toolId>.svg` holds a real vendor
// logo for the adapters listed in BRAND_LOGO_IDS. Logos were sourced from open
// logo repositories (Wikimedia Commons, Simple Icons [CC0], VectorLogoZone) and
// remain the trademarks of their respective owners — they appear only to
// identify the corresponding adapter (nominative use), as in any integration
// catalog. Vendors without an openly-licensed SVG fall back to a brand-tinted
// monogram tile (brandFallbackColor). Keep this in sync with the files on disk.
// ============================================================================

/** Adapters that have a bundled real logo at public/logos/<toolId>.svg. */
export const BRAND_LOGO_IDS: ReadonlySet<string> = new Set([
  "virustotal",
  "crowdstrike",
  "qualys",
  "entra-id",
  "forcepoint-dlp",
  "trellix-epo",
  "cisco-meraki",
  "cisco-umbrella",
  "digicert",
  "zscaler-zpa",
  "zscaler-zia",
  "zscaler-rba",
  "zscaler-ai-guard",
  "okta",
  "tenable",
  "sentinelone",
  "intune",
  "jamf",
  "servicenow",
  "wiz",
]);

/** True when a real vendor logo file exists for this adapter. */
export function hasBrandLogo(toolId: string): boolean {
  return BRAND_LOGO_IDS.has(toolId);
}

/** Public path to the bundled logo (only meaningful when hasBrandLogo). */
export function brandLogoSrc(toolId: string): string {
  return `/logos/${toolId}.svg`;
}

// Brand accent for the monogram fallback (vendors with no openly-licensed SVG).
// Approximate primary brand colours — used only to tint the fallback tile.
const FALLBACK_COLOR: Record<string, string> = {
  rapid7: "#E5352B",
  "recorded-future": "#CF2E2E",
  "appomni-agentguard": "#4B31C9",
};

/** Tint for the monogram fallback tile; a neutral slate for anything unmapped. */
export function brandFallbackColor(toolId: string): string {
  return FALLBACK_COLOR[toolId] ?? "#3B3B47";
}
