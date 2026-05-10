"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const FUNDER_KEY_PREFIX = "polyscope.polymarket.funder.";
const DEPOSIT_WALLET_KEY_PREFIX = "polyscope.polymarket.depositwallet.";

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

// ── DepositWallet-funder storage ─────────────────────────────
// Per-EOA cache of the Polymarket DepositWallet address. MetaMask/Rabby
// signups land on Polymarket's ERC-1271 DepositWallet (deployed by
// Polymarket Deployer 1, single-owner Ownable). The owner EOA signs
// orders; the SCA validates via isValidSignature. SDK uses
// signatureType=POLY_1271 with the SCA as funder.

export function loadDepositWalletFunder(address: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      `${DEPOSIT_WALLET_KEY_PREFIX}${address.toLowerCase()}`,
    );
    if (raw && /^0x[0-9a-fA-F]{40}$/.test(raw)) return raw.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

export function saveDepositWalletFunder(address: string, funder: string) {
  if (typeof window === "undefined") return;
  if (!/^0x[0-9a-fA-F]{40}$/.test(funder)) return;
  sessionStorage.setItem(
    `${DEPOSIT_WALLET_KEY_PREFIX}${address.toLowerCase()}`,
    funder.toLowerCase(),
  );
}

export function clearDepositWalletFunder(address: string) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(
    `${DEPOSIT_WALLET_KEY_PREFIX}${address.toLowerCase()}`,
  );
}

// User-facing error mapping. Raw axios dumps from clob-client-v2 leak the
// funder address, partial signed payloads, and request URLs into the UI
// (and any analytics that captures the message). We translate the small
// set of failure modes the user can act on; everything else collapses to
// a generic message so screenshots stay safe.
function userFacingError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const lower = msg.toLowerCase();
  if (/could not create api key/.test(lower)) {
    return "This wallet has no Polymarket account. Sign up at polymarket.com with this wallet, then reconnect.";
  }
  if (/user (rejected|denied)/.test(lower) || /signature.*rejected/.test(lower)) {
    return "Signature rejected in wallet.";
  }
  if (/insufficient.*allowance/.test(lower) || /not enough allowance/.test(lower)) {
    return "Allowance too low. Approve and try again.";
  }
  if (/insufficient.*balance/.test(lower) || /not enough balance/.test(lower)) {
    return "Insufficient balance for this order.";
  }
  if (/tick.*size/.test(lower)) {
    return "Price doesn't match this market's tick size. Adjust and retry.";
  }
  if (/min(imum)?.*(order|size)/.test(lower)) {
    return "Order is below this market's minimum size.";
  }
  if (/neg.*risk/.test(lower)) {
    return "Market is a multi-outcome (neg-risk) market — refresh and retry.";
  }
  if (/network|fetch failed|econn/.test(lower)) {
    return "Network error reaching Polymarket. Try again.";
  }
  // Fallback — short, opaque, no leak.
  return "Order could not be placed. Refresh the page and try again.";
}

export type TradeSide = "BUY" | "SELL";
// PolyScope only uses limit orders. createAndPostOrder accepts GTC/GTD;
// FOK/FAK live on createAndPostMarketOrder which we don't expose. Don't
// widen this back without also branching the SDK call.
export type TradeOrderType = "GTC" | "GTD";

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
  const credsByAddress = useRef<Record<string, ApiKeyCreds>>({});
  const currentAddress = useRef<string | null>(null);
  const lastAddress = useRef<string | null>(null);

  const onWrongChain = isConnected && chainId !== polygon.id;

  const connectInjected = useCallback(() => {
    const injected = connectors.find((c) => c.type === "injected");
    if (!injected) {
      throw new Error(
        "No injected wallet found. Install MetaMask or another browser wallet.",
      );
    }
    connect({ connector: injected });
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
        // Map the /auth/api-key 400 ("Could not create api key" when the
        // signer EOA has no Polymarket account) and other axios noise to
        // a user-facing message. userFacingError keeps the no-Polymarket
        // hint specific.
        throw new Error(userFacingError(err));
      }
    },
    [walletClient]
  );

  const buildClient = useCallback(
    async (creds: ApiKeyCreds) => {
      if (!walletClient || !address) throw new Error("Wallet client not ready");
      // Priority: DepositWallet (POLY_1271) > Safe (POLY_GNOSIS_SAFE) > EOA.
      // A given EOA links at most one funder, but we check the more
      // specific store first so a left-over Safe entry from an old setup
      // can't shadow a newer DepositWallet link.
      const depositWallet = loadDepositWalletFunder(address);
      if (depositWallet) {
        return new ClobClient({
          host: CLOB_HOST,
          chain: polygon.id,
          signer: walletClient,
          creds,
          signatureType: SignatureTypeV2.POLY_1271,
          funderAddress: depositWallet,
          builderConfig: { builderCode: BUILDER_CODE },
        });
      }
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

      // Polymarket returns balance/allowance as raw integer strings in
      // token base units. USDC and outcome shares both use 6 decimals on
      // Polygon. Comparing a human-units `price * size` against a raw
      // 1e6-scaled allowance is a sign-error (`100 USDC` shows up as
      // `100000000`, vacuously larger than any need expressed in floats).
      // After updateBalanceAllowance the allowance is 2^256-1 — well past
      // 53-bit Number precision — so we use BigInt throughout.
      const toBaseUnits = (human: number) =>
        BigInt(Math.ceil(human * 1_000_000));
      const ZERO = BigInt(0);
      const safeBigInt = (s: string | undefined) => {
        if (!s) return ZERO;
        try {
          return BigInt(s);
        } catch {
          return ZERO;
        }
      };

      if (input.side === "BUY") {
        const resp = await client.getBalanceAllowance({
          asset_type: AssetType.COLLATERAL,
        });
        const allowance = safeBigInt(resp.allowance);
        const balance = safeBigInt(resp.balance);
        const need = toBaseUnits(input.price * input.size);
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
      const allowance = safeBigInt(resp.allowance);
      const balance = safeBigInt(resp.balance);
      const need = toBaseUnits(input.size);
      if (balance < need) {
        return { ok: false, reason: "insufficient_balance", response: resp };
      }
      if (allowance < need) {
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
        setSubmitError(`Approval failed: ${userFacingError(err)}`);
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

      // If the user switches MetaMask accounts mid-flight, every async
      // step below would silently rebind to the new EOA — producing a
      // signed order from wallet B funded by Safe A's cached funder.
      // Capture the EOA at start and abort if it changes after any await.
      const addrAtStart = address.toLowerCase();
      const guardAccount = () => {
        if (currentAddress.current !== addrAtStart) {
          throw new Error("Wallet account changed mid-trade — re-open the dialog.");
        }
      };

      setIsSubmitting(true);
      try {
        const creds = await deriveOrLoadCreds(addrAtStart);
        guardAccount();
        const client = await buildClient(creds);
        guardAccount();

        // Map the string TradeOrderType to the SDK enum at runtime.
        // Public TradeOrderType is restricted to "GTC" | "GTD" — both
        // are accepted by createAndPostOrder.
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

        const result: SubmitOrderResult = {
          orderID: resp?.orderID ?? "",
          status: resp?.status ?? "unknown",
          success: resp?.success ?? false,
          errorMsg: resp?.errorMsg ? userFacingError(resp.errorMsg) : undefined,
          transactionsHashes: resp?.transactionsHashes,
          raw: resp,
        };
        setLastResult(result);
        if (!result.success && result.errorMsg) {
          setSubmitError(result.errorMsg);
        }
        return result;
      } catch (err) {
        setSubmitError(userFacingError(err));
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

  // Keep derived L2 creds in memory only. They leave no sessionStorage
  // artifact for same-origin scripts to reuse after disconnect or reload.
  useEffect(() => {
    currentAddress.current = address?.toLowerCase() ?? null;
    if (address) {
      lastAddress.current = address.toLowerCase();
    }
    if (!isConnected) {
      setLastResult(null);
      setSubmitError(null);
      credsByAddress.current = {};
      if (lastAddress.current) {
        lastAddress.current = null;
      }
    }
  }, [isConnected, address]);

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
