"use client";

import { usePollingFetch } from "@/lib/hooks";
import type { SignalAccuracy } from "@/lib/api";

export function SignalTrackRecord() {
  const { data } = usePollingFetch<SignalAccuracy>(
    "/api/signals/accuracy",
    300_000
  );

  if (!data || !data.overall) return null;

  const { overall, by_tier, rolling_30d } = data;
  const collecting = overall.total_signals < 10;

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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-4">
              <div className="text-center">
                <p className="text-4xl font-bold text-white">
                  {overall.total_signals}
                </p>
                <p className="text-sm text-gray-400 mt-1">Markets Analyzed</p>
              </div>
              <div className="text-center">
                <p className="text-4xl font-bold text-emerald-400">
                  {overall.correct}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  Counter-Consensus Hits
                </p>
              </div>
              <div className="text-center">
                <p className="text-4xl font-bold text-white">
                  {(overall.win_rate * 100).toFixed(1)}%
                </p>
                <p className="text-sm text-gray-400 mt-1">Hit Rate</p>
              </div>
              <div className="text-center">
                <p className="text-4xl font-bold text-amber-400">
                  {overall.avg_score}
                </p>
                <p className="text-sm text-gray-400 mt-1">Avg Signal Score</p>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-400">
                Counter-consensus signals identify where smart money disagrees
                with the market. In efficient markets, the crowd is usually right
                &mdash; a low hit rate is expected. The value is in catching the
                mispriced outliers where top traders see what the market
                doesn&apos;t.
              </p>
            </div>

            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                By Confidence Tier
              </p>
              <div className="grid grid-cols-3 gap-4 text-center">
                {(["high", "medium", "low"] as const).map((tier) => {
                  const t = by_tier[tier];
                  return (
                    <div key={tier}>
                      <p className="text-sm text-gray-400 capitalize">{tier}</p>
                      <p className="text-lg font-bold text-white">
                        {t.total > 0
                          ? `${(t.win_rate * 100).toFixed(0)}%`
                          : "\u2014"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t.correct}/{t.total} markets
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

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
