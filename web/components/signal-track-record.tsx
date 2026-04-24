"use client";

import { usePollingFetch } from "@/lib/hooks";
import type { SignalAccuracy, SignalAccuracyTier } from "@/lib/api";

const SKEW_LABELS: Record<keyof SignalAccuracy["by_skew"], string> = {
  tight: "tight · 40–60%",
  moderate: "moderate · 25–40 / 60–75",
  lopsided: "lopsided · 10–25 / 75–90",
  very_lopsided: "very lopsided · ≤10 / ≥90",
};

function SkewRow({
  label,
  data,
  highlight,
}: {
  label: string;
  data: SignalAccuracyTier;
  highlight?: boolean;
}) {
  const pct =
    data.total > 0 ? `${(data.win_rate * 100).toFixed(1)}%` : "—";
  return (
    <div
      className={`flex items-center justify-between px-3.5 py-2.5 rounded-md border ${
        highlight
          ? "border-scope-500/35 bg-scope-500/5"
          : "border-ink-800 bg-surface"
      }`}
    >
      <p
        className={`font-mono text-caption ${
          highlight ? "text-scope-300" : "text-ink-300"
        }`}
      >
        {label}
      </p>
      <div className="flex items-baseline gap-3">
        <p
          className={`num text-body font-medium ${
            highlight ? "text-scope-400" : "text-ink-100"
          }`}
        >
          {pct}
        </p>
        <p className="text-micro text-ink-500 num">
          {data.correct}/{data.total}
        </p>
      </div>
    </div>
  );
}

function HeadlineCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "scope" | "fade" | "neutral";
}) {
  const color =
    accent === "scope"
      ? "text-scope-400"
      : accent === "fade"
        ? "text-fade-500"
        : "text-ink-100";
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className={`num ${color} text-h2 leading-none tracking-tighter`}>
        {value}
      </div>
      <div className="text-micro text-ink-400 font-mono mt-2 leading-snug">
        {sub}
      </div>
    </div>
  );
}

export function SignalTrackRecord() {
  const { data } = usePollingFetch<SignalAccuracy>(
    "/api/signals/accuracy",
    300_000,
  );

  if (!data || !data.overall) return null;

  const { overall, by_skew, rolling_30d } = data;
  const collecting = overall.total_signals < 10;
  const tight = by_skew?.tight;
  const tightReady = tight && tight.total >= 10;

  return (
    <div className="surface rounded-lg p-6">
      {collecting ? (
        <div className="text-center py-8">
          <div className="eyebrow mb-3">status</div>
          <p className="num text-h3 text-ink-300">collecting data</p>
          <p className="text-caption text-ink-400 mt-2 font-mono">
            <span className="num text-ink-200">{overall.total_signals}</span> of{" "}
            <span className="num text-ink-200">10</span> unique markets resolved.
            Accuracy metrics appear once the sample crosses the threshold.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-6 pb-6 border-b border-ink-800">
            <HeadlineCell
              label="tight-market accuracy"
              value={
                tightReady
                  ? `${(tight.win_rate * 100).toFixed(1)}%`
                  : "—"
              }
              sub={
                tightReady
                  ? `${tight.correct}/${tight.total} resolved in 40–60% markets`
                  : "need 10+ resolved tight-market signals"
              }
              accent="scope"
            />
            <HeadlineCell
              label="markets analyzed"
              value={overall.total_signals.toLocaleString()}
              sub={`${overall.correct} counter-consensus hits`}
            />
            <HeadlineCell
              label="avg signal score"
              value={String(overall.avg_score)}
              sub="composite divergence strength"
              accent="fade"
            />
          </div>

          <div className="border border-fade-500/20 bg-fade-500/5 rounded-md px-4 py-3 mb-6">
            <p className="text-micro text-fade-400/90 font-mono leading-relaxed">
              <span className="text-fade-500 font-medium">why tight-market first.</span>{" "}
              Headline win rates on resolved signals are dominated by lopsided
              markets where the favored side wins regardless — composition
              effect, not edge. The honest test of signal quality is the 40–60%
              band, where outcomes are genuinely uncertain.{" "}
              <a
                href="/methodology"
                className="text-fade-400 underline underline-offset-2 hover:text-fade-300"
              >
                methodology →
              </a>
            </p>
          </div>

          {by_skew && (
            <div>
              <div className="eyebrow mb-3">by market skew</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <SkewRow label={SKEW_LABELS.tight} data={by_skew.tight} highlight />
                <SkewRow label={SKEW_LABELS.moderate} data={by_skew.moderate} />
                <SkewRow label={SKEW_LABELS.lopsided} data={by_skew.lopsided} />
                <SkewRow label={SKEW_LABELS.very_lopsided} data={by_skew.very_lopsided} />
              </div>
            </div>
          )}

          {data.simulation && data.simulation.total_wagered > 0 && (
            <div className="border-t border-ink-800 pt-5 mt-6">
              <div className="eyebrow mb-3">simulated p&amp;l · $100 per signal</div>
              <div className="grid grid-cols-3 gap-8">
                <div>
                  <p
                    className={`num text-h3 tracking-tighter ${
                      data.simulation.roi_pct >= 0
                        ? "text-scope-400"
                        : "text-alert-500"
                    }`}
                  >
                    {data.simulation.roi_pct >= 0 ? "+" : ""}
                    {data.simulation.roi_pct.toFixed(1)}%
                  </p>
                  <p className="text-micro text-ink-400 font-mono mt-1">
                    simulated roi
                  </p>
                </div>
                <div>
                  <p className="num text-h3 text-ink-100 tracking-tighter">
                    $
                    {data.simulation.total_return.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </p>
                  <p className="text-micro text-ink-400 font-mono mt-1">
                    on{" "}
                    <span className="num text-ink-200">
                      $
                      {data.simulation.total_wagered.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </span>{" "}
                    wagered
                  </p>
                </div>
                <div>
                  <p className="num text-h3 text-fade-500 tracking-tighter">
                    {data.simulation.avg_odds_on_hits.toFixed(1)}x
                  </p>
                  <p className="text-micro text-ink-400 font-mono mt-1">
                    avg odds on hits
                  </p>
                </div>
              </div>
            </div>
          )}

          {rolling_30d.total > 0 && (
            <div className="border-t border-ink-800 pt-4 mt-5">
              <p className="text-caption text-ink-400 font-mono text-center">
                <span className="text-ink-500">30d · </span>
                <span className="num text-ink-200">
                  {rolling_30d.correct}/{rolling_30d.total}
                </span>{" "}
                hits ·{" "}
                <span className="num text-ink-100">
                  {(rolling_30d.win_rate * 100).toFixed(1)}%
                </span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
