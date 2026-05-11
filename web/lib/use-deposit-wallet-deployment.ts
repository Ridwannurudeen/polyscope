"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TransactionType } from "@polymarket/builder-relayer-client";
import { useRelayClient } from "./use-relay-client";

type DeploymentState = {
  depositWalletAddress: string | null;
  isDeployed: boolean | null;
  isLoading: boolean;
  isDeploying: boolean;
  error: string | null;
};

const INITIAL_STATE: DeploymentState = {
  depositWalletAddress: null,
  isDeployed: null,
  isLoading: false,
  isDeploying: false,
  error: null,
};

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

/**
 * Derive + deploy the connected wallet's Polymarket DepositWallet via the
 * Builder Relayer.
 *
 * The DepositWallet is a CREATE2-derived ERC-1271 smart account controlled
 * by the user's EOA. Its address is known before deployment, so the hook
 * surfaces it as soon as a wallet is connected; ``isDeployed`` reflects
 * whether the contract code is already on chain.
 *
 * ``deploy()`` submits a gasless deployment via the relayer and resolves
 * once the transaction reaches a confirmed state. The Builder Code is
 * attributed automatically because the underlying ``RelayClient`` is
 * constructed with PolyScope's builder config.
 */
export function useDepositWalletDeployment() {
  const { relayClient, eoaAddress } = useRelayClient();
  const [state, setState] = useState<DeploymentState>(INITIAL_STATE);
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    if (!relayClient) {
      setState(INITIAL_STATE);
      return;
    }
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const predicted = await relayClient.deriveDepositWalletAddress();
      const address = predicted.toLowerCase();
      const deployed = await relayClient.getDeployed(
        address,
        TransactionType.WALLET,
      );
      if (generation !== generationRef.current) return;
      setState({
        depositWalletAddress: address,
        isDeployed: deployed,
        isLoading: false,
        isDeploying: false,
        error: null,
      });
    } catch (err) {
      if (generation !== generationRef.current) return;
      setState({
        depositWalletAddress: null,
        isDeployed: null,
        isLoading: false,
        isDeploying: false,
        error: errorMessage(err),
      });
    }
  }, [relayClient]);

  useEffect(() => {
    void load();
  }, [load]);

  const deploy = useCallback(async () => {
    if (!relayClient) {
      setState((prev) => ({
        ...prev,
        error: "Connect a wallet on Polygon before deploying.",
      }));
      return;
    }
    setState((prev) => ({ ...prev, isDeploying: true, error: null }));
    try {
      const tx = await relayClient.deployDepositWallet();
      const mined = await tx.wait();
      if (!mined) {
        throw new Error("Relayer reported deployment failed");
      }
      await load();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isDeploying: false,
        error: errorMessage(err),
      }));
    }
  }, [relayClient, load]);

  return {
    ...state,
    eoaAddress: eoaAddress ?? null,
    deploy,
    refresh: load,
  };
}
