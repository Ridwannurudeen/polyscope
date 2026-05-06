"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BandStat, SkewBand } from "@/lib/kelly";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

let _bandStatsCache: Partial<Record<SkewBand, BandStat>> | null = null;
let _bandStatsPromise: Promise<Partial<Record<SkewBand, BandStat>>> | null = null;
let _bandStatsFetchedAt = 0;
const BAND_STATS_TTL_MS = 5 * 60 * 1000;

export function useBandStats(): Partial<Record<SkewBand, BandStat>> | null {
  const [stats, setStats] = useState(_bandStatsCache);

  useEffect(() => {
    const now = Date.now();
    const fresh = _bandStatsCache && now - _bandStatsFetchedAt < BAND_STATS_TTL_MS;
    if (fresh) {
      setStats(_bandStatsCache);
      return;
    }
    if (!_bandStatsPromise) {
      _bandStatsPromise = fetch(`${API_BASE}/api/signals/accuracy`)
        .then((r) => r.json())
        .then((d) => {
          _bandStatsCache = (d?.by_skew || null) as Partial<
            Record<SkewBand, BandStat>
          > | null;
          _bandStatsFetchedAt = Date.now();
          return _bandStatsCache || {};
        })
        .catch(() => ({}))
        .finally(() => {
          _bandStatsPromise = null;
        });
    }
    _bandStatsPromise.then((s) => setStats(s));
  }, []);

  return stats;
}

export function usePollingFetch<T>(
  path: string,
  intervalMs: number
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  retry: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);

  // Effect-scoped fetch — when `path`/`intervalMs` change, generation
  // bumps and any in-flight fetch from the previous effect is dropped
  // before it can call setState. Without this, an old-path response
  // could resolve after the new effect fired and overwrite fresh data.
  useEffect(() => {
    const myGen = ++generation.current;
    const ac = new AbortController();

    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}${path}`, { signal: ac.signal });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        if (generation.current !== myGen) return;
        setData(json);
        setError(null);
        setLastUpdated(new Date());
      } catch (e) {
        if (generation.current !== myGen) return;
        if ((e as Error)?.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to fetch");
      } finally {
        if (generation.current === myGen) setLoading(false);
      }
    };

    setLoading(true);
    run();
    intervalRef.current = setInterval(run, intervalMs);
    return () => {
      ac.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [path, intervalMs]);

  const retry = useCallback(() => {
    const myGen = ++generation.current;
    setLoading(true);
    fetch(`${API_BASE}${path}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        if (generation.current !== myGen) return;
        setData(json);
        setError(null);
        setLastUpdated(new Date());
      })
      .catch((e: unknown) => {
        if (generation.current !== myGen) return;
        setError(e instanceof Error ? e.message : "Failed to fetch");
      })
      .finally(() => {
        if (generation.current === myGen) setLoading(false);
      });
  }, [path]);

  return { data, loading, error, lastUpdated, retry };
}
