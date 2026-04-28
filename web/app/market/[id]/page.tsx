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
import { PageHeader } from "@/components/page-header";
import { ScoreBadge } from "@/components/score-badge";
import { SignalEvidence } from "@/components/signal-evidence";
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

  const { data, loading, error, retry } =
    usePollingFetch<MarketDetail>(`/api/market/${id}`, 120_000);

  if (loading) {
    return (
      <div>
        <div className="mb-10 pb-10 border-b border-ink-800">
          <div className="h-3 w-24 bg-ink-800 rounded-sm mb-3 animate-pulse-subtle" />
          <div className="h-9 w-3/4 bg-ink-800 rounded-sm animate-pulse-subtle" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-10">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="surface rounded-lg h-[300px] animate-pulse-subtle" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-16">
        <p className="text-alert-500 font-mono text-body-sm mb-4">
          failed to load market data
        </p>
        <button onClick={retry} className="btn-secondary">
          retry
        </button>
      </div>
    );
  }

  if (!data?.market) {
    return (
      <div className="text-center py-16">
        <p className="text-ink-400 font-mono text-body-sm">market not found</p>
      </div>
    );
  }

  const { market, divergence, price_history, signal_history } = data;

  const chartData = (price_history || []).map((p: { t: number; p: number }) => ({
    time: new Date(p.t * 1000).toLocaleDateString(),
    price: parseFloat((p.p * 100).toFixed(1)),
  }));

  return (
    <div>
      <PageHeader
        title={market.question}
        sub={market.category ? `category · ${market.category}` : undefined}
      />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
        <StatCard
          title="current price"
          value={`${(market.price_yes * 100).toFixed(0)}%`}
          subtitle="yes"
        />
        <StatCard
          title="volume · 24h"
          value={`$${market.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <StatCard
          title="open interest"
          value={`$${market.open_interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <StatCard
          title="liquidity"
          value={`$${market.liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
      </div>

      {/* Divergence Alert */}
      {divergence && (
        <div className="mb-10">
          <div className="border border-fade-500/30 bg-fade-500/5 rounded-lg p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="eyebrow text-fade-500 mb-3">
                  counter-consensus signal
                </div>
                <p className="text-body-lg text-ink-100 leading-relaxed">
                  PolyScope view ·{" "}
                  <span className="num text-ink-300">
                    {divergence.sm_trader_count}
                  </span>{" "}
                  top traders positioned{" "}
                  <span
                    className={`num font-medium ${
                      divergence.sm_direction === "YES"
                        ? "text-scope-400"
                        : "text-alert-500"
                    }`}
                  >
                    {divergence.sm_direction}
                  </span>{" "}
                  at{" "}
                  <span className="num text-ink-100">
                    {(divergence.sm_consensus * 100).toFixed(0)}%
                  </span>
                  , while market prices{" "}
                  <span className="num text-ink-100">
                    {(divergence.market_price * 100).toFixed(0)}%
                  </span>
                  .
                </p>
                <p className="text-caption text-ink-400 mt-2 font-mono">
                  divergence ·{" "}
                  <span className="num text-fade-500">
                    {(divergence.divergence_pct * 100).toFixed(0)}%
                  </span>
                </p>
              </div>
              <div className="shrink-0 pt-1">
                <ScoreBadge score={divergence.score} label="score" />
              </div>
            </div>
          </div>
          <div className="mt-3">
            <SignalEvidence marketId={id} />
          </div>
        </div>
      )}

      {/* Price History */}
      <section className="mb-12">
        <div className="mb-5 pb-3 border-b border-ink-800">
          <div className="eyebrow mb-2">price · history</div>
          <h2 className="text-h3 text-ink-100 tracking-tight">price history</h2>
        </div>
        <div className="surface rounded-lg p-6">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="scopeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00E5A0" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#00E5A0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="#1E232D"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  stroke="#4D5566"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  fontFamily="var(--font-geist-mono)"
                />
                <YAxis
                  stroke="#4D5566"
                  fontSize={11}
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  fontFamily="var(--font-geist-mono)"
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0F1218",
                    border: "1px solid #2A303D",
                    borderRadius: "6px",
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "12px",
                    color: "#ECEEF2",
                  }}
                  itemStyle={{ color: "#00E5A0" }}
                  labelStyle={{ color: "#7A8496" }}
                  formatter={(value) => [`${value}%`, "yes"]}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#00E5A0"
                  fill="url(#scopeGrad)"
                  strokeWidth={1.75}
                  name="yes"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-body-sm text-ink-400 font-mono text-center py-12">
              price history not available yet.
            </p>
          )}
        </div>
      </section>

      {/* Signal History */}
      {signal_history && signal_history.length > 0 && (
        <section className="mb-12">
          <div className="mb-5 pb-3 border-b border-ink-800">
            <div className="eyebrow mb-2">log · per-scan</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">signal history</h2>
          </div>
          <div className="surface rounded-lg overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">date</th>
                  <th className="eyebrow text-center px-3 py-3">sm dir</th>
                  <th className="eyebrow text-center px-3 py-3">market</th>
                  <th className="eyebrow text-center px-3 py-3">sm consensus</th>
                  <th className="eyebrow text-center px-3 py-3">divergence</th>
                  <th className="eyebrow text-center px-3 py-3">score</th>
                  <th className="eyebrow text-center px-3 py-3">result</th>
                </tr>
              </thead>
              <tbody>
                {signal_history.map((s, i) => (
                  <tr
                    key={s.timestamp + i}
                    className="border-b border-ink-800/60 last:border-0 row-hover"
                  >
                    <td className="px-3 py-3 text-caption text-ink-400 font-mono num whitespace-nowrap">
                      {new Date(s.timestamp).toLocaleDateString()}
                    </td>
                    <td
                      className={`px-3 py-3 text-center font-mono num ${
                        s.sm_direction === "YES"
                          ? "text-scope-400"
                          : "text-alert-500"
                      }`}
                    >
                      {s.sm_direction}
                    </td>
                    <td className="px-3 py-3 text-center text-caption text-ink-300 font-mono num">
                      {(s.market_price * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-3 text-center text-caption text-ink-300 font-mono num">
                      {(s.sm_consensus * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-3 text-center text-fade-500 font-mono num">
                      {(s.divergence_pct * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-3 text-center text-ink-100 font-mono num">
                      {s.signal_strength.toFixed(0)}
                    </td>
                    <td className="px-3 py-3 text-center font-mono">
                      {s.resolved ? (
                        s.outcome_correct === 1 ? (
                          <span className="text-scope-500">✓</span>
                        ) : (
                          <span className="text-alert-500">✗</span>
                        )
                      ) : (
                        <span className="text-ink-600">—</span>
                      )}
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
