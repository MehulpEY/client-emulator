"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "emu-theme";

/** Dark/light toggle. Persists to localStorage; the no-flash script in layout
 *  applies the stored theme before paint. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as "dark" | "light") || "dark";
    setTheme(stored);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  }

  return (
    <button onClick={toggle} className="btn-ghost h-8 w-8 !px-0" title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} aria-label="Toggle theme">
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
