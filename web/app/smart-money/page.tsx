"use client";

import { useMemo, useState } from "react";
import { DecisionCard } from "@/components/decision-card";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { TableSkeleton } from "@/components/skeleton";
import { WhaleFlow } from "@/components/whale-flow";
import { usePollingFetch } from "@/lib/hooks";
import type { Trader, DivergenceSignal } from "@/lib/api";

type DirectionFilter = "all" | "YES" | "NO";
type SkewFilter = "all" | "tight" | "moderate" | "lopsided" | "very_lopsided";
type TierFilter = "all" | "tier1" | "tier2" | "tier3plus";

function skewBand(price: number): SkewFilter {
  if (price >= 0.9 || price <= 0.1) return "very_lopsided";
  if (price >= 0.75 || price <= 0.25) return "lopsided";
  if (price >= 0.6 || price <= 0.4) return "moderate";
  return "tight";
}

function tierBucket(score: number): TierFilter {
  if (score >= 80) return "tier1";
  if (score >= 60) return "tier2";
  return "tier3plus";
}

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
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [skew, setSkew] = useState<SkewFilter>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [category, setCategory] = useState<string>("all");
  const [predictiveOnly, setPredictiveOnly] = useState(false);

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

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const d of divergences) {
      const c = (d.category || "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [divergences]);

  const filtered = useMemo(() => {
    return divergences.filter((d) => {
      if (direction !== "all" && d.sm_direction !== direction) return false;
      if (skew !== "all" && skewBand(d.market_price) !== skew) return false;
      if (tier !== "all" && tierBucket(d.score) !== tier) return false;
      if (category !== "all" && (d.category || "") !== category) return false;
      if (predictiveOnly && !d.predictive_contributor) return false;
      return true;
    });
  }, [divergences, direction, skew, tier, category, predictiveOnly]);

  const resetFilters = () => {
    setDirection("all");
    setSkew("all");
    setTier("all");
    setCategory("all");
    setPredictiveOnly(false);
  };

  const filtersActive =
    direction !== "all" ||
    skew !== "all" ||
    tier !== "all" ||
    category !== "all" ||
    predictiveOnly;

  const predictiveCount = divergences.filter(
    (d) => d.predictive_contributor
  ).length;

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
          <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
            <h2 className="text-xl font-semibold text-white">
              Active Divergences
              <span className="text-sm text-gray-500 font-normal ml-2">
                {filtered.length} of {divergences.length}
              </span>
            </h2>
            {filtersActive && (
              <button
                onClick={resetFilters}
                className="text-xs text-gray-400 hover:text-white"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Filter bar */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
            <button
              onClick={() => setPredictiveOnly(!predictiveOnly)}
              className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                predictiveOnly
                  ? "bg-violet-500/20 border-violet-500/50 text-violet-200"
                  : "bg-gray-950 border-gray-700 text-gray-400 hover:text-gray-200"
              }`}
              title="Backtest: predictive-backed signals returned +17.7% ROI on 75 signals vs +4.2% unfiltered"
            >
              ⚡ Predictive-backed only
              {predictiveCount > 0 && (
                <span className="ml-1.5 text-[11px] opacity-70">
                  ({predictiveCount})
                </span>
              )}
            </button>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 uppercase">Direction</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as DirectionFilter)}
                className="bg-gray-950 border border-gray-800 text-white rounded px-2 py-1 text-sm"
              >
                <option value="all">All</option>
                <option value="YES">YES only</option>
                <option value="NO">NO only</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 uppercase">Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as TierFilter)}
                className="bg-gray-950 border border-gray-800 text-white rounded px-2 py-1 text-sm"
              >
                <option value="all">All</option>
                <option value="tier1">Tier 1 (≥80)</option>
                <option value="tier2">Tier 2 (60-79)</option>
                <option value="tier3plus">Tier 3+ (&lt;60)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 uppercase">Skew</label>
              <select
                value={skew}
                onChange={(e) => setSkew(e.target.value as SkewFilter)}
                className="bg-gray-950 border border-gray-800 text-white rounded px-2 py-1 text-sm"
              >
                <option value="all">All</option>
                <option value="tight">Tight (40-60%)</option>
                <option value="moderate">Moderate</option>
                <option value="lopsided">Lopsided</option>
                <option value="very_lopsided">Very lopsided</option>
              </select>
            </div>
            {categories.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 uppercase">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="bg-gray-950 border border-gray-800 text-white rounded px-2 py-1 text-sm max-w-[200px]"
                >
                  <option value="all">All</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <p className="text-gray-400 mb-2">
                No signals match the current filters.
              </p>
              <button
                onClick={resetFilters}
                className="text-sm text-emerald-400 hover:text-emerald-300"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((d, i) => (
                <DecisionCard key={d.market_id + i} signal={d} />
              ))}
            </div>
          )}
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
