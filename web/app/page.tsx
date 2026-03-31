"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { ScoreBadge } from "@/components/score-badge";
import { SignalTrackRecord } from "@/components/signal-track-record";
import { DashboardSkeleton } from "@/components/skeleton";
import { StatCard } from "@/components/stat-card";
import { usePollingFetch } from "@/lib/hooks";
import type { ScanResult, DivergenceSignal, MarketMover } from "@/lib/api";

export default function Dashboard() {
  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<ScanResult>("/api/scan/latest", 60_000);

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

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">
            Counter-Consensus Intelligence
          </h1>
          <p className="text-gray-400 mt-1">
            See what smart money sees, before the crowd catches up.
          </p>
        </div>
        <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Active Markets"
          value={data?.total_markets || 0}
        />
        <StatCard
          title="Divergence Signals"
          value={data?.total_divergences || 0}
          subtitle="Markets where SM disagrees"
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
            Counter-Consensus Signals
          </h2>
          <Link
            href="/smart-money"
            className="text-sm text-emerald-400 hover:text-emerald-300"
          >
            View all
          </Link>
        </div>

        {divergences.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-gray-400">
              No divergence signals right now. Markets and smart money are aligned.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {divergences.map((d: DivergenceSignal, i: number) => (
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
                        Market:{" "}
                        <span className="text-white">
                          {(d.market_price * 100).toFixed(0)}% YES
                        </span>
                      </span>
                      <span className="text-gray-400">
                        Smart Money:{" "}
                        <span
                          className={
                            d.sm_direction === "YES"
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          {(d.sm_consensus * 100).toFixed(0)}% (
                          {d.sm_direction})
                        </span>
                      </span>
                      <span className="text-gray-500">
                        {d.sm_trader_count} traders
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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

      <Disclaimer />
    </div>
  );
}
