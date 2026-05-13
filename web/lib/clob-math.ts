// Pure helpers extracted from use-clob-order.ts so they can be unit-tested
// without pulling in React/wagmi/viem.

// USDC.e and outcome shares are both 6-decimal on Polygon. Math.round
// defeats IEEE-754 drift (e.g. 0.51 * 10 * 1e6 = 5100000.000000001 in JS,
// which Math.ceil rounded to 5100001 — a false 1-µunit shortfall).
export const toBaseUnits = (human: number): bigint =>
  BigInt(Math.round(human * 1_000_000));

/**
 * Parse a string into a BigInt, returning ``undefined`` if it can't be
 * parsed (rather than silently returning 0). Callers can distinguish a
 * true "balance is zero" reading from a "couldn't read the balance"
 * failure — the latter shouldn't block trading with a misleading
 * "insufficient balance" message.
 *
 * The legacy silent-0 behavior caused users to see "insufficient
 * balance" when reality was "the CLOB returned junk we couldn't parse."
 */
export const safeBigInt = (s: string | undefined): bigint | undefined => {
  if (!s) return BigInt(0);
  try {
    return BigInt(s);
  } catch {
    if (typeof console !== "undefined") {
      console.warn("safeBigInt: could not parse %o", s);
    }
    return undefined;
  }
};

/**
 * Initial share count for the trade modal — picks a number that targets
 * a sane USDC notional given the current market price, instead of always
 * showing "10 shares" which is meaningless across the 0.01–0.99 range
 * (≈$0.10 on long-tail markets, ≈$9.90 on near-resolution markets).
 *
 * Returns a string rounded to 2 decimals so it fits the `step="0.01"`
 * size input. Falls back to "10" when price isn't usable yet.
 */
export const DEFAULT_TARGET_NOTIONAL_USDC = 10;

export function defaultShareCountForNotional(
  price: number,
  notional: number = DEFAULT_TARGET_NOTIONAL_USDC,
): string {
  if (!isFinite(price) || price <= 0) return "10";
  if (!isFinite(notional) || notional <= 0) return "10";
  const shares = notional / price;
  // Round to 2 decimals to match input step
  return (Math.round(shares * 100) / 100).toFixed(2);
}

export function userFacingError(
  raw: unknown,
  fallback = "Order could not be placed. Refresh the page and try again.",
): string {
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
  return fallback;
}
