"use client";

import Link from "next/link";
import { MarkCrosshair } from "@/components/logo";
import { PolymarketLogo } from "@/components/polymarket-logo";
import { usePollingFetch } from "@/lib/hooks";
import { dedupeSignalsByMarket } from "@/lib/api";
import type { DivergenceSignal, ScanResult } from "@/lib/api";

interface MethodologyStats {
  predictive_filter?: {
    qualifying_traders: number;
    signals: number;
    win_pct: number | null;
    roi_pct: number | null;
  };
}

interface AccuracyTrader {
  trader_address: string;
  accuracy_pct: number;
  correct_predictions: number;
  total_divergent_signals: number;
}

interface PLTrader {
  rank: number;
  address: string;
  name: string | null;
  profit: number;
  volume: number;
  alpha_ratio: number | null;
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

interface HeroSignatureProps {
  scan?: ScanResult | null;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatRoi(pct: number | null | undefined): string {
  if (pct == null) return "loading";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatPct(value: number | null | undefined) {
  if (value == null) return "--";
  return `${Math.round(value * 100)}%`;
}

function clampPct(value: number) {
  return Math.max(3, Math.min(97, value * 100));
}

function signalTone(signal: DivergenceSignal) {
  return signal.sm_direction === "YES" ? "text-scope-400" : "text-fade-500";
}

export function HeroSignature({ scan }: HeroSignatureProps) {
  const { data: stats, loading: statsLoading } =
    usePollingFetch<MethodologyStats>("/api/methodology/stats", 300_000);
  const { data: compare } = usePollingFetch<CompareResponse>(
    "/api/leaderboards/compare?limit=8&min_signals=5",
    120_000,
  );

  const signals = dedupeSignalsByMarket(scan?.divergences || []).slice(0, 5);
  const filter = stats?.predictive_filter;
  const visibleMarkets = scan
    ? new Set((scan.divergences || []).map((signal) => signal.market_id)).size
    : null;
  // `??` not `&&` — a successful scan with zero markets is meaningful
  // ("all aligned today"), not a missing-data signal.
  const reportedMarkets =
    typeof scan?.total_markets === "number" && scan.total_markets > 0
      ? scan.total_markets
      : null;
  const markets = reportedMarkets ?? visibleMarkets;
  const activeSignals = scan?.total_divergences ?? null;
  const filterSignals = filter?.signals ?? null;
  const overlap = compare?.overlap?.count ?? null;

  return (
    <section className="w-full min-w-0 pt-1 md:pt-4 pb-8 md:pb-10 mb-8 border-b border-ink-800">
      <div className="w-full min-w-0 grid grid-cols-1 xl:grid-cols-[minmax(0,0.88fr)_minmax(520px,1.12fr)] gap-8 xl:gap-10 items-start">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2.5 mb-5 text-ink-400">
            <span className="relative inline-flex h-7 w-7 items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-scope-500/30 bg-scope-500/8" />
              <MarkCrosshair size={18} className="relative text-ink-300" />
            </span>
            <span className="eyebrow text-scope-500">polyscope scope view</span>
            <span className="hidden sm:inline text-micro font-mono text-ink-500">
              live trader-accuracy terminal
            </span>
          </div>

          <h1 className="max-w-full text-[32px] sm:text-h1 md:text-display lg:text-display-xl xl:text-display text-ink-100 tracking-tightest leading-[1.04] lg:leading-[0.98] text-balance">
            Polymarket traders, ranked by{" "}
            <span className="text-scope-400">accuracy,</span>{" "}
            <span className="text-ink-400">not profit.</span>
          </h1>

          <p className="mt-4 md:mt-5 max-w-2xl text-body md:text-body-lg text-ink-400 leading-relaxed text-pretty">
            PolyScope watches where top traders break from market consensus,
            then scores whether those breaks resolve into signal or noise.
          </p>

          <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <HeroMetric
              label="markets"
              value={markets !== null ? markets.toLocaleString() : "--"}
              sub={reportedMarkets !== null ? "priced live" : "with rifts"}
            />
            <HeroMetric
              label="signals"
              value={activeSignals !== null ? activeSignals.toLocaleString() : "--"}
              sub="active rifts"
            />
            <HeroMetric
              label="filter sample"
              value={filterSignals !== null ? filterSignals.toLocaleString() : "--"}
              sub={statsLoading ? "warming" : "qualified"}
            />
            <HeroMetric
              label="backtest roi"
              value={formatRoi(filter?.roi_pct)}
              sub="methodology"
              accent={
                filter?.roi_pct == null
                  ? undefined
                  : filter.roi_pct >= 0
                    ? "scope"
                    : "fade"
              }
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 text-caption sm:text-body-sm font-mono">
            <Link
              href="/compare"
              className="inline-flex items-center gap-2 text-ink-200 hover:text-scope-400 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-scope-500 animate-pulse-subtle" />
              compare profit vs accuracy
            </Link>
            <Link
              href="/methodology"
              className="text-ink-500 hover:text-ink-200 transition-colors"
            >
              methodology -&gt;
            </Link>
            <a
              href="https://polymarket.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-ink-500 hover:text-ink-200 transition-colors group"
              title="Markets, prices, positions and resolutions sourced from Polymarket"
            >
              <span className="eyebrow">data via</span>
              <PolymarketLogo
                variant="full"
                height={12}
                className="opacity-75 group-hover:opacity-100 transition-opacity"
              />
            </a>
          </div>

          <div className="hidden md:grid mt-8 grid-cols-3 gap-3">
            <ProofChip
              label="ranking overlap"
              value={overlap !== null ? String(overlap) : "--"}
              note="profit top vs accuracy top"
            />
            <ProofChip
              label="qualifying traders"
              value={filter ? String(filter.qualifying_traders) : "--"}
              note="minimum sample enforced"
            />
            <ProofChip
              label="orders"
              value="non-custodial"
              note="wallet signs directly"
            />
          </div>
        </div>

        <ScopeInstrument signals={signals} compare={compare ?? undefined} />
      </div>
    </section>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "scope" | "fade";
}) {
  const valueTone =
    accent === "scope"
      ? "text-scope-400"
      : accent === "fade"
        ? "text-fade-500"
        : "text-ink-100";
  return (
    <div className="surface rounded-md px-3 py-3 min-w-0">
      <div className="eyebrow mb-2 truncate">{label}</div>
      <div className={`num text-h3 leading-none tracking-tighter ${valueTone}`}>
        {value}
      </div>
      <div className="text-micro text-ink-500 font-mono mt-1.5 truncate">
        {sub}
      </div>
    </div>
  );
}

function ProofChip({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="border border-ink-800 bg-background/50 rounded-md px-3 py-2.5">
      <div className="eyebrow text-ink-500 mb-1">{label}</div>
      <div className="num text-body-sm text-ink-100 font-medium truncate">
        {value}
      </div>
      <div className="text-micro text-ink-500 font-mono mt-1 truncate">
        {note}
      </div>
    </div>
  );
}

function ScopeInstrument({
  signals,
  compare,
}: {
  signals: DivergenceSignal[];
  compare?: CompareResponse;
}) {
  const primary = signals[0];
  const bestAccuracy = compare?.accuracy_top[0];
  const bestProfit = compare?.pl_leaderboard[0];
  const missingFromProfit = compare?.accuracy_top_missing_from_pl?.length ?? 0;
  const miniRows: (DivergenceSignal | null)[] = signals.length
    ? signals.slice(1, 5)
    : Array.from({ length: 4 }, () => null);

  return (
    <div className="relative min-w-0 surface rounded-lg overflow-hidden shadow-elevated">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-scope-500/20" />
      <div className="absolute right-8 top-8 text-ink-700/70">
        <MarkCrosshair size={150} />
      </div>

      <div className="relative p-4 md:p-5 border-b border-ink-800 flex items-center justify-between gap-4">
        <div>
          <div className="eyebrow text-scope-500 mb-1">scope view</div>
          <h2 className="text-h3 md:text-h2 text-ink-100 tracking-tight leading-tight">
            consensus rift monitor
          </h2>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-micro font-mono text-ink-500">
          <span className="relative inline-flex">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-scope-500" />
            <span className="absolute inset-0 inline-block w-1.5 h-1.5 rounded-full bg-scope-500 animate-ping opacity-60" />
          </span>
          live
        </div>
      </div>

      <div className="relative p-4 md:p-5">
        {primary ? (
          <PrimaryRift signal={primary} />
        ) : (
          <div className="rounded-md border border-ink-800 bg-background/45 p-4 min-h-[150px] flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-10 w-10 rounded-full border border-scope-500/30 bg-scope-500/8 flex items-center justify-center text-ink-400">
                <MarkCrosshair size={24} />
              </div>
              <p className="text-body-sm font-mono text-ink-400">
                waiting for live divergence tape
              </p>
            </div>
          </div>
        )}

        <div className="mt-4 min-w-0 grid grid-cols-1 lg:grid-cols-[1fr_0.85fr] gap-4">
          <div className="min-w-0 rounded-md border border-ink-800 overflow-hidden">
            <div className="px-3 py-2 border-b border-ink-800 flex items-center justify-between">
              <span className="eyebrow">active rifts</span>
              <span className="num text-micro text-ink-500">
                {signals.length || "--"}
              </span>
            </div>
            <div className="divide-y divide-ink-800/70">
              {miniRows.map(
                (signal, index) =>
                  signal ? (
                    <SignalMiniRow
                      key={signal.market_id}
                      signal={signal}
                      index={index + 2}
                    />
                  ) : (
                    <div key={index} className="px-3 py-3">
                      <div className="shimmer h-3 w-5/6 rounded-sm mb-2" />
                      <div className="shimmer h-2 w-1/2 rounded-sm opacity-70" />
                    </div>
                  ),
              )}
            </div>
          </div>

          <div className="min-w-0 rounded-md border border-ink-800 bg-background/45 p-3">
            <div className="eyebrow mb-3">profit vs accuracy</div>
            <ContrastLine
              label="profit leader"
              value={bestProfit?.name || (bestProfit ? shortAddr(bestProfit.address) : "--")}
              sub={
                bestProfit
                  ? `$${bestProfit.profit.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}`
                  : "loading"
              }
              tone="neutral"
            />
            <ContrastLine
              label="accuracy leader"
              value={
                bestAccuracy ? shortAddr(bestAccuracy.trader_address) : "--"
              }
              sub={
                bestAccuracy
                  ? `${bestAccuracy.accuracy_pct.toFixed(0)}% (${bestAccuracy.correct_predictions}/${bestAccuracy.total_divergent_signals})`
                  : "loading"
              }
              tone="scope"
            />
            <div className="mt-3 pt-3 border-t border-ink-800">
              <div className="num text-h2 tracking-tighter text-fade-500">
                {compare ? missingFromProfit : "--"}
              </div>
              <div className="text-micro text-ink-500 font-mono leading-snug">
                accuracy leaders missing from the profit list
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrimaryRift({ signal }: { signal: DivergenceSignal }) {
  return (
    <Link
      href={`/market/${signal.market_id}`}
      className="block rounded-md border border-scope-500/25 bg-scope-500/5 p-4 hover:border-scope-500/45 transition-colors"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow text-scope-500 mb-2">largest live rift</div>
          <h3 className="text-h3 text-ink-100 tracking-tight leading-snug line-clamp-2">
            {signal.question}
          </h3>
        </div>
        <div className="text-right shrink-0">
          <div className="num text-h1 sm:text-display tracking-tightest text-fade-500 leading-none">
            {(signal.divergence_pct * 100).toFixed(0)}%
          </div>
          <div className="text-micro text-ink-500 font-mono mt-1">
            divergence
          </div>
        </div>
      </div>

      <RiftScale signal={signal} />

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniStat label="crowd" value={formatPct(signal.market_price)} />
        <MiniStat
          label="polyscope"
          value={`${signal.sm_direction} ${formatPct(signal.sm_consensus)}`}
          tone={signal.sm_direction === "YES" ? "scope" : "fade"}
        />
        <MiniStat
          label="contributors"
          value={String(signal.sm_trader_count)}
        />
      </div>
    </Link>
  );
}

function RiftScale({ signal }: { signal: DivergenceSignal }) {
  const crowd = clampPct(signal.market_price);
  const scope = clampPct(signal.sm_consensus);
  return (
    <div className="mt-5">
      <div className="relative h-10">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-ink-700" />
        <div
          className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-ink-300 rounded-sm"
          style={{ left: `${crowd}%` }}
        />
        <div
          className={`absolute top-1/2 h-6 w-1 -translate-y-1/2 rounded-sm ${
            signal.sm_direction === "YES" ? "bg-scope-500" : "bg-fade-500"
          }`}
          style={{ left: `${scope}%` }}
        />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-fade-500/25"
          style={{
            left: `${Math.min(crowd, scope)}%`,
            width: `${Math.max(4, Math.abs(scope - crowd))}%`,
          }}
        />
      </div>
      <div className="flex items-center justify-between text-micro font-mono text-ink-500">
        <span>0%</span>
        <span>crowd / polyscope gap</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "scope" | "fade";
}) {
  const valueTone =
    tone === "scope"
      ? "text-scope-400"
      : tone === "fade"
        ? "text-fade-500"
        : "text-ink-100";
  return (
    <div className="border border-ink-800 bg-background/55 rounded-md px-3 py-2">
      <div className="eyebrow text-ink-500 mb-1">{label}</div>
      <div className={`num text-body font-medium truncate ${valueTone}`}>
        {value}
      </div>
    </div>
  );
}

function SignalMiniRow({
  signal,
  index,
}: {
  signal: DivergenceSignal;
  index: number;
}) {
  return (
    <Link
      href={`/market/${signal.market_id}`}
      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 row-hover"
    >
      <span className="num text-micro text-ink-500">
        {String(index).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <p className="text-body-sm text-ink-100 truncate">{signal.question}</p>
        <p className="text-micro font-mono text-ink-500 truncate">
          crowd {formatPct(signal.market_price)} - ps{" "}
          <span className={signalTone(signal)}>
            {signal.sm_direction} {formatPct(signal.sm_consensus)}
          </span>
        </p>
      </div>
      <span className="num text-body font-medium text-fade-500">
        {(signal.divergence_pct * 100).toFixed(0)}%
      </span>
    </Link>
  );
}

function ContrastLine({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "scope" | "neutral";
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-micro font-mono text-ink-500 uppercase tracking-wider">
          {label}
        </span>
        <span
          className={`num text-body-sm font-medium truncate ${
            tone === "scope" ? "text-scope-400" : "text-ink-100"
          }`}
        >
          {value}
        </span>
      </div>
      <div className="mt-1 text-right text-micro font-mono text-ink-500 truncate">
        {sub}
      </div>
    </div>
  );
}
