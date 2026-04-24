"use client";

import { useState } from "react";
import { LogTrade } from "@/components/log-trade";
import { ScoreBadge } from "@/components/score-badge";
import { ShareButton } from "@/components/share-button";
import { SignalEvidence } from "@/components/signal-evidence";
import { SizeHint } from "@/components/size-hint";
import { TradeButton } from "@/components/trade-button";
import { WatchlistButton } from "@/components/watchlist-button";
import { trackEvent } from "@/lib/analytics";
import type { DivergenceSignal } from "@/lib/api";
import { useBandStats } from "@/lib/hooks";

function tierFromScore(score: number): {
  label: string;
  tone: "scope" | "fade" | "ink";
  description: string;
} {
  if (score >= 80)
    return {
      label: "tier 1",
      tone: "scope",
      description: "Large divergence + multiple high-rank contributors.",
    };
  if (score >= 60)
    return {
      label: "tier 2",
      tone: "fade",
      description: "Meaningful divergence — inspect contributors before acting.",
    };
  if (score >= 40)
    return {
      label: "tier 3",
      tone: "ink",
      description: "Low composite — informational only.",
    };
  return {
    label: "tier 4",
    tone: "ink",
    description: "Below confidence threshold.",
  };
}

function skewFromPrice(price: number): {
  band: "tight" | "moderate" | "lopsided" | "very_lopsided";
  label: string;
  edgeNote: string;
  followSm: boolean;
} {
  if (price >= 0.9 || price <= 0.1) {
    return {
      band: "very_lopsided",
      label: "very lopsided",
      edgeNote:
        "very-lopsided · fade SM · composition effect dominates, thin real edge.",
      followSm: false,
    };
  }
  if (price >= 0.75 || price <= 0.25) {
    return {
      band: "lopsided",
      label: "lopsided",
      edgeNote:
        "lopsided · follow SM · low hit rate, high payout — positive EV on dissent.",
      followSm: true,
    };
  }
  if (price >= 0.6 || price <= 0.4) {
    return {
      band: "moderate",
      label: "moderate",
      edgeNote:
        "moderate · follow SM · real uncertainty; historical SM edge ~86% on dissent.",
      followSm: true,
    };
  }
  return {
    band: "tight",
    label: "tight",
    edgeNote:
      "tight · follow SM · strongest edge zone — 100% on 17 resolved in this band.",
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

function Tag({
  tone,
  children,
  title,
}: {
  tone: "scope" | "fade" | "ink" | "alert";
  children: React.ReactNode;
  title?: string;
}) {
  const styles = {
    scope: "border-scope-500/35 bg-scope-500/8 text-scope-300",
    fade: "border-fade-500/35 bg-fade-500/8 text-fade-400",
    ink: "border-ink-700 bg-surface text-ink-300",
    alert: "border-alert-500/40 bg-alert-500/8 text-alert-400",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center text-eyebrow font-mono uppercase tracking-wider px-2 py-[3px] rounded-sm border ${styles[tone]}`}
    >
      {children}
    </span>
  );
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
  const dirClass =
    signal.sm_direction === "YES" ? "text-scope-400" : "text-alert-500";

  return (
    <div className="surface rounded-lg overflow-hidden">
      {/* Header row — tags + question + score */}
      <div className="p-5 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <Tag tone={tier.tone}>{tier.label}</Tag>
            {signal.predictive_contributor && (
              <Tag
                tone="scope"
                title={`predictive contributor · ${signal.predictive_contributor.trader_address.slice(
                  0,
                  10,
                )}… · ${signal.predictive_contributor.pct}% on ${
                  signal.predictive_contributor.n
                } signals · CI ${signal.predictive_contributor.ci_lo}–${signal.predictive_contributor.ci_hi}%`}
              >
                predictive-backed ·{" "}
                {signal.predictive_contributor.pct.toFixed(0)}%
                &nbsp;(n={signal.predictive_contributor.n})
              </Tag>
            )}
            <Tag tone={skew.band === "tight" ? "scope" : "ink"}>
              {skew.label}
            </Tag>
            <span
              className={`text-micro font-mono ${
                fresh.stale ? "text-fade-500" : "text-ink-500"
              }`}
              title={`signal timestamp · ${signal.timestamp}`}
            >
              {fresh.label}
              {fresh.stale && " · stale"}
            </span>
            <span className="text-micro font-mono text-ink-500 uppercase tracking-wider">
              {signal.signal_source === "trades"
                ? "trade-weighted"
                : "position-based"}
            </span>
          </div>
          <p className="text-body-lg text-ink-100 leading-snug font-medium">
            {signal.question}
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <ScoreBadge score={signal.score} label="score" />
        </div>
      </div>

      {/* Action bar */}
      <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
        <WatchlistButton marketId={signal.market_id} />
        <TradeButton
          marketId={signal.market_id}
          question={signal.question}
          direction={signal.sm_direction as "YES" | "NO"}
          marketPrice={signal.market_price}
        />
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
          marketPrice={signal.market_price}
        />
      </div>

      {/* Thesis */}
      <div className="px-5 pb-4">
        <div className="border border-ink-800 bg-background rounded-md p-3.5">
          <div className="eyebrow mb-2">thesis</div>
          <p className="text-body-sm text-ink-200 leading-relaxed">
            market prices this at{" "}
            <span className="num text-ink-100 font-medium">{crowdPct}%</span>{" "}
            <span className="text-ink-400">yes</span>. polyscope view:{" "}
            <span className={`num font-medium ${dirClass}`}>
              {signal.sm_direction}
            </span>{" "}
            ({skew.followSm ? "following" : "fading"} a{" "}
            <span className="num text-ink-100 font-medium">{smPct}%</span>{" "}
            smart-money consensus that diverges by{" "}
            <span className="num text-fade-500 font-medium">{divPct}%</span>{" "}
            from market).
          </p>
          <p className="text-micro text-ink-400 font-mono mt-2">
            {skew.edgeNote}
          </p>
        </div>
      </div>

      {/* Sizing hint */}
      <div className="px-5 pb-4">
        <SizeHint
          marketPrice={signal.market_price}
          smDirection={signal.sm_direction}
          bandStats={bandStats}
        />
      </div>

      {/* Decision metadata */}
      <div className="px-5 pb-4 grid grid-cols-2 gap-4">
        <div>
          <div className="eyebrow mb-1.5">contributors</div>
          <p className="text-body-sm text-ink-200">
            <span className="num text-ink-100 font-medium">
              {signal.sm_trader_count}
            </span>{" "}
            top-100 traders
          </p>
          <p className="text-micro text-ink-500 font-mono mt-0.5">
            expand evidence · per-trader accuracy
          </p>
        </div>
        <div>
          <div className="eyebrow mb-1.5">confidence</div>
          <p className="text-body-sm text-ink-200 leading-relaxed">
            {tier.description}
          </p>
        </div>
      </div>

      {/* Invalidator chips */}
      <div className="px-5 pb-4">
        <div className="eyebrow mb-2">invalidators</div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-micro font-mono px-2 py-1 rounded-sm border border-ink-800 bg-background text-ink-300">
            divergence &lt; 5% · auto-expire
          </span>
          <span className="text-micro font-mono px-2 py-1 rounded-sm border border-ink-800 bg-background text-ink-300">
            high-accuracy contributor flips side
          </span>
          {skew.band === "very_lopsided" && (
            <span className="text-micro font-mono px-2 py-1 rounded-sm border border-fade-500/30 bg-fade-500/5 text-fade-400">
              lopsided · composition effect, not alpha
            </span>
          )}
          {fresh.stale && (
            <span className="text-micro font-mono px-2 py-1 rounded-sm border border-fade-500/30 bg-fade-500/5 text-fade-400">
              stale · recheck before acting
            </span>
          )}
        </div>
      </div>

      {/* Evidence toggle */}
      <div className="border-t border-ink-800">
        <button
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) {
              trackEvent("evidence_opened", { market_id: signal.market_id });
            }
          }}
          className="w-full px-5 py-3 text-body-sm text-ink-400 hover:text-ink-100 hover:bg-ink-800/40 flex items-center justify-between font-mono transition-colors duration-120"
        >
          <span>{expanded ? "hide evidence" : "show evidence"}</span>
          <span className="text-micro text-ink-500">
            contributors · skew · category
          </span>
        </button>
        {expanded && (
          <div className="px-5 pb-5 pt-1">
            <SignalEvidence marketId={signal.market_id} />
          </div>
        )}
      </div>
    </div>
  );
}
