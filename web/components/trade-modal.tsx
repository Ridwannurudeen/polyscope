"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { polygon } from "wagmi/chains";
import { defaultShareCountForNotional } from "@/lib/clob-math";
import { useDepositWalletDeployment } from "@/lib/use-deposit-wallet-deployment";
import { useTradeApproval } from "@/lib/use-trade-approval";
import { useClobOrder, type TradeSide } from "@/lib/use-clob-order";
import { trackEvent } from "@/lib/analytics";

interface TradeModalProps {
  open: boolean;
  onClose: () => void;
  tokenId: string;
  marketId?: string;
  marketQuestion: string;
  suggestedSide: TradeSide;
  suggestedPrice: number;
  tickSize?: "0.001" | "0.01" | "0.1";
  negRisk?: boolean;
}

export function TradeModal(props: TradeModalProps) {
  const {
    open,
    onClose,
    tokenId,
    marketId,
    marketQuestion,
    suggestedSide,
    suggestedPrice,
    tickSize = "0.01",
    negRisk = false,
  } = props;

  const { address, isConnected, chainId } = useAccount();
  const {
    connectors,
    connect,
    status: connectStatus,
    error: connectError,
  } = useConnect();
  const { switchChain } = useSwitchChain();

  const {
    depositWalletAddress,
    isDeployed,
    isLoading: isLoadingDeployment,
    isDeploying,
    error: deploymentError,
    deploy: deployDepositWallet,
  } = useDepositWalletDeployment();

  const { approve, isApproving, error: approvalError } = useTradeApproval();

  const {
    isPlacing,
    error: orderError,
    lastResult,
    placeOrder,
    clearError,
  } = useClobOrder();

  const [side, setSide] = useState<TradeSide>(suggestedSide);
  const [price, setPrice] = useState<string>(suggestedPrice.toFixed(2));
  const [size, setSize] = useState<string>(() =>
    defaultShareCountForNotional(suggestedPrice),
  );
  const [needsApproval, setNeedsApproval] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const onWrongChain = isConnected && chainId !== polygon.id;
  const builderCodeConfigured = Boolean(
    process.env.NEXT_PUBLIC_POLYMARKET_BUILDER_CODE,
  );

  const priceDecimals = tickSize === "0.001" ? 3 : tickSize === "0.1" ? 1 : 2;
  const tickFloor = Number(tickSize);
  const tickCeil = 1 - tickFloor;

  useEffect(() => {
    if (open) {
      setSide(suggestedSide);
      setPrice(suggestedPrice.toFixed(priceDecimals));
      setSize(defaultShareCountForNotional(suggestedPrice));
      setNeedsApproval(false);
      setBalanceError(null);
    }
  }, [open, suggestedPrice, suggestedSide, priceDecimals]);

  const connectInjected = () => {
    const injected = connectors.find((c) => c.type === "injected");
    if (!injected) return;
    connect({ connector: injected });
  };

  const priceNum = Number.parseFloat(price) || 0;
  const sizeNum = Number.parseFloat(size) || 0;
  const notional = priceNum * sizeNum;

  const canSubmit =
    isConnected &&
    !onWrongChain &&
    !isPlacing &&
    !isApproving &&
    !isDeploying &&
    isDeployed === true &&
    priceNum >= tickFloor &&
    priceNum <= tickCeil &&
    sizeNum > 0 &&
    builderCodeConfigured;

  const orderInput = {
    tokenId,
    side,
    price: priceNum,
    size: sizeNum,
    orderType: "GTC" as const,
    tickSize,
    negRisk,
  };

  const handleDeploy = async () => {
    trackEvent("trade_deploy_clicked", {});
    try {
      await deployDepositWallet();
      trackEvent("trade_deploy_result", { success: true });
    } catch {
      trackEvent("trade_deploy_result", { success: false });
    }
  };

  const handleApprove = async () => {
    trackEvent("trade_approve_clicked", { side });
    // Clear the stale order error so a failed approval surfaces its own
    // message instead of being masked behind it in `visibleError`.
    clearError();
    setBalanceError(null);
    try {
      await approve({ side, tokenId });
      setNeedsApproval(false);
      trackEvent("trade_approve_result", { success: true });
    } catch {
      trackEvent("trade_approve_result", { success: false });
    }
  };

  const handleSubmit = async () => {
    trackEvent("trade_submit_clicked", {
      side,
      price: priceNum,
      size: sizeNum,
    });
    setNeedsApproval(false);
    setBalanceError(null);
    try {
      const res = await placeOrder(orderInput);
      trackEvent("trade_submit_result", {
        success: res.success,
        status: res.status,
        market_id: marketId ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/allowance too low/i.test(msg)) {
        setNeedsApproval(true);
      } else if (/insufficient balance/i.test(msg)) {
        setBalanceError(
          side === "BUY"
            ? "Insufficient pUSD balance. Deposit USDC.e on Polymarket first."
            : "You don't hold enough of this outcome to sell.",
        );
      }
    }
  };

  if (!open) return null;

  const visibleError = orderError || approvalError || deploymentError || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-background border border-ink-700 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ink-100">
            Trade on Polymarket
          </h2>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-100 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-ink-400 mb-5 line-clamp-3">
          {marketQuestion}
        </p>

        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setSide("BUY")}
            className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
              side === "BUY"
                ? "bg-scope-500/20 border-scope-500/50 text-scope-300"
                : "bg-surface border-ink-700 text-ink-400 hover:text-ink-100"
            }`}
          >
            Buy YES
          </button>
          <button
            onClick={() => setSide("SELL")}
            className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
              side === "SELL"
                ? "bg-alert-500/20 border-alert-500/50 text-alert-400"
                : "bg-surface border-ink-700 text-ink-400 hover:text-ink-100"
            }`}
          >
            Sell YES
          </button>
        </div>

        {/* Price + size */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-ink-500 uppercase mb-1">
              Price
            </label>
            <input
              type="number"
              step={tickSize}
              min={tickFloor}
              max={tickCeil}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-ink-700 text-ink-100 rounded-lg focus:outline-none focus:border-scope-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-500 uppercase mb-1">
              Shares
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-ink-700 text-ink-100 rounded-lg focus:outline-none focus:border-scope-500/50"
            />
          </div>
        </div>

        {/* Notional preview */}
        <div className="bg-surface border border-ink-700 rounded-lg p-3 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Total cost</span>
            <span className="text-ink-100 font-semibold">
              ${notional.toFixed(2)}
            </span>
          </div>
          <p className="text-xs text-ink-500 mt-1">
            Limit order, good-til-canceled. Resting orders may or may not fill.
          </p>
        </div>

        {/* DepositWallet status */}
        {isConnected && !onWrongChain && (
          <div className="bg-surface border border-ink-700 rounded-lg p-3 mb-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-ink-500 uppercase tracking-wide">
                DepositWallet
              </span>
              {depositWalletAddress && (
                <span className="font-mono text-xs text-scope-300">
                  {depositWalletAddress.slice(0, 6)}…
                  {depositWalletAddress.slice(-4)}
                </span>
              )}
            </div>
            {isLoadingDeployment && (
              <p className="text-[11px] text-ink-500">
                Checking deployment status…
              </p>
            )}
            {!isLoadingDeployment && isDeployed === true && (
              <p className="text-[11px] text-scope-400/80">
                Deployed. Orders settle from this smart wallet.
              </p>
            )}
            {!isLoadingDeployment && isDeployed === false && (
              <p className="text-[11px] text-fade-400/80">
                Not deployed yet. We&apos;ll deploy a smart wallet for your EOA
                via Polymarket&apos;s relayer — one signature, no gas.
              </p>
            )}
          </div>
        )}

        {/* Status / actions */}
        {!builderCodeConfigured ? (
          <div className="bg-alert-500/10 border border-alert-500/30 rounded-lg p-3 text-sm text-alert-400">
            Trading is disabled: builder code not set on this deployment.
          </div>
        ) : !isConnected ? (
          <button
            onClick={connectInjected}
            disabled={connectStatus === "pending"}
            className="w-full py-2.5 bg-scope-500/20 border border-scope-500/50 text-scope-300 rounded-lg font-medium hover:bg-scope-500/30 disabled:opacity-50"
          >
            {connectStatus === "pending" ? "Connecting…" : "Connect wallet"}
          </button>
        ) : onWrongChain ? (
          <button
            onClick={() => switchChain({ chainId: polygon.id })}
            className="w-full py-2.5 bg-fade-500/20 border border-fade-500/50 text-fade-400 rounded-lg font-medium hover:bg-fade-500/30"
          >
            Switch to Polygon
          </button>
        ) : isDeployed === false ? (
          <button
            onClick={handleDeploy}
            disabled={isDeploying}
            className="w-full py-2.5 bg-fade-500/20 border border-fade-500/50 text-fade-400 rounded-lg font-medium hover:bg-fade-500/30 disabled:opacity-60"
          >
            {isDeploying
              ? "Deploying smart wallet…"
              : "Deploy smart wallet (one-time)"}
          </button>
        ) : needsApproval ? (
          <button
            onClick={handleApprove}
            disabled={isApproving}
            className="w-full py-2.5 bg-fade-500/20 border border-fade-500/50 text-fade-400 rounded-lg font-medium hover:bg-fade-500/30 disabled:opacity-60"
          >
            {isApproving
              ? "Approving…"
              : side === "BUY"
                ? "Approve pUSD (one-time)"
                : "Approve outcome token (one-time)"}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-2.5 bg-scope-500/30 border border-scope-500/60 text-scope-200 rounded-lg font-medium hover:bg-scope-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPlacing
              ? "Signing + submitting…"
              : `${side === "BUY" ? "Buy" : "Sell"} for $${notional.toFixed(2)}`}
          </button>
        )}

        {needsApproval && (
          <p className="mt-2 text-[11px] text-fade-400/80">
            First trade requires approving Polymarket&apos;s exchange contract
            to move your {side === "BUY" ? "pUSD" : "outcome tokens"}. One-time
            gasless signature.
          </p>
        )}
        {balanceError && (
          <div className="mt-3 bg-fade-500/10 border border-fade-500/30 rounded-lg p-3 text-xs text-fade-400">
            {balanceError}
          </div>
        )}

        {/* Connect error */}
        {connectError && (
          <p className="mt-3 text-xs text-alert-500">{connectError.message}</p>
        )}

        {/* Hook errors (deployment / approval / order) */}
        {visibleError && (
          <div className="mt-3 bg-alert-500/10 border border-alert-500/30 rounded-lg p-3 text-xs text-alert-400 break-words">
            {visibleError}
          </div>
        )}

        {/* Success */}
        {lastResult?.success && (
          <div className="mt-3 bg-scope-500/10 border border-scope-500/30 rounded-lg p-3 text-xs text-scope-200">
            Order submitted. Status: {lastResult.status}. Order ID:{" "}
            <span className="font-mono break-all">{lastResult.orderID}</span>
          </div>
        )}

        {/* Wallet + compliance footer */}
        <div className="mt-4 text-[10px] text-ink-500 text-center leading-relaxed">
          {isConnected && address && (
            <p>
              Connected:{" "}
              <span className="font-mono">
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            </p>
          )}
          <p className="mt-1">
            Non-custodial: your wallet signs the order directly. PolyScope never
            handles your private key. Attribution via our builder code is the
            only way we benefit.
          </p>
        </div>
      </div>
    </div>
  );
}
