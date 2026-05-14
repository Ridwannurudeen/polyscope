import { describe, expect, it } from "vitest";
import { getContractConfig } from "@polymarket/clob-client-v2";

import { spendersForOrder } from "./onchain-allowance";

describe("spendersForOrder", () => {
  const c = getContractConfig(137);

  it("verifies just the V2 exchange for a standard market", () => {
    expect(spendersForOrder(137, false)).toEqual([c.exchangeV2]);
  });

  it("verifies the neg-risk exchange + adapter for a neg-risk market", () => {
    // Neg-risk markets settle through both the neg-risk exchange and its
    // adapter, so both must be approved before the order can rest.
    expect(spendersForOrder(137, true)).toEqual([
      c.negRiskExchangeV2,
      c.negRiskAdapter,
    ]);
  });
});
