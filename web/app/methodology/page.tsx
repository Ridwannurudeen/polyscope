"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { TableSkeleton } from "@/components/skeleton";
import { usePollingFetch } from "@/lib/hooks";

interface SkewStat {
  total: number;
  correct: number;
  win_rate_pct: number | null;
}

interface BandStat {
  n: number;
  hits: number;
  win_pct: number | null;
  roi_pct: number | null;
}

interface PredictiveFilter {
  qualifying_traders: number;
  signals: number;
  hits: number;
  win_pct: number | null;
  roi_pct: number | null;
  by_band: Record<string, BandStat>;
  baseline: {
    signals: number;
    hits: number;
    win_pct: number | null;
    roi_pct: number | null;
  };
}

interface MethodologyStats {
  signals: {
    total: number;
    resolved: number;
    correct: number;
    overall_win_rate_pct: number | null;
    first_captured: string | null;
    latest_captured: string | null;
  };
  skew_breakdown: Record<string, SkewStat>;
  resolved_markets: number;
  per_trader: {
    records_captured: number;
    traders_scored: number;
    avg_accuracy_pct: number | null;
  };
  predictive_filter?: PredictiveFilter;
}

interface BuilderIdentity {
  configured: boolean;
  code: string | null;
}

const SKEW_LABELS: Record<string, string> = {
  very_lopsided: "very lopsided · ≥90 or ≤10",
  lopsided: "lopsided · 75–90 or 10–25",
  moderate: "moderate · 60–75 or 25–40",
  tight: "tight · 40–60",
};

const SKEW_ORDER = ["tight", "moderate", "lopsided", "very_lopsided"];

function daysBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  return Math.max(
    0,
    Math.round(
      (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000,
    ),
  );
}

function colorForAccuracy(pct: number | null) {
  if (pct === null) return "text-ink-500";
  if (pct >= 70) return "text-scope-400";
  if (pct >= 50) return "text-fade-500";
  return "text-alert-500";
}

function fmtRoi(pct: number | null | undefined): string {
  if (pct == null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function pluralTraders(n: number): string {
  if (n === 0) return "none yet";
  if (n === 1) return "one trader";
  return `${n} traders`;
}

const PRED_BAND_LABELS: Record<string, string> = {
  tight: "tight · 40–60",
  moderate: "moderate",
  lopsided: "lopsided",
  very_lopsided: "very-lopsided",
};

const PRED_BAND_ORDER = ["tight", "moderate", "lopsided", "very_lopsided"];

function Section({
  num,
  eyebrow,
  title,
  children,
}: {
  num: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-14">
      <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-ink-800">
        <span className="num text-eyebrow font-mono text-ink-500 tracking-wider">
          §{num}
        </span>
        <div>
          <div className="eyebrow mb-1">{eyebrow}</div>
          <h2 className="text-h3 text-ink-100 tracking-tight">{title}</h2>
        </div>
      </div>
      <div className="text-body text-ink-300 leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface rounded-md p-4">
      <div className="eyebrow mb-2">{label}</div>
      <p className="num text-h4 text-ink-100 tracking-tight">{value}</p>
    </div>
  );
}

export default function MethodologyPage() {
  const { data, loading } = usePollingFetch<MethodologyStats>(
    "/api/methodology/stats",
    60_000,
  );
  const { data: identity } = usePollingFetch<BuilderIdentity>(
    "/api/builder/identity",
    300_000,
  );

  const spanDays = daysBetween(
    data?.signals?.first_captured,
    data?.signals?.latest_captured,
  );

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <section className="mb-12 pb-10 border-b border-ink-800">
        <div className="eyebrow mb-3">reference · methodology</div>
        <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight mb-3">
          how polyscope measures
        </h1>
        <p className="text-body-lg text-ink-300 leading-relaxed max-w-2xl">
          How signals are generated, what the backtests actually say, and an
          honest accounting of where the edge is — and isn&apos;t.
        </p>
      </section>

      <Section
        num="1"
        eyebrow="framing · the wrong ranking"
        title="the problem with a P&L leaderboard"
      >
        <p>
          Polymarket ranks traders publicly by profit. Profit is not the same
          as being predictive. A trader can be profitable from a handful of
          oversized wins while being systematically wrong on most of their
          diverse positions — including the ones where they disagree with the
          market.
        </p>
        <p>
          PolyScope asks a narrower, more useful question: when top-ranked
          traders take positions that diverge from the market price, does their
          direction agree with how the market eventually resolves?
        </p>
      </Section>

      <Section
        num="2"
        eyebrow="pipeline · signal generation"
        title="how signals are generated"
      >
        <ol className="space-y-2 list-decimal list-inside marker:text-ink-500 marker:font-mono">
          <li>
            Every 5 minutes, scan 500 active Polymarket markets meeting
            liquidity thresholds (≥$50K open interest, ≥$10K 24h volume).
          </li>
          <li>
            For each market, fetch current positions held by the top-100 ranked
            traders from Polymarket&apos;s leaderboard.
          </li>
          <li>
            Compute a weighted consensus: each trader&apos;s implied YES
            probability is weighted by inverse rank × alpha ratio × log-scaled
            size × category-skill multiplier.
          </li>
          <li>
            If the gap between consensus and market price exceeds 10% and the
            composite signal score passes threshold, emit a signal. For the top
            ~80 candidates we refine using trade-weighted consensus with a 24h
            exponential half-life decay.
          </li>
          <li>
            Persist per-signal, per-trader attribution: who held which
            direction, at what size, with what weight. This is the foundation
            of per-trader accuracy scoring.
          </li>
        </ol>
      </Section>

      <Section
        num="3"
        eyebrow="findings · skew-band breakdown"
        title="the honest findings"
      >
        <p>
          The first ~98K resolved signals were where the original strategy
          was finalized: we flipped the aggregate SM direction universally
          (after finding raw consensus was anti-predictive at 8.3%). The
          flipped strategy hit 96% at the headline level — but a follow-up
          per-skew backtest showed that was almost entirely a composition
          effect from heavily lopsided markets. (Capture has since grown
          past 139K resolved signals; the live numbers above always reflect
          the current dataset.)
        </p>
        <p>
          The per-skew breakdown forced a correction. On{" "}
          <span className="text-ink-100 font-medium">tight 40–60% markets</span>,
          fading SM lost 0 of 17 unique markets. On moderate, 3 of 21. SM was
          actually predictive when it dissented on those bands — going{" "}
          <em>with</em> SM would have won. On very-lopsided markets (≥90% or
          ≤10%), fading gives a near-100% hit rate but ~0% ROI — the favorite
          almost always wins anyway.
        </p>
        <p>
          The live strategy now follows that finding:{" "}
          <span className="text-ink-100 font-medium">
            fade SM on very-lopsided (composition play), follow SM everywhere
            else (real alpha).
          </span>{" "}
          On the 1,556-market backtest at finalization, this flipped net ROI
          from −2.6% to +3.9% at the same 97% headline hit rate. §4 below
          shows live filter performance against the current dataset.
        </p>
        <p className="mt-4">The per-band breakdown after correction:</p>

        {loading ? (
          <TableSkeleton rows={4} />
        ) : (
          <div className="surface rounded-lg overflow-x-auto mt-2">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-4 py-3">market skew</th>
                  <th className="eyebrow text-right px-4 py-3">signals</th>
                  <th className="eyebrow text-right px-4 py-3">
                    win rate · current strategy
                  </th>
                </tr>
              </thead>
              <tbody>
                {SKEW_ORDER.map((skew) => {
                  const row = data?.skew_breakdown?.[skew];
                  return (
                    <tr
                      key={skew}
                      className="border-b border-ink-800/60 last:border-0"
                    >
                      <td className="px-4 py-3 text-ink-100 font-mono">
                        {SKEW_LABELS[skew]}
                      </td>
                      <td className="px-4 py-3 text-right font-mono num text-ink-300">
                        {row ? row.total.toLocaleString() : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono num font-medium ${colorForAccuracy(
                          row?.win_rate_pct ?? null,
                        )}`}
                      >
                        {row?.win_rate_pct != null
                          ? `${row.win_rate_pct.toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4">
          Headline hit rate is a misleading summary when the sample is
          dominated by one skew band. We report it because it is what people
          ask for; per-band numbers and ROI are what actually matter.
        </p>
      </Section>

      <Section
        num="4"
        eyebrow="filter · predictive-backed"
        title="the predictive-contributor filter"
      >
        <p>
          Aggregating top-100 traders into a single consensus hides per-trader
          skill. We score each contributor individually on their resolved
          divergent positions. A trader qualifies as{" "}
          <em>predictive</em> when all three hold: at least 30 resolved
          observations, point accuracy above 50% (genuinely above coin flip),
          and a Wilson-95%-CI lower bound ≥ 40% (not purely noise).
        </p>
        {data?.predictive_filter ? (
          <p>
            On{" "}
            <span className="text-ink-100 font-medium num">
              {data.predictive_filter.baseline.signals.toLocaleString()}
            </span>{" "}
            backtested signals, restricting to signals backed by at least one
            predictive contributor leaves{" "}
            <span className="text-ink-100 font-medium num">
              {data.predictive_filter.signals.toLocaleString()} signals at{" "}
              {data.predictive_filter.win_pct?.toFixed(1) ?? "—"}% hit rate
              and {fmtRoi(data.predictive_filter.roi_pct)} simulated ROI
            </span>
            {" "}— compared to {fmtRoi(data.predictive_filter.baseline.roi_pct)}{" "}
            ROI on the unfiltered set.
          </p>
        ) : (
          <p className="text-ink-500">Computing live filter performance…</p>
        )}
        <p>
          An earlier version used only the CI-lower gate and misreported a
          much rosier ROI. The issue: high-volume anti-predictive traders
          (47.5% accuracy on 1,000+ observations) have a Wilson-CI lower bound
          that still crosses 40%, so they cleared the gate and appeared on
          nearly every signal. Requiring the point estimate itself to be above
          50% restores the filter&apos;s meaning.
        </p>
        {data?.predictive_filter?.by_band &&
        Object.keys(data.predictive_filter.by_band).length > 0 ? (
          <>
            <p>
              The filter concentrates into tight and moderate markets where
              aggregation is weakest and individual conviction matters most:
            </p>
            <ul className="space-y-1 list-disc list-inside marker:text-ink-500 text-body-sm font-mono">
              {PRED_BAND_ORDER.map((band) => {
                const b = data.predictive_filter!.by_band[band];
                if (!b) return null;
                return (
                  <li key={band}>
                    <span className="num text-ink-100">
                      {PRED_BAND_LABELS[band]}
                    </span>{" "}
                    — {b.hits}/{b.n}, {fmtRoi(b.roi_pct)} ROI
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <p>
          Caveats: the eligible-contributor list is currently short —{" "}
          <span className="text-ink-100 font-medium num">
            {pluralTraders(data?.predictive_filter?.qualifying_traders ?? 0)}
          </span>{" "}
          cleared the 40% Wilson-lower threshold at time of writing. The
          filter&apos;s value grows as per-trader observations accumulate.
          Signals are tagged{" "}
          <span className="inline-block px-1.5 py-[2px] border border-scope-500/35 bg-scope-500/8 text-scope-300 text-eyebrow font-mono rounded-sm uppercase tracking-wider">
            predictive-backed
          </span>{" "}
          when they qualify.
        </p>
      </Section>

      <Section
        num="5"
        eyebrow="validated · what the data supports"
        title="what the data does support"
      >
        <p>Three findings hold up:</p>
        <ol className="space-y-2 list-decimal list-inside marker:text-ink-500 marker:font-mono">
          <li>
            <span className="text-ink-100 font-medium">
              Polymarket&apos;s P&amp;L leaderboard is not a predictive-skill
              leaderboard.
            </span>{" "}
            Top-ranked-by-profit traders cluster near 45–55% individual
            accuracy on divergent signals. Most are not reliably predictive.
          </li>
          <li>
            <span className="text-ink-100 font-medium">
              A handful of individuals clear a meaningful edge.
            </span>{" "}
            <span className="num text-ink-100">
              {pluralTraders(
                data?.predictive_filter?.qualifying_traders ?? 0,
              )}
            </span>{" "}
            currently have Wilson-CI lower bounds above 40% on 30+ resolved
            observations. This is the population the predictive filter
            surfaces.
          </li>
          <li>
            <span className="text-ink-100 font-medium">
              Aggregation changes the picture per-band.
            </span>{" "}
            Weighted consensus of top-100 traders is predictive enough to
            overcome individual noise on tight and moderate markets; it is
            composition-bound on very-lopsided markets.
          </li>
        </ol>
        <p>
          The per-trader leaderboard is on{" "}
          <Link
            href="/traders"
            className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
          >
            /traders
          </Link>{" "}
          — predictive ↔ anti-predictive, with sample sizes and confidence
          intervals shown so you can weigh the evidence yourself.
        </p>
      </Section>

      <Section num="6" eyebrow="state · right now" title="live dataset">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBlock
            label="signals"
            value={
              loading ? "…" : (data?.signals.total ?? 0).toLocaleString()
            }
          />
          <StatBlock
            label="resolved"
            value={
              loading ? "…" : (data?.signals.resolved ?? 0).toLocaleString()
            }
          />
          <StatBlock
            label="markets"
            value={
              loading
                ? "…"
                : (data?.resolved_markets ?? 0).toLocaleString()
            }
          />
          <StatBlock label="span" value={loading ? "…" : `${spanDays}d`} />
          <StatBlock
            label="per-trader records"
            value={
              loading
                ? "…"
                : (data?.per_trader.records_captured ?? 0).toLocaleString()
            }
          />
          <StatBlock
            label="traders scored"
            value={
              loading
                ? "…"
                : (data?.per_trader.traders_scored ?? 0).toLocaleString()
            }
          />
          <div className="surface rounded-md p-4 col-span-2">
            <div className="eyebrow mb-2">
              overall win rate · live strategy
            </div>
            <p
              className={`num text-h4 tracking-tight ${colorForAccuracy(
                data?.signals.overall_win_rate_pct ?? null,
              )}`}
            >
              {loading
                ? "…"
                : data?.signals.overall_win_rate_pct != null
                  ? `${data.signals.overall_win_rate_pct.toFixed(1)}%`
                  : "—"}{" "}
              <span className="text-caption text-ink-500 font-mono font-normal">
                · composition-weighted, see §3
              </span>
            </p>
          </div>
        </div>
      </Section>

      <Section
        num="7"
        eyebrow="on-chain · attribution"
        title="builder identity"
      >
        <p>
          PolyScope is a registered Polymarket builder. Our builder code is a
          public <code className="text-micro bg-surface border border-ink-800 px-1.5 py-0.5 rounded-sm font-mono text-ink-100">bytes32</code>{" "}
          identifier tied to our builder profile; orders routed through
          PolyScope carry this code and attribute volume to us on-chain.
        </p>
        {identity?.configured && identity.code ? (
          <div className="surface rounded-md p-4 mt-3">
            <div className="eyebrow mb-2">builder code</div>
            <p className="font-mono text-body-sm text-scope-400 break-all num">
              {identity.code}
            </p>
          </div>
        ) : (
          <div className="surface rounded-md p-4 text-body-sm text-ink-400 font-mono mt-3">
            builder code not configured on this deployment
          </div>
        )}
        <p className="text-caption text-ink-400 mt-2">
          Full transparency page with live order log:{" "}
          <Link
            href="/builder"
            className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
          >
            /builder
          </Link>
          .
        </p>
      </Section>

      <Section
        num="8"
        eyebrow="constraints · known-unknowns"
        title="limitations we are honest about"
      >
        <ul className="space-y-2 list-disc list-inside marker:text-ink-500">
          <li>
            Per-trader accuracy capture began April 12, 2026. Early per-address
            samples are small — treat anything below n=25 as preliminary.
          </li>
          <li>
            Resolved-outcome coverage depends on Polymarket&apos;s market-close
            cadence. Fast-resolution markets (sports, daily prices) dominate
            the resolved sample; long-horizon markets are underweighted.
          </li>
          <li>
            Signals are generated every 5 minutes. By construction they cannot
            capture intraday micro-structure or react faster than that.
          </li>
          <li>
            Category labels come from Polymarket&apos;s tags and are
            inconsistent across similar markets.
          </li>
          <li>
            PolyScope offers an optional non-custodial order-routing UI. Your
            wallet signs every order locally and submits directly to
            Polymarket; PolyScope never holds keys or funds. Signals are
            research, not trading advice. Past accuracy does not imply future
            performance. See{" "}
            <Link
              href="/terms"
              className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
            >
              /terms
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Disclaimer />
    </div>
  );
}
