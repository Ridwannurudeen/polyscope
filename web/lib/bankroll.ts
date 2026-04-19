"use client";

import { useEffect, useState } from "react";

const KEY = "polyscope:bankroll";

export function useBankroll(): {
  bankroll: number | null;
  setBankroll: (n: number | null) => void;
} {
  const [bankroll, setState] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0) setState(n);
      }
    } catch {
      // localStorage blocked
    }
  }, []);

  const setBankroll = (n: number | null) => {
    setState(n);
    try {
      if (n === null || n <= 0) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(n));
    } catch {
      // ignore
    }
  };

  return { bankroll, setBankroll };
}
