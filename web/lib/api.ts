const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export async function fetchAPI<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
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
  timestamp: string;
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
  rolling_30d: SignalAccuracyTier;
  simulation?: PnlSimulation;
}
