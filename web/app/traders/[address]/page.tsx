"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { FollowButton } from "@/components/follow-button";
import { LastUpdated } from "@/components/last-updated";
import { TableSkeleton } from "@/components/skeleton";
import { trackEvent } from "@/lib/analytics";
import { usePollingFetch } from "@/lib/hooks";

interface AccuracyCI {
  pct: number;
  lo: number;
  hi: number;
  total: number;
  correct: number;
  sufficient: boolean;
}

interface TraderProfile {
  trader_address: string;
  total_divergent_signals: number;
  correct_predictions: number;
  wrong_predictions: number;
  accuracy_pct: number;
  accuracy_by_skew: Record<string, { total: number; correct: number }>;
  accuracy_by_category: Record<string, { total: number; correct: number }>;
  last_updated: string;
  ci?: AccuracyCI;
  skew_ci?: Record<string, AccuracyCI>;
  error?: string;
}

const SKEW_LABELS: Record<string, string> = {
  very_lopsided: "very lopsided · ≥90 or ≤10",
  lopsided: "lopsided · 75–90 or 10–25",
  moderate: "moderate · 60–75 or 25–40",
  tight: "tight · 40–60",
};

function accuracyColor(pct: number) {
  if (pct >= 70) return "text-scope-400";
  if (pct >= 50) return "text-fade-500";
  return "text-alert-500";
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
        <div className="mb-10 pb-10 border-b border-ink-800">
          <div className="h-3 w-32 bg-ink-800 rounded-sm mb-5 animate-pulse-subtle" />
          <div className="h-8 w-full max-w-2xl bg-ink-800 rounded-sm animate-pulse-subtle" />
        </div>
        <TableSkeleton rows={6} />
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="text-center py-16">
        <p className="text-alert-500 font-mono text-body-sm mb-4">
          {data?.error || "failed to load trader profile"}
        </p>
        <div className="flex justify-center gap-3">
          <button onClick={retry} className="btn-secondary">
            retry
          </button>
          <Link href="/traders" className="btn-secondary">
            back to leaderboard
          </Link>
        </div>
      </div>
    );
  }

  const skewEntries = Object.entries(data.accuracy_by_skew || {}).sort(
    (a, b) => (b[1].total || 0) - (a[1].total || 0),
  );
  const categoryEntries = Object.entries(data.accuracy_by_category || {})
    .filter(([cat]) => cat && cat !== "")
    .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
    .slice(0, 15);

  return (
    <div>
      <div className="mb-3">
        <Link
          href="/traders"
          className="text-caption text-ink-500 hover:text-ink-300 font-mono transition-colors"
        >
          ← back to leaderboard
        </Link>
      </div>

      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="flex items-start justify-between gap-6 mb-3">
          <div className="min-w-0">
            <div className="eyebrow mb-3">profile · trader</div>
            <h1 className="text-h2 font-mono text-ink-100 break-all leading-tight tracking-tight num">
              {data.trader_address}
            </h1>
            <p className="text-caption text-ink-400 mt-2 font-mono">
              predictive accuracy on counter-consensus positions
            </p>
            <div className="mt-4">
              <FollowButton traderAddress={data.trader_address} />
            </div>
          </div>
          <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
        </div>
      </section>

      {data.ci && !data.ci.sufficient && (
        <div className="mb-8 border border-fade-500/30 bg-fade-500/5 rounded-md px-4 py-3">
          <p className="text-body-sm text-fade-400 font-mono leading-relaxed">
            <span className="text-fade-500 font-medium">small sample.</span>{" "}
            this trader has only{" "}
            <span className="num text-fade-300">
              {data.total_divergent_signals}
            </span>{" "}
            resolved predictions. accuracy is noisy below n=30 — the 95% CI is
            wide and any ranking is provisional.
          </p>
        </div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
        <div className="surface rounded-md p-4">
          <div className="eyebrow mb-2">accuracy</div>
          <p
            className={`num text-h2 tracking-tight ${accuracyColor(data.accuracy_pct)}`}
          >
            {data.accuracy_pct.toFixed(1)}%
          </p>
          {data.ci && (
            <p className="text-micro text-ink-500 num font-mono mt-1.5">
              ci [{data.ci.lo.toFixed(0)}–{data.ci.hi.toFixed(0)}]
            </p>
          )}
        </div>
        <div className="surface rounded-md p-4">
          <div className="eyebrow mb-2">total signals</div>
          <p className="num text-h2 text-ink-100 tracking-tight">
            {data.total_divergent_signals}
          </p>
        </div>
        <div className="surface rounded-md p-4">
          <div className="eyebrow mb-2">correct</div>
          <p className="num text-h2 text-scope-400 tracking-tight">
            {data.correct_predictions}
          </p>
        </div>
        <div className="surface rounded-md p-4">
          <div className="eyebrow mb-2">wrong</div>
          <p className="num text-h2 text-alert-500 tracking-tight">
            {data.wrong_predictions}
          </p>
        </div>
      </div>

      {/* Accuracy by skew */}
      {skewEntries.length > 0 && (
        <section className="mb-12">
          <div className="mb-5 pb-3 border-b border-ink-800">
            <div className="eyebrow mb-2">breakdown · skew</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">
              accuracy by market skew
            </h2>
          </div>
          <div className="surface rounded-lg overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">skew band</th>
                  <th className="eyebrow text-right px-3 py-3">
                    accuracy · 95% ci
                  </th>
                  <th className="eyebrow text-right px-3 py-3">correct</th>
                  <th className="eyebrow text-right px-3 py-3">total</th>
                </tr>
              </thead>
              <tbody>
                {skewEntries.map(([skew, stats]) => {
                  const pct =
                    stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  const ci = data.skew_ci?.[skew];
                  return (
                    <tr
                      key={skew}
                      className="border-b border-ink-800/60 last:border-0 row-hover"
                    >
                      <td className="px-3 py-3 text-ink-100 font-mono">
                        {SKEW_LABELS[skew] || skew}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div
                          className={`num font-medium ${accuracyColor(pct)}`}
                        >
                          {pct.toFixed(1)}%
                        </div>
                        {ci && (
                          <div className="text-micro text-ink-500 num mt-0.5">
                            [{ci.lo.toFixed(0)}–{ci.hi.toFixed(0)}]
                            {!ci.sufficient && (
                              <span
                                className="ml-1 text-fade-500/70"
                                title="sample below n=30"
                              >
                                ·
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-caption font-mono num text-scope-400">
                        {stats.correct}
                      </td>
                      <td className="px-3 py-3 text-right text-caption font-mono num text-ink-400">
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

      {/* Accuracy by category */}
      {categoryEntries.length > 0 && (
        <section className="mb-12">
          <div className="mb-5 pb-3 border-b border-ink-800">
            <div className="eyebrow mb-2">breakdown · category</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">
              accuracy by category
              <span className="num text-ink-500 font-normal text-caption ml-2 tracking-normal">
                top 15
              </span>
            </h2>
          </div>
          <div className="surface rounded-lg overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">category</th>
                  <th className="eyebrow text-right px-3 py-3">accuracy</th>
                  <th className="eyebrow text-right px-3 py-3">correct</th>
                  <th className="eyebrow text-right px-3 py-3">total</th>
                </tr>
              </thead>
              <tbody>
                {categoryEntries.map(([category, stats]) => {
                  const pct =
                    stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  return (
                    <tr
                      key={category}
                      className="border-b border-ink-800/60 last:border-0 row-hover"
                    >
                      <td className="px-3 py-3 text-ink-100">{category}</td>
                      <td
                        className={`px-3 py-3 text-right font-mono num font-medium ${accuracyColor(pct)}`}
                      >
                        {pct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-3 text-right text-caption font-mono num text-scope-400">
                        {stats.correct}
                      </td>
                      <td className="px-3 py-3 text-right text-caption font-mono num text-ink-400">
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
