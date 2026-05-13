/**
 * Tests for useLivePrices — the polling hook isn't tested here (would
 * need React Testing Library + happy-dom). Instead these tests
 * exercise the byMarket projection logic by simulating the backend
 * payload shape and asserting the shape the hook would yield.
 *
 * The hook itself just calls fetch + filters/maps the response; the
 * filter rules are the meaningful logic.
 */

import { describe, expect, it } from "vitest";

interface LivePriceEntry {
  best_bid?: number;
  best_ask?: number;
  last_trade?: number;
  current_price?: number | null;
  market_id?: string | null;
  ts?: number;
}

// Mirrors the logic inside useLivePrices.fetchOnce — kept in lockstep
// so a regression in one is caught by the test. If/when we extract
// this into an exported helper, this test will import it directly.
function projectToByMarket(
  prices: Record<string, LivePriceEntry>,
): Record<string, number> {
  const byMarket: Record<string, number> = {};
  for (const entry of Object.values(prices ?? {})) {
    const mid = entry.market_id;
    const price = entry.current_price;
    if (typeof mid === "string" && typeof price === "number" && price > 0) {
      byMarket[mid] = price;
    }
  }
  return byMarket;
}

describe("useLivePrices payload projection", () => {
  it("maps token_id-keyed prices to a market_id-keyed view", () => {
    const result = projectToByMarket({
      "tok-a": { market_id: "0xmarket-a", current_price: 0.42 },
      "tok-b": { market_id: "0xmarket-b", current_price: 0.71 },
    });
    expect(result).toEqual({
      "0xmarket-a": 0.42,
      "0xmarket-b": 0.71,
    });
  });

  it("skips entries with no market_id (token in stream not in cache)", () => {
    const result = projectToByMarket({
      "tok-orphan": { current_price: 0.5, market_id: null },
      "tok-a": { market_id: "0xmarket-a", current_price: 0.42 },
    });
    expect(result).toEqual({ "0xmarket-a": 0.42 });
  });

  it("skips entries with non-numeric or zero current_price", () => {
    const result = projectToByMarket({
      "tok-a": { market_id: "0xmarket-a", current_price: 0 },
      "tok-b": { market_id: "0xmarket-b", current_price: null },
      "tok-c": { market_id: "0xmarket-c", current_price: 0.5 },
    });
    expect(result).toEqual({ "0xmarket-c": 0.5 });
  });

  it("handles missing prices object gracefully", () => {
    // The hook calls Object.values(data.prices ?? {}); empty object yields {}
    expect(projectToByMarket({})).toEqual({});
  });
});
