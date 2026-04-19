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
    bankroll ? String(bankroll) : ""
  );

  const band = skewBand(marketPrice);
  const stat = bandStats?.[band];

  if (!stat || stat.total < 10) {
    return (
      <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-500">
        <span className="uppercase text-gray-500">Sizing</span> — not enough
        resolved signals in the {BAND_LABEL[band]} band yet to suggest a size.
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
      className={`rounded-lg border p-3 ${
        edgeNegative
          ? "bg-gray-950 border-gray-800"
          : "bg-emerald-500/5 border-emerald-500/20"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 text-xs">
          <span className="uppercase text-gray-500">Sizing</span>
          <span
            className={
              edgeNegative ? "text-gray-400" : "text-emerald-300 font-semibold"
            }
          >
            Edge {k.edge_pct >= 0 ? "+" : ""}
            {k.edge_pct.toFixed(1)}%
          </span>
          <span className="text-gray-500">
            Buy {smDirection} @ {k.buy_price.toFixed(2)}
          </span>
          <span className="text-gray-500">
            p={(k.p * 100).toFixed(0)}% · CI [{(k.ci_low * 100).toFixed(0)}–
            {(k.ci_high * 100).toFixed(0)}%] · n={k.sample_total}
          </span>
        </div>
      </div>

      {edgeNegative ? (
        <p className="text-[11px] text-gray-500 mt-2">
          Conservative-CI Kelly is zero. Pass on this one.
        </p>
      ) : (
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="text-sm">
            <span className="text-gray-500 text-xs uppercase mr-2">
              ¼-Kelly
            </span>
            <span className="text-white font-semibold">
              {(k.quarter_kelly * 100).toFixed(2)}%
            </span>
            {bankroll && (
              <span className="text-emerald-400 font-semibold ml-2">
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
              className="text-xs text-emerald-400 hover:text-emerald-300 underline"
            >
              Set bankroll to see $ stake
            </button>
          )}
          {bankroll && !editing && (
            <button
              onClick={() => {
                setCustom(String(bankroll));
                setEditing(true);
              }}
              className="text-xs text-gray-500 hover:text-gray-300"
              title={`Bankroll: $${bankroll}`}
            >
              edit bankroll
            </button>
          )}

          {editing && (
            <div className="flex items-center gap-1 text-xs">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setBankroll(n);
                    setEditing(false);
                  }}
                  className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 text-gray-300 rounded hover:bg-gray-700"
                >
                  ${n >= 1000 ? `${n / 1000}K` : n}
                </button>
              ))}
              <input
                type="number"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="custom"
                className="w-20 bg-gray-950 border border-gray-700 text-white rounded px-1.5 py-0.5 text-xs"
              />
              <button
                onClick={saveCustom}
                className="px-1.5 py-0.5 bg-emerald-600 text-white rounded"
              >
                OK
              </button>
              <button
                onClick={() => {
                  setBankroll(null);
                  setEditing(false);
                }}
                className="text-gray-500 hover:text-gray-300"
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
