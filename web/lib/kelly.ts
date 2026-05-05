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

export function signalPrice(sm_direction: string, market_price: number): number {
  return sm_direction === "YES" ? market_price : 1 - market_price;
}

export interface ExposureHint {
  p: number;
  p_safe: number;
  reference_price: number;
  historical_roi_delta_pct: number;
  full_exposure: number;
  capped_exposure: number;
  historical_roi_delta: number;
  ci_low: number;
  ci_high: number;
  sample_total: number;
}

export function exposureHint(
  sm_direction: string,
  market_price: number,
  band: BandStat
): ExposureHint {
  const p = band.win_rate;
  const [lo, hi] = wilsonInterval(band.correct, band.total);
  const p_safe = lo;
  const price = Math.max(
    0.01,
    Math.min(0.99, signalPrice(sm_direction, market_price)),
  );
  const b = (1 - price) / price;
  const roiDelta = p / price - 1;
  const fullExposure =
    b > 0 ? Math.max(0, (b * p_safe - (1 - p_safe)) / b) : 0;
  return {
    p,
    p_safe,
    reference_price: price,
    historical_roi_delta_pct: roiDelta * 100,
    full_exposure: fullExposure,
    capped_exposure: fullExposure / 4,
    historical_roi_delta: roiDelta,
    ci_low: lo,
    ci_high: hi,
    sample_total: band.total,
  };
}
