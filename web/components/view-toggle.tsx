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
 * Two-button list/grid switch. Sized for both desktop (compact) and
 * touch (40×40 hit area). Keyboard accessible: Tab to focus, Enter to
 * activate, ArrowLeft/Right to switch between modes inline.
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
      className={`inline-flex items-center surface rounded-md p-0.5 ${className}`}
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
        className={`w-9 h-7 inline-flex items-center justify-center rounded-sm transition-colors ${
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
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "grid"}
        aria-label="Grid view"
        onClick={() => onChange("grid")}
        className={`w-9 h-7 inline-flex items-center justify-center rounded-sm transition-colors ${
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
      </button>
    </div>
  );
}
