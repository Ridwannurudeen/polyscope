"use client";

import Link from "next/link";
import { useState } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { FollowButton } from "@/components/follow-button";
import { LastUpdated } from "@/components/last-updated";
import { TableSkeleton } from "@/components/skeleton";
import { usePollingFetch } from "@/lib/hooks";

interface AccuracyCI {
  pct: number;
  lo: number;
  hi: number;
  total: number;
  correct: number;
  sufficient: boolean;
}

interface TraderAccuracy {
  trader_address: string;
  total_divergent_signals: number;
  correct_predictions: number;
  wrong_predictions: number;
  accuracy_pct: number;
  accuracy_by_skew: Record<string, { total: number; correct: number }>;
  accuracy_by_category: Record<string, { total: number; correct: number }>;
  last_updated: string;
  ci?: AccuracyCI;
}

interface LeaderboardResponse {
  traders: TraderAccuracy[];
  count: number;
  order: string;
  min_signals: number;
}

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function accuracyColor(pct: number) {
  if (pct >= 70) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-red-400";
}

export default function TradersPage() {
  const [minSignals, setMinSignals] = useState(5);

  const { data: predictive, loading, error, lastUpdated, retry } =
    usePollingFetch<LeaderboardResponse>(
      `/api/traders/leaderboard?order=predictive&min_signals=${minSignals}&limit=50`,
      60_000
    );

  const { data: antiPredictive } = usePollingFetch<LeaderboardResponse>(
    `/api/traders/leaderboard?order=anti-predictive&min_signals=${minSignals}&limit=50`,
    60_000
  );

  const predictiveTraders = predictive?.traders || [];
  const antiTraders = antiPredictive?.traders || [];

  if (loading) {
    return (
      <div>
        <div className="mb-2">
          <div className="h-8 w-64 bg-gray-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-96 bg-gray-800/60 rounded animate-pulse mb-6" />
        </div>
        <TableSkeleton rows={10} />
      </div>
    );
  }

  if (error && !predictive) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-3">Failed to load trader accuracy data.</p>
        <button
          onClick={retry}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const noData = predictiveTraders.length === 0 && antiTraders.length === 0;

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <h1 className="text-3xl font-bold text-white">The True Smart Money Leaderboard</h1>
        <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
      </div>
      <p className="text-gray-400 mb-6 max-w-3xl">
        Polymarket ranks traders by P&amp;L — profitable, but not necessarily{" "}
        <em>predictive</em>. PolyScope ranks them by how often their positions
        match the actual market outcome when they diverge from the crowd. Two
        views: the genuinely predictive traders, and the ones worth fading.
      </p>

      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm text-gray-400">Min signals per trader:</label>
        <select
          value={minSignals}
          onChange={(e) => setMinSignals(Number(e.target.value))}
          className="bg-gray-900 border border-gray-800 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-600"
        >
          <option value={1}>1+</option>
          <option value={5}>5+</option>
          <option value={10}>10+</option>
          <option value={25}>25+</option>
          <option value={50}>50+</option>
        </select>
      </div>

      {noData ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-2">
            Building per-trader accuracy data.
          </p>
          <p className="text-gray-500 text-sm">
            Meaningful sample sizes require ~7-14 days of signal resolution.
            Come back soon.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Predictive */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-1">
              Predictive Traders
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Positions match actual outcomes — real smart money
            </p>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                    <th className="text-left p-3">#</th>
                    <th className="text-left p-3">Trader</th>
                    <th className="text-right p-3">Accuracy (95% CI)</th>
                    <th className="text-right p-3">Signals</th>
                    <th className="text-right p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {predictiveTraders.map((t, i) => (
                    <tr
                      key={t.trader_address}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="p-3 text-gray-500 text-sm">{i + 1}</td>
                      <td className="p-3">
                        <Link
                          href={`/traders/${t.trader_address}`}
                          className="text-white text-sm font-mono hover:text-emerald-400"
                        >
                          {formatAddress(t.trader_address)}
                        </Link>
                      </td>
                      <td className="p-3 text-right">
                        <div
                          className={`text-sm font-semibold ${accuracyColor(t.accuracy_pct)}`}
                        >
                          {t.accuracy_pct.toFixed(1)}%
                        </div>
                        {t.ci && (
                          <div className="text-xs text-gray-500">
                            [{t.ci.lo.toFixed(0)}–{t.ci.hi.toFixed(0)}%]
                            {!t.ci.sufficient && (
                              <span
                                className="ml-1 text-amber-500/70"
                                title="Sample size below 30 — treat as noisy"
                              >
                                ⚠
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right text-sm text-gray-400">
                        {t.correct_predictions}/{t.total_divergent_signals}
                      </td>
                      <td className="p-3 text-right">
                        <FollowButton
                          traderAddress={t.trader_address}
                          size="sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Anti-predictive */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-1">
              Traders to Fade
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Consistently wrong when they diverge from market price
            </p>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                    <th className="text-left p-3">#</th>
                    <th className="text-left p-3">Trader</th>
                    <th className="text-right p-3">Accuracy (95% CI)</th>
                    <th className="text-right p-3">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {antiTraders.map((t, i) => (
                    <tr
                      key={t.trader_address}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="p-3 text-gray-500 text-sm">{i + 1}</td>
                      <td className="p-3">
                        <Link
                          href={`/traders/${t.trader_address}`}
                          className="text-white text-sm font-mono hover:text-red-400"
                        >
                          {formatAddress(t.trader_address)}
                        </Link>
                      </td>
                      <td className="p-3 text-right">
                        <div
                          className={`text-sm font-semibold ${accuracyColor(t.accuracy_pct)}`}
                        >
                          {t.accuracy_pct.toFixed(1)}%
                        </div>
                        {t.ci && (
                          <div className="text-xs text-gray-500">
                            [{t.ci.lo.toFixed(0)}–{t.ci.hi.toFixed(0)}%]
                            {!t.ci.sufficient && (
                              <span
                                className="ml-1 text-amber-500/70"
                                title="Sample size below 30 — treat as noisy"
                              >
                                ⚠
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right text-sm text-gray-400">
                        {t.correct_predictions}/{t.total_divergent_signals}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <Disclaimer />
    </div>
  );
}
