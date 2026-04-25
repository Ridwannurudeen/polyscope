"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { FollowButton } from "@/components/follow-button";
import { TableSkeleton } from "@/components/skeleton";
import { TelegramConnect } from "@/components/telegram-connect";
import { getClientId } from "@/lib/client-id";
import { shortAddress, useIdentity } from "@/lib/identity";

interface Invalidation {
  reason:
    | "converged"
    | "direction_flipped"
    | "resolved_right"
    | "resolved_wrong"
    | "expired";
  label: string;
  severity: "info" | "warn";
}

interface WatchlistItem {
  id: number;
  market_id: string;
  sm_direction_at_add: string | null;
  market_price_at_add: number | null;
  sm_consensus_at_add: number | null;
  divergence_pct_at_add: number | null;
  question: string;
  category: string;
  added_at: string;
  current_market_price: number | null;
  current_sm_direction: string | null;
  current_sm_consensus: number | null;
  current_divergence_pct: number | null;
  latest_expired: number | null;
  resolved_outcome: number | null;
  resolved_final_price: number | null;
  outcome_matched_direction: boolean | null;
  invalidation: Invalidation | null;
}

interface PortfolioAction {
  id: number;
  market_id: string;
  action_direction: string;
  size: number;
  price: number;
  acted_at: string;
  question: string | null;
  category: string | null;
  resolved_outcome: number | null;
  resolved_final_price: number | null;
  resolved_at: string | null;
  action_correct: boolean | null;
}

interface PortfolioResponse {
  actions: PortfolioAction[];
  stats: {
    total_actions: number;
    resolved_actions: number;
    correct: number;
    win_rate_pct: number | null;
    pnl_estimate_usd: number;
  };
}

interface FollowedTrader {
  trader_address: string;
  followed_at: string;
  total_divergent_signals: number | null;
  correct_predictions: number | null;
  accuracy_pct: number | null;
  ci?: {
    pct: number;
    lo: number;
    hi: number;
    total: number;
    correct: number;
    sufficient: boolean;
  };
}

interface FollowAlert {
  id: number;
  trader_address: string;
  signal_id: number;
  market_id: string;
  position_direction: string | null;
  created_at: string;
  seen_at: string | null;
  question: string | null;
  market_price: number | null;
  sm_consensus: number | null;
  divergence_pct: number | null;
  signal_strength: number | null;
  sm_direction: string | null;
  accuracy_pct: number | null;
  total_divergent_signals: number | null;
}

function colorForWinRate(pct: number | null) {
  if (pct === null) return "text-ink-500";
  if (pct >= 60) return "text-scope-400";
  if (pct >= 50) return "text-fade-500";
  return "text-alert-500";
}

function directionColor(dir: string | null) {
  if (!dir) return "text-ink-400";
  return dir === "YES" ? "text-scope-400" : "text-alert-500";
}

function SectionHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-5 pb-3 border-b border-ink-800 gap-3 flex-wrap">
      <div>
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h2 className="text-h3 text-ink-100 tracking-tight">{title}</h2>
        {sub && (
          <p className="text-caption text-ink-400 mt-1 max-w-2xl">{sub}</p>
        )}
      </div>
      {right}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "scope" | "alert" | "fade";
}) {
  const colorClass = {
    ink: "text-ink-100",
    scope: "text-scope-400",
    fade: "text-fade-500",
    alert: "text-alert-500",
  }[tone];
  return (
    <div className="surface rounded-md p-4">
      <div className="eyebrow mb-2">{label}</div>
      <p className={`num text-h3 tracking-tight ${colorClass}`}>{value}</p>
    </div>
  );
}

export default function PortfolioPage() {
  const { walletAddress } = useIdentity();
  const [clientId, setClientId] = useState<string>("");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [followed, setFollowed] = useState<FollowedTrader[]>([]);
  const [alerts, setAlerts] = useState<FollowAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cid = getClientId();
    setClientId(cid);
    if (!cid) return;

    const qs = new URLSearchParams({ client_id: cid });
    if (walletAddress) qs.set("wallet_address", walletAddress);

    Promise.all([
      fetch(`/api/watchlist?${qs.toString()}`).then((r) => r.json()),
      fetch(`/api/portfolio?${qs.toString()}`).then((r) => r.json()),
      fetch(`/api/follow/list?${qs.toString()}`).then((r) => r.json()),
      fetch(`/api/follow/alerts?${qs.toString()}&limit=20`).then((r) =>
        r.json(),
      ),
    ])
      .then(([w, p, f, a]) => {
        setWatchlist(w.items || []);
        setPortfolio(p);
        setFollowed(f.items || []);
        setAlerts(a.items || []);
      })
      .finally(() => setLoading(false));
  }, [walletAddress]);

  const markAlertsSeen = async () => {
    const cid = getClientId();
    const qs = new URLSearchParams({ client_id: cid });
    if (walletAddress) qs.set("wallet_address", walletAddress);
    await fetch(`/api/follow/alerts/mark-seen?${qs.toString()}`, {
      method: "POST",
    });
    setAlerts((prev) =>
      prev.map((a) => ({
        ...a,
        seen_at: a.seen_at || new Date().toISOString(),
      })),
    );
  };

  if (loading) {
    return (
      <div>
        <div className="mb-10 pb-10 border-b border-ink-800">
          <div className="h-3 w-24 bg-ink-800 rounded-sm mb-5 animate-pulse-subtle" />
          <div className="h-10 w-48 bg-ink-800 rounded-sm mb-3 animate-pulse-subtle" />
          <div className="h-4 w-96 bg-ink-800/70 rounded-sm animate-pulse-subtle" />
        </div>
        <TableSkeleton rows={8} />
      </div>
    );
  }

  const removeFromWatchlist = async (id: number) => {
    const r = await fetch(
      `/api/watchlist/${id}?client_id=${encodeURIComponent(clientId)}`,
      { method: "DELETE" },
    );
    if (r.ok) {
      setWatchlist((prev) => prev.filter((x) => x.id !== id));
    }
  };

  const unseenCount = alerts.filter((a) => !a.seen_at).length;
  const noData =
    watchlist.length === 0 &&
    (portfolio?.actions.length ?? 0) === 0 &&
    followed.length === 0 &&
    alerts.length === 0;

  return (
    <div>
      {/* Hero */}
      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="eyebrow mb-3">your view</div>
        <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight mb-3">
          portfolio
        </h1>
        <p className="text-body-lg text-ink-300 leading-relaxed max-w-2xl">
          Watched signals and logged trades. Scored once markets resolve.{" "}
          {walletAddress ? (
            <span className="text-scope-400 font-mono">
              · linked to {shortAddress(walletAddress)} (cross-device sync)
            </span>
          ) : (
            <span className="text-ink-400">
              · stored anonymously on this browser. link a wallet to sync.
            </span>
          )}
        </p>
      </section>

      {noData ? (
        <div className="surface rounded-lg p-10 text-center">
          <div className="eyebrow mb-3">empty</div>
          <p className="text-body text-ink-300 mb-2">nothing here yet</p>
          <p className="text-caption text-ink-400 font-mono">
            watch signals from{" "}
            <Link
              href="/smart-money"
              className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
            >
              /smart-money
            </Link>
            , or log trades from any decision card
          </p>
        </div>
      ) : (
        <>
          <TelegramConnect />

          {/* New positions from followed traders */}
          {alerts.length > 0 && (
            <section className="mb-12">
              <SectionHeader
                eyebrow="alerts · followed traders"
                title="new positions"
                sub={
                  unseenCount > 0
                    ? `${unseenCount} new alert${unseenCount === 1 ? "" : "s"}`
                    : undefined
                }
                right={
                  unseenCount > 0 ? (
                    <button
                      onClick={markAlertsSeen}
                      className="btn-ghost"
                    >
                      mark all read
                    </button>
                  ) : undefined
                }
              />
              <div className="space-y-2">
                {alerts.slice(0, 10).map((a) => (
                  <Link
                    key={a.id}
                    href={`/market/${a.market_id}`}
                    className={`block surface rounded-md p-3 hover:border-ink-600 transition-colors duration-120 ${
                      a.seen_at ? "" : "ring-1 ring-scope-500/20 border-scope-500/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm text-ink-100 truncate font-medium">
                          {a.question || a.market_id.slice(0, 20)}
                        </p>
                        <div className="flex items-center gap-4 mt-1.5 text-caption font-mono">
                          <span className="text-ink-500 num">
                            {shortAddress(a.trader_address)}
                          </span>
                          {a.accuracy_pct !== null &&
                            a.total_divergent_signals !== null && (
                              <span className="text-ink-500">
                                <span className="num text-ink-300">
                                  {a.accuracy_pct.toFixed(0)}%
                                </span>{" "}
                                on{" "}
                                <span className="num text-ink-300">
                                  {a.total_divergent_signals}
                                </span>
                              </span>
                            )}
                          <span
                            className={`num ${
                              a.position_direction === "YES"
                                ? "text-scope-400"
                                : "text-alert-500"
                            }`}
                          >
                            → {a.position_direction}
                          </span>
                          {a.market_price !== null && (
                            <span className="text-ink-500">
                              market{" "}
                              <span className="num text-ink-300">
                                {(a.market_price * 100).toFixed(0)}%
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-micro text-ink-500 font-mono num shrink-0">
                        {new Date(a.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Followed traders */}
          {followed.length > 0 && (
            <section className="mb-12">
              <SectionHeader
                eyebrow="follow list · trader"
                title="traders you follow"
              />
              <div className="surface rounded-lg overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-ink-800">
                      <th className="eyebrow text-left px-3 py-3">trader</th>
                      <th className="eyebrow text-right px-3 py-3">accuracy</th>
                      <th className="eyebrow text-right px-3 py-3">signals</th>
                      <th className="eyebrow text-right px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {followed.map((f) => {
                      const hasData =
                        f.accuracy_pct !== null &&
                        f.total_divergent_signals !== null &&
                        f.total_divergent_signals > 0;
                      const accClass =
                        (f.accuracy_pct ?? 0) >= 60
                          ? "text-scope-400"
                          : (f.accuracy_pct ?? 0) >= 50
                            ? "text-fade-500"
                            : "text-alert-500";
                      return (
                        <tr
                          key={f.trader_address}
                          className="border-b border-ink-800/60 last:border-0 row-hover"
                        >
                          <td className="px-3 py-3">
                            <Link
                              href={`/traders/${f.trader_address}`}
                              className="text-ink-100 font-mono num hover:text-scope-400 transition-colors"
                            >
                              {shortAddress(f.trader_address)}
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {hasData ? (
                              <>
                                <div
                                  className={`num font-medium ${accClass}`}
                                >
                                  {(f.accuracy_pct ?? 0).toFixed(0)}%
                                </div>
                                {f.ci && (
                                  <div className="text-micro text-ink-500 num mt-0.5">
                                    [{f.ci.lo.toFixed(0)}–{f.ci.hi.toFixed(0)}]
                                    {!f.ci.sufficient && (
                                      <span
                                        className="ml-1 text-fade-500/70"
                                        title="small sample (n<30)"
                                      >
                                        ·
                                      </span>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-caption text-ink-500 font-mono">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right text-caption text-ink-400 font-mono num">
                            {f.total_divergent_signals || 0}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <FollowButton
                              traderAddress={f.trader_address}
                              size="sm"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Performance stats */}
          {portfolio && portfolio.stats.total_actions > 0 && (
            <section className="mb-12">
              <SectionHeader
                eyebrow="results · trade log"
                title="performance"
              />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatTile
                  label="total trades"
                  value={String(portfolio.stats.total_actions)}
                />
                <StatTile
                  label="resolved"
                  value={String(portfolio.stats.resolved_actions)}
                />
                <StatTile
                  label="correct"
                  value={String(portfolio.stats.correct)}
                  tone="scope"
                />
                <StatTile
                  label="win rate"
                  value={
                    portfolio.stats.win_rate_pct !== null
                      ? `${portfolio.stats.win_rate_pct.toFixed(1)}%`
                      : "—"
                  }
                  tone={
                    portfolio.stats.win_rate_pct === null
                      ? "ink"
                      : portfolio.stats.win_rate_pct >= 60
                        ? "scope"
                        : portfolio.stats.win_rate_pct >= 50
                          ? "fade"
                          : "alert"
                  }
                />
                <StatTile
                  label="pnl · est"
                  value={`$${portfolio.stats.pnl_estimate_usd.toFixed(0)}`}
                  tone={
                    portfolio.stats.pnl_estimate_usd >= 0 ? "scope" : "alert"
                  }
                />
              </div>
            </section>
          )}

          {/* Trade log */}
          {portfolio && portfolio.actions.length > 0 && (
            <section className="mb-12">
              <SectionHeader eyebrow="ledger · all" title="trade log" />
              <div className="surface rounded-lg overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-ink-800">
                      <th className="eyebrow text-left px-3 py-3">when</th>
                      <th className="eyebrow text-left px-3 py-3">market</th>
                      <th className="eyebrow text-center px-3 py-3">dir</th>
                      <th className="eyebrow text-right px-3 py-3">size</th>
                      <th className="eyebrow text-right px-3 py-3">price</th>
                      <th className="eyebrow text-center px-3 py-3">outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.actions.map((a) => (
                      <tr
                        key={a.id}
                        className="border-b border-ink-800/60 last:border-0 row-hover"
                      >
                        <td className="px-3 py-3 text-caption text-ink-400 font-mono num whitespace-nowrap">
                          {new Date(a.acted_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/market/${a.market_id}`}
                            className="text-ink-100 hover:text-scope-400 line-clamp-1 max-w-[300px] transition-colors"
                          >
                            {a.question || a.market_id.slice(0, 12)}
                          </Link>
                        </td>
                        <td
                          className={`px-3 py-3 text-center font-mono num ${directionColor(a.action_direction)}`}
                        >
                          {a.action_direction}
                        </td>
                        <td className="px-3 py-3 text-right text-caption text-ink-300 font-mono num">
                          ${a.size.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right text-caption text-ink-300 font-mono num">
                          {a.price.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-center font-mono">
                          {a.action_correct === true ? (
                            <span className="text-scope-500">✓</span>
                          ) : a.action_correct === false ? (
                            <span className="text-alert-500">✗</span>
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

          {/* Watchlist */}
          {watchlist.length > 0 &&
            (() => {
              const active = watchlist.filter((w) => w.invalidation === null);
              const invalidated = watchlist.filter(
                (w) => w.invalidation !== null,
              );
              const renderItem = (w: WatchlistItem) => (
                <div
                  key={w.id}
                  className={`surface rounded-md p-3 flex items-start justify-between gap-3 ${
                    w.invalidation?.severity === "warn"
                      ? "border-fade-500/30"
                      : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/market/${w.market_id}`}
                      className="text-body-sm text-ink-100 hover:text-scope-400 line-clamp-1 font-medium transition-colors"
                    >
                      {w.question || w.market_id.slice(0, 20)}
                    </Link>
                    {w.invalidation && (
                      <p
                        className={`text-caption font-mono mt-1.5 ${
                          w.invalidation.severity === "warn"
                            ? "text-fade-400"
                            : "text-scope-300"
                        }`}
                      >
                        {w.invalidation.label}
                      </p>
                    )}
                    <div className="flex gap-4 mt-1.5 text-caption font-mono flex-wrap">
                      <span className="text-ink-500">
                        at-add · crowd{" "}
                        <span className="num text-ink-300">
                          {w.market_price_at_add !== null
                            ? `${(w.market_price_at_add * 100).toFixed(0)}%`
                            : "—"}
                        </span>{" "}
                        · view{" "}
                        <span className={`num ${directionColor(w.sm_direction_at_add)}`}>
                          {w.sm_direction_at_add || "—"}
                        </span>
                      </span>
                      {w.current_market_price !== null && (
                        <span className="text-ink-500">
                          now ·{" "}
                          <span className="num text-ink-300">
                            {(w.current_market_price * 100).toFixed(0)}%
                          </span>
                          {w.current_sm_direction &&
                            w.current_sm_direction !==
                              w.sm_direction_at_add && (
                              <>
                                {" · sm "}
                                <span
                                  className={`num ${directionColor(w.current_sm_direction)}`}
                                >
                                  {w.current_sm_direction}
                                </span>
                              </>
                            )}
                        </span>
                      )}
                      {w.resolved_outcome !== null && (
                        <span
                          className={`num ${
                            w.outcome_matched_direction
                              ? "text-scope-400"
                              : "text-alert-500"
                          }`}
                        >
                          resolved {w.resolved_outcome === 1 ? "YES" : "NO"} ·{" "}
                          {w.outcome_matched_direction
                            ? "called it"
                            : "wrong"}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFromWatchlist(w.id)}
                    className="text-eyebrow font-mono px-2 py-1 text-ink-500 hover:text-alert-500 uppercase tracking-wider transition-colors shrink-0"
                    aria-label="remove"
                  >
                    remove
                  </button>
                </div>
              );

              return (
                <>
                  {active.length > 0 && (
                    <section className="mb-12">
                      <SectionHeader
                        eyebrow={`watch · ${active.length} active`}
                        title="watchlist"
                      />
                      <div className="space-y-2">{active.map(renderItem)}</div>
                    </section>
                  )}
                  {invalidated.length > 0 && (
                    <section className="mb-12">
                      <SectionHeader
                        eyebrow={`invalidated · ${invalidated.length}`}
                        title="thesis invalidated"
                        sub="signals that have converged, flipped side, or resolved · review and act, or remove"
                      />
                      <div className="space-y-2">
                        {invalidated.map(renderItem)}
                      </div>
                    </section>
                  )}
                </>
              );
            })()}
        </>
      )}

      <Disclaimer />
    </div>
  );
}
