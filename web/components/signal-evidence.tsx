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
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function accuracyColor(pct: number | null) {
  if (pct === null) return "text-ink-500";
  if (pct >= 70) return "text-scope-400";
  if (pct >= 50) return "text-fade-500";
  return "text-alert-500";
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
      <div className="border border-ink-800 bg-background rounded-md p-4 animate-pulse-subtle">
        <div className="h-3 w-32 bg-ink-800 rounded-sm mb-3" />
        <div className="h-2.5 w-full bg-ink-800/70 rounded-sm mb-2" />
        <div className="h-2.5 w-3/4 bg-ink-800/70 rounded-sm" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border border-ink-800 bg-background rounded-md p-3 text-body-sm text-ink-500 font-mono">
        evidence unavailable · {error || "no data"}
      </div>
    );
  }

  return (
    <div className="border border-ink-800 bg-background rounded-md p-4 space-y-4">
      {/* Signal metadata strip */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-caption font-mono">
        <span className="text-ink-500">
          source ·{" "}
          <span
            className={
              data.signal.signal_source === "trades"
                ? "text-scope-400"
                : "text-ink-300"
            }
          >
            {data.signal.signal_source}
          </span>
        </span>
        <span className="text-ink-500">
          fresh ·{" "}
          <span className="text-ink-300">
            {freshnessLabel(data.signal.timestamp)}
          </span>
        </span>
        <span className="text-ink-500">
          divergence ·{" "}
          <span className="text-ink-300 num">
            {(data.signal.divergence_pct * 100).toFixed(1)}%
          </span>
        </span>
        <span className="text-ink-500">
          score ·{" "}
          <span className="text-ink-300 num">
            {data.signal.signal_strength.toFixed(0)}
          </span>
        </span>
      </div>

      {/* Historical context — flat 4-cell row, not nested cards.
          The two `surface` boxes inside the already-bordered evidence
          container were card-in-card-in-card chrome. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 py-3 border-y border-ink-800/70">
        <div>
          <div className="eyebrow mb-1">skew band</div>
          <p className="text-body-sm text-ink-200">{data.skew.label}</p>
        </div>
        <div>
          <div className="eyebrow mb-1">band hit rate</div>
          {data.skew.hit_rate_pct !== null ? (
            <p className="text-body-sm font-mono">
              <span className={`num ${accuracyColor(data.skew.hit_rate_pct)}`}>
                {data.skew.hit_rate_pct.toFixed(1)}%
              </span>
              <span className="text-ink-500 num ml-2">
                {data.skew.correct}/{data.skew.total_resolved}
              </span>
            </p>
          ) : (
            <p className="text-body-sm text-ink-500 font-mono">—</p>
          )}
        </div>
        <div>
          <div className="eyebrow mb-1">category</div>
          <p className="text-body-sm text-ink-200 truncate">
            {data.category.name || "uncategorized"}
          </p>
        </div>
        <div>
          <div className="eyebrow mb-1">cat hit rate</div>
          {data.category.hit_rate_pct !== null ? (
            <p className="text-body-sm font-mono">
              <span
                className={`num ${accuracyColor(data.category.hit_rate_pct)}`}
              >
                {data.category.hit_rate_pct.toFixed(1)}%
              </span>
              <span className="text-ink-500 num ml-2">
                {data.category.correct}/{data.category.total_resolved}
              </span>
            </p>
          ) : (
            <p className="text-body-sm text-ink-500 font-mono">—</p>
          )}
        </div>
      </div>

      {/* Contributors */}
      <div>
        <div className="eyebrow mb-2.5">
          contributing traders ·{" "}
          <span className="num">{data.contributors.length}</span>
        </div>
        {data.contributors.length === 0 ? (
          <p className="text-body-sm text-ink-500 font-mono">
            no per-trader data available yet.
          </p>
        ) : (
          <div className="surface rounded-md overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-2">trader</th>
                  <th className="eyebrow text-center px-3 py-2">rank</th>
                  <th className="eyebrow text-center px-3 py-2">dir</th>
                  <th className="eyebrow text-right px-3 py-2">size</th>
                  <th className="eyebrow text-right px-3 py-2">accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.contributors.map((c) => (
                  <tr
                    key={c.trader_address}
                    className="border-b border-ink-800/60 last:border-0 row-hover"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/traders/${c.trader_address}`}
                        className="text-ink-100 font-mono num hover:text-scope-400 transition-colors"
                      >
                        {formatAddress(c.trader_address)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-center text-caption text-ink-500 font-mono num">
                      {c.trader_rank ? `#${c.trader_rank}` : "—"}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-center font-mono num ${
                        c.position_direction === "YES"
                          ? "text-scope-400"
                          : "text-alert-500"
                      }`}
                    >
                      {c.position_direction}
                    </td>
                    <td className="px-3 py-2.5 text-right text-caption text-ink-300 font-mono num">
                      $
                      {c.position_size.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right text-caption font-mono num ${accuracyColor(c.accuracy_pct)}`}
                    >
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
