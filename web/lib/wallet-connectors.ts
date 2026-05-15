"use client";

import type { Connector } from "wagmi";
import {
  isBackpackProvider,
  isMetaMaskProvider,
  type WalletProviderLike,
} from "./wallet-provider";

const METAMASK_CONNECTOR_IDS = new Set([
  "metaMask",
  "io.metamask",
  "io.metamask.flask",
  "io.metamask.mobile",
]);

function rdnsValues(connector: Connector): string[] {
  if (!connector.rdns) return [];
  if (typeof connector.rdns === "string") return [connector.rdns];
  return [...connector.rdns];
}

function connectorLooksLikeBackpack(connector: Connector): boolean {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  return (
    id.includes("backpack") ||
    name.includes("backpack") ||
    rdnsValues(connector).some((rdns) =>
      rdns.toLowerCase().includes("backpack"),
    )
  );
}

function connectorLooksLikeMetaMask(connector: Connector): boolean {
  if (METAMASK_CONNECTOR_IDS.has(connector.id)) return true;
  if (connector.name.toLowerCase() === "metamask") return true;
  return rdnsValues(connector).some((rdns) => METAMASK_CONNECTOR_IDS.has(rdns));
}

async function providerForConnector(
  connector: Connector,
): Promise<WalletProviderLike | undefined> {
  try {
    return (await connector.getProvider()) as WalletProviderLike | undefined;
  } catch {
    return undefined;
  }
}

export async function preferredInjectedConnector(
  connectors: readonly Connector[],
): Promise<Connector | undefined> {
  const available: { connector: Connector; provider: WalletProviderLike }[] =
    [];

  for (const connector of connectors) {
    if (connector.type !== "injected") continue;
    if (connectorLooksLikeBackpack(connector)) continue;

    const provider = await providerForConnector(connector);
    if (!provider || isBackpackProvider(provider)) continue;

    available.push({ connector, provider });
  }

  const preferred = available.find(
    ({ connector, provider }) =>
      connectorLooksLikeMetaMask(connector) || isMetaMaskProvider(provider),
  );
  return preferred?.connector ?? available[0]?.connector;
}
