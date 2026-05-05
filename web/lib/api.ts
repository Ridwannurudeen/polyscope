const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export async function fetchAPI<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface PredictiveContributor {
  trader_address: string;
  pct: number;
  ci_lo: number;
  ci_hi: number;
  n: number;
}

export interface DivergenceSignal {
  market_id: string;
  question: string;
  market_price: number;
  sm_consensus: number;
  divergence_pct: number;
  score: number;
  sm_trader_count: number;
  sm_direction: string;
  category: string;
  signal_source: string;
  timestamp: string;
  predictive_contributor?: PredictiveContributor | null;
}

function signalTimestampMs(signal: { timestamp?: string }): number {
  const ms = Date.parse(signal.timestamp ?? "");
  return Number.isNaN(ms) ? 0 : ms;
}

function isPreferredSignal(
  candidate: { timestamp?: string; score?: number; divergence_pct?: number },
  current: { timestamp?: string; score?: number; divergence_pct?: number },
): boolean {
  const candidateTs = signalTimestampMs(candidate);
  const currentTs = signalTimestampMs(current);
  if (candidateTs !== currentTs) return candidateTs > currentTs;

  const candidateScore = candidate.score ?? Number.NEGATIVE_INFINITY;
  const currentScore = current.score ?? Number.NEGATIVE_INFINITY;
  if (candidateScore !== currentScore) return candidateScore > currentScore;

  const candidateDiv = candidate.divergence_pct ?? Number.NEGATIVE_INFINITY;
  const currentDiv = current.divergence_pct ?? Number.NEGATIVE_INFINITY;
  return candidateDiv > currentDiv;
}

export function dedupeSignalsByMarket<
  T extends {
    market_id: string;
    timestamp?: string;
    score?: number;
    divergence_pct?: number;
  },
>(signals: readonly T[]): T[] {
  const bestByMarket = new Map<string, T>();
  for (const signal of signals) {
    const current = bestByMarket.get(signal.market_id);
    if (!current || isPreferredSignal(signal, current)) {
      bestByMarket.set(signal.market_id, signal);
    }
  }
  return Array.from(bestByMarket.values()).sort((a, b) => {
    if (isPreferredSignal(a, b)) return -1;
    if (isPreferredSignal(b, a)) return 1;
    return 0;
  });
}

export interface WhaleAlert {
  id: number;
  trader_address: string;
  trader_rank: number;
  market_id: string;
  question: string;
  side: string;
  size: number;
  price: number;
  trade_timestamp: string;
  detected_at: string;
}

export interface MarketMover {
  market_id: string;
  question: string;
  category: string;
  price_now: number;
  price_before: number;
  change_pct: number;
  timeframe: string;
  volume_24h: number;
}

export interface Market {
  condition_id: string;
  question: string;
  slug: string;
  category: string;
  price_yes: number;
  price_no: number;
  volume_24h: number;
  open_interest: number;
  liquidity: number;
}

export interface Trader {
  address: string;
  rank: number;
  profit: number;
  volume: number;
  markets_traded: number;
  name: string;
  alpha_ratio: number;
}

export interface CalibrationBucket {
  bucket_low: number;
  bucket_high: number;
  predicted_avg: number;
  actual_pct: number;
  count: number;
  brier_score: number;
}

export interface ScanResult {
  divergences: DivergenceSignal[];
  movers_24h: MarketMover[];
  total_markets: number;
  total_divergences: number;
}

export interface CalibrationData {
  overall_brier: number;
  calibration: CalibrationBucket[];
  by_category: Record<string, { brier_score: number; count: number }>;
  total_resolved: number;
}

export interface SignalAccuracyTier {
  total: number;
  correct: number;
  win_rate: number;
}

export interface PnlSimulation {
  total_wagered: number;
  total_return: number;
  roi_pct: number;
  avg_odds_on_hits: number;
}

export interface SignalAccuracy {
  overall: {
    total_signals: number;
    correct: number;
    win_rate: number;
    avg_score: number;
  };
  by_tier: {
    high: SignalAccuracyTier;
    medium: SignalAccuracyTier;
    low: SignalAccuracyTier;
  };
  by_skew: {
    very_lopsided: SignalAccuracyTier;
    lopsided: SignalAccuracyTier;
    moderate: SignalAccuracyTier;
    tight: SignalAccuracyTier;
  };
  rolling_30d: SignalAccuracyTier;
  simulation?: PnlSimulation;
}
