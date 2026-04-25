"use client";

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { SkeletonCard } from "@/components/skeleton";
import { StatCard } from "@/components/stat-card";
import { usePollingFetch } from "@/lib/hooks";
import type { CalibrationData } from "@/lib/api";

export default function CalibrationPage() {
  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<CalibrationData>("/api/calibration", 600_000);

  if (loading) {
    return (
      <div>
        <div className="mb-10 pb-10 border-b border-ink-800">
          <div className="h-3 w-24 bg-ink-800 rounded-sm mb-3 animate-pulse-subtle" />
          <div className="h-9 w-64 bg-ink-800 rounded-sm mb-3 animate-pulse-subtle" />
          <div className="h-4 w-96 bg-ink-800/70 rounded-sm animate-pulse-subtle" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-10">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="surface rounded-lg h-[400px] animate-pulse-subtle" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-16">
        <p className="text-alert-500 font-mono text-body-sm mb-4">
          failed to load calibration data
        </p>
        <button onClick={retry} className="btn-secondary">
          retry
        </button>
      </div>
    );
  }

  const calibration = data?.calibration || [];
  const chartData = calibration.map((b) => ({
    bucket: `${(b.bucket_low * 100).toFixed(0)}-${(b.bucket_high * 100).toFixed(0)}%`,
    predicted: b.predicted_avg * 100,
    actual: b.actual_pct * 100,
    count: b.count,
    brier: b.brier_score,
  }));

  const categories = data?.by_category || {};

  return (
    <div>
      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="eyebrow mb-3">calibration · resolved</div>
            <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight">
              calibration dashboard
            </h1>
            <p className="text-body-lg text-ink-300 mt-3 max-w-2xl leading-relaxed">
              How accurate are Polymarket predictions overall? Brier scores
              and calibration curves across the resolved-market ledger.
            </p>
          </div>
          <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-12">
        <StatCard
          title="overall brier score"
          value={
            data?.overall_brier != null ? data.overall_brier.toFixed(6) : "—"
          }
          subtitle={
            data?.overall_brier != null
              ? data.overall_brier < 0.05
                ? "excellent · <0.05"
                : data.overall_brier < 0.1
                  ? "good · <0.10"
                  : data.overall_brier < 0.25
                    ? "fair · <0.25"
                    : "needs improvement"
              : "lower is better · 0 = perfect"
          }
        />
        <StatCard
          title="resolved markets"
          value={(data?.total_resolved || 0).toLocaleString()}
        />
        <StatCard
          title="categories tracked"
          value={Object.keys(categories).length.toString()}
        />
      </div>

      {/* Calibration curve */}
      <section className="mb-12">
        <div className="mb-5 pb-3 border-b border-ink-800">
          <div className="eyebrow mb-2">curve · predicted vs actual</div>
          <h2 className="text-h3 text-ink-100 tracking-tight">calibration curve</h2>
          <p className="text-caption text-ink-400 mt-1 max-w-2xl">
            Predicted probability vs. actual outcome frequency. A perfectly
            calibrated market follows the diagonal.
          </p>
        </div>
        <div className="surface rounded-lg p-6">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="#1E232D"
                  vertical={false}
                />
                <XAxis
                  dataKey="bucket"
                  stroke="#4D5566"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  fontFamily="var(--font-geist-mono)"
                />
                <YAxis
                  stroke="#4D5566"
                  fontSize={11}
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  fontFamily="var(--font-geist-mono)"
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0F1218",
                    border: "1px solid #2A303D",
                    borderRadius: "6px",
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "12px",
                    color: "#ECEEF2",
                  }}
                  labelStyle={{ color: "#7A8496" }}
                />
                <ReferenceLine
                  segment={[
                    { x: "0-10%", y: 5 },
                    { x: "90-100%", y: 95 },
                  ]}
                  stroke="#2A303D"
                  strokeDasharray="3 6"
                  label=""
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="#7A8496"
                  name="predicted"
                  dot={false}
                  strokeWidth={1.25}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="#00E5A0"
                  strokeWidth={1.75}
                  name="actual"
                  dot={{ fill: "#00E5A0", r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-body-sm text-ink-400 font-mono text-center py-12">
              no resolved markets yet · calibration data appears as markets resolve
            </p>
          )}
        </div>
      </section>

      {/* Brier by category */}
      <section className="mb-12">
        <div className="mb-5 pb-3 border-b border-ink-800">
          <div className="eyebrow mb-2">breakdown · category</div>
          <h2 className="text-h3 text-ink-100 tracking-tight">accuracy by category</h2>
        </div>
        <div className="surface rounded-lg overflow-x-auto">
          {Object.keys(categories).length > 0 ? (
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">category</th>
                  <th className="eyebrow text-right px-3 py-3">brier score</th>
                  <th className="eyebrow text-right px-3 py-3">markets</th>
                  <th className="eyebrow text-right px-3 py-3">grade</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(categories).map(([cat, info]) => {
                  const grade =
                    info.brier_score < 0.1
                      ? "A"
                      : info.brier_score < 0.15
                        ? "B"
                        : info.brier_score < 0.25
                          ? "C"
                          : "D";
                  const gradeColor =
                    grade === "A"
                      ? "text-scope-400"
                      : grade === "B"
                        ? "text-ink-100"
                        : grade === "C"
                          ? "text-fade-500"
                          : "text-alert-500";

                  return (
                    <tr
                      key={cat}
                      className="border-b border-ink-800/60 last:border-0 row-hover"
                    >
                      <td className="px-3 py-3 text-ink-100">{cat}</td>
                      <td className="px-3 py-3 text-right text-ink-300 font-mono num">
                        {info.brier_score.toFixed(4)}
                      </td>
                      <td className="px-3 py-3 text-right text-caption text-ink-400 font-mono num">
                        {info.count}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono font-medium num ${gradeColor}`}
                      >
                        {grade}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-body-sm text-ink-400 font-mono text-center py-8">
              category data appears as markets resolve
            </p>
          )}
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
