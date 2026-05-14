"use client";

import { useCallback, useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { polygon } from "wagmi/chains";
import { encodeFunctionData, maxUint256 } from "viem";
import {
  AssetType,
  ClobClient,
  SignatureTypeV2,
  getContractConfig,
  type ApiKeyCreds,
} from "@polymarket/clob-client-v2";
import type { DepositWalletCall } from "@polymarket/builder-relayer-client";
import { userFacingError } from "./clob-math";
import { readTradeAllowance } from "./onchain-allowance";
import { useDepositWalletDeployment } from "./use-deposit-wallet-deployment";
import { useRelayClient } from "./use-relay-client";

const CLOB_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_CLOB_HOST || "https://clob.polymarket.com";

const BUILDER_CODE = process.env.NEXT_PUBLIC_POLYMARKET_BUILDER_CODE || "";

const APPROVAL_FALLBACK = "Approval failed. Refresh the page and try again.";

export type ApprovalSide = "BUY" | "SELL";

export interface ApproveInput {
  side: ApprovalSide;
  tokenId: string;
  /** Whether the order being approved for trades a neg-risk market. */
  negRisk: boolean;
}

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ERC1155_APPROVAL_ABI = [
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

/**
 * The full standard Polymarket approval set. The exchange contracts must
 * be able to move the DepositWallet's collateral (ERC-20 `approve`) and
 * its outcome shares (ERC-1155 `setApprovalForAll`). One batch mirrors
 * what polymarket.com sets on first trade, so it covers every later BUY
 * and SELL — the user never hits "allowance too low" again.
 */
function buildApprovalCalls(chainId: number): DepositWalletCall[] {
  const c = getContractConfig(chainId);
  const spenders = [c.exchangeV2, c.negRiskExchangeV2, c.negRiskAdapter];
  return spenders.flatMap((spender) => [
    {
      target: c.collateral,
      value: "0",
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [spender as `0x${string}`, maxUint256],
      }),
    },
    {
      target: c.conditionalTokens,
      value: "0",
      data: encodeFunctionData({
        abi: ERC1155_APPROVAL_ABI,
        functionName: "setApprovalForAll",
        args: [spender as `0x${string}`, true],
      }),
    },
  ]);
}

/**
 * Approve the Polymarket exchange contracts to move the user's
 * relayer-deployed DepositWallet funds.
 *
 * Submits the *real* on-chain approval as a gasless batch through the
 * Builder Relayer (`executeDepositWalletBatch`), then refreshes the
 * CLOB's cached balance/allowance view so the next order check sees it.
 *
 * The previous implementation called only `updateBalanceAllowance`, which
 * just refreshes the CLOB's server-side cache — it never performs an
 * on-chain approval, so it could not lift an "allowance too low" reject.
 */
export function useTradeApproval() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: polygon.id });
  const publicClient = usePublicClient({ chainId: polygon.id });
  const { depositWalletAddress, isDeployed } = useDepositWalletDeployment();
  const { relayClient } = useRelayClient();

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
        throw new Error(userFacingError(err, APPROVAL_FALLBACK));
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
      if (!relayClient) {
        throw new Error(
          "Relayer not ready — reconnect your wallet on Polygon.",
        );
      }
      if (!BUILDER_CODE) {
        throw new Error("Builder code not configured on this deployment.");
      }

      setIsApproving(true);
      try {
        // 1. Real on-chain approval — gasless batch via the relayer.
        const calls = buildApprovalCalls(polygon.id);
        const deadline = String(Math.floor(Date.now() / 1000) + 3600);
        const tx = await relayClient.executeDepositWalletBatch(
          calls,
          depositWalletAddress,
          deadline,
        );
        const mined = await tx.wait();
        if (!mined) {
          throw new Error("Relayer reported the approval batch failed.");
        }

        // 2. Verify the approval actually landed on chain. The relayer's
        //    `.wait()` only confirms its own meta-transaction was mined —
        //    not that the inner approve / setApprovalForAll calls executed
        //    without reverting. Without this check a silently-reverted
        //    batch looks like success and the user bounces straight back
        //    to "allowance too low" on the next order.
        if (publicClient) {
          const onchain = await readTradeAllowance(publicClient, {
            chainId: polygon.id,
            side: input.side,
            negRisk: input.negRisk,
            owner: depositWalletAddress as `0x${string}`,
          });
          if (onchain <= BigInt(0)) {
            throw new Error(
              "Approval didn't take effect on chain. Try again, or approve directly on polymarket.com.",
            );
          }
        }

        // 3. Refresh the CLOB's cached allowance view so the next order
        //    check sees the approval we just set on chain.
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
        console.error("PolyScope: approval failed:", err);
        const msg = userFacingError(err, APPROVAL_FALLBACK);
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
      publicClient,
      relayClient,
      walletClient,
    ],
  );

  return {
    isApproving,
    error,
    approve,
  };
}
