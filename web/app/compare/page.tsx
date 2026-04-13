"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { TableSkeleton } from "@/components/skeleton";
import { usePollingFetch } from "@/lib/hooks";

interface PLTrader {
  rank: number;
  address: string;
  name: string | null;
  profit: number;
  volume: number;
  alpha_ratio: number | null;
}

interface AccuracyTrader {
  trader_address: string;
  accuracy_pct: number;
  correct_predictions: number;
  total_divergent_signals: number;
}

interface CompareResponse {
  pl_leaderboard: PLTrader[];
  accuracy_top: AccuracyTrader[];
  accuracy_fade: AccuracyTrader[];
  overlap: {
    addresses: string[];
    count: number;
    overlap_pct_of_accuracy_top: number | null;
  };
  pl_top_in_fade_list: PLTrader[];
  accuracy_top_missing_from_pl: AccuracyTrader[];
  min_signals: number;
  limit: number;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function colorForAccuracy(pct: number) {
  if (pct >= 70) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-red-400";
}

export default function ComparePage() {
  const { data, loading } = usePollingFetch<CompareResponse>(
    "/api/leaderboards/compare?limit=25&min_signals=5",
    120_000
  );

  if (loading) {
    return (
      <div>
        <div className="h-8 w-72 bg-gray-800 rounded animate-pulse mb-6" />
        <TableSkeleton rows={10} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-gray-400">Comparison data unavailable.</div>
    );
  }

  const overlapAddresses = new Set(
    data.overlap.addresses.map((a) => a.toLowerCase())
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">
          P&amp;L vs Accuracy
        </h1>
        <p className="text-gray-400 max-w-3xl">
          Polymarket ranks traders by profit. PolyScope ranks them by how often
          their positions match resolved outcomes when they diverge from the
          crowd. These are not the same thing.
        </p>
      </div>

      {/* Headline stats */}
      <section className="mb-8">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              P&amp;L top {data.limit}
            </p>
            <p className="text-2xl font-semibold text-white">
              {data.pl_leaderboard.length}
            </p>
            <p className="text-xs text-gray-500 mt-1">addresses ranked</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Accuracy top {data.limit}
            </p>
            <p className="text-2xl font-semibold text-white">
              {data.accuracy_top.length}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              with ≥{data.min_signals} signals
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Overlap
            </p>
            <p className="text-2xl font-semibold text-amber-400">
              {data.overlap.count}
              <span className="text-sm text-gray-400 ml-2 font-normal">
                {data.overlap.overlap_pct_of_accuracy_top != null
                  ? `(${data.overlap.overlap_pct_of_accuracy_top.toFixed(0)}% of accuracy top)`
                  : ""}
              </span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              addresses on both lists
            </p>
          </div>
        </div>
      </section>

      {/* Side-by-side */}
      <section className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* P&L side */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">
            Polymarket P&amp;L Leaderboard
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Ranked by total profit
          </p>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">#</th>
                  <th className="text-left p-3">Trader</th>
                  <th className="text-right p-3">Profit</th>
                </tr>
              </thead>
              <tbody>
                {data.pl_leaderboard.map((t) => {
                  const isOverlap = overlapAddresses.has(
                    t.address.toLowerCase()
                  );
                  return (
                    <tr
                      key={t.address}
                      className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${isOverlap ? "bg-emerald-500/5" : ""}`}
                    >
                      <td className="p-3 text-gray-500 w-8">{t.rank}</td>
                      <td className="p-3">
                        <Link
                          href={`/traders/${t.address}`}
                          className={`font-mono text-xs hover:text-emerald-400 ${isOverlap ? "text-emerald-400" : "text-white"}`}
                        >
                          {t.name || shortAddr(t.address)}
                        </Link>
                        {isOverlap && (
                          <span className="ml-2 text-xs text-emerald-400">
                            ★
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right text-emerald-400 font-medium">
                        ${t.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Accuracy side */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">
            PolyScope Accuracy Leaderboard
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Ranked by hit rate when diverging from market
          </p>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">#</th>
                  <th className="text-left p-3">Trader</th>
                  <th className="text-right p-3">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.accuracy_top.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-4 text-sm text-gray-500">
                      Building leaderboard — needs more resolved signals.
                    </td>
                  </tr>
                ) : (
                  data.accuracy_top.map((t, i) => {
                    const isOverlap = overlapAddresses.has(
                      t.trader_address.toLowerCase()
                    );
                    return (
                      <tr
                        key={t.trader_address}
                        className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${isOverlap ? "bg-emerald-500/5" : ""}`}
                      >
                        <td className="p-3 text-gray-500 w-8">{i + 1}</td>
                        <td className="p-3">
                          <Link
                            href={`/traders/${t.trader_address}`}
                            className={`font-mono text-xs hover:text-emerald-400 ${isOverlap ? "text-emerald-400" : "text-white"}`}
                          >
                            {shortAddr(t.trader_address)}
                          </Link>
                          {isOverlap && (
                            <span className="ml-2 text-xs text-emerald-400">
                              ★
                            </span>
                          )}
                        </td>
                        <td
                          className={`p-3 text-right font-medium ${colorForAccuracy(t.accuracy_pct)}`}
                        >
                          {t.accuracy_pct.toFixed(0)}%
                          <span className="text-xs text-gray-500 ml-1">
                            ({t.correct_predictions}/{t.total_divergent_signals})
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Receipts */}
      <section className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">
            P&amp;L Top That Are Anti-Predictive
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            High-profit traders whose divergent positions are wrong more often
            than right
          </p>
          <div className="bg-gray-900 border border-gray-800 rounded-xl">
            {data.pl_top_in_fade_list.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">
                No overlap with the fade list yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {data.pl_top_in_fade_list.map((t) => (
                    <tr
                      key={t.address}
                      className="border-b border-gray-800/50 last:border-0"
                    >
                      <td className="p-3 text-gray-500 w-8">#{t.rank}</td>
                      <td className="p-3">
                        <Link
                          href={`/traders/${t.address}`}
                          className="text-white font-mono text-xs hover:text-red-400"
                        >
                          {t.name || shortAddr(t.address)}
                        </Link>
                      </td>
                      <td className="p-3 text-right text-red-400 text-xs">
                        on fade list
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-white mb-1">
            Accuracy Leaders Missing From P&amp;L Top
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Predictive traders the P&amp;L ranking overlooks
          </p>
          <div className="bg-gray-900 border border-gray-800 rounded-xl">
            {data.accuracy_top_missing_from_pl.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">
                Nothing missing — the two rankings align here.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {data.accuracy_top_missing_from_pl.map((t) => (
                    <tr
                      key={t.trader_address}
                      className="border-b border-gray-800/50 last:border-0"
                    >
                      <td className="p-3">
                        <Link
                          href={`/traders/${t.trader_address}`}
                          className="text-white font-mono text-xs hover:text-emerald-400"
                        >
                          {shortAddr(t.trader_address)}
                        </Link>
                      </td>
                      <td
                        className={`p-3 text-right font-medium ${colorForAccuracy(t.accuracy_pct)}`}
                      >
                        {t.accuracy_pct.toFixed(0)}%
                        <span className="text-xs text-gray-500 ml-1">
                          ({t.correct_predictions}/{t.total_divergent_signals})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="mb-10 bg-gray-900 border border-gray-800 rounded-xl p-5">
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="text-white font-semibold">Why this matters:</span>{" "}
          P&amp;L can be driven by a handful of oversized wins or by trading
          high-volume markets with thin edges. Predictive accuracy is the
          orthogonal question — does this trader&apos;s direction match how
          markets actually resolve? When you&apos;re looking for signal, that
          second question is the one that matters. See the{" "}
          <Link
            href="/methodology"
            className="text-emerald-400 hover:underline"
          >
            full methodology
          </Link>{" "}
          for how this is measured and the honest caveats.
        </p>
      </section>

      <Disclaimer />
    </div>
  );
}
