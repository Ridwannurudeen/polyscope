"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePollingFetch } from "@/lib/hooks";

/**
 * Hero signature: one display-scale stat that anchors the page.
 *
 * The number animates from 0 → target on first render (and only on
 * first render — re-fetches don't replay). A slow conic-gradient halo
 * sits behind the number for ambient presence. Reduced-motion users
 * see the number snap in.
 */

interface MethodologyStats {
  predictive_filter?: {
    qualifying_traders: number;
    signals: number;
    win_pct: number | null;
    roi_pct: number | null;
    baseline?: { roi_pct: number | null };
  };
}

function useCountUp(target: number | null, durationMs = 1200) {
  const [value, setValue] = useState(0);
  const playedRef = useRef(false);
  useEffect(() => {
    if (target === null || playedRef.current) return;
    playedRef.current = true;

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Quart out
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(target * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

export function HeroSignature() {
  const { data } = usePollingFetch<MethodologyStats>(
    "/api/methodology/stats",
    300_000,
  );

  const filtered = data?.predictive_filter;
  const roi = filtered?.roi_pct ?? null;
  const winPct = filtered?.win_pct ?? null;
  const signals = filtered?.signals ?? null;
  const traders = filtered?.qualifying_traders ?? null;
  const baselineRoi = filtered?.baseline?.roi_pct ?? null;

  const animatedRoi = useCountUp(roi, 1400);

  const hasData = roi !== null && winPct !== null && signals !== null;

  return (
    <section className="relative pt-6 pb-14 mb-12 overflow-hidden">
      {/* Live indicator strip */}
      <div className="flex items-center gap-2 mb-7 animate-fade-in">
        <span className="relative inline-flex">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-scope-500" />
          <span className="absolute inset-0 inline-block w-1.5 h-1.5 rounded-full bg-scope-500 animate-ping opacity-60" />
        </span>
        <span className="eyebrow text-scope-500">live · polymarket v2</span>
        <span className="eyebrow text-ink-500 ml-3">
          counter-consensus intelligence
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-end">
        {/* LEFT — Headline + supporting copy */}
        <div className="lg:col-span-7 animate-fade-up">
          <h1 className="text-h1 md:text-display lg:text-display-xl text-ink-100 tracking-tightest leading-[0.96] text-balance">
            We don&apos;t rank by{" "}
            <span className="text-ink-400">profit.</span>
            <br />
            We rank by{" "}
            <span className="text-scope-400 relative">
              accuracy.
            </span>
          </h1>
          <p className="text-body-lg text-ink-300 mt-7 max-w-xl leading-relaxed text-pretty">
            Top-100 Polymarket traders are scored on their own
            counter-consensus positions as resolved data accumulates.
            The handful who clear a Wilson 95% lower bound on real
            predictive accuracy — that&apos;s the leaderboard you should
            care about.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/traders" className="btn-hero">
              view predictive traders →
            </Link>
            <Link href="/methodology" className="btn-secondary btn-md">
              read methodology
            </Link>
          </div>
        </div>

        {/* RIGHT — Signature stat */}
        <div className="lg:col-span-5 relative animate-fade-up [animation-delay:120ms]">
          <div className="relative">
            <div className="halo" />
            <div className="relative">
              <div className="eyebrow text-scope-500 mb-4">
                predictive-filter ROI · backtest
              </div>
              <div className="num text-display-xl text-ink-100 leading-[0.92] tracking-tightest">
                {hasData ? (
                  <>
                    <span className="text-scope-400">+</span>
                    {animatedRoi.toFixed(1)}
                    <span className="text-h1 text-ink-400 align-top ml-1">%</span>
                  </>
                ) : (
                  <span className="text-ink-500">—</span>
                )}
              </div>
              <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-1 max-w-md">
                <div>
                  <div className="eyebrow mb-1">win rate</div>
                  <div className="num text-h3 text-ink-100">
                    {winPct !== null ? `${winPct.toFixed(1)}%` : "—"}
                  </div>
                </div>
                <div>
                  <div className="eyebrow mb-1">backtested signals</div>
                  <div className="num text-h3 text-ink-100">
                    {signals !== null ? signals.toLocaleString() : "—"}
                  </div>
                </div>
                <div>
                  <div className="eyebrow mb-1">qualifying traders</div>
                  <div className="num text-h3 text-ink-100">
                    {traders !== null ? traders : "—"}
                  </div>
                </div>
              </div>
              {baselineRoi !== null && roi !== null && baselineRoi !== 0 && (
                <p className="mt-5 text-caption text-ink-500 font-mono">
                  vs{" "}
                  <span className="text-ink-300 num">
                    {baselineRoi >= 0 ? "+" : ""}
                    {baselineRoi.toFixed(1)}%
                  </span>{" "}
                  unfiltered baseline · {(roi / Math.max(0.1, Math.abs(baselineRoi))).toFixed(1)}× lift
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
