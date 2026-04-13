import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://polyscope.gudman.xyz";

interface SkewStat {
  total: number;
  correct: number;
  win_rate_pct: number | null;
}

export async function GET() {
  let total = 0;
  let resolved = 0;
  let tightWinRate: number | null = null;
  let veryLopsidedWinRate: number | null = null;

  try {
    const r = await fetch(`${API_BASE}/api/methodology/stats`, {
      cache: "no-store",
    });
    if (r.ok) {
      const d = await r.json();
      total = d.signals?.total || 0;
      resolved = d.signals?.resolved || 0;
      const skew = d.skew_breakdown || {};
      tightWinRate = (skew.tight as SkewStat)?.win_rate_pct ?? null;
      veryLopsidedWinRate =
        (skew.very_lopsided as SkewStat)?.win_rate_pct ?? null;
    }
  } catch {
    // fall through
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#030712",
          color: "#ffffff",
          padding: 60,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 700 }}>PolyScope</span>
          <span
            style={{
              fontSize: 14,
              padding: "4px 10px",
              background: "rgba(52, 211, 153, 0.2)",
              color: "#34d399",
              borderRadius: 999,
            }}
          >
            METHODOLOGY
          </span>
        </div>

        <div
          style={{
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.1,
            marginBottom: 12,
            display: "flex",
          }}
        >
          The honest version
        </div>
        <div
          style={{
            fontSize: 22,
            color: "#9ca3af",
            marginBottom: 32,
            display: "flex",
          }}
        >
          Why a 95% headline does not mean tradeable alpha
        </div>

        <div
          style={{
            display: "flex",
            gap: 24,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              flex: 1,
              background: "#111827",
              border: "1px solid #34d399",
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ fontSize: 14, color: "#6b7280", letterSpacing: 2 }}>
              VERY LOPSIDED MARKETS
            </span>
            <span style={{ fontSize: 64, fontWeight: 700, color: "#34d399" }}>
              {veryLopsidedWinRate !== null
                ? `${veryLopsidedWinRate.toFixed(1)}%`
                : "—"}
            </span>
            <span style={{ fontSize: 16, color: "#9ca3af" }}>
              Compositional, not alpha
            </span>
          </div>

          <div
            style={{
              flex: 1,
              background: "#111827",
              border: "1px solid #f87171",
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ fontSize: 14, color: "#6b7280", letterSpacing: 2 }}>
              TIGHT 40-60% MARKETS
            </span>
            <span style={{ fontSize: 64, fontWeight: 700, color: "#f87171" }}>
              {tightWinRate !== null
                ? `${tightWinRate.toFixed(1)}%`
                : "—"}
            </span>
            <span style={{ fontSize: 16, color: "#9ca3af" }}>
              Where real edge would live
            </span>
          </div>
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 18, color: "#6b7280" }}>
            polyscope.gudman.xyz/methodology
          </span>
          <span style={{ fontSize: 16, color: "#6b7280" }}>
            {resolved.toLocaleString()} resolved signals · {total.toLocaleString()} total
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
