"use client";

import Link from "next/link";
import { usePollingFetch } from "@/lib/hooks";
import type { ScanResult, DivergenceSignal } from "@/lib/api";

/**
 * Continuous horizontal marquee of live divergence signals. Pauses on
 * hover. Edges fade out via mask. Each item links to the market.
 *
 * Critical: we render the same items twice and translate -50% so the
 * loop is seamless. CSS animation with `prefers-reduced-motion` guard
 * (handled in globals).
 */
export function LiveTicker() {
  const { data } = usePollingFetch<ScanResult>("/api/scan/latest", 60_000);
  const signals = (data?.divergences || []).slice(0, 14);

  if (signals.length === 0) {
    return (
      <div className="border-y border-ink-800 py-3">
        <div className="flex items-center gap-3 text-micro font-mono text-ink-500">
          <span className="eyebrow text-ink-500">live feed</span>
          <span>· no active divergence signals</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative border-y border-ink-800 py-3 mb-12 mask-fade-x overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 z-10 px-4 flex items-center bg-gradient-to-r from-background via-background to-transparent">
        <span className="relative inline-flex mr-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-scope-500" />
          <span className="absolute inset-0 inline-block w-1.5 h-1.5 rounded-full bg-scope-500 animate-ping opacity-60" />
        </span>
        <span className="eyebrow text-scope-500">live</span>
      </div>
      <div className="marquee-track gap-10 pl-28">
        {[...signals, ...signals].map((s: DivergenceSignal, i) => (
          <Link
            key={`${s.market_id}-${i}`}
            href={`/market/${s.market_id}`}
            className="flex items-center gap-3 text-body-sm text-ink-300 hover:text-ink-100 transition-colors shrink-0"
          >
            <span
              className={`num text-body font-medium tracking-tight ${
                s.divergence_pct > 0.2 ? "text-fade-500" : "text-fade-500/70"
              }`}
            >
              {(s.divergence_pct * 100).toFixed(0)}%
            </span>
            <span className="max-w-[260px] truncate">{s.question}</span>
            <span className="text-micro font-mono text-ink-500">
              crowd{" "}
              <span className="num text-ink-300">
                {(s.market_price * 100).toFixed(0)}%
              </span>{" "}
              · ps{" "}
              <span
                className={`num ${
                  s.sm_direction === "YES" ? "text-scope-400" : "text-fade-500"
                }`}
              >
                {s.sm_direction} {(s.sm_consensus * 100).toFixed(0)}%
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
