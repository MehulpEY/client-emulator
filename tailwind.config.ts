import type { Config } from "tailwindcss";

/**
 * Design tokens map to the CSS custom properties declared in `globals.css`
 * (theme-aware: light under `:root`/`[data-theme="light"]`, dark under
 * `[data-theme="dark"]`). The CSS vars are the single source of truth; this
 * file only exposes them to Tailwind's utility generator.
 *
 * Doctrine (shared with the reference design system): calm-enterprise,
 * readable - Inter type (via next/font `--font-sans`), soft radii
 * (xs 4 / sm 6 / DEFAULT 8 / md 10 / lg 12 / xl 16 / full pill), hairline
 * borders, electric-yellow accent. Depth comes from borders + the 1px glass
 * inset in `globals.css`; outer drop shadows are reserved for overlays
 * (popovers / modals).
 */
const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // -- canvas / surfaces -----------------------------------------------
        bg: "var(--bg)",
        canvas: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface-2)",
        surfaceHover: "var(--surface-hover)",
        sunk: "var(--surface-sunk)",
        elevated: "var(--elevated)",
        border: "var(--border)",
        borderStrong: "var(--border-strong)",
        hair: "var(--hair)",
        // -- type ------------------------------------------------------------
        text: "var(--text)",
        text2: "var(--text-2)",
        text3: "var(--text-3)",
        // -- brand accent ----------------------------------------------------
        accent: {
          DEFAULT: "var(--accent)",
          2: "var(--accent-2)",
          ink: "var(--accent-ink)",
          soft: "var(--accent-soft)",
          press: "var(--accent-press)",
          fg: "var(--accent-fg)",
        },
        // -- state semantics -------------------------------------------------
        ok: { DEFAULT: "var(--ok)", bg: "var(--ok-bg)", line: "var(--ok-line)" },
        info: { DEFAULT: "var(--info)", bg: "var(--info-bg)", line: "var(--info-line)" },
        warn: { DEFAULT: "var(--warn)", bg: "var(--warn-bg)", line: "var(--warn-line)" },
        danger: { DEFAULT: "var(--danger)", bg: "var(--danger-bg)", line: "var(--danger-line)" },
        sev: {
          critical: "var(--sev-critical)", "critical-bg": "var(--sev-critical-bg)", "critical-line": "var(--sev-critical-line)",
          high: "var(--sev-high)", "high-bg": "var(--sev-high-bg)", "high-line": "var(--sev-high-line)",
          medium: "var(--sev-medium)", "medium-bg": "var(--sev-medium-bg)", "medium-line": "var(--sev-medium-line)",
          low: "var(--sev-low)", "low-bg": "var(--sev-low-bg)", "low-line": "var(--sev-low-line)",
        },
        // -- aliases kept so older markup re-skins automatically --------------
        panel: "var(--surface)",
        ink: "var(--text)",
        muted: "var(--text-2)",
        faint: "var(--text-3)",
        line: "var(--border)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Arial", '"Helvetica Neue"', "Helvetica", '"Liberation Sans"', "sans-serif"],
        mono: ["var(--font-mono)", '"SFMono-Regular"', '"SF Mono"', "Menlo", "Consolas", '"Liberation Mono"', "monospace"],
      },
      borderRadius: {
        none: "0", xs: "4px", sm: "6px", DEFAULT: "8px", md: "10px", lg: "12px", xl: "16px", "2xl": "20px", "3xl": "24px", full: "9999px",
      },
      screens: {
        "3xl": "1920px",
        "4xl": "2560px",
      },
      boxShadow: {
        // Panels carry no outer drop shadow - border + inset only.
        panel: "inset 0 1px 0 0 var(--glass-inset)",
        glow: "0 0 0 1px var(--accent-glow)",
        pop: "0 12px 32px -12px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};
export default config;
