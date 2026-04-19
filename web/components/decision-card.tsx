"use client";

import { useState } from "react";
import { LogTrade } from "@/components/log-trade";
import { ScoreBadge } from "@/components/score-badge";
import { ShareButton } from "@/components/share-button";
import { SignalEvidence } from "@/components/signal-evidence";
import { SizeHint } from "@/components/size-hint";
import { WatchlistButton } from "@/components/watchlist-button";
import { trackEvent } from "@/lib/analytics";
import type { DivergenceSignal } from "@/lib/api";
import { useBandStats } from "@/lib/hooks";

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

function skewFromPrice(price: number): {
  band: "tight" | "moderate" | "lopsided" | "very_lopsided";
  label: string;
  edgeNote: string;
  edgeColor: string;
  followSm: boolean;
} {
  if (price >= 0.9 || price <= 0.1) {
    return {
      band: "very_lopsided",
      label: "Very lopsided",
      edgeNote:
        "Very-lopsided: fade SM. Mostly composition effect — thin edge, not genuine alpha",
      edgeColor: "text-gray-400",
      followSm: false,
    };
  }
  if (price >= 0.75 || price <= 0.25) {
    return {
      band: "lopsided",
      label: "Lopsided",
      edgeNote:
        "Lopsided: follow SM. Low hit rate but high payout — positive EV when SM dissents",
      edgeColor: "text-gray-300",
      followSm: true,
    };
  }
  if (price >= 0.6 || price <= 0.4) {
    return {
      band: "moderate",
      label: "Moderate",
      edgeNote:
        "Moderate: follow SM. Real uncertainty, SM edge historically ~86% on dissents",
      edgeColor: "text-amber-300",
      followSm: true,
    };
  }
  return {
    band: "tight",
    label: "Tight",
    edgeNote:
      "Tight: follow SM. Strongest edge zone — SM has been right 100% on 17 resolved",
    edgeColor: "text-emerald-300",
    followSm: true,
  };
}

function freshness(timestamp: string): { label: string; stale: boolean } {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return { label: "—", stale: false };
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  let label: string;
  if (mins < 1) label = "just now";
  else if (mins < 60) label = `${mins}m ago`;
  else if (hrs < 24) label = `${hrs}h ago`;
  else label = `${days}d ago`;
  return { label, stale: hrs > 12 };
}

export function DecisionCard({ signal }: { signal: DivergenceSignal }) {
  const [expanded, setExpanded] = useState(false);
  const bandStats = useBandStats();
  const tier = tierFromScore(signal.score);
  const skew = skewFromPrice(signal.market_price);
  const fresh = freshness(signal.timestamp);
  const crowdPct = (signal.market_price * 100).toFixed(0);
  const smPct = (signal.sm_consensus * 100).toFixed(0);
  const divPct = (signal.divergence_pct * 100).toFixed(0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className={`text-xs px-2 py-0.5 rounded border font-medium ${tier.tierBg} ${tier.tierColor}`}
            >
              {tier.tier}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded border bg-gray-950 ${
                skew.band === "tight"
                  ? "border-emerald-500/30 text-emerald-400"
                  : skew.band === "very_lopsided"
                    ? "border-gray-700 text-gray-400"
                    : "border-gray-700 text-gray-300"
              }`}
            >
              {skew.label}
            </span>
            <span
              className={`text-xs ${fresh.stale ? "text-amber-400" : "text-gray-500"}`}
              title={`Signal timestamp: ${signal.timestamp}`}
            >
              {fresh.label}
              {fresh.stale && " · stale"}
            </span>
            <span className="text-xs text-gray-500 uppercase">
              {signal.signal_source === "trades"
                ? "Trade-weighted"
                : "Position-based"}
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
        <ShareButton
          marketId={signal.market_id}
          question={signal.question}
          direction={signal.sm_direction}
          divergencePct={signal.divergence_pct}
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
            <span
              className={`font-semibold ${directionColor(signal.sm_direction)}`}
            >
              {signal.sm_direction}
            </span>{" "}
            ({skew.followSm ? "following" : "fading"} a{" "}
            <span className="text-white font-semibold">{smPct}%</span>{" "}
            smart-money consensus that diverges by{" "}
            <span className="text-white font-semibold">{divPct}%</span> from the
            market).
          </p>
          <p className={`text-xs mt-2 ${skew.edgeColor}`}>{skew.edgeNote}</p>
        </div>
      </div>

      {/* Sizing hint */}
      <div className="px-4 pb-3">
        <SizeHint
          marketPrice={signal.market_price}
          smDirection={signal.sm_direction}
          bandStats={bandStats}
        />
      </div>

      {/* Decision metadata */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-500 uppercase mb-1">Contributors</p>
          <p className="text-gray-200">
            {signal.sm_trader_count} top-100 traders
          </p>
          <p className="text-gray-500 text-[11px] mt-0.5">
            Expand evidence for per-trader accuracy
          </p>
        </div>
        <div>
          <p className="text-gray-500 uppercase mb-1">Confidence</p>
          <p className={tier.tierColor}>{tier.description}</p>
        </div>
      </div>

      {/* Invalidator chips */}
      <div className="px-4 pb-3">
        <p className="text-xs text-gray-500 uppercase mb-1.5">
          Thesis invalidators
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] px-2 py-1 rounded-md bg-gray-950 border border-gray-800 text-gray-300">
            ⏱ Divergence converges below 5% → auto-expire
          </span>
          <span className="text-[11px] px-2 py-1 rounded-md bg-gray-950 border border-gray-800 text-gray-300">
            🔁 High-accuracy contributor flips side
          </span>
          {skew.band === "very_lopsided" && (
            <span className="text-[11px] px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300">
              ⚠ Lopsided market — composition effect, not alpha
            </span>
          )}
          {fresh.stale && (
            <span className="text-[11px] px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300">
              ⚠ Signal is stale — recheck before acting
            </span>
          )}
        </div>
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
