"use client";

import { useMemo } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { polygon } from "wagmi/chains";
import { RelayClient } from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";

const RELAYER_URL =
  process.env.NEXT_PUBLIC_POLYMARKET_RELAYER_URL ||
  "https://relayer-v2.polymarket.com/";

// The relative path of the backend HMAC sign endpoint. Resolved against
// window.location.origin at call time so the same build runs in dev,
// staging, and prod without an env var rebake.
const REMOTE_SIGNING_PATH = "/api/polymarket/builder/sign";

const POLYGON_CHAIN_ID = polygon.id;

function getRemoteSigningUrl(): string {
  if (typeof window === "undefined") return REMOTE_SIGNING_PATH;
  return `${window.location.origin}${REMOTE_SIGNING_PATH}`;
}

/**
 * Build a Polymarket RelayClient bound to the connected user's wallet.
 *
 * The relayer authenticates the *builder identity* via HMAC headers
 * pulled from PolyScope's backend ``POST /api/polymarket/builder/sign``
 * endpoint — that keeps the Builder API Secret + Passphrase on the
 * server. The relayer authorizes operations on behalf of the *user's*
 * wallet, which signs each relayed transaction in the browser.
 *
 * Returns ``null`` until a wallet is connected on Polygon mainnet.
 */
export function useRelayClient() {
  const { address: eoaAddress, chainId } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: POLYGON_CHAIN_ID });

  const relayClient = useMemo<RelayClient | null>(() => {
    if (!walletClient || !eoaAddress) return null;
    if (chainId !== POLYGON_CHAIN_ID) return null;
    const builderConfig = new BuilderConfig({
      remoteBuilderConfig: { url: getRemoteSigningUrl() },
    });
    return new RelayClient(
      RELAYER_URL,
      POLYGON_CHAIN_ID,
      walletClient,
      builderConfig,
    );
  }, [walletClient, eoaAddress, chainId]);

  return { relayClient, eoaAddress, chainId };
}
