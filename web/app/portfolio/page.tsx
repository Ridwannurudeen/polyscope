"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { TableSkeleton } from "@/components/skeleton";
import { getClientId } from "@/lib/client-id";
import { shortAddress, useIdentity } from "@/lib/identity";

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
  resolved_outcome: number | null;
  resolved_final_price: number | null;
  outcome_matched_direction: boolean | null;
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
    ])
      .then(([w, p]) => {
        setWatchlist(w.items || []);
        setPortfolio(p);
      })
      .finally(() => setLoading(false));
  }, [walletAddress]);

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

  const noData = watchlist.length === 0 && (portfolio?.actions.length ?? 0) === 0;

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

          {/* Watchlist */}
          {watchlist.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-semibold text-white mb-4">Watchlist</h2>
              <div className="space-y-2">
                {watchlist.map((w) => (
                  <div
                    key={w.id}
                    className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-start justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/market/${w.market_id}`}
                        className="text-white text-sm font-medium hover:text-emerald-400 line-clamp-1"
                      >
                        {w.question || w.market_id.slice(0, 20)}
                      </Link>
                      <div className="flex gap-4 mt-1 text-xs">
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
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Disclaimer />
    </div>
  );
}
