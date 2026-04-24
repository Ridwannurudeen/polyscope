"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { ScoreBadge } from "@/components/score-badge";
import { SignalTrackRecord } from "@/components/signal-track-record";
import { DashboardSkeleton } from "@/components/skeleton";
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
  ci?: {
    pct: number;
    lo: number;
    hi: number;
    total: number;
    correct: number;
    sufficient: boolean;
  };
}

interface TradersLeaderboardResponse {
  traders: TraderLeaderboardEntry[];
  count: number;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatNum(n: number | string | null | undefined, digits = 0) {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/* ── Stat cell — eyebrow + mono value. Used in hero strip. ── */
function StatCell({
  label,
  value,
  sub,
  align = "left",
}: {
  label: string;
  value: string | number;
  sub?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="num text-h3 text-ink-100 leading-none">{value}</div>
      {sub && <div className="text-micro text-ink-400 mt-1.5 font-mono">{sub}</div>}
    </div>
  );
}

/* ── Section header — consistent spacing + right-side link ── */
function SectionHead({
  eyebrow,
  title,
  sub,
  href,
  cta,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="flex items-end justify-between mb-5 pb-3 border-b border-ink-800">
      <div>
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h2 className="text-h3 text-ink-100 tracking-tight">{title}</h2>
        {sub && <p className="text-caption text-ink-400 mt-1 max-w-2xl">{sub}</p>}
      </div>
      {href && cta && (
        <Link
          href={href}
          className="text-body-sm text-scope-500 hover:text-scope-400 font-mono transition-colors"
        >
          {cta} →
        </Link>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<ScanResult>("/api/scan/latest", 60_000);
  const { data: eventsData } = usePollingFetch<EventsResponse>(
    "/api/events?limit=5",
    120_000,
  );
  const { data: predictiveData } = usePollingFetch<TradersLeaderboardResponse>(
    "/api/traders/leaderboard?order=predictive&min_signals=30&limit=6",
    120_000,
  );
  const { data: predictiveFallback } = usePollingFetch<TradersLeaderboardResponse>(
    "/api/traders/leaderboard?order=predictive&min_signals=5&limit=6",
    120_000,
  );
  const { data: fadeData } = usePollingFetch<TradersLeaderboardResponse>(
    "/api/traders/leaderboard?order=anti-predictive&min_signals=30&limit=6",
    120_000,
  );
  const { data: fadeFallback } = usePollingFetch<TradersLeaderboardResponse>(
    "/api/traders/leaderboard?order=anti-predictive&min_signals=5&limit=6",
    120_000,
  );

  if (loading) return <DashboardSkeleton />;

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-alert-500 font-mono text-body-sm">
          failed to load dashboard data
        </p>
        <button onClick={retry} className="btn-secondary">
          retry
        </button>
      </div>
    );
  }

  const divergences = data?.divergences || [];
  const movers = data?.movers_24h || [];
  const predictiveStrict = predictiveData?.traders || [];
  const fadeStrict = fadeData?.traders || [];
  const predictive =
    predictiveStrict.length > 0
      ? predictiveStrict
      : predictiveFallback?.traders || [];
  const fade =
    fadeStrict.length > 0 ? fadeStrict : fadeFallback?.traders || [];
  const strictLeaderboardReady = predictiveStrict.length > 0;

  const topDivergence =
    divergences.length > 0
      ? `${(divergences[0].divergence_pct * 100).toFixed(0)}%`
      : "—";
  const topMover =
    movers.length > 0
      ? `${movers[0].change_pct > 0 ? "+" : ""}${(movers[0].change_pct * 100).toFixed(0)}%`
      : "—";

  return (
    <div>
      {/* ── HERO — terminal style: info first, no marketing ── */}
      <section className="pt-2 pb-10 border-b border-ink-800 mb-10">
        <div className="flex items-start justify-between gap-8 mb-8">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-scope-500 animate-pulse-subtle" />
              <span className="eyebrow text-scope-500">live · polymarket v2</span>
            </div>
            <h1 className="text-h1 md:text-display text-ink-100 tracking-tightest leading-[1.02]">
              counter-consensus
              <br />
              <span className="text-ink-300">intelligence for polymarket.</span>
            </h1>
            <p className="text-body-lg text-ink-300 mt-5 max-w-2xl leading-relaxed">
              Polymarket ranks by P&amp;L. We rank by <em className="not-italic text-ink-100">accuracy</em>.
              Each top trader is evaluated on their own divergent positions against
              resolved outcomes, with Wilson 95% confidence intervals. Find the
              handful who are actually predictive — see the evidence, follow the moves.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/traders" className="btn-primary">
                view predictive leaderboard →
              </Link>
              <Link href="/methodology" className="btn-ghost">
                read methodology
              </Link>
            </div>
          </div>
          <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
        </div>

        {/* Stats strip — mono values, tabular, terminal-first */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-10 gap-y-6 pt-8 border-t border-ink-800">
          <StatCell
            label="active markets"
            value={formatNum(data?.total_markets)}
            sub="tracked from polymarket gamma"
          />
          <StatCell
            label="divergence signals"
            value={formatNum(data?.total_divergences)}
            sub="top-trader vs market disagreement"
          />
          <StatCell
            label="strongest divergence"
            value={topDivergence}
            sub={divergences.length > 0 ? "live · active signal" : "no active signal"}
          />
          <StatCell
            label="top mover · 24h"
            value={topMover}
            sub={movers.length > 0 ? movers[0].question.slice(0, 28) + "…" : "—"}
          />
        </div>
      </section>

      {/* ── TRACK RECORD — validated headline claim ── */}
      <section className="mb-12">
        <SectionHead
          eyebrow="validated · backtest"
          title="signal quality vs resolved outcomes"
          sub="Headline numbers rebuild on every hour from the resolved-market ledger. See methodology for the skew-band breakdown that decomposes the composition effect."
          href="/methodology"
          cta="methodology"
        />
        <SignalTrackRecord />
      </section>

      {/* ── PREDICTIVE LEADERBOARD ── */}
      {(predictive.length > 0 || fade.length > 0) && (
        <section className="mb-12">
          <SectionHead
            eyebrow="core · rank by accuracy"
            title="predictive leaderboard"
            sub={
              strictLeaderboardReady
                ? "Traders with n ≥ 30 resolved predictions. Accuracy computed on counter-consensus positions only — not total P&L."
                : "Early preview — small samples, accuracy is provisional until n ≥ 30."
            }
            href="/traders"
            cta="full leaderboard"
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TraderBoard
              side="predictive"
              title="predictive · follow"
              rows={predictive}
            />
            <TraderBoard side="fade" title="anti-predictive · fade" rows={fade} />
          </div>
        </section>
      )}

      {/* ── ACTIVE SIGNALS ── */}
      <section className="mb-12">
        <SectionHead
          eyebrow="realtime · divergence feed"
          title="active signals"
          sub="Top traders (aggregated, size + rank + category-weighted) currently disagree with market price. Each row links to the full decision card with evidence."
          href="/smart-money"
          cta="all decision cards"
        />
        {divergences.length === 0 ? (
          <div className="surface rounded-lg p-10 text-center">
            <p className="text-body-sm text-ink-400 font-mono">
              no active signals · markets and top traders aligned
            </p>
          </div>
        ) : (
          <div className="surface rounded-lg overflow-hidden divide-y divide-ink-800">
            {divergences.slice(0, 8).map((d: DivergenceSignal, i: number) => (
              <Link
                key={d.market_id + i}
                href={`/market/${d.market_id}`}
                className="flex items-center justify-between px-5 py-4 row-hover"
              >
                <div className="flex-1 min-w-0 pr-6">
                  <p className="text-body text-ink-100 font-medium truncate">
                    {d.question}
                  </p>
                  <div className="flex items-center gap-5 mt-1.5 text-caption font-mono">
                    <span className="text-ink-400">
                      crowd{" "}
                      <span className="text-ink-100 num">
                        {(d.market_price * 100).toFixed(0)}%
                      </span>
                    </span>
                    <span className="text-ink-400">
                      polyscope{" "}
                      <span
                        className={`num ${
                          d.sm_direction === "YES"
                            ? "text-scope-400"
                            : "text-fade-500"
                        }`}
                      >
                        {d.sm_direction} {(d.sm_consensus * 100).toFixed(0)}%
                      </span>
                    </span>
                    <span className="text-ink-500">
                      {d.sm_trader_count} traders
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="num text-h4 text-fade-500 tracking-tight">
                    {(d.divergence_pct * 100).toFixed(0)}%
                  </span>
                  <ScoreBadge score={d.score} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── WHALE FLOW ── */}
      <section className="mb-12">
        <WhaleFlow />
      </section>

      {/* ── MOVERS ── */}
      <section className="mb-12">
        <SectionHead
          eyebrow="delta · 24h window"
          title="biggest movers"
          sub="Price change over the last 24 hours across tracked markets."
          href="/markets"
          cta="all markets"
        />
        {movers.length === 0 ? (
          <div className="surface rounded-lg p-10 text-center">
            <p className="text-body-sm text-ink-400 font-mono">
              no significant movers
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {movers.map((m: MarketMover, i: number) => (
              <Link
                key={m.market_id + i}
                href={`/market/${m.market_id}`}
                className="surface rounded-lg p-4 hover:border-ink-600 transition-colors duration-120"
              >
                <p className="text-body-sm text-ink-100 truncate font-medium">
                  {m.question}
                </p>
                <div className="flex items-center justify-between mt-3 text-caption font-mono">
                  <span className="text-ink-400 num">
                    {(m.price_before * 100).toFixed(0)}% →{" "}
                    <span className="text-ink-100">
                      {(m.price_now * 100).toFixed(0)}%
                    </span>
                  </span>
                  <span
                    className={`num text-h4 ${
                      m.change_pct > 0 ? "text-scope-400" : "text-alert-500"
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

      {/* ── EVENT CLUSTERS ── */}
      {eventsData && eventsData.events.length > 0 && (
        <section className="mb-12">
          <SectionHead
            eyebrow="grouped · by theme"
            title="event clusters"
            sub="Markets that resolve off the same underlying event, grouped."
          />
          <div className="surface rounded-lg overflow-hidden divide-y divide-ink-800">
            {eventsData.events.map((e) => (
              <div
                key={e.title}
                className="flex items-center justify-between px-5 py-4"
              >
                <div className="flex-1 min-w-0 pr-6">
                  <p className="text-body text-ink-100 truncate font-medium">
                    {e.title}
                  </p>
                  <div className="flex items-center gap-5 mt-1.5 text-caption font-mono">
                    <span className="text-ink-400">
                      <span className="num text-ink-100">{e.market_count}</span> markets
                    </span>
                    <span className="text-ink-400">
                      vol{" "}
                      <span className="text-ink-100 num">
                        ${formatNum(e.total_volume)}
                      </span>
                    </span>
                    {e.divergence_signals > 0 && (
                      <span className="text-fade-500 num">
                        {e.divergence_signals} divergence
                        {e.divergence_signals > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                {e.avg_divergence > 0 && (
                  <span className="num text-h4 text-fade-500 tracking-tight">
                    {(e.avg_divergence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <Disclaimer />
    </div>
  );
}

/* ── Trader leaderboard table — used in PREDICTIVE LEADERBOARD section ── */
function TraderBoard({
  side,
  title,
  rows,
}: {
  side: "predictive" | "fade";
  title: string;
  rows: TraderLeaderboardEntry[];
}) {
  const accent = side === "predictive" ? "text-scope-400" : "text-fade-500";
  const hoverAccent =
    side === "predictive" ? "hover:text-scope-400" : "hover:text-fade-500";
  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      <div className="surface rounded-lg overflow-hidden">
        <table className="w-full text-body-sm">
          <tbody>
            {rows.map((t, i) => (
              <tr
                key={t.trader_address}
                className="border-b border-ink-800/70 last:border-0 row-hover"
              >
                <td className="pl-4 pr-2 py-3 text-micro text-ink-500 font-mono w-8 num text-right">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="py-3 pr-3">
                  <Link
                    href={`/traders/${t.trader_address}`}
                    className={`text-ink-100 font-mono text-body-sm ${hoverAccent} transition-colors`}
                  >
                    {shortAddr(t.trader_address)}
                  </Link>
                </td>
                <td className="py-3 pr-4 text-right">
                  <div className={`num ${accent} text-body font-medium`}>
                    {t.accuracy_pct.toFixed(0)}%
                    {t.ci && !t.ci.sufficient && (
                      <span
                        className="ml-1 text-fade-500/60 text-caption"
                        title="small sample (n<30)"
                      >
                        ·
                      </span>
                    )}
                  </div>
                  {t.ci && (
                    <div className="text-micro text-ink-500 num mt-0.5">
                      [{t.ci.lo.toFixed(0)}–{t.ci.hi.toFixed(0)}]
                    </div>
                  )}
                </td>
                <td className="pr-4 py-3 text-right text-micro text-ink-500 num w-20">
                  {t.correct_predictions}/{t.total_divergent_signals}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
