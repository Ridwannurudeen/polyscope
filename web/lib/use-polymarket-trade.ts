"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { polygon } from "wagmi/chains";
import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
  type ApiKeyCreds,
  type BalanceAllowanceResponse,
} from "@polymarket/clob-client-v2";

const CLOB_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_CLOB_HOST ||
  "https://clob.polymarket.com";

const BUILDER_CODE = process.env.NEXT_PUBLIC_POLYMARKET_BUILDER_CODE || "";

const CREDS_KEY_PREFIX = "polyscope.polymarket.creds.";
const FUNDER_KEY_PREFIX = "polyscope.polymarket.funder.";

// ── Safe-funder storage ──────────────────────────────────────
// Per-EOA cache of the Polymarket Safe address the user trades through.
// Keyed by lowercased EOA. Users with Magic-based Polymarket accounts
// deposit into a Safe proxy controlled by their EOA; the EOA's raw USDC
// balance is zero, so every trade has to sign with signatureType=
// POLY_GNOSIS_SAFE and pass the Safe as funder. Users paste this once;
// it persists in sessionStorage (not localStorage — we don't want it
// following across tabs indefinitely).

export function loadSafeFunder(address: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      `${FUNDER_KEY_PREFIX}${address.toLowerCase()}`,
    );
    if (raw && /^0x[0-9a-fA-F]{40}$/.test(raw)) return raw.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

export function saveSafeFunder(address: string, funder: string) {
  if (typeof window === "undefined") return;
  if (!/^0x[0-9a-fA-F]{40}$/.test(funder)) return;
  sessionStorage.setItem(
    `${FUNDER_KEY_PREFIX}${address.toLowerCase()}`,
    funder.toLowerCase(),
  );
}

export function clearSafeFunder(address: string) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(`${FUNDER_KEY_PREFIX}${address.toLowerCase()}`);
}

function loadCachedCreds(address: string): ApiKeyCreds | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${CREDS_KEY_PREFIX}${address.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.key && parsed?.secret && parsed?.passphrase) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveCachedCreds(address: string, creds: ApiKeyCreds) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(
    `${CREDS_KEY_PREFIX}${address.toLowerCase()}`,
    JSON.stringify(creds)
  );
}

export type TradeSide = "BUY" | "SELL";
export type TradeOrderType = "GTC" | "GTD" | "FOK" | "FAK";

export interface SubmitOrderInput {
  tokenId: string;
  side: TradeSide;
  price: number;
  size: number;
  orderType?: TradeOrderType;
  tickSize?: "0.001" | "0.01" | "0.1";
  negRisk?: boolean;
}

export interface SubmitOrderResult {
  orderID: string;
  status: string;
  success: boolean;
  errorMsg?: string;
  transactionsHashes?: string[];
  raw: unknown;
}

export function usePolymarketTrade() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, status: connectStatus, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SubmitOrderResult | null>(null);

  const onWrongChain = isConnected && chainId !== polygon.id;

  const connectInjected = useCallback(() => {
    const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
    if (injected) connect({ connector: injected });
  }, [connect, connectors]);

  // When the connected EOA has a cached Safe funder, trades route
  // through Polymarket's Gnosis-Safe proxy (signatureType=
  // POLY_GNOSIS_SAFE). Otherwise trades sign as the EOA directly.
  // deriveOrLoadCreds uses plain EOA for the initial API-key derivation
  // (Polymarket's derivation endpoint keys against the signer itself,
  // not the funder), then buildClient switches to Safe mode for the
  // actual trade calls.
  const deriveOrLoadCreds = useCallback(
    async (addr: string): Promise<ApiKeyCreds> => {
      const cached = loadCachedCreds(addr);
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
      const creds = await tmpClient.createOrDeriveApiKey();
      saveCachedCreds(addr, creds);
      return creds;
    },
    [walletClient]
  );

  const buildClient = useCallback(
    async (creds: ApiKeyCreds) => {
      if (!walletClient || !address) throw new Error("Wallet client not ready");
      const funder = loadSafeFunder(address);
      if (funder) {
        return new ClobClient({
          host: CLOB_HOST,
          chain: polygon.id,
          signer: walletClient,
          creds,
          signatureType: SignatureTypeV2.POLY_GNOSIS_SAFE,
          funderAddress: funder,
          builderConfig: { builderCode: BUILDER_CODE },
        });
      }
      return new ClobClient({
        host: CLOB_HOST,
        chain: polygon.id,
        signer: walletClient,
        creds,
        signatureType: SignatureTypeV2.EOA,
        builderConfig: { builderCode: BUILDER_CODE },
      });
    },
    [walletClient, address]
  );

  const checkAllowance = useCallback(
    async (
      input: SubmitOrderInput
    ): Promise<{ ok: boolean; reason?: string; response: BalanceAllowanceResponse }> => {
      if (!address) throw new Error("Wallet not connected");
      const creds = await deriveOrLoadCreds(address);
      const client = await buildClient(creds);

      if (input.side === "BUY") {
        const resp = await client.getBalanceAllowance({
          asset_type: AssetType.COLLATERAL,
        });
        const allowance = Number(resp.allowance || "0");
        const balance = Number(resp.balance || "0");
        const need = input.price * input.size;
        if (balance < need) {
          return { ok: false, reason: "insufficient_balance", response: resp };
        }
        if (allowance < need) {
          return { ok: false, reason: "needs_approval", response: resp };
        }
        return { ok: true, response: resp };
      }

      const resp = await client.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: input.tokenId,
      });
      const allowance = Number(resp.allowance || "0");
      const balance = Number(resp.balance || "0");
      if (balance < input.size) {
        return { ok: false, reason: "insufficient_balance", response: resp };
      }
      if (allowance < input.size) {
        return { ok: false, reason: "needs_approval", response: resp };
      }
      return { ok: true, response: resp };
    },
    [address, buildClient, deriveOrLoadCreds]
  );

  const approveAllowance = useCallback(
    async (input: SubmitOrderInput): Promise<void> => {
      if (!address) throw new Error("Wallet not connected");
      setSubmitError(null);
      setIsApproving(true);
      try {
        const creds = await deriveOrLoadCreds(address);
        const client = await buildClient(creds);
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
        const msg = err instanceof Error ? err.message : String(err);
        setSubmitError(`Approval failed: ${msg}`);
        throw err;
      } finally {
        setIsApproving(false);
      }
    },
    [address, buildClient, deriveOrLoadCreds]
  );

  const submitOrder = useCallback(
    async (input: SubmitOrderInput): Promise<SubmitOrderResult> => {
      setSubmitError(null);
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

      setIsSubmitting(true);
      try {
        const creds = await deriveOrLoadCreds(address);
        const client = await buildClient(creds);

        const orderType = (input.orderType ?? "GTC") as OrderType;
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
          orderType as OrderType.GTC | OrderType.GTD,
        );

        const result: SubmitOrderResult = {
          orderID: resp?.orderID ?? "",
          status: resp?.status ?? "unknown",
          success: resp?.success ?? false,
          errorMsg: resp?.errorMsg,
          transactionsHashes: resp?.transactionsHashes,
          raw: resp,
        };
        setLastResult(result);
        if (!result.success && result.errorMsg) {
          setSubmitError(result.errorMsg);
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSubmitError(msg);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [address, buildClient, deriveOrLoadCreds, isConnected, onWrongChain, walletClient]
  );

  const switchToPolygon = useCallback(() => {
    switchChain({ chainId: polygon.id });
  }, [switchChain]);

  const status = useMemo(() => {
    if (!isConnected) return "disconnected";
    if (onWrongChain) return "wrong-chain";
    if (isSubmitting) return "submitting";
    return "ready";
  }, [isConnected, isSubmitting, onWrongChain]);

  // Clear last result/error on disconnect
  useEffect(() => {
    if (!isConnected) {
      setLastResult(null);
      setSubmitError(null);
    }
  }, [isConnected]);

  return {
    address,
    isConnected,
    status,
    connect: connectInjected,
    disconnect,
    switchToPolygon,
    onWrongChain,
    connectError: connectError?.message ?? null,
    connectStatus,
    checkAllowance,
    approveAllowance,
    submitOrder,
    isSubmitting,
    isApproving,
    submitError,
    lastResult,
    builderCodeConfigured: Boolean(BUILDER_CODE),
  };
}
