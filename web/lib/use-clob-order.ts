"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { polygon } from "wagmi/chains";
import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
  type ApiKeyCreds,
} from "@polymarket/clob-client-v2";
import { safeBigInt, toBaseUnits, userFacingError } from "./clob-math";
import { useDepositWalletDeployment } from "./use-deposit-wallet-deployment";

const CLOB_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_CLOB_HOST || "https://clob.polymarket.com";

const BUILDER_CODE = process.env.NEXT_PUBLIC_POLYMARKET_BUILDER_CODE || "";

export type TradeSide = "BUY" | "SELL";
export type TradeOrderType = "GTC" | "GTD";

export interface PlaceOrderInput {
  tokenId: string;
  side: TradeSide;
  price: number;
  size: number;
  orderType?: TradeOrderType;
  tickSize?: "0.001" | "0.01" | "0.1";
  negRisk?: boolean;
}

export interface PlaceOrderResult {
  orderID: string;
  status: string;
  success: boolean;
  errorMsg?: string;
  transactionsHashes?: string[];
  raw: unknown;
}

type AllowanceFailure = "insufficient_balance" | "insufficient_allowance";

/**
 * Place a Builder-attributed order against the user's relayer-deployed
 * DepositWallet.
 *
 * Composes {@link useDepositWalletDeployment} (for the funder address +
 * deployment gate) with a ClobClient configured for ``POLY_1271`` so the
 * EOA signs orders on behalf of the SCA. Returns ``isReady=false`` until
 * the DepositWallet is deployed on chain.
 *
 * Approval writes are intentionally out of scope: a separate hook will
 * batch USDC.e + outcome-share approvals through the relayer. This hook
 * surfaces an ``insufficient_allowance`` failure so callers can route the
 * user into that flow.
 */
export function useClobOrder() {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: polygon.id });
  const {
    depositWalletAddress,
    isDeployed,
    isLoading: isLoadingDeployment,
  } = useDepositWalletDeployment();

  const credsByAddress = useRef<Record<string, ApiKeyCreds>>({});
  const currentAddress = useRef<string | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PlaceOrderResult | null>(null);

  useEffect(() => {
    currentAddress.current = address?.toLowerCase() ?? null;
    if (!isConnected) {
      credsByAddress.current = {};
      setLastResult(null);
      setError(null);
    }
  }, [address, isConnected]);

  const onWrongChain = isConnected && chainId !== polygon.id;

  const isReady = useMemo(
    () =>
      isConnected &&
      !onWrongChain &&
      Boolean(depositWalletAddress) &&
      isDeployed === true &&
      Boolean(BUILDER_CODE),
    [isConnected, onWrongChain, depositWalletAddress, isDeployed],
  );

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

  const buildClient = useCallback(
    (creds: ApiKeyCreds): ClobClient => {
      if (!walletClient || !depositWalletAddress) {
        throw new Error("Wallet client or DepositWallet not ready.");
      }
      return new ClobClient({
        host: CLOB_HOST,
        chain: polygon.id,
        signer: walletClient,
        creds,
        signatureType: SignatureTypeV2.POLY_1271,
        funderAddress: depositWalletAddress,
        builderConfig: { builderCode: BUILDER_CODE },
      });
    },
    [walletClient, depositWalletAddress],
  );

  const ensureAllowance = useCallback(
    async (
      client: ClobClient,
      input: PlaceOrderInput,
    ): Promise<AllowanceFailure | null> => {
      if (input.side === "BUY") {
        const resp = await client.getBalanceAllowance({
          asset_type: AssetType.COLLATERAL,
        });
        const need = toBaseUnits(input.price * input.size);
        if (safeBigInt(resp.balance) < need) return "insufficient_balance";
        if (safeBigInt(resp.allowance) < need) return "insufficient_allowance";
        return null;
      }
      const resp = await client.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: input.tokenId,
      });
      const need = toBaseUnits(input.size);
      if (safeBigInt(resp.balance) < need) return "insufficient_balance";
      if (safeBigInt(resp.allowance) < need) return "insufficient_allowance";
      return null;
    },
    [],
  );

  const placeOrder = useCallback(
    async (input: PlaceOrderInput): Promise<PlaceOrderResult> => {
      setError(null);
      setLastResult(null);

      if (!isConnected || !address || !walletClient) {
        throw new Error("Connect a wallet first.");
      }
      if (onWrongChain) {
        throw new Error("Wrong network — switch to Polygon.");
      }
      if (!BUILDER_CODE) {
        throw new Error("Builder code not configured on this deployment.");
      }
      if (isLoadingDeployment) {
        throw new Error(
          "DepositWallet status loading — try again in a moment.",
        );
      }
      if (!depositWalletAddress || isDeployed !== true) {
        throw new Error("Deploy your DepositWallet before placing an order.");
      }

      const addrAtStart = address.toLowerCase();
      const guardAccount = () => {
        if (currentAddress.current !== addrAtStart) {
          throw new Error(
            "Wallet account changed mid-trade — re-open the dialog.",
          );
        }
      };

      setIsPlacing(true);
      try {
        const creds = await deriveOrLoadCreds(addrAtStart);
        guardAccount();
        const client = buildClient(creds);

        const allowanceFailure = await ensureAllowance(client, input);
        guardAccount();
        if (allowanceFailure === "insufficient_balance") {
          throw new Error("Insufficient balance for this order.");
        }
        if (allowanceFailure === "insufficient_allowance") {
          throw new Error("Allowance too low. Approve and try again.");
        }

        const orderTypeEnum =
          input.orderType === "GTD" ? OrderType.GTD : OrderType.GTC;
        const sideEnum = input.side === "BUY" ? Side.BUY : Side.SELL;

        const resp = await client.createAndPostOrder(
          {
            tokenID: input.tokenId,
            price: input.price,
            size: input.size,
            side: sideEnum,
            builderCode: BUILDER_CODE,
          },
          {
            tickSize: input.tickSize ?? "0.01",
            negRisk: input.negRisk ?? false,
          },
          orderTypeEnum,
        );

        const result: PlaceOrderResult = {
          orderID: resp?.orderID ?? "",
          status: resp?.status ?? "unknown",
          success: resp?.success ?? false,
          errorMsg: resp?.errorMsg ? userFacingError(resp.errorMsg) : undefined,
          transactionsHashes: resp?.transactionsHashes,
          raw: resp,
        };
        setLastResult(result);
        if (!result.success && result.errorMsg) {
          setError(result.errorMsg);
        }
        return result;
      } catch (err) {
        setError(userFacingError(err));
        throw err;
      } finally {
        setIsPlacing(false);
      }
    },
    [
      address,
      buildClient,
      depositWalletAddress,
      deriveOrLoadCreds,
      ensureAllowance,
      isConnected,
      isDeployed,
      isLoadingDeployment,
      onWrongChain,
      walletClient,
    ],
  );

  return {
    isReady,
    isPlacing,
    error,
    lastResult,
    depositWalletAddress,
    placeOrder,
  };
}
