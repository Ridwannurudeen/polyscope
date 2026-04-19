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
  reason: "converged" | "direction_flipped" | "resolved_right" | "resolved_wrong" | "expired";
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
  if (pct === null) return "text-gray-500";
  if (pct >= 60) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-red-400";
}

function directionColor(dir: string | null) {
  if (!dir) return "text-gray-400";
  return dir === "YES" ? "text-emerald-400" : "text-red-400";
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
      fetch(`/api/follow/alerts?${qs.toString()}&limit=20`).then((r) => r.json()),
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
    setAlerts((prev) => prev.map((a) => ({ ...a, seen_at: a.seen_at || new Date().toISOString() })));
  };

  if (loading) {
    return (
      <div>
        <div className="h-8 w-48 bg-gray-800 rounded animate-pulse mb-6" />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  const removeFromWatchlist = async (id: number) => {
    const r = await fetch(
      `/api/watchlist/${id}?client_id=${encodeURIComponent(clientId)}`,
      { method: "DELETE" }
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Portfolio</h1>
        <p className="text-gray-400">
          Your watched signals and logged trades. Scored once markets resolve.{" "}
          {walletAddress ? (
            <span className="text-emerald-400">
              Linked to wallet {shortAddress(walletAddress)} — follows you
              across devices.
            </span>
          ) : (
            <>
              <span>Stored anonymously on this browser.</span>{" "}
              <span className="text-gray-500">
                Link a wallet (top-right) to sync across devices.
              </span>
            </>
          )}
        </p>
      </div>

      {noData ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-300 mb-2">Nothing here yet.</p>
          <p className="text-gray-500 text-sm mb-4">
            Watch signals from the{" "}
            <Link href="/smart-money" className="text-emerald-400 hover:underline">
              Smart Money
            </Link>{" "}
            page or log trades on any decision card.
          </p>
        </div>
      ) : (
        <>
          <TelegramConnect />

          {/* New positions from followed traders */}
          {alerts.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">
                    New positions from followed traders
                  </h2>
                  {unseenCount > 0 && (
                    <p className="text-xs text-emerald-400 mt-0.5">
                      {unseenCount} new alert{unseenCount === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
                {unseenCount > 0 && (
                  <button
                    onClick={markAlertsSeen}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {alerts.slice(0, 10).map((a) => (
                  <Link
                    key={a.id}
                    href={`/market/${a.market_id}`}
                    className={`block bg-gray-900 border rounded-xl p-3 hover:border-gray-700 transition-colors ${
                      a.seen_at ? "border-gray-800" : "border-emerald-500/30 ring-1 ring-emerald-500/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {a.question || a.market_id.slice(0, 20)}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs">
                          <span className="font-mono text-gray-500">
                            {shortAddress(a.trader_address)}
                          </span>
                          {a.accuracy_pct !== null &&
                            a.total_divergent_signals !== null && (
                              <span className="text-gray-500">
                                {a.accuracy_pct.toFixed(0)}% on{" "}
                                {a.total_divergent_signals} markets
                              </span>
                            )}
                          <span
                            className={
                              a.position_direction === "YES"
                                ? "text-emerald-400 font-medium"
                                : "text-red-400 font-medium"
                            }
                          >
                            → {a.position_direction}
                          </span>
                          {a.market_price !== null && (
                            <span className="text-gray-500">
                              Market: {(a.market_price * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 shrink-0">
                        {new Date(a.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Traders you follow */}
          {followed.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-semibold text-white mb-4">
                Traders you follow
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                      <th className="text-left p-3">Trader</th>
                      <th className="text-right p-3">Accuracy</th>
                      <th className="text-right p-3">Signals</th>
                      <th className="text-right p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {followed.map((f) => {
                      const hasData =
                        f.accuracy_pct !== null &&
                        f.total_divergent_signals !== null &&
                        f.total_divergent_signals > 0;
                      return (
                        <tr
                          key={f.trader_address}
                          className="border-b border-gray-800/50 hover:bg-gray-800/30"
                        >
                          <td className="p-3">
                            <Link
                              href={`/traders/${f.trader_address}`}
                              className="text-white font-mono text-xs hover:text-emerald-400"
                            >
                              {shortAddress(f.trader_address)}
                            </Link>
                          </td>
                          <td className="p-3 text-right">
                            {hasData ? (
                              <>
                                <div
                                  className={`text-sm font-semibold ${
                                    (f.accuracy_pct ?? 0) >= 60
                                      ? "text-emerald-400"
                                      : (f.accuracy_pct ?? 0) >= 50
                                        ? "text-amber-400"
                                        : "text-red-400"
                                  }`}
                                >
                                  {(f.accuracy_pct ?? 0).toFixed(0)}%
                                </div>
                                {f.ci && (
                                  <div className="text-[10px] text-gray-500">
                                    [{f.ci.lo.toFixed(0)}–{f.ci.hi.toFixed(0)}%]
                                    {!f.ci.sufficient && (
                                      <span
                                        className="ml-1 text-amber-500/70"
                                        title="Small sample (<30)"
                                      >
                                        ⚠
                                      </span>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-gray-500">—</span>
                            )}
                          </td>
                          <td className="p-3 text-right text-xs text-gray-400">
                            {f.total_divergent_signals || 0}
                          </td>
                          <td className="p-3 text-right">
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

          {/* Stats summary */}
          {portfolio && portfolio.stats.total_actions > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-semibold text-white mb-4">Performance</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase mb-1">Total Trades</p>
                  <p className="text-xl font-semibold text-white">
                    {portfolio.stats.total_actions}
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase mb-1">Resolved</p>
                  <p className="text-xl font-semibold text-white">
                    {portfolio.stats.resolved_actions}
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase mb-1">Correct</p>
                  <p className="text-xl font-semibold text-emerald-400">
                    {portfolio.stats.correct}
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase mb-1">Win Rate</p>
                  <p
                    className={`text-xl font-semibold ${colorForWinRate(portfolio.stats.win_rate_pct)}`}
                  >
                    {portfolio.stats.win_rate_pct !== null
                      ? `${portfolio.stats.win_rate_pct.toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase mb-1">PnL (est)</p>
                  <p
                    className={`text-xl font-semibold ${
                      portfolio.stats.pnl_estimate_usd >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    ${portfolio.stats.pnl_estimate_usd.toFixed(0)}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Trade log */}
          {portfolio && portfolio.actions.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-semibold text-white mb-4">Trade Log</h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                      <th className="text-left p-3">When</th>
                      <th className="text-left p-3">Market</th>
                      <th className="text-center p-3">Direction</th>
                      <th className="text-right p-3">Size</th>
                      <th className="text-right p-3">Price</th>
                      <th className="text-center p-3">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.actions.map((a) => (
                      <tr
                        key={a.id}
                        className="border-b border-gray-800/50 hover:bg-gray-800/30"
                      >
                        <td className="p-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(a.acted_at).toLocaleDateString()}
                        </td>
                        <td className="p-3">
                          <Link
                            href={`/market/${a.market_id}`}
                            className="text-white text-sm hover:text-emerald-400 line-clamp-1 max-w-[300px]"
                          >
                            {a.question || a.market_id.slice(0, 12)}
                          </Link>
                        </td>
                        <td
                          className={`p-3 text-center text-sm font-medium ${directionColor(a.action_direction)}`}
                        >
                          {a.action_direction}
                        </td>
                        <td className="p-3 text-right text-sm text-gray-400">
                          ${a.size.toLocaleString()}
                        </td>
                        <td className="p-3 text-right text-sm text-gray-400">
                          {a.price.toFixed(2)}
                        </td>
                        <td className="p-3 text-center text-lg">
                          {a.action_correct === true
                            ? "✅"
                            : a.action_correct === false
                              ? "❌"
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Watchlist — split by invalidation state */}
          {watchlist.length > 0 &&
            (() => {
              const active = watchlist.filter((w) => w.invalidation === null);
              const invalidated = watchlist.filter(
                (w) => w.invalidation !== null
              );
              const renderItem = (w: WatchlistItem) => (
                <div
                  key={w.id}
                  className={`bg-gray-900 border rounded-xl p-3 flex items-start justify-between gap-3 ${
                    w.invalidation?.severity === "warn"
                      ? "border-amber-500/30"
                      : "border-gray-800"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/market/${w.market_id}`}
                      className="text-white text-sm font-medium hover:text-emerald-400 line-clamp-1"
                    >
                      {w.question || w.market_id.slice(0, 20)}
                    </Link>
                    {w.invalidation && (
                      <p
                        className={`text-xs mt-1 ${
                          w.invalidation.severity === "warn"
                            ? "text-amber-300"
                            : "text-emerald-300"
                        }`}
                      >
                        ⚠ {w.invalidation.label}
                      </p>
                    )}
                    <div className="flex gap-4 mt-1 text-xs flex-wrap">
                      <span className="text-gray-500">
                        At add: crowd{" "}
                        <span className="text-gray-300">
                          {w.market_price_at_add !== null
                            ? `${(w.market_price_at_add * 100).toFixed(0)}%`
                            : "—"}
                        </span>{" "}
                        · view{" "}
                        <span className={directionColor(w.sm_direction_at_add)}>
                          {w.sm_direction_at_add || "—"}
                        </span>
                      </span>
                      {w.current_market_price !== null && (
                        <span className="text-gray-500">
                          Now:{" "}
                          <span className="text-gray-300">
                            {(w.current_market_price * 100).toFixed(0)}%
                          </span>
                          {w.current_sm_direction &&
                            w.current_sm_direction !==
                              w.sm_direction_at_add && (
                              <>
                                {" · SM now "}
                                <span
                                  className={directionColor(
                                    w.current_sm_direction
                                  )}
                                >
                                  {w.current_sm_direction}
                                </span>
                              </>
                            )}
                        </span>
                      )}
                      {w.resolved_outcome !== null && (
                        <span
                          className={
                            w.outcome_matched_direction
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          Resolved {w.resolved_outcome === 1 ? "YES" : "NO"} —{" "}
                          {w.outcome_matched_direction ? "called it" : "wrong"}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFromWatchlist(w.id)}
                    className="text-xs text-gray-500 hover:text-red-400 shrink-0"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              );

              return (
                <>
                  {active.length > 0 && (
                    <section className="mb-10">
                      <h2 className="text-xl font-semibold text-white mb-4">
                        Watchlist — active ({active.length})
                      </h2>
                      <div className="space-y-2">{active.map(renderItem)}</div>
                    </section>
                  )}
                  {invalidated.length > 0 && (
                    <section className="mb-10">
                      <h2 className="text-xl font-semibold text-white mb-1">
                        Thesis invalidated ({invalidated.length})
                      </h2>
                      <p className="text-xs text-gray-500 mb-4">
                        Watched signals that have converged, flipped side, or
                        resolved. Review and act, or remove.
                      </p>
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
