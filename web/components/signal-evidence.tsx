"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Contributor {
  trader_address: string;
  trader_rank: number | null;
  position_direction: string;
  position_size: number;
  avg_price: number;
  weight_in_consensus: number;
  accuracy_pct: number | null;
  total_divergent_signals: number | null;
  correct_predictions: number | null;
}

interface EvidenceResponse {
  signal: {
    id: number;
    market_id: string;
    timestamp: string;
    market_price: number;
    sm_consensus: number;
    divergence_pct: number;
    signal_strength: number;
    sm_trader_count: number;
    sm_direction: string;
    signal_source: string;
    category: string;
  };
  contributors: Contributor[];
  skew: {
    band: string;
    label: string;
    total_resolved: number;
    correct: number;
    hit_rate_pct: number | null;
  };
  category: {
    name: string;
    total_resolved: number;
    correct: number;
    hit_rate_pct: number | null;
  };
  error?: string;
}

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function accuracyColor(pct: number | null) {
  if (pct === null) return "text-gray-500";
  if (pct >= 70) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-red-400";
}

function freshnessLabel(timestamp: string): string {
  const then = new Date(timestamp).getTime();
  const now = Date.now();
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function SignalEvidence({ marketId }: { marketId: string }) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/signals/evidence/${marketId}`)
      .then((r) => r.json())
      .then((d: EvidenceResponse) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  if (loading) {
    return (
      <div className="mt-3 p-4 bg-gray-950 border border-gray-800 rounded-lg">
        <div className="h-4 w-32 bg-gray-800 rounded animate-pulse mb-3" />
        <div className="h-3 w-full bg-gray-800/60 rounded animate-pulse mb-2" />
        <div className="h-3 w-3/4 bg-gray-800/60 rounded animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mt-3 p-3 bg-gray-950 border border-gray-800 rounded-lg text-sm text-gray-500">
        Evidence unavailable: {error || "no data"}
      </div>
    );
  }

  return (
    <div className="mt-3 p-4 bg-gray-950 border border-gray-800 rounded-lg space-y-4">
      {/* Signal metadata strip */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <span className="text-gray-500">
          Source:{" "}
          <span className={data.signal.signal_source === "trades" ? "text-emerald-400" : "text-gray-300"}>
            {data.signal.signal_source}
          </span>
        </span>
        <span className="text-gray-500">
          Fresh: <span className="text-gray-300">{freshnessLabel(data.signal.timestamp)}</span>
        </span>
        <span className="text-gray-500">
          Divergence:{" "}
          <span className="text-gray-300">
            {(data.signal.divergence_pct * 100).toFixed(1)}%
          </span>
        </span>
        <span className="text-gray-500">
          Score: <span className="text-gray-300">{data.signal.signal_strength.toFixed(0)}</span>
        </span>
      </div>

      {/* Historical context */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-gray-900 rounded border border-gray-800">
          <p className="text-xs text-gray-500 uppercase mb-1">Skew Band</p>
          <p className="text-sm text-white">{data.skew.label}</p>
          {data.skew.hit_rate_pct !== null ? (
            <p className="text-xs text-gray-400 mt-1">
              Historical hit rate:{" "}
              <span className={accuracyColor(data.skew.hit_rate_pct)}>
                {data.skew.hit_rate_pct.toFixed(1)}%
              </span>{" "}
              ({data.skew.correct}/{data.skew.total_resolved})
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">No resolved data yet</p>
          )}
        </div>
        <div className="p-3 bg-gray-900 rounded border border-gray-800">
          <p className="text-xs text-gray-500 uppercase mb-1">Category</p>
          <p className="text-sm text-white">{data.category.name || "uncategorized"}</p>
          {data.category.hit_rate_pct !== null ? (
            <p className="text-xs text-gray-400 mt-1">
              Historical hit rate:{" "}
              <span className={accuracyColor(data.category.hit_rate_pct)}>
                {data.category.hit_rate_pct.toFixed(1)}%
              </span>{" "}
              ({data.category.correct}/{data.category.total_resolved})
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">No resolved data yet</p>
          )}
        </div>
      </div>

      {/* Contributors */}
      <div>
        <p className="text-xs text-gray-500 uppercase mb-2">
          Contributing Traders ({data.contributors.length})
        </p>
        {data.contributors.length === 0 ? (
          <p className="text-sm text-gray-500">No per-trader data available yet.</p>
        ) : (
          <div className="bg-gray-900 rounded border border-gray-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-2">Trader</th>
                  <th className="text-center p-2">Rank</th>
                  <th className="text-center p-2">Dir</th>
                  <th className="text-right p-2">Size</th>
                  <th className="text-right p-2">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.contributors.map((c) => (
                  <tr
                    key={c.trader_address}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="p-2">
                      <Link
                        href={`/traders/${c.trader_address}`}
                        className="text-white font-mono text-xs hover:text-emerald-400"
                      >
                        {formatAddress(c.trader_address)}
                      </Link>
                    </td>
                    <td className="p-2 text-center text-xs text-gray-400">
                      {c.trader_rank ? `#${c.trader_rank}` : "—"}
                    </td>
                    <td
                      className={`p-2 text-center text-xs font-medium ${
                        c.position_direction === "YES"
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {c.position_direction}
                    </td>
                    <td className="p-2 text-right text-xs text-gray-400">
                      ${c.position_size.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className={`p-2 text-right text-xs ${accuracyColor(c.accuracy_pct)}`}>
                      {c.accuracy_pct !== null
                        ? `${c.accuracy_pct.toFixed(0)}% (${c.correct_predictions}/${c.total_divergent_signals})`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
