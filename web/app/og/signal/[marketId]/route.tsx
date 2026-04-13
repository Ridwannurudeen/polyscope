import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://polyscope.gudman.xyz";

function tierLabel(score: number): string {
  if (score >= 80) return "Tier 1";
  if (score >= 60) return "Tier 2";
  if (score >= 40) return "Tier 3";
  return "Tier 4";
}

function tierColor(score: number): string {
  if (score >= 80) return "#34d399"; // emerald-400
  if (score >= 60) return "#fbbf24"; // amber-400
  return "#9ca3af"; // gray-400
}

function directionColor(direction: string): string {
  return direction === "YES" ? "#34d399" : "#f87171";
}

export async function GET(
  _req: Request,
  { params }: { params: { marketId: string } }
) {
  const marketId = params.marketId;

  let signal: {
    question: string;
    market_price: number;
    sm_consensus: number;
    divergence_pct: number;
    signal_strength: number;
    sm_trader_count: number;
    sm_direction: string;
  } | null = null;

  try {
    const r = await fetch(
      `${API_BASE}/api/signals/evidence/${marketId}`,
      { cache: "no-store" }
    );
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error) signal = d.signal;
    }
  } catch {
    // Fall through to error image
  }

  if (!signal) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#030712",
            color: "#9ca3af",
            fontSize: 32,
          }}
        >
          PolyScope — signal unavailable
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const crowdPct = Math.round(signal.market_price * 100);
  const smPct = Math.round(signal.sm_consensus * 100);
  const divPct = Math.round(signal.divergence_pct * 100);
  const tier = tierLabel(signal.signal_strength);
  const tierCol = tierColor(signal.signal_strength);
  const dirCol = directionColor(signal.sm_direction);
  const question =
    signal.question.length > 120
      ? signal.question.slice(0, 117) + "…"
      : signal.question;

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
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 32,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "#ffffff",
              }}
            >
              PolyScope
            </span>
            <span
              style={{
                fontSize: 14,
                padding: "4px 10px",
                background: "rgba(52, 211, 153, 0.2)",
                color: "#34d399",
                borderRadius: 999,
              }}
            >
              DIVERGENCE SIGNAL
            </span>
          </div>
          <span
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: tierCol,
              padding: "6px 16px",
              border: `2px solid ${tierCol}`,
              borderRadius: 8,
            }}
          >
            {tier} · Score {Math.round(signal.signal_strength)}
          </span>
        </div>

        {/* Question */}
        <div
          style={{
            fontSize: 40,
            lineHeight: 1.2,
            fontWeight: 600,
            marginBottom: 40,
            color: "#ffffff",
            display: "flex",
          }}
        >
          {question}
        </div>

        {/* Numbers row */}
        <div
          style={{
            display: "flex",
            gap: 24,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              flex: 1,
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ fontSize: 14, color: "#6b7280", letterSpacing: 2 }}>
              CROWD
            </span>
            <span style={{ fontSize: 48, fontWeight: 700, color: "#ffffff" }}>
              {crowdPct}%
            </span>
            <span style={{ fontSize: 16, color: "#9ca3af" }}>YES</span>
          </div>

          <div
            style={{
              flex: 1,
              background: "#111827",
              border: `1px solid ${dirCol}`,
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ fontSize: 14, color: "#6b7280", letterSpacing: 2 }}>
              POLYSCOPE
            </span>
            <span style={{ fontSize: 48, fontWeight: 700, color: dirCol }}>
              {signal.sm_direction}
            </span>
            <span style={{ fontSize: 16, color: "#9ca3af" }}>
              ({smPct}% consensus)
            </span>
          </div>

          <div
            style={{
              flex: 1,
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ fontSize: 14, color: "#6b7280", letterSpacing: 2 }}>
              DIVERGENCE
            </span>
            <span style={{ fontSize: 48, fontWeight: 700, color: "#fbbf24" }}>
              {divPct}%
            </span>
            <span style={{ fontSize: 16, color: "#9ca3af" }}>
              {signal.sm_trader_count} contributors
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 18, color: "#6b7280" }}>
            polyscope.gudman.xyz
          </span>
          <span style={{ fontSize: 16, color: "#6b7280" }}>
            Counter-consensus intelligence for Polymarket
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
