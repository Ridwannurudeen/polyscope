"use client";

import { useMemo, useState } from "react";
import { DecisionCard } from "@/components/decision-card";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { TableSkeleton } from "@/components/skeleton";
import { WhaleFlow } from "@/components/whale-flow";
import { usePollingFetch } from "@/lib/hooks";
import type { Trader, DivergenceSignal } from "@/lib/api";

type DirectionFilter = "all" | "YES" | "NO";
type SkewFilter = "all" | "tight" | "moderate" | "lopsided" | "very_lopsided";
type TierFilter = "all" | "tier1" | "tier2" | "tier3plus";

function skewBand(price: number): SkewFilter {
  if (price >= 0.9 || price <= 0.1) return "very_lopsided";
  if (price >= 0.75 || price <= 0.25) return "lopsided";
  if (price >= 0.6 || price <= 0.4) return "moderate";
  return "tight";
}

function tierBucket(score: number): TierFilter {
  if (score >= 80) return "tier1";
  if (score >= 60) return "tier2";
  return "tier3plus";
}

interface LeaderboardResponse {
  traders: Trader[];
  count: number;
}

interface DivergencesResponse {
  signals: DivergenceSignal[];
  count: number;
}

interface HistorySignal {
  market_id: string;
  question: string;
  sm_direction: string;
  market_price: number;
  sm_consensus: number;
  outcome_correct: number | null;
  timestamp: string;
}

interface HistoryResponse {
  history: HistorySignal[];
  count: number;
}

export default function SmartMoneyPage() {
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [skew, setSkew] = useState<SkewFilter>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [category, setCategory] = useState<string>("all");
  const [predictiveOnly, setPredictiveOnly] = useState(false);

  const {
    data: lbData,
    loading: lbLoading,
    error: lbError,
    lastUpdated,
    retry,
  } = usePollingFetch<LeaderboardResponse>(
    "/api/smart-money/leaderboard",
    60_000,
  );

  const { data: divData } = usePollingFetch<DivergencesResponse>(
    "/api/divergences",
    60_000,
  );

  const { data: histData } = usePollingFetch<HistoryResponse>(
    "/api/divergences/history?limit=50",
    60_000,
  );

  const traders = lbData?.traders || [];
  const divergences = divData?.signals || [];
  const history = histData?.history || [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const d of divergences) {
      const c = (d.category || "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [divergences]);

  const filtered = useMemo(() => {
    return divergences.filter((d) => {
      if (direction !== "all" && d.sm_direction !== direction) return false;
      if (skew !== "all" && skewBand(d.market_price) !== skew) return false;
      if (tier !== "all" && tierBucket(d.score) !== tier) return false;
      if (category !== "all" && (d.category || "") !== category) return false;
      if (predictiveOnly && !d.predictive_contributor) return false;
      return true;
    });
  }, [divergences, direction, skew, tier, category, predictiveOnly]);

  const resetFilters = () => {
    setDirection("all");
    setSkew("all");
    setTier("all");
    setCategory("all");
    setPredictiveOnly(false);
  };

  const filtersActive =
    direction !== "all" ||
    skew !== "all" ||
    tier !== "all" ||
    category !== "all" ||
    predictiveOnly;

  const predictiveCount = divergences.filter(
    (d) => d.predictive_contributor,
  ).length;

  if (lbLoading) {
    return (
      <div>
        <div className="mb-10 pb-10 border-b border-ink-800">
          <div className="h-3 w-24 bg-ink-800 rounded-sm mb-5 animate-pulse-subtle" />
          <div className="h-10 w-80 bg-ink-800 rounded-sm mb-3 animate-pulse-subtle" />
          <div className="h-4 w-96 bg-ink-800/70 rounded-sm animate-pulse-subtle" />
        </div>
        <TableSkeleton rows={10} />
      </div>
    );
  }

  if (lbError && !lbData) {
    return (
      <div className="text-center py-16">
        <p className="text-alert-500 font-mono text-body-sm mb-4">
          failed to load smart-money data
        </p>
        <button onClick={retry} className="btn-secondary">
          retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* HERO */}
      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="flex items-start justify-between gap-8 mb-2">
          <div className="max-w-3xl">
            <div className="eyebrow mb-3 text-scope-500">signals · realtime</div>
            <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight">
              smart money feed
            </h1>
            <p className="text-body-lg text-ink-300 mt-3 max-w-2xl leading-relaxed">
              Top-trader rankings and counter-consensus signals with per-contributor
              accuracy. Every decision card shows the evidence under the claim.
            </p>
          </div>
          <LastUpdated lastUpdated={lastUpdated} error={lbError} retry={retry} />
        </div>
      </section>

      {/* Whale Flow */}
      <section className="mb-12">
        <WhaleFlow />
      </section>

      {/* Active divergences */}
      {divergences.length > 0 && (
        <section className="mb-12">
          <div className="flex items-end justify-between mb-5 pb-3 border-b border-ink-800 flex-wrap gap-3">
            <div>
              <div className="eyebrow mb-2">realtime · divergence feed</div>
              <h2 className="text-h3 text-ink-100 tracking-tight">
                active divergences{" "}
                <span className="num text-ink-500 font-normal tracking-normal">
                  {filtered.length} / {divergences.length}
                </span>
              </h2>
            </div>
            {filtersActive && (
              <button onClick={resetFilters} className="btn-ghost">
                clear filters
              </button>
            )}
          </div>

          {/* Filter bar */}
          <div className="surface rounded-lg p-3 mb-4 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setPredictiveOnly(!predictiveOnly)}
              className={`btn ${
                predictiveOnly
                  ? "bg-scope-500/15 border border-scope-500/45 text-scope-300"
                  : "border border-ink-700 text-ink-400 hover:text-ink-100 hover:border-ink-600"
              }`}
              title="Backtest · predictive-backed signals: +14.9% ROI on 33 signals vs +4.2% unfiltered"
            >
              predictive-backed only
              {predictiveCount > 0 && (
                <span className="ml-1.5 num opacity-70">
                  ({predictiveCount})
                </span>
              )}
            </button>

            <FilterSelect
              label="direction"
              value={direction}
              onChange={(v) => setDirection(v as DirectionFilter)}
              options={[
                { value: "all", label: "all" },
                { value: "YES", label: "yes only" },
                { value: "NO", label: "no only" },
              ]}
            />
            <FilterSelect
              label="tier"
              value={tier}
              onChange={(v) => setTier(v as TierFilter)}
              options={[
                { value: "all", label: "all" },
                { value: "tier1", label: "tier 1 · ≥80" },
                { value: "tier2", label: "tier 2 · 60–79" },
                { value: "tier3plus", label: "tier 3+ · <60" },
              ]}
            />
            <FilterSelect
              label="skew"
              value={skew}
              onChange={(v) => setSkew(v as SkewFilter)}
              options={[
                { value: "all", label: "all" },
                { value: "tight", label: "tight · 40–60" },
                { value: "moderate", label: "moderate" },
                { value: "lopsided", label: "lopsided" },
                { value: "very_lopsided", label: "very lopsided" },
              ]}
            />
            {categories.length > 1 && (
              <FilterSelect
                label="category"
                value={category}
                onChange={setCategory}
                options={[
                  { value: "all", label: "all" },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
              />
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="surface rounded-lg p-10 text-center">
              <p className="text-body-sm text-ink-400 font-mono mb-3">
                no signals match current filters
              </p>
              <button
                onClick={resetFilters}
                className="text-body-sm text-scope-500 hover:text-scope-400 font-mono"
              >
                clear filters
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((d, i) => (
                <DecisionCard key={d.market_id + i} signal={d} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Resolved signals */}
      {history.length > 0 && (
        <section className="mb-12">
          <div className="mb-5 pb-3 border-b border-ink-800">
            <div className="eyebrow mb-2">ledger · resolved</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">resolved signals</h2>
          </div>
          <div className="surface rounded-lg overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-4 py-3">date</th>
                  <th className="eyebrow text-left px-4 py-3">market</th>
                  <th className="eyebrow text-center px-4 py-3">sm called</th>
                  <th className="eyebrow text-center px-4 py-3">crowd</th>
                  <th className="eyebrow text-center px-4 py-3">correct</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr
                    key={h.market_id + i}
                    className="border-b border-ink-800/60 last:border-0 row-hover"
                  >
                    <td className="px-4 py-3 text-ink-400 text-caption font-mono num whitespace-nowrap">
                      {new Date(h.timestamp).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-ink-100 truncate max-w-[360px]">
                      {h.question}
                    </td>
                    <td
                      className={`px-4 py-3 text-center font-mono num ${
                        h.sm_direction === "YES"
                          ? "text-scope-400"
                          : "text-alert-500"
                      }`}
                    >
                      {h.sm_direction}
                    </td>
                    <td className="px-4 py-3 text-center font-mono num text-ink-300">
                      {(h.market_price * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-3 text-center font-mono">
                      {h.outcome_correct === 1 ? (
                        <span className="text-scope-500">✓</span>
                      ) : h.outcome_correct === 0 ? (
                        <span className="text-alert-500">✗</span>
                      ) : (
                        <span className="text-ink-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Leaderboard by profit */}
      <section>
        <div className="mb-5 pb-3 border-b border-ink-800">
          <div className="eyebrow mb-2">supporting · by p&amp;l</div>
          <h2 className="text-h3 text-ink-100 tracking-tight">
            top traders · profit
          </h2>
          <p className="text-caption text-ink-400 mt-1">
            Polymarket&apos;s native ranking. Not what we rank by — see the{" "}
            <a
              href="/traders"
              className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
            >
              predictive leaderboard
            </a>{" "}
            for accuracy-ranked.
          </p>
        </div>
        <div className="surface rounded-lg overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-ink-800">
                <th className="eyebrow text-left px-4 py-3">rank</th>
                <th className="eyebrow text-left px-4 py-3">trader</th>
                <th className="eyebrow text-right px-4 py-3">profit</th>
                <th className="eyebrow text-right px-4 py-3">volume</th>
                <th className="eyebrow text-right px-4 py-3">alpha</th>
              </tr>
            </thead>
            <tbody>
              {traders.slice(0, 50).map((t) => {
                const alpha = (t.alpha_ratio || 0) * 100;
                const alphaClass =
                  alpha > 5
                    ? "text-scope-400"
                    : alpha > 1
                      ? "text-fade-500"
                      : "text-ink-500";
                return (
                  <tr
                    key={t.address}
                    className="border-b border-ink-800/60 last:border-0 row-hover"
                  >
                    <td className="px-4 py-3 text-ink-500 num font-mono">
                      #{t.rank}
                    </td>
                    <td className="px-4 py-3 text-ink-100 font-medium">
                      {t.name ||
                        `${t.address.slice(0, 6)}…${t.address.slice(-4)}`}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono num ${
                        t.profit >= 0 ? "text-scope-400" : "text-alert-500"
                      }`}
                    >
                      $
                      {t.profit.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono num text-ink-300">
                      $
                      {t.volume.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono num font-medium ${alphaClass}`}
                    >
                      {alpha.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-ink-700 text-ink-100 text-body-sm font-mono rounded-md px-2 py-1 focus:outline-none focus:border-scope-500/50 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
