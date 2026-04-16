/**
 * User identity hook.
 *
 * Combines the anonymous client_id (localStorage UUID) with an optional
 * linked wallet address. On first wallet link, calls POST /api/wallet/link
 * so prior watchlist/portfolio history is migrated to the wallet.
 *
 * Privy integration slots in here once creds are configured — the React
 * Privy hook replaces the manual setWalletAddress call, but the shape of
 * this hook and its consumers stays the same.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { getClientId } from "@/lib/client-id";

const WALLET_KEY = "polyscope_wallet_address";

const _EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;

export function isValidEvmAddress(addr: string): boolean {
  return _EVM_ADDR.test(addr.trim());
}

function storedWallet(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WALLET_KEY);
    if (raw && isValidEvmAddress(raw)) return raw.toLowerCase();
  } catch {}
  return null;
}

export interface Identity {
  clientId: string;
  walletAddress: string | null;
  linkWallet: (address: string) => Promise<{ ok: boolean; error?: string }>;
  unlinkWallet: () => void;
  linking: boolean;
}

export function useIdentity(): Identity {
  const [clientId, setClientId] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    setClientId(getClientId());
    setWalletAddress(storedWallet());
  }, []);

  const linkWallet = useCallback(
    async (address: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = address.trim().toLowerCase();
      if (!isValidEvmAddress(trimmed)) {
        return { ok: false, error: "Not a valid EVM address" };
      }
      const cid = clientId || getClientId();
      setLinking(true);
      try {
        const res = await fetch("/api/wallet/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: cid, wallet_address: trimmed }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: text || `HTTP ${res.status}` };
        }
        window.localStorage.setItem(WALLET_KEY, trimmed);
        setWalletAddress(trimmed);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Network error" };
      } finally {
        setLinking(false);
      }
    },
    [clientId]
  );

  const unlinkWallet = useCallback(() => {
    try {
      window.localStorage.removeItem(WALLET_KEY);
    } catch {}
    setWalletAddress(null);
  }, []);

  return { clientId, walletAddress, linkWallet, unlinkWallet, linking };
}

export function shortAddress(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
