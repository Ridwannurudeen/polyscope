import { describe, expect, it } from "vitest";

import { findMetaMaskProvider, isMetaMaskProvider } from "./wallet-provider";

describe("wallet provider selection", () => {
  it("accepts MetaMask providers", () => {
    expect(isMetaMaskProvider({ isMetaMask: true })).toBe(true);
  });

  it("rejects Backpack providers that impersonate MetaMask", () => {
    expect(isMetaMaskProvider({ isMetaMask: true, isBackpack: true })).toBe(
      false,
    );
  });

  it("finds MetaMask from a multi-provider window", () => {
    const backpack = { isMetaMask: true, isBackpack: true };
    const metamask = { isMetaMask: true };
    expect(
      findMetaMaskProvider({
        ethereum: { providers: [backpack, metamask] },
      } as unknown as Window),
    ).toBe(metamask);
  });
});
