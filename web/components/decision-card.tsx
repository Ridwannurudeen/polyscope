"use client";

import { useState } from "react";
import { LogTrade } from "@/components/log-trade";
import { ScoreBadge } from "@/components/score-badge";
import { SignalEvidence } from "@/components/signal-evidence";
import { WatchlistButton } from "@/components/watchlist-button";
import { trackEvent } from "@/lib/analytics";
import type { DivergenceSignal } from "@/lib/api";

function tierFromScore(score: number): {
  tier: string;
  tierColor: string;
  tierBg: string;
  description: string;
} {
  if (score >= 80)
    return {
      tier: "Tier 1",
      tierColor: "text-emerald-400",
      tierBg: "bg-emerald-500/10 border-emerald-500/30",
      description: "Strong signal — large divergence + multiple high-rank contributors",
    };
  if (score >= 60)
    return {
      tier: "Tier 2",
      tierColor: "text-amber-400",
      tierBg: "bg-amber-500/10 border-amber-500/30",
      description: "Moderate signal — meaningful divergence, check contributors",
    };
  if (score >= 40)
    return {
      tier: "Tier 3",
      tierColor: "text-gray-300",
      tierBg: "bg-gray-800 border-gray-700",
      description: "Weak signal — low composite score, treat as informational",
    };
  return {
    tier: "Tier 4",
    tierColor: "text-gray-500",
    tierBg: "bg-gray-800 border-gray-700",
    description: "Informational only — below confidence threshold",
  };
}

function directionColor(direction: string): string {
  return direction === "YES" ? "text-emerald-400" : "text-red-400";
}

export function DecisionCard({ signal }: { signal: DivergenceSignal }) {
  const [expanded, setExpanded] = useState(false);
  const tier = tierFromScore(signal.score);
  const crowdPct = (signal.market_price * 100).toFixed(0);
  const smPct = (signal.sm_consensus * 100).toFixed(0);
  const divPct = (signal.divergence_pct * 100).toFixed(0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`text-xs px-2 py-0.5 rounded border font-medium ${tier.tierBg} ${tier.tierColor}`}
            >
              {tier.tier}
            </span>
            <span className="text-xs text-gray-500 uppercase">
              {signal.signal_source === "trades" ? "Trade-weighted" : "Position-based"}
            </span>
          </div>
          <p className="text-white font-medium leading-snug">
            {signal.question}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreBadge score={signal.score} label="Score" />
        </div>
      </div>

      {/* Action bar */}
      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
        <WatchlistButton marketId={signal.market_id} />
        <LogTrade
          marketId={signal.market_id}
          defaultDirection={signal.sm_direction}
          defaultPrice={
            signal.sm_direction === "YES"
              ? signal.market_price
              : 1 - signal.market_price
          }
        />
      </div>

      {/* Thesis */}
      <div className="px-4 pb-3">
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase mb-2">Thesis</p>
          <p className="text-sm text-gray-200 leading-relaxed">
            Market prices this at{" "}
            <span className="text-white font-semibold">{crowdPct}% YES</span>.{" "}
            PolyScope view:{" "}
            <span className={`font-semibold ${directionColor(signal.sm_direction)}`}>
              {signal.sm_direction}
            </span>{" "}
            (fading a{" "}
            <span className="text-white font-semibold">{smPct}%</span> smart-money
            consensus that diverges by{" "}
            <span className="text-white font-semibold">{divPct}%</span> from the
            market).
          </p>
        </div>
      </div>

      {/* Decision metadata */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-500 uppercase mb-1">Contributors</p>
          <p className="text-gray-200">
            {signal.sm_trader_count} top-100 traders
          </p>
        </div>
        <div>
          <p className="text-gray-500 uppercase mb-1">Confidence</p>
          <p className={tier.tierColor}>{tier.description}</p>
        </div>
      </div>

      {/* Invalidators */}
      <div className="px-4 pb-3">
        <p className="text-xs text-gray-500 uppercase mb-1">Invalidators</p>
        <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
          <li>
            Signal expires if market/SM divergence converges below 5% — fresh
            positions may realign
          </li>
          <li>
            High-accuracy contributors flipping direction weakens the fade
            thesis (check evidence)
          </li>
          <li>
            Lopsided markets (≥90% or ≤10%) — signal is mostly a confirmation
            of the favored side, not alpha
          </li>
        </ul>
      </div>

      {/* Evidence toggle */}
      <div className="border-t border-gray-800">
        <button
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) {
              trackEvent("evidence_opened", { market_id: signal.market_id });
            }
          }}
          className="w-full px-4 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800/50 flex items-center justify-between"
        >
          <span>{expanded ? "Hide evidence" : "Show evidence"}</span>
          <span className="text-xs text-gray-500">
            contributors · skew · category hit rate
          </span>
        </button>
        {expanded && (
          <div className="px-4 pb-4">
            <SignalEvidence marketId={signal.market_id} />
          </div>
        )}
      </div>
    </div>
  );
}
