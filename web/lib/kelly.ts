export type SkewBand = "tight" | "moderate" | "lopsided" | "very_lopsided";

export interface BandStat {
  total: number;
  correct: number;
  win_rate: number;
}

export function skewBand(price: number): SkewBand {
  if (price >= 0.9 || price <= 0.1) return "very_lopsided";
  if (price >= 0.75 || price <= 0.25) return "lopsided";
  if (price >= 0.6 || price <= 0.4) return "moderate";
  return "tight";
}

const Z_95 = 1.959963984540054;

export function wilsonInterval(
  correct: number,
  total: number
): [number, number] {
  if (total <= 0) return [0, 0];
  const p = correct / total;
  const z = Z_95;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
    denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function buyPrice(sm_direction: string, market_price: number): number {
  return sm_direction === "YES" ? market_price : 1 - market_price;
}

export interface KellyResult {
  p: number;
  p_safe: number;
  buy_price: number;
  edge_pct: number;
  full_kelly: number;
  quarter_kelly: number;
  ev_per_dollar: number;
  ci_low: number;
  ci_high: number;
  sample_total: number;
}

export function kellySuggestion(
  sm_direction: string,
  market_price: number,
  band: BandStat
): KellyResult {
  const p = band.win_rate;
  const [lo, hi] = wilsonInterval(band.correct, band.total);
  // Use lower bound so sample uncertainty reduces stake — conservative Kelly.
  const p_safe = lo;
  const bp = Math.max(0.01, Math.min(0.99, buyPrice(sm_direction, market_price)));
  const b = (1 - bp) / bp;
  const ev = p / bp - 1;
  const fullKelly = b > 0 ? Math.max(0, (b * p_safe - (1 - p_safe)) / b) : 0;
  return {
    p,
    p_safe,
    buy_price: bp,
    edge_pct: ev * 100,
    full_kelly: fullKelly,
    quarter_kelly: fullKelly / 4,
    ev_per_dollar: ev,
    ci_low: lo,
    ci_high: hi,
    sample_total: band.total,
  };
}
