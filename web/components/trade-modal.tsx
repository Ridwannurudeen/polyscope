"use client";

import { useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";
import { usePublicClient } from "wagmi";
import {
  usePolymarketTrade,
  type TradeSide,
  loadSafeFunder,
  saveSafeFunder,
  clearSafeFunder,
} from "@/lib/use-polymarket-trade";
import { trackEvent } from "@/lib/analytics";

// Minimal Gnosis Safe ABI — only the bits we need to verify ownership
// before letting a user link a Safe as funder. `getOwners()` is the
// canonical read on every Safe variant since v1.0.
const SAFE_ABI = [
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

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

  const {
    address,
    isConnected,
    connect,
    switchToPolygon,
    onWrongChain,
    connectError,
    connectStatus,
    checkAllowance,
    approveAllowance,
    submitOrder,
    isSubmitting,
    isApproving,
    submitError,
    lastResult,
    builderCodeConfigured,
  } = usePolymarketTrade();

  const [side, setSide] = useState<TradeSide>(suggestedSide);
  const [price, setPrice] = useState<string>(suggestedPrice.toFixed(2));
  const [size, setSize] = useState<string>("10");
  const [needsApproval, setNeedsApproval] = useState<boolean>(false);
  const [allowanceError, setAllowanceError] = useState<string | null>(null);

  // Funder state — Magic-account users have their USDC in a Gnosis-Safe
  // proxy controlled by their EOA, not the EOA itself. When a Safe
  // address is entered and saved, trades use signatureType=
  // POLY_GNOSIS_SAFE with the Safe as funder. Otherwise EOA-direct.
  const [funder, setFunder] = useState<string | null>(null);
  const [funderInput, setFunderInput] = useState<string>("");
  const [funderMode, setFunderMode] = useState<"eoa" | "safe">("eoa");
  const [funderError, setFunderError] = useState<string | null>(null);
  const [funderVerifying, setFunderVerifying] = useState(false);
  const publicClient = usePublicClient();

  // Number of decimals to display for the suggested price, matching the
  // market's tick size. Without this, `toFixed(2)` on a 0.001-tick
  // market truncates 0.0345 to "0.03" — a 13% suggestion change and a
  // value the CLOB will reject as off-tick on submit.
  const priceDecimals =
    tickSize === "0.001" ? 3 : tickSize === "0.1" ? 1 : 2;
  const tickFloor = Number(tickSize);
  const tickCeil = 1 - tickFloor;

  useEffect(() => {
    if (open) {
      setSide(suggestedSide);
      setPrice(suggestedPrice.toFixed(priceDecimals));
      setNeedsApproval(false);
      setAllowanceError(null);
    }
  }, [open, suggestedPrice, suggestedSide, priceDecimals]);

  // Load any cached Safe funder whenever the connected wallet changes.
  useEffect(() => {
    if (!address) return;
    const cached = loadSafeFunder(address);
    if (cached) {
      setFunder(cached);
      setFunderMode("safe");
    } else {
      setFunder(null);
      setFunderMode("eoa");
    }
    setFunderInput("");
    setFunderError(null);
  }, [address]);

  const handleSaveFunder = async () => {
    const raw = funderInput.trim();
    setFunderError(null);

    // 1. Loose shape — accept either lowercase or EIP-55 input.
    if (!isAddress(raw)) {
      setFunderError("Paste a valid 0x… address (40 hex chars after 0x).");
      return;
    }

    // 2. EIP-55 checksum — only enforce when the input is mixed-case,
    //    so users pasting all-lowercase from explorers aren't blocked.
    const looksChecksummed = raw !== raw.toLowerCase() && raw !== raw.toUpperCase();
    if (looksChecksummed) {
      try {
        getAddress(raw); // throws on bad checksum
      } catch {
        setFunderError(
          "Address checksum is invalid. Re-copy from Polymarket or polygonscan.",
        );
        return;
      }
    }

    const clean = raw.toLowerCase();
    if (address && clean === address.toLowerCase()) {
      setFunderError(
        "That's your wallet address — use 'My wallet (EOA)' mode instead, or paste your Polymarket Safe address.",
      );
      return;
    }
    if (!address) return;
    if (!publicClient) {
      setFunderError("Network not ready. Reconnect your wallet.");
      return;
    }

    // 3. Verify on-chain that this is a Gnosis Safe whose owner set
    //    includes the connected EOA. Without this, a clipboard hijack
    //    or phishing site can swap the Safe with one the attacker
    //    controls — every subsequent approve/submit signs against
    //    their funder.
    setFunderVerifying(true);
    try {
      const code = await publicClient.getCode({ address: clean as `0x${string}` });
      if (!code || code === "0x") {
        setFunderError(
          "No contract at that address on Polygon. This isn't a Gnosis Safe.",
        );
        return;
      }
      const owners = (await publicClient.readContract({
        address: clean as `0x${string}`,
        abi: SAFE_ABI,
        functionName: "getOwners",
      })) as readonly string[];
      const ownerSet = new Set(owners.map((a) => a.toLowerCase()));
      if (!ownerSet.has(address.toLowerCase())) {
        setFunderError(
          "Your wallet isn't listed as an owner of that Safe. Double-check the address.",
        );
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // ABI mismatch = not a Safe; network failure = transient.
      if (/getOwners|abi|reverted/i.test(msg)) {
        setFunderError(
          "That contract isn't a Gnosis Safe (no getOwners). Paste your Polymarket Safe.",
        );
      } else {
        setFunderError("Couldn't verify Safe ownership — network issue. Try again.");
      }
      return;
    } finally {
      setFunderVerifying(false);
    }

    saveSafeFunder(address, clean);
    setFunder(clean);
    setFunderMode("safe");
    setFunderError(null);
    setNeedsApproval(false);
    setAllowanceError(null);
    trackEvent("polymarket_safe_linked", { safe_short: `${clean.slice(0, 6)}…${clean.slice(-4)}` });
  };

  const handleClearFunder = () => {
    if (!address) return;
    clearSafeFunder(address);
    setFunder(null);
    setFunderMode("eoa");
    setFunderInput("");
    setFunderError(null);
    setNeedsApproval(false);
    setAllowanceError(null);
  };

  const priceNum = Number.parseFloat(price) || 0;
  const sizeNum = Number.parseFloat(size) || 0;
  const notional = priceNum * sizeNum;

  const canSubmit =
    isConnected &&
    !onWrongChain &&
    !isSubmitting &&
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

  const handleSubmit = async () => {
    trackEvent("trade_submit_clicked", { side, price: priceNum, size: sizeNum });
    setAllowanceError(null);
    try {
      const check = await checkAllowance(orderInput);
      if (!check.ok && check.reason === "insufficient_balance") {
        setAllowanceError(
          side === "BUY"
            ? "Insufficient pUSD balance. Deposit more on Polymarket first."
            : "You don't hold enough of this outcome to sell."
        );
        return;
      }
      if (!check.ok && check.reason === "needs_approval") {
        setNeedsApproval(true);
        return;
      }

      const res = await submitOrder(orderInput);
      trackEvent("trade_submit_result", {
        success: res.success,
        status: res.status,
        market_id: marketId ?? null,
      });
    } catch {
      // error already captured in hook state; UI shows it
    }
  };

  const handleApprove = async () => {
    trackEvent("trade_approve_clicked", { side });
    try {
      await approveAllowance(orderInput);
      setNeedsApproval(false);
      trackEvent("trade_approve_result", { success: true });
    } catch {
      trackEvent("trade_approve_result", { success: false });
      // error in submitError
    }
  };

  if (!open) return null;

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
          <h2 className="text-lg font-semibold text-ink-100">Trade on Polymarket</h2>
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

        {/* Funder — EOA vs Polymarket Safe */}
        {isConnected && !onWrongChain && (
          <div className="bg-surface border border-ink-700 rounded-lg p-3 mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-ink-500 uppercase tracking-wide">
                Fund from
              </span>
              <div className="flex gap-1 text-xs">
                <button
                  onClick={() => {
                    if (funder) handleClearFunder();
                    else setFunderMode("eoa");
                  }}
                  className={`px-2 py-1 rounded transition-colors ${
                    funderMode === "eoa"
                      ? "bg-scope-500/20 text-scope-300 border border-scope-500/40"
                      : "text-ink-400 border border-transparent hover:text-ink-100"
                  }`}
                >
                  My wallet
                </button>
                <button
                  onClick={() => setFunderMode("safe")}
                  className={`px-2 py-1 rounded transition-colors ${
                    funderMode === "safe"
                      ? "bg-scope-500/20 text-scope-300 border border-scope-500/40"
                      : "text-ink-400 border border-transparent hover:text-ink-100"
                  }`}
                >
                  Polymarket Safe
                </button>
              </div>
            </div>

            {funderMode === "eoa" && (
              <p className="text-[11px] text-ink-500 leading-snug">
                Trades sign from and settle to your connected wallet directly.
                Use this if your USDC is already in this wallet (not on
                Polymarket).
              </p>
            )}

            {funderMode === "safe" && funder && (
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-scope-300">
                  {funder.slice(0, 6)}…{funder.slice(-4)}
                </span>
                <button
                  onClick={handleClearFunder}
                  className="text-ink-500 hover:text-alert-500 transition-colors"
                >
                  Unlink
                </button>
              </div>
            )}

            {funderMode === "safe" && !funder && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="0x… Polymarket Safe address"
                  value={funderInput}
                  onChange={(e) => setFunderInput(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full px-3 py-1.5 bg-background border border-ink-700 text-ink-100 text-xs font-mono rounded focus:outline-none focus:border-scope-500/50"
                />
                <button
                  onClick={handleSaveFunder}
                  disabled={!funderInput.trim() || funderVerifying}
                  className="w-full py-1.5 text-xs bg-scope-500/15 border border-scope-500/40 text-scope-300 rounded hover:bg-scope-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {funderVerifying ? "Verifying ownership…" : "Link Safe"}
                </button>
                <p className="text-[11px] text-ink-500 leading-snug">
                  Polymarket deposits live in a Safe proxy controlled by your
                  wallet. Copy it from polymarket.com → Profile (under your
                  avatar — NOT your wallet address). PolyScope verifies on-chain
                  that your wallet is an owner before linking.
                </p>
              </div>
            )}

            {funderError && (
              <p className="text-[11px] text-alert-500 mt-2">{funderError}</p>
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
            onClick={connect}
            disabled={connectStatus === "pending"}
            className="w-full py-2.5 bg-scope-500/20 border border-scope-500/50 text-scope-300 rounded-lg font-medium hover:bg-scope-500/30 disabled:opacity-50"
          >
            {connectStatus === "pending" ? "Connecting…" : "Connect wallet"}
          </button>
        ) : onWrongChain ? (
          <button
            onClick={switchToPolygon}
            className="w-full py-2.5 bg-fade-500/20 border border-fade-500/50 text-fade-400 rounded-lg font-medium hover:bg-fade-500/30"
          >
            Switch to Polygon
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
            {isSubmitting
              ? "Signing + submitting…"
              : `${side === "BUY" ? "Buy" : "Sell"} for $${notional.toFixed(2)}`}
          </button>
        )}

        {needsApproval && (
          <p className="mt-2 text-[11px] text-fade-400/80">
            First trade requires approving Polymarket&apos;s exchange contract to
            move your {side === "BUY" ? "pUSD" : "outcome tokens"}. One-time
            gasless signature.
          </p>
        )}
        {allowanceError && (
          <div className="mt-3 bg-fade-500/10 border border-fade-500/30 rounded-lg p-3 text-xs text-fade-400">
            {allowanceError}
          </div>
        )}

        {/* Connect error */}
        {connectError && (
          <p className="mt-3 text-xs text-alert-500">{connectError}</p>
        )}

        {/* Submit error */}
        {submitError && (
          <div className="mt-3 bg-alert-500/10 border border-alert-500/30 rounded-lg p-3 text-xs text-alert-400 break-words">
            {submitError}
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
              Connected: <span className="font-mono">{address.slice(0, 6)}…{address.slice(-4)}</span>
            </p>
          )}
          <p className="mt-1">
            Non-custodial: your wallet signs the order directly. PolyScope never
            handles your private key. Attribution via our builder code is the
            only way we benefit.
          </p>
          {isConnected && (
            <p className="mt-1">
              New to Polymarket? Your wallet needs a Polymarket account —{" "}
              <a
                href="https://polymarket.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-scope-400/80 hover:text-scope-300 underline"
              >
                sign up there first
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
