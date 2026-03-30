"use client";

import { useEffect, useState } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { ScoreBadge } from "@/components/score-badge";
import type { Trader, DivergenceSignal } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function SmartMoneyPage() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [divergences, setDivergences] = useState<DivergenceSignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/smart-money/leaderboard`).then((r) => r.json()),
      fetch(`${API_BASE}/api/divergences`).then((r) => r.json()),
    ])
      .then(([lb, div]) => {
        setTraders(lb.traders || []);
        setDivergences(div.signals || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse text-gray-400 text-center py-12">
        Loading smart money data...
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Smart Money Feed</h1>
      <p className="text-gray-400 mb-6">
        Top trader rankings and counter-consensus signals. Read-only intelligence.
      </p>

      {/* Counter-consensus signals */}
      {divergences.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">
            Active Divergences
          </h2>
          <div className="space-y-3">
            {divergences.map((d, i) => (
              <div
                key={d.market_id + i}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white font-medium">{d.question}</p>
                    <div className="flex gap-4 mt-2 text-sm">
                      <span className="text-gray-400">
                        Crowd: {(d.market_price * 100).toFixed(0)}% YES
                      </span>
                      <span
                        className={
                          d.sm_direction === "YES"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        SM: {(d.sm_consensus * 100).toFixed(0)}% (favors{" "}
                        {d.sm_direction})
                      </span>
                    </div>
                  </div>
                  <ScoreBadge score={d.score} label="Score" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Leaderboard */}
      <section>
        <h2 className="text-xl font-semibold text-white mb-4">
          Top Traders by Profit
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                <th className="text-left p-3">Rank</th>
                <th className="text-left p-3">Trader</th>
                <th className="text-right p-3">Profit</th>
                <th className="text-right p-3">Volume</th>
                <th className="text-right p-3">Markets</th>
              </tr>
            </thead>
            <tbody>
              {traders.slice(0, 50).map((t) => (
                <tr
                  key={t.address}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30"
                >
                  <td className="p-3 text-gray-400 text-sm">#{t.rank}</td>
                  <td className="p-3">
                    <p className="text-white text-sm font-medium">
                      {t.name || `${t.address.slice(0, 6)}...${t.address.slice(-4)}`}
                    </p>
                  </td>
                  <td
                    className={`p-3 text-right text-sm font-medium ${
                      t.profit >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    ${t.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="p-3 text-right text-sm text-gray-400">
                    ${t.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="p-3 text-right text-sm text-gray-400">
                    {t.markets_traded}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
