"use client";

import Link from "next/link";
import { usePollingFetch } from "@/lib/hooks";
import { dedupeSignalsByMarket } from "@/lib/api";
import type { ScanResult } from "@/lib/api";

export function LiveTicker() {
  const { data } = usePollingFetch<ScanResult>("/api/scan/latest", 60_000);
  const signals = dedupeSignalsByMarket(data?.divergences || []).slice(0, 14);
  const tape = [...signals, ...signals];
  const empty = signals.length === 0;

  // Always render the same outer bar + LIVE pulse so there's no
  // layout shift when signals arrive after first paint.
  return (
    <div className="relative border-y border-ink-800 py-3 mb-10 md:mb-12 mask-fade-x overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 z-10 px-3 md:px-4 flex items-center bg-gradient-to-r from-background via-background to-transparent">
        <span className="relative inline-flex mr-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-scope-500" />
          <span className="absolute inset-0 inline-block w-1.5 h-1.5 rounded-full bg-scope-500 animate-ping opacity-60" />
        </span>
        <span className="eyebrow text-scope-500">live</span>
      </div>
      {empty ? (
        <div className="pl-24 md:pl-28 text-micro font-mono text-ink-500">
          no active divergence signals
        </div>
      ) : (
        <div className="marquee-track gap-8 md:gap-10 pl-24 md:pl-28">
          {tape.map((s, index) => (
            <Link
              key={`${s.market_id}-${index}`}
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
              <span className="max-w-[190px] md:max-w-[260px] truncate">
                {s.question}
              </span>
              <span className="text-micro font-mono text-ink-500">
                crowd{" "}
                <span className="num text-ink-300">
                  {(s.market_price * 100).toFixed(0)}%
                </span>{" "}
                - ps{" "}
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
      )}
    </div>
  );
}
