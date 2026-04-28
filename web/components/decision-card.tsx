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

/**
 * DecisionCard — terminal row, not a SaaS card.
 *
 * Layout, top to bottom:
 *  1. Tag row     — tier · predictive-backed (if any) · skew · freshness · source · score (right)
 *  2. Question    — promoted to h3 so it dominates
 *  3. Readout grid — crowd · polyscope · divergence (3 mono cells, the data, no prose)
 *  4. Action bar  — watch · trade · log · share
 *  5. Size hint   — quarter-Kelly suggestion when band has resolved samples
 *  6. Disclosure  — single mono row "[+] evidence"
 *
 * Compared to the previous version: 6 stacked padded sections collapsed to
 * 4 zones (header, readout, action, disclosure), card-in-card thesis box
 * removed, invalidator chips merged into the tag row when active.
 */

function tierFromScore(score: number): {
  label: string;
  tone: "scope" | "fade" | "ink";
  hint: string;
} {
  if (score >= 80) return { label: "tier 1", tone: "scope", hint: "large divergence · multi high-rank contributors" };
  if (score >= 60) return { label: "tier 2", tone: "fade", hint: "meaningful · inspect contributors" };
  if (score >= 40) return { label: "tier 3", tone: "ink", hint: "low composite · informational" };
  return { label: "tier 4", tone: "ink", hint: "sub-threshold" };
}

function skewFromPrice(price: number): {
  band: "tight" | "moderate" | "lopsided" | "very_lopsided";
  label: string;
  followSm: boolean;
} {
  if (price >= 0.9 || price <= 0.1) return { band: "very_lopsided", label: "very lopsided", followSm: false };
  if (price >= 0.75 || price <= 0.25) return { band: "lopsided", label: "lopsided", followSm: true };
  if (price >= 0.6 || price <= 0.4) return { band: "moderate", label: "moderate", followSm: true };
  return { band: "tight", label: "tight", followSm: true };
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
    ink: "border-ink-700 text-ink-300",
    alert: "border-alert-500/40 bg-alert-500/8 text-alert-400",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center text-eyebrow font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

function ReadoutCell({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "scope" | "fade" | "alert";
}) {
  const valueClass =
    tone === "scope"
      ? "text-scope-400"
      : tone === "fade"
      ? "text-fade-500"
      : tone === "alert"
      ? "text-alert-500"
      : "text-ink-100";
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className={`num text-h3 leading-none tracking-tighter ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

export function DecisionCard({ signal }: { signal: DivergenceSignal }) {
  const [expanded, setExpanded] = useState(false);
  const bandStats = useBandStats();
  const tier = tierFromScore(signal.score);
  const skew = skewFromPrice(signal.market_price);
  const fresh = freshness(signal.timestamp);
  const crowdPct = `${(signal.market_price * 100).toFixed(0)}%`;
  const smPct = `${(signal.sm_consensus * 100).toFixed(0)}%`;
  const divPct = `${(signal.divergence_pct * 100).toFixed(0)}%`;
  const dirTone: "scope" | "alert" =
    signal.sm_direction === "YES" ? "scope" : "alert";

  return (
    <article className="surface rounded-lg overflow-hidden">
      {/* Header — tags + question + score */}
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <Tag tone={tier.tone} title={tier.hint}>
              {tier.label}
            </Tag>
            {signal.predictive_contributor && (
              <Tag
                tone="scope"
                title={`predictive contributor · ${signal.predictive_contributor.trader_address.slice(
                  0,
                  10,
                )}… · ${signal.predictive_contributor.pct}% on ${signal.predictive_contributor.n} signals · CI ${signal.predictive_contributor.ci_lo}–${signal.predictive_contributor.ci_hi}%`}
              >
                predictive · {signal.predictive_contributor.pct.toFixed(0)}%
                &nbsp;n={signal.predictive_contributor.n}
              </Tag>
            )}
            <Tag tone={skew.band === "tight" ? "scope" : "ink"}>
              {skew.label}
            </Tag>
            <Tag tone="ink">
              {signal.sm_trader_count}{" "}
              <span className="text-ink-500 normal-case ml-0.5">contributors</span>
            </Tag>
            {skew.band === "very_lopsided" && (
              <Tag tone="fade" title="composition effect on lopsided markets">
                composition
              </Tag>
            )}
            {fresh.stale && (
              <Tag tone="fade" title="signal older than 12h — recheck before acting">
                stale
              </Tag>
            )}
            <span
              className="text-micro font-mono text-ink-500 ml-1"
              title={`signal timestamp · ${signal.timestamp}`}
            >
              {fresh.label}
              <span className="mx-2 text-ink-700">·</span>
              {signal.signal_source === "trades" ? "trade-weighted" : "positions"}
            </span>
          </div>
          <h3 className="text-h3 text-ink-50 leading-snug font-medium tracking-tight">
            {signal.question}
          </h3>
        </div>
        <div className="shrink-0">
          <ScoreBadge score={signal.score} label="score" />
        </div>
      </div>

      {/* Readout grid — replaces narrated thesis */}
      <div className="px-4 pb-4 grid grid-cols-3 gap-4">
        <ReadoutCell label="crowd" value={crowdPct} />
        <ReadoutCell
          label={`polyscope · ${skew.followSm ? "follow" : "fade"}`}
          value={`${signal.sm_direction} ${smPct}`}
          tone={dirTone}
        />
        <ReadoutCell label="divergence" value={divPct} tone="fade" />
      </div>

      {/* Action bar */}
      <div className="px-4 pb-4 flex items-center gap-2 flex-wrap border-t border-ink-800 pt-4">
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

      {/* Sizing hint — only renders when band has enough resolved samples */}
      <div className="px-4 pb-4">
        <SizeHint
          marketPrice={signal.market_price}
          smDirection={signal.sm_direction}
          bandStats={bandStats}
        />
      </div>

      {/* Evidence disclosure — single mono row, not a CTA */}
      <button
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next) {
            trackEvent("evidence_opened", { market_id: signal.market_id });
          }
        }}
        className="w-full px-4 py-2.5 text-eyebrow font-mono text-ink-500 hover:text-ink-200 flex items-center gap-2 border-t border-ink-800 transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-ink-400">[{expanded ? "−" : "+"}]</span>
        <span>{expanded ? "hide evidence" : "show evidence"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-ink-800/70">
          <SignalEvidence marketId={signal.market_id} />
        </div>
      )}
    </article>
  );
}
