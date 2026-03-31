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
              Win rates will appear once enough data is collected.
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="text-center">
            <p className="text-4xl font-bold text-emerald-400">
              {(overall.win_rate * 100).toFixed(1)}%
            </p>
            <p className="text-sm text-gray-400 mt-1">Win Rate</p>
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-white">
              {overall.total_signals}
            </p>
            <p className="text-sm text-gray-400 mt-1">Unique Markets</p>
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-white">{overall.correct}</p>
            <p className="text-sm text-gray-400 mt-1">Correct Calls</p>
          </div>
        </div>
        )}

        {!collecting && (
          <>
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
                      <p className="text-xs text-gray-500">{t.total} signals</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {rolling_30d.total > 0 && (
              <div className="border-t border-gray-800 pt-4 mt-4 text-center">
                <p className="text-xs text-gray-500">
                  30-day: {(rolling_30d.win_rate * 100).toFixed(1)}% win rate (
                  {rolling_30d.correct}/{rolling_30d.total})
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
