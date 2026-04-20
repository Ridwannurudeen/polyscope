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

interface BuilderIdentity {
  configured: boolean;
  code: string | null;
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
  const { data: identity } = usePollingFetch<BuilderIdentity>(
    "/api/builder/identity",
    300_000
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
          On our first 98K+ resolved signals we flipped the aggregate SM
          direction universally (after finding the raw consensus was
          anti-predictive at 8.3%). The flipped strategy hit 96% at the headline
          level — but a follow-up per-skew backtest showed that was almost
          entirely a composition effect from heavily lopsided markets.
        </p>
        <p className="text-gray-300 leading-relaxed mb-4">
          The per-skew breakdown forced a correction. On <strong>tight
          40-60% markets</strong>, fading SM lost 0 out of 17 unique markets.
          On moderate markets, 3 of 21. SM was actually predictive when it
          dissented on those bands — going <em>with</em> SM would have won.
          On very-lopsided markets (≥90% or ≤10%), fading gives a near-100%
          hit rate but ~0% ROI — the favorite almost always wins anyway.
        </p>
        <p className="text-gray-300 leading-relaxed mb-4">
          The live strategy now follows that finding:{" "}
          <strong>
            fade SM on very-lopsided markets (composition play), follow SM
            everywhere else (real alpha).
          </strong>{" "}
          On the same 1,556-market backtest this flips net ROI from −2.6% to
          +3.9% at the same 97% headline hit rate.
        </p>
        <p className="text-gray-300 leading-relaxed mb-4">
          The per-band breakdown after the correction:
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
                  <th className="text-right p-3">Win Rate (current strategy)</th>
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
          Headline hit rate is a misleading summary when the sample is
          dominated by one skew band. We report it because it is the number
          most people will ask for, but the per-band numbers and ROI are what
          actually matter.
        </p>
      </section>

      {/* Section 4: Predictive-contributor filter */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          4. The predictive-contributor filter
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          Aggregating top-100 traders into a single consensus hides
          per-trader skill. We score each contributor individually on their
          resolved divergent positions. A trader qualifies as{" "}
          <em>predictive</em> when all three hold: at least 30 resolved
          observations, point accuracy above 50% (genuinely above coin flip),
          and a Wilson-95%-CI lower bound at least 40% (not purely noise).
        </p>
        <p className="text-gray-300 leading-relaxed mb-3">
          On 1,592 backtested signals, restricting to signals backed by at
          least one predictive contributor left{" "}
          <strong>33 signals at 97.0% hit rate and +14.9% simulated ROI</strong>
          {" "}— compared to +4.2% ROI on the unfiltered set. Same hit rate;{" "}
          <strong>roughly 3.5x the return</strong>.
        </p>
        <p className="text-gray-300 leading-relaxed mb-3">
          An earlier version used only the CI-lower gate and misreported
          75 signals at +17.7% ROI. The issue: high-volume anti-predictive
          traders (e.g. 47.5% accuracy on 1,000+ observations) have a
          Wilson-CI lower bound that still crosses 40%, so they cleared the
          gate and appeared on nearly every signal. Requiring the point
          estimate itself to be above 50% restores the filter&apos;s
          meaning.
        </p>
        <p className="text-gray-300 leading-relaxed mb-3">
          The filter concentrates into tight and moderate markets where
          aggregation is weakest and individual conviction matters most:
        </p>
        <ul className="space-y-1 text-gray-300 leading-relaxed list-disc list-inside mb-3 text-sm">
          <li>tight (40-60%): 1/1 won, +113% ROI</li>
          <li>moderate: 3/3 won, +156% ROI</li>
          <li>very-lopsided: 28/29, −3% ROI (still composition-bound)</li>
        </ul>
        <p className="text-gray-300 leading-relaxed mb-3">
          Caveats: the eligible-contributor list is currently very short (two
          traders cleared the 40% Wilson-lower threshold at time of writing).
          The filter&apos;s value will grow as per-trader observations
          accumulate. Signals on the Smart Money page are tagged with a{" "}
          <span className="inline-block px-1.5 py-0.5 bg-violet-500/10 border border-violet-500/40 text-violet-300 text-xs rounded">
            ⚡ Predictive-backed
          </span>{" "}
          badge when they qualify.
        </p>
      </section>

      {/* Section 5: Why per-trader attribution exists */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          5. What the data <em>does</em> support
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          Three findings hold up:
        </p>
        <ol className="space-y-2 text-gray-300 leading-relaxed list-decimal list-inside mb-3">
          <li>
            <strong>
              Polymarket&apos;s P&amp;L leaderboard is not a predictive-skill
              leaderboard.
            </strong>{" "}
            Top-ranked-by-profit traders cluster near 45-55% individual
            accuracy on divergent signals. Most are not reliably predictive.
          </li>
          <li>
            <strong>A handful of individuals clear a meaningful edge.</strong>{" "}
            Two addresses currently have Wilson-CI lower bounds above 40% on
            30+ resolved observations. This is the population the predictive
            filter surfaces.
          </li>
          <li>
            <strong>Aggregation changes the picture per-band.</strong>{" "}
            Weighted consensus of top-100 traders is predictive enough to
            overcome individual noise on tight and moderate markets; it is
            composition-bound on very-lopsided markets.
          </li>
        </ol>
        <p className="text-gray-300 leading-relaxed">
          The per-trader leaderboard is on{" "}
          <Link href="/traders" className="text-emerald-400 hover:underline">
            /traders
          </Link>{" "}
          — predictive ↔ anti-predictive, with sample sizes and confidence
          intervals shown so you can weigh the evidence yourself.
        </p>
      </section>

      {/* Section 5: Live dataset */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          6. Live dataset
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
              Overall Win Rate (live strategy)
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

      {/* Section 7: Builder identity */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          7. Builder identity
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          PolyScope is a registered Polymarket builder. Our builder code
          is a public <code className="text-xs bg-gray-800 px-1 py-0.5 rounded">bytes32</code>{" "}
          identifier tied to our builder profile; orders routed through
          PolyScope carry this code and attribute volume to us on-chain.
        </p>
        {identity?.configured && identity.code ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-2">
              Builder Code
            </p>
            <p className="font-mono text-sm text-emerald-400 break-all">
              {identity.code}
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-400">
            Builder code not configured on this deployment.
          </div>
        )}
        <p className="text-gray-400 leading-relaxed text-sm mt-3">
          Full transparency page with live order log:{" "}
          <Link
            href="/builder"
            className="text-emerald-400 hover:underline"
          >
            /builder
          </Link>
          .
        </p>
      </section>

      {/* Section 8: Caveats */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-white mb-3">
          8. Limitations we are honest about
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
            PolyScope offers an optional non-custodial order-routing UI.
            Your wallet signs every order locally and submits directly to
            Polymarket; PolyScope never holds keys or funds. Signals are
            research, not trading advice. Past accuracy does not imply
            future performance. See{" "}
            <Link href="/terms" className="text-emerald-400 hover:underline">
              /terms
            </Link>
            .
          </li>
        </ul>
      </section>

      <Disclaimer />
    </div>
  );
}
