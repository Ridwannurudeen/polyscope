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
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function accuracyColor(pct: number) {
  if (pct >= 70) return "text-scope-400";
  if (pct >= 50) return "text-fade-500";
  return "text-alert-500";
}

export default function TradersPage() {
  const [minSignals, setMinSignals] = useState(5);

  const {
    data: predictive,
    loading,
    error,
    lastUpdated,
    retry,
  } = usePollingFetch<LeaderboardResponse>(
    `/api/traders/leaderboard?order=predictive&min_signals=${minSignals}&limit=50`,
    60_000,
  );

  const { data: antiPredictive } = usePollingFetch<LeaderboardResponse>(
    `/api/traders/leaderboard?order=anti-predictive&min_signals=${minSignals}&limit=50`,
    60_000,
  );

  const predictiveTraders = predictive?.traders || [];
  const antiTraders = antiPredictive?.traders || [];

  if (loading) {
    return (
      <div>
        <div className="mb-10 pb-10 border-b border-ink-800">
          <div className="h-3 w-24 bg-ink-800 rounded-sm mb-5 animate-pulse-subtle" />
          <div className="h-10 w-80 bg-ink-800 rounded-sm mb-3 animate-pulse-subtle" />
          <div className="h-4 w-96 bg-ink-800/70 rounded-sm animate-pulse-subtle" />
        </div>
        <TableSkeleton rows={10} />
      </div>
    );
  }

  if (error && !predictive) {
    return (
      <div className="text-center py-16">
        <p className="text-alert-500 font-mono text-body-sm mb-4">
          failed to load trader accuracy data
        </p>
        <button onClick={retry} className="btn-secondary">
          retry
        </button>
      </div>
    );
  }

  const noData = predictiveTraders.length === 0 && antiTraders.length === 0;

  return (
    <div>
      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="flex items-start justify-between gap-8 mb-4">
          <div className="max-w-3xl">
            <div className="eyebrow mb-3 text-scope-500">
              core · rank by accuracy
            </div>
            <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight">
              the true smart-money leaderboard
            </h1>
            <p className="text-body-lg text-ink-300 mt-3 max-w-2xl leading-relaxed">
              Polymarket ranks traders by P&amp;L — profitable, but not
              necessarily{" "}
              <em className="not-italic text-ink-100">predictive</em>.
              PolyScope ranks them by how often their positions match the
              actual market outcome when they diverge from the crowd. Two
              views: the genuinely predictive, and the ones worth fading.
            </p>
          </div>
          <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
        </div>

        <div className="flex items-center gap-3 mt-5">
          <span className="eyebrow">min signals</span>
          <select
            value={minSignals}
            onChange={(e) => setMinSignals(Number(e.target.value))}
            className="bg-background border border-ink-700 text-ink-100 text-body-sm font-mono rounded-md px-2 py-1 focus:outline-none focus:border-scope-500/50 cursor-pointer"
          >
            <option value={1}>1+</option>
            <option value={5}>5+</option>
            <option value={10}>10+</option>
            <option value={25}>25+</option>
            <option value={50}>50+</option>
          </select>
        </div>
      </section>

      {noData ? (
        <div className="surface rounded-lg p-10 text-center">
          <div className="eyebrow mb-3">building dataset</div>
          <p className="text-body text-ink-300 mb-2">
            per-trader accuracy data is accruing
          </p>
          <p className="text-caption text-ink-400 font-mono">
            meaningful samples require ~7–14 days of signal resolution · come
            back soon
          </p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <TraderTable
            title="predictive · follow"
            sub="positions match actual outcomes — real smart money"
            rows={predictiveTraders}
            side="predictive"
          />
          <TraderTable
            title="anti-predictive · fade"
            sub="consistently wrong when they diverge from market"
            rows={antiTraders}
            side="fade"
          />
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

function TraderTable({
  title,
  sub,
  rows,
  side,
}: {
  title: string;
  sub: string;
  rows: TraderAccuracy[];
  side: "predictive" | "fade";
}) {
  const hoverAccent =
    side === "predictive" ? "hover:text-scope-400" : "hover:text-alert-500";

  return (
    <section>
      <div className="mb-3">
        <div className="eyebrow mb-1.5">{title}</div>
        <p className="text-caption text-ink-400">{sub}</p>
      </div>
      <div className="surface rounded-lg overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-ink-800">
              <th className="eyebrow text-left px-3 py-3">#</th>
              <th className="eyebrow text-left px-3 py-3">trader</th>
              <th className="eyebrow text-right px-3 py-3">
                accuracy · 95% ci
              </th>
              <th className="eyebrow text-right px-3 py-3">signals</th>
              {side === "predictive" && (
                <th className="eyebrow text-right px-3 py-3"></th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr
                key={t.trader_address}
                className="border-b border-ink-800/60 last:border-0 row-hover"
              >
                <td className="px-3 py-3 text-ink-500 font-mono num">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/traders/${t.trader_address}`}
                    className={`text-ink-100 font-mono num text-body-sm transition-colors ${hoverAccent}`}
                  >
                    {formatAddress(t.trader_address)}
                  </Link>
                </td>
                <td className="px-3 py-3 text-right">
                  <div
                    className={`num font-medium ${accuracyColor(t.accuracy_pct)}`}
                  >
                    {t.accuracy_pct.toFixed(1)}%
                  </div>
                  {t.ci && (
                    <div className="text-micro text-ink-500 num mt-0.5">
                      [{t.ci.lo.toFixed(0)}–{t.ci.hi.toFixed(0)}]
                      {!t.ci.sufficient && (
                        <span
                          className="ml-1 text-fade-500/70"
                          title="sample below n=30 — provisional"
                        >
                          ·
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-right text-caption text-ink-400 font-mono num">
                  {t.correct_predictions}/{t.total_divergent_signals}
                </td>
                {side === "predictive" && (
                  <td className="px-3 py-3 text-right">
                    <FollowButton
                      traderAddress={t.trader_address}
                      size="sm"
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
