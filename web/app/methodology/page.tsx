"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { TableSkeleton } from "@/components/skeleton";
import { usePollingFetch } from "@/lib/hooks";

interface SkewStat {
  total: number;
  correct: number;
  win_rate_pct: number | null;
}

interface MethodologyStats {
  signals: {
    total: number;
    resolved: number;
    correct: number;
    overall_win_rate_pct: number | null;
    first_captured: string | null;
    latest_captured: string | null;
  };
  skew_breakdown: Record<string, SkewStat>;
  resolved_markets: number;
  per_trader: {
    records_captured: number;
    traders_scored: number;
    avg_accuracy_pct: number | null;
  };
}

const SKEW_LABELS: Record<string, string> = {
  very_lopsided: "Very lopsided (≥90% or ≤10%)",
  lopsided: "Lopsided (75-90% or 10-25%)",
  moderate: "Moderate (60-75% or 25-40%)",
  tight: "Tight (40-60%)",
};

const SKEW_ORDER = ["tight", "moderate", "lopsided", "very_lopsided"];

function daysBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  return Math.max(
    0,
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
  );
}

function colorForAccuracy(pct: number | null) {
  if (pct === null) return "text-gray-500";
  if (pct >= 70) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-red-400";
}

export default function MethodologyPage() {
  const { data, loading } = usePollingFetch<MethodologyStats>(
    "/api/methodology/stats",
    60_000
  );

  const spanDays = daysBetween(
    data?.signals?.first_captured,
    data?.signals?.latest_captured
  );

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Methodology</h1>
      <p className="text-gray-400 mb-10">
        How PolyScope generates signals, what we measure, and an honest
        accounting of what the data actually shows.
      </p>

      {/* Section 1: The problem */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          1. The problem with a P&amp;L leaderboard
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          Polymarket ranks traders publicly by profit. Profit is not the same
          as being predictive. A trader can be profitable from a handful of
          oversized wins while being systematically wrong on most of their
          diverse positions — including the ones where they disagree with the
          market.
        </p>
        <p className="text-gray-300 leading-relaxed">
          PolyScope asks a narrower, more useful question: when top-ranked
          traders take positions that diverge from the market price, does their
          direction agree with how the market eventually resolves?
        </p>
      </section>

      {/* Section 2: How signals are generated */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          2. How signals are generated
        </h2>
        <ol className="space-y-3 text-gray-300 leading-relaxed list-decimal list-inside">
          <li>
            Every 5 minutes, scan 500 active Polymarket markets meeting
            liquidity thresholds (≥$50K open interest, ≥$10K 24h volume).
          </li>
          <li>
            For each market, fetch current positions held by the top-100
            ranked traders from Polymarket&apos;s leaderboard.
          </li>
          <li>
            Compute a weighted consensus: each trader&apos;s implied YES
            probability is weighted by inverse rank × alpha ratio × log-scaled
            size × category-skill multiplier.
          </li>
          <li>
            If the gap between consensus and market price exceeds 10% and the
            composite signal score passes threshold, emit a signal. For the
            top ~80 candidates we refine using a trade-weighted consensus with
            24-hour exponential half-life decay.
          </li>
          <li>
            Persist per-signal, per-trader attribution: who held which
            direction, at what size, with what weight. This is the foundation
            of per-trader accuracy scoring.
          </li>
        </ol>
      </section>

      {/* Section 3: The honest findings */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          3. The honest findings
        </h2>
        <p className="text-gray-300 leading-relaxed mb-4">
          On 98K+ resolved signals captured through early April 2026, the raw
          aggregate smart-money consensus was <strong>anti-predictive</strong>{" "}
          — correct on only 8.3% of divergent signals. Flipping the direction
          (fading SM consensus) inverted this to 95.4% at the headline level.
        </p>
        <p className="text-gray-300 leading-relaxed mb-4">
          But this headline is almost entirely a composition effect. Most
          resolved signals came from markets already priced lopsided (e.g. 90%
          YES). On those, fading a small contrarian SM position is
          mathematically equivalent to siding with the obvious favorite — not
          real edge.
        </p>
        <p className="text-gray-300 leading-relaxed mb-4">
          The breakdown by market skew makes this explicit:
        </p>

        {loading ? (
          <TableSkeleton rows={4} />
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto mb-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">Market Skew</th>
                  <th className="text-right p-3">Signals</th>
                  <th className="text-right p-3">Win Rate (fade SM)</th>
                </tr>
              </thead>
              <tbody>
                {SKEW_ORDER.map((skew) => {
                  const row = data?.skew_breakdown?.[skew];
                  return (
                    <tr
                      key={skew}
                      className="border-b border-gray-800/50"
                    >
                      <td className="p-3 text-white text-sm">
                        {SKEW_LABELS[skew]}
                      </td>
                      <td className="p-3 text-right text-gray-400 text-sm">
                        {row ? row.total.toLocaleString() : "—"}
                      </td>
                      <td
                        className={`p-3 text-right text-sm font-semibold ${colorForAccuracy(row?.win_rate_pct ?? null)}`}
                      >
                        {row?.win_rate_pct != null
                          ? `${row.win_rate_pct.toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-gray-300 leading-relaxed">
          On <strong>tight 40-60% markets</strong> — where real edge would have
          to live — the fade strategy barely beats a coin flip. The 95%+
          headline is not tradeable alpha. It is a composition artifact of
          heavily skewed markets mixed into the average.
        </p>
      </section>

      {/* Section 4: Why this still matters */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          4. What the data <em>does</em> support
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          Two findings hold up:
        </p>
        <ol className="space-y-2 text-gray-300 leading-relaxed list-decimal list-inside mb-3">
          <li>
            <strong>Polymarket&apos;s P&amp;L leaderboard is not a
            predictive-skill leaderboard.</strong>{" "}
            Top-ranked-by-profit traders take positions that are systematically
            wrong when they diverge from market price.
          </li>
          <li>
            <strong>Individual-trader accuracy varies significantly</strong>{" "}
            and is the real signal worth extracting. Aggregating the top-100
            discards this — you need per-trader attribution over time.
          </li>
        </ol>
        <p className="text-gray-300 leading-relaxed">
          That is why PolyScope captures per-signal per-trader records and
          scores each address individually on resolved outcomes. The output is
          on <Link href="/traders" className="text-emerald-400 hover:underline">/traders</Link>{" "}
          — a dual leaderboard separating genuinely predictive addresses from
          systematically anti-predictive ones.
        </p>
      </section>

      {/* Section 5: Live dataset */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          5. Live dataset
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">Signals</p>
            <p className="text-xl font-semibold text-white">
              {loading ? "…" : (data?.signals.total ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">Resolved</p>
            <p className="text-xl font-semibold text-white">
              {loading ? "…" : (data?.signals.resolved ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">Markets</p>
            <p className="text-xl font-semibold text-white">
              {loading ? "…" : (data?.resolved_markets ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">Span</p>
            <p className="text-xl font-semibold text-white">
              {loading ? "…" : `${spanDays}d`}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Per-Trader Records
            </p>
            <p className="text-xl font-semibold text-white">
              {loading
                ? "…"
                : (data?.per_trader.records_captured ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Traders Scored
            </p>
            <p className="text-xl font-semibold text-white">
              {loading
                ? "…"
                : (data?.per_trader.traders_scored ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 col-span-2">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Overall Win Rate (fade)
            </p>
            <p
              className={`text-xl font-semibold ${colorForAccuracy(data?.signals.overall_win_rate_pct ?? null)}`}
            >
              {loading
                ? "…"
                : data?.signals.overall_win_rate_pct != null
                  ? `${data.signals.overall_win_rate_pct.toFixed(1)}%`
                  : "—"}{" "}
              <span className="text-xs text-gray-500 font-normal">
                (composition-weighted, see §3)
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* Section 6: Caveats */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          6. Limitations we are honest about
        </h2>
        <ul className="space-y-2 text-gray-300 leading-relaxed list-disc list-inside">
          <li>
            Per-trader accuracy data began capture on April 12, 2026. The first
            few weeks of numbers have small per-address sample sizes. Treat
            anything with fewer than 25 signals as preliminary.
          </li>
          <li>
            Resolved-outcome coverage depends on Polymarket&apos;s market-close
            cadence. Fast-resolution markets (sports, daily prices) produce
            most of the resolved sample; long-horizon markets (elections,
            year-end events) are underweighted.
          </li>
          <li>
            Signals are generated every 5 minutes; by construction they cannot
            capture intraday micro-structure or react in under 5 minutes.
          </li>
          <li>
            Category labels come from Polymarket&apos;s tags and are
            inconsistent across similar markets.
          </li>
          <li>
            This is research. PolyScope does not currently route orders and
            does not provide trading advice.
          </li>
        </ul>
      </section>

      <Disclaimer />
    </div>
  );
}
