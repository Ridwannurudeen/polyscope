"use client";

import { useState } from "react";
import { useBankroll } from "@/lib/bankroll";
import {
  kellySuggestion,
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
        not enough resolved signals in the {BAND_LABEL[band]} band yet to
        suggest a size.
      </div>
    );
  }

  const k = kellySuggestion(smDirection, marketPrice, stat);
  const edgeNegative = k.edge_pct <= 0 || k.quarter_kelly <= 0;

  const saveCustom = () => {
    const n = parseFloat(custom);
    if (Number.isFinite(n) && n > 0) setBankroll(n);
    setEditing(false);
  };

  const stake = bankroll && !edgeNegative ? bankroll * k.quarter_kelly : 0;

  return (
    <div
      className={`rounded-md border px-3.5 py-3 ${
        edgeNegative
          ? "border-ink-800 bg-background"
          : "border-scope-500/25 bg-scope-500/5"
      }`}
    >
      <div className="flex items-baseline gap-3 flex-wrap text-caption font-mono">
        <span className="eyebrow">sizing</span>
        <span
          className={`num font-medium ${
            edgeNegative ? "text-ink-400" : "text-scope-300"
          }`}
        >
          edge {k.edge_pct >= 0 ? "+" : ""}
          {k.edge_pct.toFixed(1)}%
        </span>
        <span className="text-ink-400">
          buy <span className="num text-ink-200">{smDirection}</span> @{" "}
          <span className="num text-ink-200">{k.buy_price.toFixed(2)}</span>
        </span>
        <span className="text-ink-500">
          p=<span className="num">{(k.p * 100).toFixed(0)}%</span> · CI [
          <span className="num">{(k.ci_low * 100).toFixed(0)}–{(k.ci_high * 100).toFixed(0)}%</span>
          ] · n=<span className="num">{k.sample_total}</span>
        </span>
      </div>

      {edgeNegative ? (
        <p className="text-micro text-ink-500 font-mono mt-2">
          conservative-CI Kelly is zero · pass.
        </p>
      ) : (
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <div className="flex items-baseline gap-2 text-body-sm">
            <span className="eyebrow">¼-kelly</span>
            <span className="num text-ink-100 font-medium">
              {(k.quarter_kelly * 100).toFixed(2)}%
            </span>
            {bankroll && (
              <span className="num text-scope-400 font-medium">
                ≈ $
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
              set bankroll →
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
              <button
                onClick={saveCustom}
                className="btn-primary h-6 px-2"
              >
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
