"use client";

import { useParams } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { ScoreBadge } from "@/components/score-badge";
import { SkeletonCard } from "@/components/skeleton";
import { StatCard } from "@/components/stat-card";
import { usePollingFetch } from "@/lib/hooks";

interface SignalHistoryEntry {
  timestamp: string;
  market_price: number;
  sm_consensus: number;
  divergence_pct: number;
  signal_strength: number;
  sm_trader_count: number;
  sm_direction: string;
  resolved: number;
  outcome_correct: number | null;
}

interface MarketDetail {
  market: {
    condition_id: string;
    question: string;
    slug: string;
    category: string;
    price_yes: number;
    price_no: number;
    volume_24h: number;
    open_interest: number;
    liquidity: number;
  };
  divergence: {
    market_price: number;
    sm_consensus: number;
    divergence_pct: number;
    score: number;
    sm_trader_count: number;
    sm_direction: string;
  } | null;
  price_history: { t: number; p: number }[];
  signal_history?: SignalHistoryEntry[];
}

export default function MarketPage() {
  const params = useParams();
  const id = params.id as string;

  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<MarketDetail>(`/api/market/${id}`, 120_000);

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <div className="h-3 w-16 bg-gray-800 rounded animate-pulse mb-2" />
          <div className="h-7 w-3/4 bg-gray-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl h-[300px] animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-3">Failed to load market data.</p>
        <button
          onClick={retry}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data?.market) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Market not found.</p>
      </div>
    );
  }

  const { market, divergence, price_history, signal_history } = data;

  const chartData = (price_history || []).map(
    (p: { t: number; p: number }) => ({
      time: new Date(p.t * 1000).toLocaleDateString(),
      price: (p.p * 100).toFixed(1),
    })
  );

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          {market.category && (
            <span className="text-xs text-gray-500 uppercase tracking-wide">
              {market.category}
            </span>
          )}
          <h1 className="text-2xl font-bold text-white mt-1">
            {market.question}
          </h1>
        </div>
        <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Current Price"
          value={`${(market.price_yes * 100).toFixed(0)}% YES`}
        />
        <StatCard
          title="Volume (24h)"
          value={`$${market.volume_24h.toLocaleString()}`}
        />
        <StatCard
          title="Open Interest"
          value={`$${market.open_interest.toLocaleString()}`}
        />
        <StatCard
          title="Liquidity"
          value={`$${market.liquidity.toLocaleString()}`}
        />
      </div>

      {/* Divergence Alert */}
      {divergence && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-amber-400 font-semibold text-sm uppercase tracking-wide">
                Counter-Consensus Signal
              </h3>
              <p className="text-white mt-2">
                Smart money ({divergence.sm_trader_count} top traders) is
                positioned{" "}
                <span
                  className={
                    divergence.sm_direction === "YES"
                      ? "text-emerald-400 font-bold"
                      : "text-red-400 font-bold"
                  }
                >
                  {divergence.sm_direction}
                </span>{" "}
                at {(divergence.sm_consensus * 100).toFixed(0)}%, while the
                market says {(divergence.market_price * 100).toFixed(0)}%.
              </p>
              <p className="text-gray-400 text-sm mt-1">
                Divergence: {(divergence.divergence_pct * 100).toFixed(0)}%
              </p>
            </div>
            <ScoreBadge score={divergence.score} label="Score" />
          </div>
        </div>
      )}

      {/* Price Chart */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-4">Price History</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid #1f2937",
                    borderRadius: "8px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.1}
                  strokeWidth={2}
                  name="YES %"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-center py-12">
              Price history not available yet.
            </p>
          )}
        </div>
      </section>

      {/* Signal History */}
      {signal_history && signal_history.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">
            Signal History
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">Date</th>
                  <th className="text-center p-3">SM Direction</th>
                  <th className="text-center p-3">Market</th>
                  <th className="text-center p-3">SM Consensus</th>
                  <th className="text-center p-3">Divergence</th>
                  <th className="text-center p-3">Score</th>
                  <th className="text-center p-3">Result</th>
                </tr>
              </thead>
              <tbody>
                {signal_history.map((s, i) => (
                  <tr
                    key={s.timestamp + i}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="p-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(s.timestamp).toLocaleDateString()}
                    </td>
                    <td
                      className={`p-3 text-center text-sm font-medium ${
                        s.sm_direction === "YES"
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {s.sm_direction}
                    </td>
                    <td className="p-3 text-center text-sm text-gray-400">
                      {(s.market_price * 100).toFixed(0)}%
                    </td>
                    <td className="p-3 text-center text-sm text-gray-400">
                      {(s.sm_consensus * 100).toFixed(0)}%
                    </td>
                    <td className="p-3 text-center text-sm text-amber-400">
                      {(s.divergence_pct * 100).toFixed(0)}%
                    </td>
                    <td className="p-3 text-center text-sm text-white">
                      {s.signal_strength.toFixed(0)}
                    </td>
                    <td className="p-3 text-center text-lg">
                      {s.resolved
                        ? s.outcome_correct === 1
                          ? "\u2705"
                          : "\u274c"
                        : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Disclaimer />
    </div>
  );
}
