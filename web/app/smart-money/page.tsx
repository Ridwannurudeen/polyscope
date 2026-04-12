"use client";

import { useState } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { ScoreBadge } from "@/components/score-badge";
import { SignalEvidence } from "@/components/signal-evidence";
import { TableSkeleton } from "@/components/skeleton";
import { WhaleFlow } from "@/components/whale-flow";
import { usePollingFetch } from "@/lib/hooks";
import type { Trader, DivergenceSignal } from "@/lib/api";

interface LeaderboardResponse {
  traders: Trader[];
  count: number;
}

interface DivergencesResponse {
  signals: DivergenceSignal[];
  count: number;
}

interface HistorySignal {
  market_id: string;
  question: string;
  sm_direction: string;
  market_price: number;
  sm_consensus: number;
  outcome_correct: number | null;
  timestamp: string;
}

interface HistoryResponse {
  history: HistorySignal[];
  count: number;
}

export default function SmartMoneyPage() {
  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);

  const {
    data: lbData,
    loading: lbLoading,
    error: lbError,
    lastUpdated,
    retry,
  } = usePollingFetch<LeaderboardResponse>(
    "/api/smart-money/leaderboard",
    60_000
  );

  const { data: divData } = usePollingFetch<DivergencesResponse>(
    "/api/divergences",
    60_000
  );

  const { data: histData } = usePollingFetch<HistoryResponse>(
    "/api/divergences/history?limit=50",
    60_000
  );

  const traders = lbData?.traders || [];
  const divergences = divData?.signals || [];
  const history = histData?.history || [];

  if (lbLoading) {
    return (
      <div>
        <div className="mb-2">
          <div className="h-8 w-48 bg-gray-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-80 bg-gray-800/60 rounded animate-pulse mb-6" />
        </div>
        <TableSkeleton rows={10} />
      </div>
    );
  }

  if (lbError && !lbData) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-3">Failed to load smart money data.</p>
        <button
          onClick={retry}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <h1 className="text-3xl font-bold text-white">Smart Money Feed</h1>
        <LastUpdated lastUpdated={lastUpdated} error={lbError} retry={retry} />
      </div>
      <p className="text-gray-400 mb-6">
        Top trader rankings and counter-consensus signals. Read-only intelligence.
      </p>

      {/* Whale Flow */}
      <WhaleFlow />

      {/* Counter-consensus signals */}
      {divergences.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">
            Active Divergences
          </h2>
          <div className="space-y-3">
            {divergences.map((d, i) => {
              const isExpanded = expandedMarket === d.market_id;
              return (
                <div
                  key={d.market_id + i}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-white font-medium">{d.question}</p>
                      <div className="flex gap-4 mt-2 text-sm">
                        <span className="text-gray-400">
                          Crowd: {(d.market_price * 100).toFixed(0)}% YES
                        </span>
                        <span
                          className={
                            d.sm_direction === "YES"
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          PolyScope: {(d.sm_consensus * 100).toFixed(0)}% (favors{" "}
                          {d.sm_direction})
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <ScoreBadge score={d.score} label="Score" />
                      <button
                        onClick={() =>
                          setExpandedMarket(isExpanded ? null : d.market_id)
                        }
                        className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg whitespace-nowrap"
                      >
                        {isExpanded ? "Hide" : "Evidence"}
                      </button>
                    </div>
                  </div>
                  {isExpanded && <SignalEvidence marketId={d.market_id} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Resolved Signals */}
      {history.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">
            Resolved Signals
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Market</th>
                  <th className="text-center p-3">SM Called</th>
                  <th className="text-center p-3">Crowd Said</th>
                  <th className="text-center p-3">Correct</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr
                    key={h.market_id + i}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="p-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(h.timestamp).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-white text-sm truncate max-w-[300px]">
                      {h.question}
                    </td>
                    <td
                      className={`p-3 text-center text-sm font-medium ${
                        h.sm_direction === "YES"
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {h.sm_direction}
                    </td>
                    <td className="p-3 text-center text-sm text-gray-400">
                      {(h.market_price * 100).toFixed(0)}% YES
                    </td>
                    <td className="p-3 text-center text-lg">
                      {h.outcome_correct === 1
                        ? "\u2705"
                        : h.outcome_correct === 0
                          ? "\u274c"
                          : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Leaderboard */}
      <section>
        <h2 className="text-xl font-semibold text-white mb-4">
          Top Traders by Profit
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                <th className="text-left p-3">Rank</th>
                <th className="text-left p-3">Trader</th>
                <th className="text-right p-3">Profit</th>
                <th className="text-right p-3">Volume</th>
                <th className="text-right p-3">Alpha</th>
              </tr>
            </thead>
            <tbody>
              {traders.slice(0, 50).map((t) => {
                const alpha = (t.alpha_ratio || 0) * 100;
                const alphaColor =
                  alpha > 5
                    ? "text-emerald-400"
                    : alpha > 1
                      ? "text-amber-400"
                      : "text-gray-500";
                return (
                  <tr
                    key={t.address}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="p-3 text-gray-400 text-sm">#{t.rank}</td>
                    <td className="p-3">
                      <p className="text-white text-sm font-medium">
                        {t.name || `${t.address.slice(0, 6)}...${t.address.slice(-4)}`}
                      </p>
                    </td>
                    <td
                      className={`p-3 text-right text-sm font-medium ${
                        t.profit >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      ${t.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-3 text-right text-sm text-gray-400">
                      ${t.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className={`p-3 text-right text-sm font-medium ${alphaColor}`}>
                      {alpha.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
