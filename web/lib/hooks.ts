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

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}${path}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    fetchData();

    intervalRef.current = setInterval(fetchData, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, intervalMs]);

  return { data, loading, error, lastUpdated, retry: fetchData };
}
