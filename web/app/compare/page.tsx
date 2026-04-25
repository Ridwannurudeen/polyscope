"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { TableSkeleton } from "@/components/skeleton";
import { usePollingFetch } from "@/lib/hooks";

interface PLTrader {
  rank: number;
  address: string;
  name: string | null;
  profit: number;
  volume: number;
  alpha_ratio: number | null;
}

interface AccuracyTrader {
  trader_address: string;
  accuracy_pct: number;
  correct_predictions: number;
  total_divergent_signals: number;
}

interface CompareResponse {
  pl_leaderboard: PLTrader[];
  accuracy_top: AccuracyTrader[];
  accuracy_fade: AccuracyTrader[];
  overlap: {
    addresses: string[];
    count: number;
    overlap_pct_of_accuracy_top: number | null;
  };
  pl_top_in_fade_list: PLTrader[];
  accuracy_top_missing_from_pl: AccuracyTrader[];
  min_signals: number;
  limit: number;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function colorForAccuracy(pct: number) {
  if (pct >= 70) return "text-scope-400";
  if (pct >= 50) return "text-fade-500";
  return "text-alert-500";
}

export default function ComparePage() {
  const { data, loading } = usePollingFetch<CompareResponse>(
    "/api/leaderboards/compare?limit=25&min_signals=5",
    120_000,
  );

  if (loading) {
    return (
      <div>
        <div className="mb-10 pb-10 border-b border-ink-800">
          <div className="h-3 w-24 bg-ink-800 rounded-sm mb-3 animate-pulse-subtle" />
          <div className="h-9 w-72 bg-ink-800 rounded-sm animate-pulse-subtle" />
        </div>
        <TableSkeleton rows={10} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-body-sm text-ink-400 font-mono py-16 text-center">
        comparison data unavailable
      </div>
    );
  }

  const overlapAddresses = new Set(
    data.overlap.addresses.map((a) => a.toLowerCase()),
  );

  return (
    <div>
      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="eyebrow mb-3">compare · two ranks</div>
        <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight">
          p&amp;l vs accuracy
        </h1>
        <p className="text-body-lg text-ink-300 mt-3 max-w-2xl leading-relaxed">
          Polymarket ranks traders by profit. PolyScope ranks them by how
          often their positions match resolved outcomes when they diverge from
          the crowd. These are not the same thing.
        </p>
      </section>

      <section className="mb-10">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="surface rounded-md p-4">
            <div className="eyebrow mb-2">
              p&amp;l top {data.limit}
            </div>
            <p className="num text-h3 text-ink-100 tracking-tight">
              {data.pl_leaderboard.length}
            </p>
            <p className="text-micro text-ink-500 font-mono mt-1.5">
              addresses ranked
            </p>
          </div>
          <div className="surface rounded-md p-4">
            <div className="eyebrow mb-2">
              accuracy top {data.limit}
            </div>
            <p className="num text-h3 text-ink-100 tracking-tight">
              {data.accuracy_top.length}
            </p>
            <p className="text-micro text-ink-500 font-mono mt-1.5">
              with ≥<span className="num">{data.min_signals}</span> signals
            </p>
          </div>
          <div className="surface rounded-md p-4">
            <div className="eyebrow mb-2">overlap</div>
            <p className="num text-h3 text-fade-500 tracking-tight">
              {data.overlap.count}
              {data.overlap.overlap_pct_of_accuracy_top != null && (
                <span className="text-caption text-ink-400 ml-2 font-normal num">
                  ({data.overlap.overlap_pct_of_accuracy_top.toFixed(0)}%)
                </span>
              )}
            </p>
            <p className="text-micro text-ink-500 font-mono mt-1.5">
              addresses on both lists
            </p>
          </div>
        </div>
      </section>

      <section className="mb-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="eyebrow mb-1.5">polymarket · profit</div>
          <p className="text-caption text-ink-400 mb-3">
            ranked by total profit
          </p>
          <div className="surface rounded-lg overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">#</th>
                  <th className="eyebrow text-left px-3 py-3">trader</th>
                  <th className="eyebrow text-right px-3 py-3">profit</th>
                </tr>
              </thead>
              <tbody>
                {data.pl_leaderboard.map((t) => {
                  const isOverlap = overlapAddresses.has(
                    t.address.toLowerCase(),
                  );
                  return (
                    <tr
                      key={t.address}
                      className={`border-b border-ink-800/60 last:border-0 row-hover ${isOverlap ? "bg-scope-500/5" : ""}`}
                    >
                      <td className="px-3 py-3 text-ink-500 font-mono num w-8">
                        {t.rank}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/traders/${t.address}`}
                          className={`font-mono num text-body-sm hover:text-scope-400 transition-colors ${isOverlap ? "text-scope-400" : "text-ink-100"}`}
                        >
                          {t.name || shortAddr(t.address)}
                        </Link>
                        {isOverlap && (
                          <span className="ml-2 text-eyebrow font-mono text-scope-500 uppercase tracking-wider">
                            ✓
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-scope-400 font-mono num font-medium">
                        $
                        {t.profit.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="eyebrow mb-1.5">polyscope · accuracy</div>
          <p className="text-caption text-ink-400 mb-3">
            ranked by hit rate when diverging from market
          </p>
          <div className="surface rounded-lg overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">#</th>
                  <th className="eyebrow text-left px-3 py-3">trader</th>
                  <th className="eyebrow text-right px-3 py-3">accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.accuracy_top.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-4 text-body-sm text-ink-500 font-mono"
                    >
                      building leaderboard · needs more resolved signals
                    </td>
                  </tr>
                ) : (
                  data.accuracy_top.map((t, i) => {
                    const isOverlap = overlapAddresses.has(
                      t.trader_address.toLowerCase(),
                    );
                    return (
                      <tr
                        key={t.trader_address}
                        className={`border-b border-ink-800/60 last:border-0 row-hover ${isOverlap ? "bg-scope-500/5" : ""}`}
                      >
                        <td className="px-3 py-3 text-ink-500 font-mono num w-8">
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/traders/${t.trader_address}`}
                            className={`font-mono num text-body-sm hover:text-scope-400 transition-colors ${isOverlap ? "text-scope-400" : "text-ink-100"}`}
                          >
                            {shortAddr(t.trader_address)}
                          </Link>
                          {isOverlap && (
                            <span className="ml-2 text-eyebrow font-mono text-scope-500 uppercase tracking-wider">
                              ✓
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-mono num font-medium ${colorForAccuracy(t.accuracy_pct)}`}
                        >
                          {t.accuracy_pct.toFixed(0)}%
                          <span className="text-micro text-ink-500 ml-1.5 font-normal">
                            ({t.correct_predictions}/{t.total_divergent_signals})
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="eyebrow mb-1.5">divergence · profitable but wrong</div>
          <p className="text-caption text-ink-400 mb-3">
            high-profit traders whose divergent positions are wrong more often
            than right
          </p>
          <div className="surface rounded-lg">
            {data.pl_top_in_fade_list.length === 0 ? (
              <p className="px-4 py-4 text-body-sm text-ink-500 font-mono">
                no overlap with the fade list yet
              </p>
            ) : (
              <table className="w-full text-body-sm">
                <tbody>
                  {data.pl_top_in_fade_list.map((t) => (
                    <tr
                      key={t.address}
                      className="border-b border-ink-800/60 last:border-0 row-hover"
                    >
                      <td className="px-3 py-3 text-ink-500 font-mono num w-12">
                        #{t.rank}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/traders/${t.address}`}
                          className="text-ink-100 font-mono num hover:text-alert-500 transition-colors"
                        >
                          {t.name || shortAddr(t.address)}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right text-alert-500 font-mono text-eyebrow uppercase tracking-wider">
                        on fade list
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow mb-1.5">overlooked · accuracy + invisible</div>
          <p className="text-caption text-ink-400 mb-3">
            predictive traders the p&amp;l ranking misses
          </p>
          <div className="surface rounded-lg">
            {data.accuracy_top_missing_from_pl.length === 0 ? (
              <p className="px-4 py-4 text-body-sm text-ink-500 font-mono">
                nothing missing · the two rankings align here
              </p>
            ) : (
              <table className="w-full text-body-sm">
                <tbody>
                  {data.accuracy_top_missing_from_pl.map((t) => (
                    <tr
                      key={t.trader_address}
                      className="border-b border-ink-800/60 last:border-0 row-hover"
                    >
                      <td className="px-3 py-3">
                        <Link
                          href={`/traders/${t.trader_address}`}
                          className="text-ink-100 font-mono num hover:text-scope-400 transition-colors"
                        >
                          {shortAddr(t.trader_address)}
                        </Link>
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono num font-medium ${colorForAccuracy(t.accuracy_pct)}`}
                      >
                        {t.accuracy_pct.toFixed(0)}%
                        <span className="text-micro text-ink-500 ml-1.5 font-normal">
                          ({t.correct_predictions}/{t.total_divergent_signals})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="mb-12 surface rounded-lg p-5">
        <p className="text-body-sm text-ink-300 leading-relaxed">
          <span className="text-ink-100 font-medium">why this matters.</span>{" "}
          P&amp;L can be driven by a handful of oversized wins or by trading
          high-volume markets with thin edges. Predictive accuracy is the
          orthogonal question — does this trader&apos;s direction match how
          markets actually resolve? When you&apos;re looking for signal,
          that&apos;s the question that matters. See the{" "}
          <Link
            href="/methodology"
            className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
          >
            full methodology
          </Link>{" "}
          for how this is measured and the honest caveats.
        </p>
      </section>

      <Disclaimer />
    </div>
  );
}
