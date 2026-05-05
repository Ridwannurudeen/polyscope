"use client";

import { useState } from "react";
import { useBankroll } from "@/lib/bankroll";
import {
  exposureHint,
  skewBand,
  type BandStat,
  type SkewBand,
} from "@/lib/kelly";

const PRESETS = [100, 500, 1000, 5000, 10000];

const BAND_LABEL: Record<SkewBand, string> = {
  tight: "tight",
  moderate: "moderate",
  lopsided: "lopsided",
  very_lopsided: "very-lopsided",
};

export function SizeHint({
  marketPrice,
  smDirection,
  bandStats,
}: {
  marketPrice: number;
  smDirection: string;
  bandStats: Partial<Record<SkewBand, BandStat>> | null;
}) {
  const { bankroll, setBankroll } = useBankroll();
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState<string>(
    bankroll ? String(bankroll) : "",
  );

  const band = skewBand(marketPrice);
  const stat = bandStats?.[band];

  if (!stat || stat.total < 10) {
    return (
      <div className="border border-ink-800 bg-background rounded-md px-3 py-2.5 text-caption text-ink-400 font-mono">
        <span className="eyebrow mr-2">sizing</span>
        not enough resolved signals in the {BAND_LABEL[band]} band yet to show
        exposure context.
      </div>
    );
  }

  const hint = exposureHint(smDirection, marketPrice, stat);
  const hasPositiveHistory =
    hint.historical_roi_delta_pct > 0 && hint.capped_exposure > 0;

  const saveCustom = () => {
    const n = parseFloat(custom);
    if (Number.isFinite(n) && n > 0) setBankroll(n);
    setEditing(false);
  };

  const stake =
    bankroll && hasPositiveHistory ? bankroll * hint.capped_exposure : 0;

  return (
    <div
      className={`rounded-md border px-3.5 py-3 ${
        hasPositiveHistory ? "border-scope-500/30" : "border-ink-800"
      }`}
    >
      <div className="flex items-baseline gap-3 flex-wrap text-caption font-mono">
        <span className="eyebrow">exposure context</span>
        <span
          className={`num font-medium ${
            hasPositiveHistory ? "text-scope-300" : "text-ink-400"
          }`}
        >
          hist ROI {hint.historical_roi_delta_pct >= 0 ? "+" : ""}
          {hint.historical_roi_delta_pct.toFixed(1)}%
        </span>
        <span className="text-ink-400">
          signal <span className="num text-ink-200">{smDirection}</span> @{" "}
          <span className="num text-ink-200">
            {hint.reference_price.toFixed(2)}
          </span>
        </span>
        <span className="text-ink-500">
          p=<span className="num">{(hint.p * 100).toFixed(0)}%</span> / CI [
          <span className="num">
            {(hint.ci_low * 100).toFixed(0)}-
            {(hint.ci_high * 100).toFixed(0)}%
          </span>
          ] / n=<span className="num">{hint.sample_total}</span>
        </span>
      </div>

      {!hasPositiveHistory ? (
        <p className="text-micro text-ink-500 font-mono mt-2">
          historical band record is not positive at this price.
        </p>
      ) : (
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <div className="flex items-baseline gap-2 text-body-sm">
            <span className="eyebrow">sim cap</span>
            <span className="num text-ink-100 font-medium">
              {(hint.capped_exposure * 100).toFixed(2)}%
            </span>
            {bankroll && (
              <span className="num text-scope-400 font-medium">
                ~= $
                {stake.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            )}
          </div>

          {!bankroll && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-body-sm text-scope-500 hover:text-scope-400 font-mono underline underline-offset-2"
            >
              set bankroll
            </button>
          )}
          {bankroll && !editing && (
            <button
              onClick={() => {
                setCustom(String(bankroll));
                setEditing(true);
              }}
              className="text-body-sm text-ink-500 hover:text-ink-300 font-mono"
              title={`Bankroll: $${bankroll}`}
            >
              edit bankroll
            </button>
          )}

          {editing && (
            <div className="flex items-center gap-1.5 text-eyebrow font-mono">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setBankroll(n);
                    setEditing(false);
                  }}
                  className="px-2 py-1 border border-ink-700 text-ink-300 rounded-sm hover:text-ink-100 hover:border-ink-600 num"
                >
                  ${n >= 1000 ? `${n / 1000}k` : n}
                </button>
              ))}
              <input
                type="number"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="custom"
                className="w-20 bg-background border border-ink-700 text-ink-100 rounded-sm px-2 py-1 text-body-sm font-mono focus:outline-none focus:border-scope-500/50"
              />
              <button onClick={saveCustom} className="btn-primary h-6 px-2">
                ok
              </button>
              <button
                onClick={() => {
                  setBankroll(null);
                  setEditing(false);
                }}
                className="text-ink-500 hover:text-ink-300 px-1.5"
                title="Clear bankroll"
              >
                clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
