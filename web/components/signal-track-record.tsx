"use client";

import { usePollingFetch } from "@/lib/hooks";
import type { SignalAccuracy, SignalAccuracyTier } from "@/lib/api";

const SKEW_LABELS: Record<keyof SignalAccuracy["by_skew"], string> = {
  tight: "Tight (40–60%)",
  moderate: "Moderate (25–40% / 60–75%)",
  lopsided: "Lopsided (10–25% / 75–90%)",
  very_lopsided: "Very lopsided (≤10% / ≥90%)",
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
    data.total > 0 ? `${(data.win_rate * 100).toFixed(1)}%` : "\u2014";
  return (
    <div
      className={`flex items-center justify-between rounded-lg px-3 py-2 ${
        highlight
          ? "bg-emerald-500/5 border border-emerald-500/30"
          : "bg-gray-950/50 border border-gray-800"
      }`}
    >
      <p className={`text-sm ${highlight ? "text-emerald-300" : "text-gray-300"}`}>
        {label}
      </p>
      <div className="flex items-baseline gap-3">
        <p
          className={`text-lg font-bold ${
            highlight ? "text-emerald-400" : "text-white"
          }`}
        >
          {pct}
        </p>
        <p className="text-xs text-gray-500">
          {data.correct}/{data.total}
        </p>
      </div>
    </div>
  );
}

export function SignalTrackRecord() {
  const { data } = usePollingFetch<SignalAccuracy>(
    "/api/signals/accuracy",
    300_000
  );

  if (!data || !data.overall) return null;

  const { overall, by_skew, rolling_30d } = data;
  const collecting = overall.total_signals < 10;
  const tight = by_skew?.tight;
  const tightReady = tight && tight.total >= 10;

  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-white mb-4">
        Signal Track Record
      </h2>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        {collecting ? (
          <div className="text-center py-4">
            <p className="text-2xl font-bold text-gray-400">Collecting Data</p>
            <p className="text-sm text-gray-500 mt-2">
              {overall.total_signals} of 10 unique markets resolved with signals.
              Accuracy metrics will appear once enough data is collected.
            </p>
          </div>
        ) : (
          <>
            {/* Honest headline: tight-market accuracy */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
              <div className="text-center md:text-left">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Tight-market accuracy
                </p>
                <p className="text-4xl font-bold text-emerald-400">
                  {tightReady
                    ? `${(tight.win_rate * 100).toFixed(1)}%`
                    : "\u2014"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {tightReady
                    ? `${tight.correct}/${tight.total} resolved in 40–60% markets`
                    : "Need 10+ resolved tight-market signals"}
                </p>
              </div>
              <div className="text-center md:text-left">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Markets analyzed
                </p>
                <p className="text-4xl font-bold text-white">
                  {overall.total_signals}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {overall.correct} counter-consensus hits
                </p>
              </div>
              <div className="text-center md:text-left">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Avg signal score
                </p>
                <p className="text-4xl font-bold text-amber-400">
                  {overall.avg_score}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Composite divergence strength
                </p>
              </div>
            </div>

            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-200/90 leading-relaxed">
                <span className="font-semibold">Why tight-market first?</span>{" "}
                Headline win rates on resolved signals are dominated by
                lopsided markets where the favored side wins regardless — a
                composition effect, not edge. The honest test of signal
                quality is the 40–60% band, where outcomes are genuinely
                uncertain.{" "}
                <a
                  href="/methodology"
                  className="text-amber-300 underline hover:text-amber-200"
                >
                  Full methodology →
                </a>
              </p>
            </div>

            {by_skew && (
              <div className="border-t border-gray-800 pt-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                  By market skew
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <SkewRow
                    label={SKEW_LABELS.tight}
                    data={by_skew.tight}
                    highlight
                  />
                  <SkewRow
                    label={SKEW_LABELS.moderate}
                    data={by_skew.moderate}
                  />
                  <SkewRow
                    label={SKEW_LABELS.lopsided}
                    data={by_skew.lopsided}
                  />
                  <SkewRow
                    label={SKEW_LABELS.very_lopsided}
                    data={by_skew.very_lopsided}
                  />
                </div>
              </div>
            )}

            {data.simulation && data.simulation.total_wagered > 0 && (
              <div className="border-t border-gray-800 pt-4 mt-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                  Simulated P&L ($100/signal)
                </p>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className={`text-lg font-bold ${data.simulation.roi_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {data.simulation.roi_pct >= 0 ? "+" : ""}
                      {data.simulation.roi_pct.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500">Simulated ROI</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-white">
                      ${data.simulation.total_return.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-gray-500">
                      on ${data.simulation.total_wagered.toLocaleString(undefined, { maximumFractionDigits: 0 })} wagered
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-amber-400">
                      {data.simulation.avg_odds_on_hits.toFixed(1)}x
                    </p>
                    <p className="text-xs text-gray-500">Avg odds on hits</p>
                  </div>
                </div>
              </div>
            )}

            {rolling_30d.total > 0 && (
              <div className="border-t border-gray-800 pt-4 mt-4 text-center">
                <p className="text-xs text-gray-500">
                  30-day: {rolling_30d.correct}/{rolling_30d.total} hits (
                  {(rolling_30d.win_rate * 100).toFixed(1)}%)
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
