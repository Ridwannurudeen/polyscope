"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { TableSkeleton } from "@/components/skeleton";
import { trackEvent } from "@/lib/analytics";
import { usePollingFetch } from "@/lib/hooks";

interface TraderProfile {
  trader_address: string;
  total_divergent_signals: number;
  correct_predictions: number;
  wrong_predictions: number;
  accuracy_pct: number;
  accuracy_by_skew: Record<string, { total: number; correct: number }>;
  accuracy_by_category: Record<string, { total: number; correct: number }>;
  last_updated: string;
  error?: string;
}

const SKEW_LABELS: Record<string, string> = {
  very_lopsided: "Very Lopsided (≥90% or ≤10%)",
  lopsided: "Lopsided (75-90% or 10-25%)",
  moderate: "Moderate (60-75% or 25-40%)",
  tight: "Tight (40-60%)",
};

function accuracyColor(pct: number) {
  if (pct >= 70) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-red-400";
}

export default function TraderProfilePage() {
  const params = useParams();
  const address = params.address as string;

  useEffect(() => {
    if (address) {
      trackEvent("trader_profile_viewed", { trader_address: address });
    }
  }, [address]);

  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<TraderProfile>(`/api/traders/${address}`, 60_000);

  if (loading) {
    return (
      <div>
        <div className="h-8 w-80 bg-gray-800 rounded animate-pulse mb-6" />
        <TableSkeleton rows={6} />
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-3">
          {data?.error || "Failed to load trader profile."}
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={retry}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
          >
            Retry
          </button>
          <Link
            href="/traders"
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
          >
            Back to leaderboard
          </Link>
        </div>
      </div>
    );
  }

  const skewEntries = Object.entries(data.accuracy_by_skew || {}).sort(
    (a, b) => (b[1].total || 0) - (a[1].total || 0)
  );
  const categoryEntries = Object.entries(data.accuracy_by_category || {})
    .filter(([cat]) => cat && cat !== "")
    .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
    .slice(0, 15);

  return (
    <div>
      <div className="mb-2">
        <Link
          href="/traders"
          className="text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to leaderboard
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-mono text-white mb-1 break-all">
            {data.trader_address}
          </h1>
          <p className="text-gray-400 text-sm">Trader predictive accuracy profile</p>
        </div>
        <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase mb-1">Accuracy</p>
          <p className={`text-2xl font-semibold ${accuracyColor(data.accuracy_pct)}`}>
            {data.accuracy_pct.toFixed(1)}%
          </p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase mb-1">Total Signals</p>
          <p className="text-2xl font-semibold text-white">
            {data.total_divergent_signals}
          </p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase mb-1">Correct</p>
          <p className="text-2xl font-semibold text-emerald-400">
            {data.correct_predictions}
          </p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase mb-1">Wrong</p>
          <p className="text-2xl font-semibold text-red-400">
            {data.wrong_predictions}
          </p>
        </div>
      </div>

      {/* Accuracy by Market Skew */}
      {skewEntries.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">
            Accuracy by Market Skew
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">Skew Band</th>
                  <th className="text-right p-3">Accuracy</th>
                  <th className="text-right p-3">Correct</th>
                  <th className="text-right p-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {skewEntries.map(([skew, stats]) => {
                  const pct =
                    stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  return (
                    <tr
                      key={skew}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="p-3 text-white text-sm">
                        {SKEW_LABELS[skew] || skew}
                      </td>
                      <td
                        className={`p-3 text-right text-sm font-semibold ${accuracyColor(pct)}`}
                      >
                        {pct.toFixed(1)}%
                      </td>
                      <td className="p-3 text-right text-sm text-emerald-400">
                        {stats.correct}
                      </td>
                      <td className="p-3 text-right text-sm text-gray-400">
                        {stats.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Accuracy by Category */}
      {categoryEntries.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">
            Accuracy by Category (top 15)
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">Category</th>
                  <th className="text-right p-3">Accuracy</th>
                  <th className="text-right p-3">Correct</th>
                  <th className="text-right p-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {categoryEntries.map(([category, stats]) => {
                  const pct =
                    stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  return (
                    <tr
                      key={category}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="p-3 text-white text-sm">{category}</td>
                      <td
                        className={`p-3 text-right text-sm font-semibold ${accuracyColor(pct)}`}
                      >
                        {pct.toFixed(1)}%
                      </td>
                      <td className="p-3 text-right text-sm text-emerald-400">
                        {stats.correct}
                      </td>
                      <td className="p-3 text-right text-sm text-gray-400">
                        {stats.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Disclaimer />
    </div>
  );
}
