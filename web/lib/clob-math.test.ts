import { describe, expect, it } from "vitest";

import {
  DEFAULT_TARGET_NOTIONAL_USDC,
  defaultShareCountForNotional,
  safeBigInt,
  toBaseUnits,
  userFacingError,
} from "./clob-math";

describe("toBaseUnits", () => {
  it("handles round-number BUY notionals without IEEE-754 drift", () => {
    // The regression: 0.51 * 10 = 5.1 in math, 5.100000000000001 in JS.
    // Math.ceil(5.1 * 1e6) was 5100001 (false 1-µUSDC shortfall);
    // Math.round gives 5100000.
    expect(toBaseUnits(0.51 * 10)).toBe(BigInt(5_100_000));
  });

  it("rounds half-microunit values to nearest", () => {
    expect(toBaseUnits(1.0000005)).toBe(BigInt(1_000_001));
    expect(toBaseUnits(1.0000004)).toBe(BigInt(1_000_000));
  });

  it("converts whole-USDC values exactly", () => {
    expect(toBaseUnits(1)).toBe(BigInt(1_000_000));
    expect(toBaseUnits(0)).toBe(BigInt(0));
    expect(toBaseUnits(1234)).toBe(BigInt(1_234_000_000));
  });

  it("handles small 0.001-tick share fractions without false-shortfall", () => {
    // 0.5 shares of an outcome token (a real edge case on tick-0.001 markets).
    expect(toBaseUnits(0.5)).toBe(BigInt(500_000));
    // Previously Math.ceil(0.5 * 1e6) could return 500001 on some inputs.
    expect(toBaseUnits(0.0005)).toBe(BigInt(500));
  });
});

describe("defaultShareCountForNotional", () => {
  it("targets $10 USDC at common market prices", () => {
    // 10 / 0.51 ≈ 19.61
    expect(defaultShareCountForNotional(0.51)).toBe("19.61");
    // 10 / 0.05 = 200.00
    expect(defaultShareCountForNotional(0.05)).toBe("200.00");
    // 10 / 0.99 ≈ 10.10
    expect(defaultShareCountForNotional(0.99)).toBe("10.10");
    // 10 / 0.5 = 20.00
    expect(defaultShareCountForNotional(0.5)).toBe("20.00");
  });

  it("honors a custom target notional", () => {
    // 25 / 0.5 = 50.00
    expect(defaultShareCountForNotional(0.5, 25)).toBe("50.00");
  });

  it("falls back to 10 for zero/negative/non-finite price", () => {
    expect(defaultShareCountForNotional(0)).toBe("10");
    expect(defaultShareCountForNotional(-0.5)).toBe("10");
    expect(defaultShareCountForNotional(NaN)).toBe("10");
    expect(defaultShareCountForNotional(Infinity)).toBe("10");
  });

  it("falls back to 10 for zero/negative notional", () => {
    expect(defaultShareCountForNotional(0.5, 0)).toBe("10");
    expect(defaultShareCountForNotional(0.5, -5)).toBe("10");
  });

  it("default target is $10", () => {
    expect(DEFAULT_TARGET_NOTIONAL_USDC).toBe(10);
  });
});

describe("safeBigInt", () => {
  it("returns 0 for undefined or empty string (an actual zero-balance read)", () => {
    expect(safeBigInt(undefined)).toBe(BigInt(0));
    expect(safeBigInt("")).toBe(BigInt(0));
  });

  it("parses numeric strings", () => {
    expect(safeBigInt("12345")).toBe(BigInt(12345));
    expect(safeBigInt("0")).toBe(BigInt(0));
  });

  it("returns undefined on unparseable input so callers can distinguish 'couldn't read' from 'zero'", () => {
    // Previous silent-0 behavior misled the trade modal into showing
    // "insufficient balance" when reality was "we couldn't parse what
    // the CLOB returned." Returning undefined makes that distinguishable.
    expect(safeBigInt("not-a-number")).toBeUndefined();
    expect(safeBigInt("1.5")).toBeUndefined(); // BigInt("1.5") throws
  });
});

describe("userFacingError", () => {
  it("maps create-api-key failure to onboarding hint", () => {
    expect(userFacingError(new Error("Could not create API key"))).toMatch(
      /sign up at polymarket\.com/i,
    );
  });

  it("maps user-rejected signatures to a short message", () => {
    expect(userFacingError(new Error("User rejected the request"))).toBe(
      "Signature rejected in wallet.",
    );
    expect(
      userFacingError(new Error("User denied transaction signature")),
    ).toBe("Signature rejected in wallet.");
    expect(userFacingError(new Error("Signature rejected by user"))).toBe(
      "Signature rejected in wallet.",
    );
  });

  it("maps tick-size errors to a tick-size hint", () => {
    expect(userFacingError(new Error("invalid tick size"))).toMatch(
      /tick size/i,
    );
    expect(
      userFacingError(new Error("price not a multiple of tick_size")),
    ).toMatch(/tick size/i);
  });

  it("maps minimum-order errors to a min-size hint", () => {
    expect(userFacingError(new Error("Order below minimum size"))).toMatch(
      /minimum size/i,
    );
    expect(userFacingError(new Error("min order is 5 USDC"))).toMatch(
      /minimum size/i,
    );
  });

  it("maps network errors to a network hint", () => {
    expect(userFacingError(new Error("fetch failed"))).toMatch(/network/i);
    expect(userFacingError(new Error("ECONNREFUSED"))).toMatch(/network/i);
    expect(userFacingError(new Error("Network request failed"))).toMatch(
      /network/i,
    );
  });

  it("maps balance/allowance rejections to a deposit+approve hint", () => {
    // The CLOB rejects with this exact string; "Refresh the page" advice
    // was actively misleading for what is really a funding/approval gap.
    expect(
      userFacingError(new Error("not enough balance / allowance")),
    ).toMatch(/deposit usdc\.e and approve/i);
    expect(userFacingError(new Error("insufficient allowance"))).toMatch(
      /deposit usdc\.e and approve/i,
    );
  });

  it("surfaces the real detail for unknown errors instead of hiding it", () => {
    // Regression: the old `return fallback` discarded the CLOB's actual
    // rejection reason, collapsing every failure to a dead-end message.
    expect(userFacingError(new Error("some weird internal error"))).toBe(
      "Order could not be placed. Refresh the page and try again. (some weird internal error)",
    );
  });

  it("honors a custom fallback for non-order call sites (e.g. approval)", () => {
    const APPROVAL_FALLBACK =
      "Approval failed. Refresh the page and try again.";
    expect(
      userFacingError(
        new Error("some weird internal error"),
        APPROVAL_FALLBACK,
      ),
    ).toBe(`${APPROVAL_FALLBACK} (some weird internal error)`);
    // Matched branches still take precedence over the fallback.
    expect(userFacingError(new Error("user rejected"), APPROVAL_FALLBACK)).toBe(
      "Signature rejected in wallet.",
    );
  });

  it("accepts non-Error values via String() coercion", () => {
    expect(userFacingError("user rejected")).toBe(
      "Signature rejected in wallet.",
    );
    expect(userFacingError(undefined)).toBe(
      "Order could not be placed. Refresh the page and try again.",
    );
  });
});
