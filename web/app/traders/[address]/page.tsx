"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { FollowButton } from "@/components/follow-button";
import { TableSkeleton } from "@/components/skeleton";
import { TradeButton } from "@/components/trade-button";
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

interface TraderPosition {
  signal_id: number;
  market_id: string;
  question: string;
  category: string;
  position_direction: "YES" | "NO" | string;
  position_size: number;
  avg_price: number;
  signal_timestamp: string;
  market_price_at_signal: number;
  sm_consensus: number;
  divergence_pct: number;
  sm_direction: string;
  neg_risk: number;
  resolved: boolean;
  correct: boolean | null;
  outcome: number | null;
}

interface TraderPositionsResponse {
  trader_address: string;
  positions: TraderPosition[];
  count: number;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

  const { data, loading, error, retry } = usePollingFetch<TraderProfile>(
    `/api/traders/${address}`,
    60_000,
  );

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

      <header className="mb-8 pb-5 border-b border-ink-800 flex items-end justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="eyebrow mb-2">trader profile</div>
          <h1 className="text-h2 md:text-h1 font-mono text-ink-100 break-all leading-tight tracking-tight num">
            {data.trader_address}
          </h1>
          <p className="text-body-sm text-ink-400 mt-2">
            Accuracy on counter-consensus positions, scored against resolved
            outcomes.
          </p>
        </div>
        <FollowButton traderAddress={data.trader_address} />
      </header>

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

      {/* Recent counter-consensus positions */}
      <RecentPositions address={data.trader_address} />

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

function RecentPositions({ address }: { address: string }) {
  const { data } = usePollingFetch<TraderPositionsResponse>(
    `/api/traders/${address}/positions?limit=20`,
    120_000,
  );

  if (!data || data.positions.length === 0) return null;

  return (
    <section className="mb-12">
      <div className="mb-5 pb-3 border-b border-ink-800">
        <div className="eyebrow mb-2">
          activity · counter-consensus positions
        </div>
        <h2 className="text-h3 text-ink-100 tracking-tight">
          recent divergent positions
          <span className="num text-ink-500 font-normal text-caption ml-2 tracking-normal">
            most recent {data.positions.length}
          </span>
        </h2>
        <p className="text-caption text-ink-500 mt-2">
          Each row is a market where this trader took a position counter to
          aggregate consensus. Click through to the market for full context.
        </p>
      </div>
      <div className="surface rounded-lg overflow-hidden divide-y divide-ink-800">
        {data.positions.map((p) => (
          <RecentPositionRow key={`${p.market_id}-${p.signal_id}`} p={p} />
        ))}
      </div>
    </section>
  );
}

function RecentPositionRow({ p }: { p: TraderPosition }) {
  const sideColor =
    p.position_direction === "YES" ? "text-scope-400" : "text-alert-500";
  const notional = p.position_size * p.avg_price;
  const traderPct = (p.avg_price * 100).toFixed(0);
  const marketPct = (p.market_price_at_signal * 100).toFixed(0);

  let outcomeBadge: ReactNode = (
    <span className="text-micro font-mono text-ink-500">pending</span>
  );
  if (p.resolved && p.correct === true) {
    outcomeBadge = (
      <span
        className="text-micro font-mono text-scope-400"
        title="trader's direction matched the resolved outcome"
      >
        ✓ correct
      </span>
    );
  } else if (p.resolved && p.correct === false) {
    outcomeBadge = (
      <span
        className="text-micro font-mono text-alert-500"
        title="trader's direction did not match the resolved outcome"
      >
        ✗ wrong
      </span>
    );
  }

  return (
    <div className="flex items-center gap-5 px-5 py-4 row-hover transition-colors">
      <Link href={`/market/${p.market_id}`} className="flex-1 min-w-0 group">
        <p className="text-body text-ink-100 truncate font-medium group-hover:text-scope-400">
          {p.question || p.market_id}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-caption font-mono">
          <span className={`num ${sideColor}`}>{p.position_direction}</span>
          <span className="text-ink-400 num">
            @ <span className="text-ink-100">{traderPct}%</span>
            <span className="text-ink-600"> · market </span>
            <span className="text-ink-300">{marketPct}%</span>
          </span>
          {p.category && <span className="text-ink-500">{p.category}</span>}
          <span className="text-ink-500">{timeAgo(p.signal_timestamp)}</span>
        </div>
      </Link>
      <div className="text-right whitespace-nowrap">
        <div className="num text-body text-ink-100 tracking-tight">
          ${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        <div className="mt-1">{outcomeBadge}</div>
      </div>
      <div className="shrink-0">
        <TradeButton
          marketId={p.market_id}
          question={p.question || p.market_id}
          direction={p.position_direction as "YES" | "NO"}
          marketPrice={p.market_price_at_signal}
        />
      </div>
    </div>
  );
}
