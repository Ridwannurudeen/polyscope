// Pure helpers extracted from use-clob-order.ts so they can be unit-tested
// without pulling in React/wagmi/viem.

// USDC.e and outcome shares are both 6-decimal on Polygon. Math.round
// defeats IEEE-754 drift (e.g. 0.51 * 10 * 1e6 = 5100000.000000001 in JS,
// which Math.ceil rounded to 5100001 — a false 1-µunit shortfall).
export const toBaseUnits = (human: number): bigint =>
  BigInt(Math.round(human * 1_000_000));

export const safeBigInt = (s: string | undefined): bigint => {
  if (!s) return BigInt(0);
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
};

export function userFacingError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const lower = msg.toLowerCase();
  if (/could not create api key/.test(lower)) {
    return "This wallet has no Polymarket account. Sign up at polymarket.com with this wallet, then reconnect.";
  }
  if (
    /user (rejected|denied)/.test(lower) ||
    /signature.*rejected/.test(lower)
  ) {
    return "Signature rejected in wallet.";
  }
  if (/tick.*size/.test(lower)) {
    return "Price doesn't match this market's tick size. Adjust and retry.";
  }
  if (/min(imum)?.*(order|size)/.test(lower)) {
    return "Order is below this market's minimum size.";
  }
  if (/network|fetch failed|econn/.test(lower)) {
    return "Network error reaching Polymarket. Try again.";
  }
  return "Order could not be placed. Refresh the page and try again.";
}
