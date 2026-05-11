"use client";

import { useCallback, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { polygon } from "wagmi/chains";
import {
  AssetType,
  ClobClient,
  SignatureTypeV2,
  type ApiKeyCreds,
} from "@polymarket/clob-client-v2";
import { useDepositWalletDeployment } from "./use-deposit-wallet-deployment";

const CLOB_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_CLOB_HOST ||
  "https://clob.polymarket.com";

const BUILDER_CODE = process.env.NEXT_PUBLIC_POLYMARKET_BUILDER_CODE || "";

export type ApprovalSide = "BUY" | "SELL";

export interface ApproveInput {
  side: ApprovalSide;
  tokenId: string;
}

function userFacingError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const lower = msg.toLowerCase();
  if (/could not create api key/.test(lower)) {
    return "This wallet has no Polymarket account. Sign up at polymarket.com with this wallet, then reconnect.";
  }
  if (/user (rejected|denied)/.test(lower) || /signature.*rejected/.test(lower)) {
    return "Signature rejected in wallet.";
  }
  if (/network|fetch failed|econn/.test(lower)) {
    return "Network error reaching Polymarket. Try again.";
  }
  return "Approval failed. Refresh the page and try again.";
}

/**
 * Approve USDC.e (BUY) or outcome shares (SELL) for the user's
 * relayer-deployed DepositWallet via Polymarket's CLOB
 * ``updateBalanceAllowance`` endpoint.
 *
 * Polymarket's backend handles the on-chain approval against the
 * correct exchange contracts (standard + neg-risk, V1 + V2). We don't
 * need to construct calldata or know the exchange addresses ourselves,
 * which keeps the surface small and resilient to V2/V3 contract churn.
 */
export function useTradeApproval() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: polygon.id });
  const { depositWalletAddress, isDeployed } = useDepositWalletDeployment();

  const credsByAddress = useRef<Record<string, ApiKeyCreds>>({});
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deriveOrLoadCreds = useCallback(
    async (addr: string): Promise<ApiKeyCreds> => {
      const key = addr.toLowerCase();
      const cached = credsByAddress.current[key];
      if (cached) return cached;
      if (!walletClient) {
        throw new Error("Wallet client not ready — reconnect your wallet.");
      }
      const tmpClient = new ClobClient({
        host: CLOB_HOST,
        chain: polygon.id,
        signer: walletClient,
        signatureType: SignatureTypeV2.EOA,
      });
      try {
        const creds = await tmpClient.createOrDeriveApiKey();
        credsByAddress.current[key] = creds;
        return creds;
      } catch (err) {
        throw new Error(userFacingError(err));
      }
    },
    [walletClient],
  );

  const approve = useCallback(
    async (input: ApproveInput): Promise<void> => {
      setError(null);
      if (!isConnected || !address || !walletClient) {
        throw new Error("Connect a wallet first.");
      }
      if (!depositWalletAddress || isDeployed !== true) {
        throw new Error("Deploy your DepositWallet before approving.");
      }
      if (!BUILDER_CODE) {
        throw new Error("Builder code not configured on this deployment.");
      }

      setIsApproving(true);
      try {
        const creds = await deriveOrLoadCreds(address.toLowerCase());
        const client = new ClobClient({
          host: CLOB_HOST,
          chain: polygon.id,
          signer: walletClient,
          creds,
          signatureType: SignatureTypeV2.POLY_1271,
          funderAddress: depositWalletAddress,
          builderConfig: { builderCode: BUILDER_CODE },
        });
        if (input.side === "BUY") {
          await client.updateBalanceAllowance({
            asset_type: AssetType.COLLATERAL,
          });
        } else {
          await client.updateBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: input.tokenId,
          });
        }
      } catch (err) {
        const msg = userFacingError(err);
        setError(msg);
        throw new Error(msg);
      } finally {
        setIsApproving(false);
      }
    },
    [
      address,
      depositWalletAddress,
      deriveOrLoadCreds,
      isConnected,
      isDeployed,
      walletClient,
    ],
  );

  return {
    isApproving,
    error,
    approve,
  };
}
