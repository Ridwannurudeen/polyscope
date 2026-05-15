import { describe, expect, it } from "vitest";
import type { Connector } from "wagmi";

import { preferredInjectedConnector } from "./wallet-connectors";
import type { WalletProviderLike } from "./wallet-provider";

function connector({
  id,
  name,
  provider,
  rdns,
}: {
  id: string;
  name: string;
  provider?: WalletProviderLike;
  rdns?: string | string[];
}): Connector {
  return {
    id,
    name,
    rdns,
    type: "injected",
    getProvider: async () => provider,
  } as unknown as Connector;
}

describe("preferredInjectedConnector", () => {
  it("skips an unavailable MetaMask-target connector and uses EIP-6963 MetaMask", async () => {
    const unavailableTarget = connector({
      id: "metaMask",
      name: "MetaMask",
    });
    const eip6963MetaMask = connector({
      id: "io.metamask",
      name: "MetaMask",
      provider: { isMetaMask: true },
      rdns: "io.metamask",
    });

    await expect(
      preferredInjectedConnector([unavailableTarget, eip6963MetaMask]),
    ).resolves.toBe(eip6963MetaMask);
  });

  it("does not choose Backpack even when it claims isMetaMask", async () => {
    const backpack = connector({
      id: "app.backpack",
      name: "Backpack",
      provider: { isMetaMask: true, isBackpack: true },
    });
    const metamask = connector({
      id: "io.metamask",
      name: "MetaMask",
      provider: { isMetaMask: true },
    });

    await expect(
      preferredInjectedConnector([backpack, metamask]),
    ).resolves.toBe(metamask);
  });

  it("returns undefined when no injected provider is available", async () => {
    await expect(
      preferredInjectedConnector([
        connector({ id: "metaMask", name: "MetaMask" }),
      ]),
    ).resolves.toBeUndefined();
  });
});
