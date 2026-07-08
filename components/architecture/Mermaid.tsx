"use client";

// Theme-aware Mermaid renderer. Mermaid is loaded lazily (only on this route),
// initialized with the "base" theme, and fed themeVariables read straight from
// the app's CSS custom properties. A MutationObserver on the root data-theme
// attribute re-renders the diagram when the user flips light/dark, so diagrams
// always match the surrounding page in both themes.

import { useEffect, useRef, useState } from "react";

let counter = 0;

function readVars() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback = "") => {
    const val = css.getPropertyValue(name).trim();
    return val || fallback;
  };
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const surface = v("--surface", isDark ? "#16161d" : "#ffffff");
  const surface2 = v("--surface-2", isDark ? "#1c1c25" : "#fafafc");
  const sunk = v("--surface-sunk", isDark ? "#101016" : "#f6f6fa");
  const text = v("--text", isDark ? "#f7f7f8" : "#1a1a24");
  const text2 = v("--text-2", isDark ? "#b4b4c0" : "#4a4a55");
  const text3 = v("--text-3", isDark ? "#8a8a96" : "#5e6877");
  const border = v("--border-strong", isDark ? "#757585" : "#7e7e8a");
  const accent = v("--accent", "#ffe600");
  const accentSoft = v("--accent-soft", isDark ? "#2a2810" : "#fbf6cc");
  const mono = v("--font-mono", "monospace");
  return {
    isDark,
    fontFamily: mono,
    fontSize: "13px",
    background: surface,
    // node fills / borders / text
    primaryColor: surface2,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: sunk,
    secondaryTextColor: text2,
    secondaryBorderColor: border,
    tertiaryColor: accentSoft,
    tertiaryTextColor: text,
    tertiaryBorderColor: accent,
    // edges / labels
    lineColor: text3,
    textColor: text2,
    // cluster (subgraph) styling
    clusterBkg: sunk,
    clusterBorder: border,
    titleColor: text,
    // state diagram specifics
    labelBackgroundColor: surface,
    // notes
    noteBkgColor: accentSoft,
    noteTextColor: text,
    noteBorderColor: accent,
  };
}

export function Mermaid({ code, caption }: { code: string; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [uid] = useState(() => `mmd-${++counter}`);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        const vars = readVars();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "base",
          themeVariables: vars,
          flowchart: { curve: "basis", htmlLabels: true, padding: 12 },
          fontFamily: vars.fontFamily,
        });
        // A fresh id per render avoids collisions with mermaid's internal cache.
        const renderId = `${uid}-${++counter}`;
        const { svg } = await mermaid.render(renderId, code);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        // Make the SVG responsive: it fills the column width but is capped at its
        // own natural width (from the viewBox) so a small diagram is not blown up,
        // and a wide one shrinks to fit on narrow screens instead of overflowing.
        const el = ref.current.querySelector("svg") as SVGSVGElement | null;
        if (el) {
          const vb = el.getAttribute("viewBox");
          let natural = vb ? parseFloat(vb.split(/\s+/)[2]) : 0;
          if (!natural) natural = parseFloat(el.getAttribute("width") || "0");
          el.removeAttribute("width");
          el.removeAttribute("height");
          el.style.width = "100%";
          el.style.height = "auto";
          el.style.maxWidth = natural ? `${Math.ceil(natural)}px` : "100%";
          el.style.display = "block";
          el.style.margin = "0 auto";
        }
        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    render();

    const obs = new MutationObserver(() => render());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [code, uid]);

  return (
    <figure className="panel mt-5 overflow-hidden">
      <div className="emu-scroll overflow-x-auto p-4">
        {status === "error" ? (
          <pre className="mono whitespace-pre-wrap text-[12px] leading-[1.7] text-text3">{code}</pre>
        ) : (
          <div
            ref={ref}
            className="mermaid-host flex min-h-[80px] items-center justify-center"
            aria-hidden={status !== "ok"}
          />
        )}
      </div>
      {caption ? (
        <figcaption className="border-t border-hair px-4 py-2 text-[11.5px] text-text3">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
