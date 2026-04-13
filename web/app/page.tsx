"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { ScoreBadge } from "@/components/score-badge";
import { SignalTrackRecord } from "@/components/signal-track-record";
import { DashboardSkeleton } from "@/components/skeleton";
import { StatCard } from "@/components/stat-card";
import { WhaleFlow } from "@/components/whale-flow";
import { usePollingFetch } from "@/lib/hooks";
import type { ScanResult, DivergenceSignal, MarketMover } from "@/lib/api";

interface EventCluster {
  title: string;
  market_count: number;
  total_volume: number;
  divergence_signals: number;
  avg_divergence: number;
  markets: { condition_id: string; question: string; price_yes: number }[];
}
interface EventsResponse {
  events: EventCluster[];
  total: number;
}

interface TraderLeaderboardEntry {
  trader_address: string;
  accuracy_pct: number;
  correct_predictions: number;
  total_divergent_signals: number;
}

interface TradersLeaderboardResponse {
  traders: TraderLeaderboardEntry[];
  count: number;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Dashboard() {
  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<ScanResult>("/api/scan/latest", 60_000);
  const { data: eventsData } = usePollingFetch<EventsResponse>(
    "/api/events?limit=5",
    120_000
  );
  const { data: predictiveData } = usePollingFetch<TradersLeaderboardResponse>(
    "/api/traders/leaderboard?order=predictive&min_signals=5&limit=5",
    120_000
  );
  const { data: fadeData } = usePollingFetch<TradersLeaderboardResponse>(
    "/api/traders/leaderboard?order=anti-predictive&min_signals=5&limit=5",
    120_000
  );

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-red-400">Failed to load dashboard data.</p>
        <button
          onClick={retry}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const divergences = data?.divergences || [];
  const movers = data?.movers_24h || [];
  const predictive = predictiveData?.traders || [];
  const fade = fadeData?.traders || [];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">
            Intelligence terminal for Polymarket dislocations
          </h1>
          <p className="text-gray-400 mt-1 max-w-2xl">
            We track where top Polymarket traders diverge from the crowd, score
            each trader individually against resolved outcomes, and surface the
            evidence behind every signal.
          </p>
        </div>
        <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
      </div>

      {/* Feature nav strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Link
          href="/smart-money"
          className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-emerald-500/40 transition-colors"
        >
          <p className="text-xs text-emerald-400 uppercase tracking-wide mb-1">
            Signals
          </p>
          <p className="text-white text-sm font-medium">
            Live divergence feed
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Decision cards with thesis, contributors, invalidators
          </p>
        </Link>
        <Link
          href="/traders"
          className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-emerald-500/40 transition-colors"
        >
          <p className="text-xs text-emerald-400 uppercase tracking-wide mb-1">
            Traders
          </p>
          <p className="text-white text-sm font-medium">
            Accuracy leaderboard
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Predictive vs anti-predictive — not P&amp;L-ranked
          </p>
        </Link>
        <Link
          href="/methodology"
          className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-emerald-500/40 transition-colors"
        >
          <p className="text-xs text-emerald-400 uppercase tracking-wide mb-1">
            Methodology
          </p>
          <p className="text-white text-sm font-medium">How signals work</p>
          <p className="text-gray-500 text-xs mt-1">
            Honest breakdown — the findings and the caveats
          </p>
        </Link>
        <Link
          href="/portfolio"
          className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-emerald-500/40 transition-colors"
        >
          <p className="text-xs text-emerald-400 uppercase tracking-wide mb-1">
            Portfolio
          </p>
          <p className="text-white text-sm font-medium">Your trades</p>
          <p className="text-gray-500 text-xs mt-1">
            Watch signals, log trades, auto-score on resolution
          </p>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard title="Active Markets" value={data?.total_markets || 0} />
        <StatCard
          title="Divergence Signals"
          value={data?.total_divergences || 0}
          subtitle="Markets where top traders disagree"
        />
        <StatCard
          title="Strongest Signal"
          value={
            divergences.length > 0
              ? `${(divergences[0].divergence_pct * 100).toFixed(0)}%`
              : "\u2014"
          }
        />
        <StatCard
          title="Top Mover (24h)"
          value={
            movers.length > 0
              ? `${movers[0].change_pct > 0 ? "+" : ""}${(movers[0].change_pct * 100).toFixed(0)}%`
              : "\u2014"
          }
        />
      </div>

      <SignalTrackRecord />

      {/* Divergence Signals */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">
            Active Divergences
          </h2>
          <Link
            href="/smart-money"
            className="text-sm text-emerald-400 hover:text-emerald-300"
          >
            View full decision cards →
          </Link>
        </div>

        {divergences.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-gray-400">
              No divergence signals right now. Markets and top traders are aligned.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {divergences.slice(0, 8).map((d: DivergenceSignal, i: number) => (
              <Link
                key={d.market_id + i}
                href={`/market/${d.market_id}`}
                className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">
                      {d.question}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="text-gray-400">
                        Crowd:{" "}
                        <span className="text-white">
                          {(d.market_price * 100).toFixed(0)}% YES
                        </span>
                      </span>
                      <span className="text-gray-400">
                        PolyScope:{" "}
                        <span
                          className={
                            d.sm_direction === "YES"
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          {d.sm_direction} ({(d.sm_consensus * 100).toFixed(0)}%)
                        </span>
                      </span>
                      <span className="text-gray-500">
                        {d.sm_trader_count} traders
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-lg font-bold text-amber-400">
                      {(d.divergence_pct * 100).toFixed(0)}%
                    </span>
                    <ScoreBadge score={d.score} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Trader leaderboards preview */}
      {(predictive.length > 0 || fade.length > 0) && (
        <section className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">
                Top Predictive Traders
              </h2>
              <Link
                href="/traders"
                className="text-xs text-emerald-400 hover:text-emerald-300"
              >
                Full leaderboard →
              </Link>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Ranked by individual accuracy when diverging from market price
            </p>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {predictive.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">
                  Building leaderboard — need more resolved signals per trader.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {predictive.map((t, i) => (
                      <tr
                        key={t.trader_address}
                        className="border-b border-gray-800/50 last:border-0"
                      >
                        <td className="p-3 text-gray-500 w-6">{i + 1}</td>
                        <td className="p-3">
                          <Link
                            href={`/traders/${t.trader_address}`}
                            className="text-white font-mono text-xs hover:text-emerald-400"
                          >
                            {shortAddr(t.trader_address)}
                          </Link>
                        </td>
                        <td className="p-3 text-right text-emerald-400 font-semibold">
                          {t.accuracy_pct.toFixed(0)}%
                        </td>
                        <td className="p-3 text-right text-xs text-gray-500 w-20">
                          {t.correct_predictions}/{t.total_divergent_signals}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">
                Traders to Fade
              </h2>
              <Link
                href="/traders"
                className="text-xs text-emerald-400 hover:text-emerald-300"
              >
                Full leaderboard →
              </Link>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Systematically wrong when they diverge from market price
            </p>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {fade.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">
                  Building leaderboard — need more resolved signals per trader.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {fade.map((t, i) => (
                      <tr
                        key={t.trader_address}
                        className="border-b border-gray-800/50 last:border-0"
                      >
                        <td className="p-3 text-gray-500 w-6">{i + 1}</td>
                        <td className="p-3">
                          <Link
                            href={`/traders/${t.trader_address}`}
                            className="text-white font-mono text-xs hover:text-red-400"
                          >
                            {shortAddr(t.trader_address)}
                          </Link>
                        </td>
                        <td className="p-3 text-right text-red-400 font-semibold">
                          {t.accuracy_pct.toFixed(0)}%
                        </td>
                        <td className="p-3 text-right text-xs text-gray-500 w-20">
                          {t.correct_predictions}/{t.total_divergent_signals}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Whale Flow */}
      <WhaleFlow />

      {/* Market Movers */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">
            Biggest Movers (24h)
          </h2>
          <Link
            href="/markets"
            className="text-sm text-emerald-400 hover:text-emerald-300"
          >
            All markets
          </Link>
        </div>

        {movers.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-gray-400">No significant movers right now.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {movers.map((m: MarketMover, i: number) => (
              <Link
                key={m.market_id + i}
                href={`/market/${m.market_id}`}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
              >
                <p className="text-white font-medium text-sm truncate">
                  {m.question}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-gray-400 text-sm">
                    {(m.price_before * 100).toFixed(0)}% →{" "}
                    {(m.price_now * 100).toFixed(0)}%
                  </span>
                  <span
                    className={`text-lg font-bold ${
                      m.change_pct > 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {m.change_pct > 0 ? "+" : ""}
                    {(m.change_pct * 100).toFixed(0)}%
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Event Clusters */}
      {eventsData && eventsData.events.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">
            Event Clusters
          </h2>
          <div className="space-y-3">
            {eventsData.events.map((e) => (
              <div
                key={e.title}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{e.title}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="text-gray-400">
                        {e.market_count} markets
                      </span>
                      <span className="text-gray-400">
                        Vol: ${e.total_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                      {e.divergence_signals > 0 && (
                        <span className="text-amber-400">
                          {e.divergence_signals} divergence{e.divergence_signals > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {e.avg_divergence > 0 && (
                    <span className="text-lg font-bold text-amber-400">
                      {(e.avg_divergence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Disclaimer />
    </div>
  );
}
