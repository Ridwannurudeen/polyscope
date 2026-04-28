"use client";

import { useEffect, useState } from "react";

export type ViewMode = "list" | "grid";

const KEY_PREFIX = "polyscope.view.";

export function useViewMode(scope: string, fallback: ViewMode = "list") {
  const [mode, setModeState] = useState<ViewMode>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`${KEY_PREFIX}${scope}`);
      if (raw === "list" || raw === "grid") setModeState(raw);
    } catch {
      // ignore
    }
    setHydrated(true);
  }, [scope]);

  const setMode = (next: ViewMode) => {
    setModeState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(`${KEY_PREFIX}${scope}`, next);
      } catch {
        // ignore
      }
    }
  };

  return { mode, setMode, hydrated };
}

/**
 * List ↔ grid switch. Two buttons in a framed group, with explicit text
 * labels on desktop so users don't have to interpret the icons. Sized
 * h-9 (36px) — comfortable for both pointer and touch — and hit areas
 * extend to the full button bounds.
 *
 * Keyboard: Tab focuses, Enter activates, ArrowLeft/Right switches modes.
 */
export function ViewToggle({
  mode,
  onChange,
  className = "",
}: {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className={`inline-flex items-stretch surface rounded-md p-0.5 ${className}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange("list");
        else if (e.key === "ArrowRight") onChange("grid");
      }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "list"}
        aria-label="List view"
        onClick={() => onChange("list")}
        className={`inline-flex items-center gap-1.5 px-2.5 h-9 rounded-sm text-eyebrow font-mono uppercase tracking-wider transition-colors ${
          mode === "list"
            ? "bg-ink-700 text-ink-100"
            : "text-ink-500 hover:text-ink-300"
        }`}
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="12" height="1.5" rx="0.5" fill="currentColor" />
          <rect x="2" y="7.25" width="12" height="1.5" rx="0.5" fill="currentColor" />
          <rect x="2" y="11.5" width="12" height="1.5" rx="0.5" fill="currentColor" />
        </svg>
        <span className="hidden sm:inline">list</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "grid"}
        aria-label="Grid view"
        onClick={() => onChange("grid")}
        className={`inline-flex items-center gap-1.5 px-2.5 h-9 rounded-sm text-eyebrow font-mono uppercase tracking-wider transition-colors ${
          mode === "grid"
            ? "bg-ink-700 text-ink-100"
            : "text-ink-500 hover:text-ink-300"
        }`}
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="5.5" height="5.5" rx="0.75" fill="currentColor" />
          <rect x="8.5" y="2" width="5.5" height="5.5" rx="0.75" fill="currentColor" />
          <rect x="2" y="8.5" width="5.5" height="5.5" rx="0.75" fill="currentColor" />
          <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="0.75" fill="currentColor" />
        </svg>
        <span className="hidden sm:inline">grid</span>
      </button>
    </div>
  );
}
