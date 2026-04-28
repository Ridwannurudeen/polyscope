"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "polyscope.theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

/**
 * Three-state theme toggle (light · system · dark) cycled by a single
 * button. Initial render uses `system` so SSR markup matches client
 * before hydration; we apply the persisted choice immediately on mount.
 *
 * The HEAD inline-script in layout.tsx applies the theme BEFORE first
 * paint to prevent a dark→light flash. This component just exposes the
 * control + state.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = readStoredTheme();
    setTheme(stored);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme, mounted]);

  // React to OS preference changes when in system mode
  useEffect(() => {
    if (!mounted || theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, mounted]);

  const cycle = () => {
    setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  };

  // Render a stable shell on SSR; swap icon after mount.
  const label =
    !mounted ? "theme"
    : theme === "light" ? "light theme"
    : theme === "dark" ? "dark theme"
    : "system theme";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Toggle theme — current: ${label}. Click to change.`}
      title={`theme · ${mounted ? theme : "system"}`}
      className="w-9 h-9 inline-flex items-center justify-center rounded-md border border-ink-700 text-ink-400 hover:text-ink-100 hover:border-ink-600 transition-colors"
    >
      {mounted && theme === "light" ? (
        // Sun
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
        </svg>
      ) : mounted && theme === "dark" ? (
        // Moon
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      ) : (
        // System (split circle)
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18" strokeLinecap="round" />
          <path d="M12 3a9 9 0 010 18" fill="currentColor" stroke="none" />
        </svg>
      )}
    </button>
  );
}
