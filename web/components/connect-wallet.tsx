"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import {
  buildWalletLinkMessage,
  isValidEvmAddress,
  shortAddress,
  useIdentity,
} from "@/lib/identity";
import { getClientId } from "@/lib/client-id";
import { trackEvent } from "@/lib/analytics";

export function ConnectWallet() {
  const { clientId, walletAddress, linkWallet, unlinkWallet, linking } =
    useIdentity();
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, status: connectStatus } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function submit() {
    setError(null);
    try {
      let wallet = address;
      if (!isConnected || !wallet) {
        const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
        if (!injected) {
          throw new Error("No browser wallet found");
        }
        const connected = await connectAsync({ connector: injected });
        wallet = connected.accounts[0];
      }
      if (!wallet || !isValidEvmAddress(wallet)) {
        throw new Error("Connected wallet is not a valid EVM address");
      }

      const cid = clientId || getClientId();
      const domain = window.location.host;
      const issuedAt = Math.floor(Date.now() / 1000);
      const message = buildWalletLinkMessage(cid, wallet, domain, issuedAt);
      const signature = await signMessageAsync({ message });
      const result = await linkWallet(wallet, {
        domain,
        issuedAt,
        signature,
      });
      if (!result.ok) {
        throw new Error(result.error || "link failed");
      }
      trackEvent("wallet_linked", { method: "signature" });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "link failed");
    }
  }

  if (walletAddress) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 h-8 px-2.5 text-eyebrow font-mono uppercase tracking-wider text-scope-400 border border-scope-500/30 bg-scope-500/8 rounded-md hover:bg-scope-500/14 hover:border-scope-500/50 transition-colors duration-120"
          title={walletAddress}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-scope-500 animate-pulse-subtle" />
          <span className="num">{shortAddress(walletAddress)}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-64 surface-elevated rounded-md shadow-elevated p-4 z-50">
            <div className="eyebrow mb-2">linked wallet</div>
            <p className="text-body-sm font-mono text-ink-100 break-all mb-3 num">
              {walletAddress}
            </p>
            <p className="text-micro text-ink-400 mb-4 leading-relaxed">
              Your watchlist and portfolio history is tied to this verified wallet.
            </p>
            <button
              onClick={() => {
                trackEvent("wallet_unlinked", {});
                unlinkWallet();
                setOpen(false);
              }}
              className="btn-secondary w-full"
            >
              unlink
            </button>
          </div>
        )}
      </div>
    );
  }

  const busy = linking || connectStatus === "pending";

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="btn-secondary">
        link wallet
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 surface-elevated rounded-md shadow-elevated p-4 z-50">
          <div className="eyebrow mb-2">link wallet</div>
          <p className="text-micro text-ink-400 mb-3 leading-relaxed">
            Connect and sign a read-only message to carry your watchlist and
            portfolio across devices. No transaction is sent.
          </p>
          {error && (
            <p className="text-micro text-alert-500 mb-2 font-mono">{error}</p>
          )}
          <button
            onClick={submit}
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? "linking..." : "connect and sign"}
          </button>
        </div>
      )}
    </div>
  );
}
