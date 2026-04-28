"use client";

import Link from "next/link";
import { PolymarketLogo } from "@/components/polymarket-logo";
import { usePollingFetch } from "@/lib/hooks";
import type { ScanResult } from "@/lib/api";

/**
 * Terminal-style hero — no marketing voice, no SaaS template.
 *
 * One declarative line at display scale. A status strip of live counts
 * pulled from the API. That's it. The leaderboard sits immediately
 * below, owning the rest of the fold.
 *
 * What this is NOT (intentional):
 *  - A "we don't / we rank" sales pitch
 *  - A paragraph explaining what the product is for
 *  - Two CTAs competing for attention
 *  - A right-side big-number with three supporting stats (SaaS hero)
 *
 * What this IS:
 *  - A definition of the product, third-person, period at end
 *  - Live operational counts (markets / signals / qualifying traders /
 *    filter ROI) running across a single low-key strip
 *  - A single tertiary link out to methodology — restraint, not absence
 */

interface MethodologyStats {
  predictive_filter?: {
    qualifying_traders: number;
    signals: number;
    win_pct: number | null;
    roi_pct: number | null;
  };
}

function formatRoi(pct: number | null | undefined): string {
  if (pct == null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function HeroSignature() {
  const { data: scan } = usePollingFetch<ScanResult>(
    "/api/scan/latest",
    60_000,
  );
  const { data: stats } = usePollingFetch<MethodologyStats>(
    "/api/methodology/stats",
    300_000,
  );

  const markets = scan?.total_markets ?? null;
  const signals = scan?.total_divergences ?? null;
  const filter = stats?.predictive_filter;

  return (
    <section className="pt-3 pb-8 mb-8">
      {/* Single declarative line. No paragraph. No CTAs. */}
      <h1 className="text-h2 md:text-h1 lg:text-display text-ink-100 tracking-tightest leading-[1.02] text-balance max-w-4xl">
        Polymarket traders, ranked by{" "}
        <span className="text-scope-400">accuracy</span>{" "}
        <span className="text-ink-400">— not profit.</span>
      </h1>

      {/* Status strip — live operational counts, no eyebrow chrome */}
      <div className="mt-7 flex flex-wrap items-center gap-x-8 gap-y-3 text-body-sm font-mono">
        <span className="inline-flex items-center gap-2 text-ink-400">
          <span className="relative inline-flex">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-scope-500" />
            <span className="absolute inset-0 inline-block w-1.5 h-1.5 rounded-full bg-scope-500 animate-ping opacity-60" />
          </span>
          <span className="uppercase tracking-wider text-eyebrow text-scope-500">
            live
          </span>
        </span>
        <StatInline
          label="markets"
          value={markets !== null ? markets.toLocaleString() : "—"}
        />
        <StatInline
          label="signals"
          value={signals !== null ? signals.toLocaleString() : "—"}
        />
        <StatInline
          label="qualifying traders"
          value={filter?.qualifying_traders != null ? String(filter.qualifying_traders) : "—"}
        />
        <StatInline
          label="filter roi · backtest"
          value={formatRoi(filter?.roi_pct)}
          accent={
            filter?.roi_pct != null
              ? filter.roi_pct >= 0
                ? "scope"
                : "fade"
              : undefined
          }
        />
        <Link
          href="/methodology"
          className="ml-auto text-ink-500 hover:text-ink-200 transition-colors underline-offset-4 hover:underline"
        >
          methodology →
        </Link>
        <a
          href="https://polymarket.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-ink-500 hover:text-ink-200 transition-colors group pl-3 sm:border-l sm:border-ink-800"
          title="Markets, prices, positions and resolutions sourced from Polymarket"
        >
          <span className="eyebrow">data via</span>
          <PolymarketLogo
            variant="full"
            height={12}
            className="opacity-75 group-hover:opacity-100 transition-opacity"
          />
        </a>
      </div>
    </section>
  );
}

function StatInline({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "scope" | "fade";
}) {
  const tone =
    accent === "scope"
      ? "text-scope-400"
      : accent === "fade"
      ? "text-fade-500"
      : "text-ink-200";
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="eyebrow">{label}</span>
      <span className={`num text-body font-medium ${tone}`}>{value}</span>
    </span>
  );
}
