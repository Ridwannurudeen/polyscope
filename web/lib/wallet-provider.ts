"use client";

import type { EIP1193Provider } from "viem";

export type WalletProviderLike = Partial<EIP1193Provider> & {
  isBackpack?: boolean;
  isMetaMask?: boolean;
  providers?: WalletProviderLike[];
  [key: string]: unknown;
};

type WindowWithEthereum = Window & {
  ethereum?: WalletProviderLike;
};

const METAMASK_IMPERSONATOR_FLAGS = [
  "isApexWallet",
  "isAvalanche",
  "isBackpack",
  "isBitKeep",
  "isBlockWallet",
  "isKuCoinWallet",
  "isMathWallet",
  "isOkxWallet",
  "isOKExWallet",
  "isOneInchIOSWallet",
  "isOneInchAndroidWallet",
  "isOpera",
  "isPhantom",
  "isPortal",
  "isRabby",
  "isTokenPocket",
  "isTokenary",
  "isUniswapWallet",
  "isZerion",
] as const;

export function isBackpackProvider(provider: WalletProviderLike): boolean {
  return provider.isBackpack === true;
}

export function isMetaMaskProvider(provider: WalletProviderLike): boolean {
  if (provider.isMetaMask !== true) return false;
  for (const flag of METAMASK_IMPERSONATOR_FLAGS) {
    if (provider[flag]) return false;
  }
  return true;
}

export function findMetaMaskProvider(
  windowRef?: unknown,
): WalletProviderLike | undefined {
  const ethereum = (windowRef as WindowWithEthereum | undefined)?.ethereum;
  if (!ethereum) return undefined;
  if (ethereum.providers?.length) {
    return ethereum.providers.find((provider) => isMetaMaskProvider(provider));
  }
  return isMetaMaskProvider(ethereum) ? ethereum : undefined;
}
