"use client";

import { useEffect, useState } from "react";
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
import { StatCard } from "@/components/stat-card";
import type { CalibrationData } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8020";

export default function CalibrationPage() {
  const [data, setData] = useState<CalibrationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/calibration`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse text-gray-400 text-center py-12">
        Loading calibration data...
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
      <h1 className="text-3xl font-bold text-white mb-2">
        Calibration Dashboard
      </h1>
      <p className="text-gray-400 mb-6">
        How accurate are Polymarket predictions? Brier scores and calibration curves.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard
          title="Overall Brier Score"
          value={data?.overall_brier?.toFixed(4) || "\u2014"}
          subtitle="Lower is better (0 = perfect)"
        />
        <StatCard
          title="Resolved Markets"
          value={data?.total_resolved || 0}
        />
        <StatCard
          title="Categories Tracked"
          value={Object.keys(categories).length}
        />
      </div>

      {/* Calibration curve */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-4">
          Calibration Curve
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Predicted probability vs. actual outcome frequency. A perfectly
          calibrated market follows the diagonal line.
        </p>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="bucket" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid #1f2937",
                    borderRadius: "8px",
                  }}
                />
                <ReferenceLine
                  segment={[
                    { x: "0-10%", y: 5 },
                    { x: "90-100%", y: 95 },
                  ]}
                  stroke="#374151"
                  strokeDasharray="5 5"
                  label=""
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="#6b7280"
                  name="Predicted %"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="#10b981"
                  strokeWidth={2}
                  name="Actual %"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-center py-12">
              No resolved markets yet. Calibration data will appear as markets resolve.
            </p>
          )}
        </div>
      </section>

      {/* Brier by category */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-4">
          Accuracy by Category
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {Object.keys(categories).length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">Category</th>
                  <th className="text-right p-3">Brier Score</th>
                  <th className="text-right p-3">Markets</th>
                  <th className="text-right p-3">Grade</th>
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
                      ? "text-emerald-400"
                      : grade === "B"
                        ? "text-blue-400"
                        : grade === "C"
                          ? "text-amber-400"
                          : "text-red-400";

                  return (
                    <tr
                      key={cat}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="p-3 text-white text-sm">{cat}</td>
                      <td className="p-3 text-right text-sm text-gray-300">
                        {info.brier_score.toFixed(4)}
                      </td>
                      <td className="p-3 text-right text-sm text-gray-400">
                        {info.count}
                      </td>
                      <td className={`p-3 text-right text-sm font-bold ${gradeColor}`}>
                        {grade}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-500 text-center py-8">
              Category data will appear as markets resolve.
            </p>
          )}
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
