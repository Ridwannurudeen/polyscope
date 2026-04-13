import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://polyscope.gudman.xyz";

export async function GET() {
  let plCount = 0;
  let accCount = 0;
  let overlap = 0;
  let plInFade = 0;

  try {
    const r = await fetch(
      `${API_BASE}/api/leaderboards/compare?limit=10&min_signals=1`,
      { cache: "no-store" }
    );
    if (r.ok) {
      const d = await r.json();
      plCount = d.pl_leaderboard?.length || 0;
      accCount = d.accuracy_top?.length || 0;
      overlap = d.overlap?.count || 0;
      plInFade = d.pl_top_in_fade_list?.length || 0;
    }
  } catch {
    // fall through to defaults
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
            COMPARE
          </span>
        </div>

        <div
          style={{
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.1,
            marginBottom: 24,
            color: "#ffffff",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>P&amp;L vs Accuracy</span>
          <span style={{ color: "#9ca3af", fontSize: 28, fontWeight: 400, marginTop: 8 }}>
            Polymarket ranks by profit. PolyScope ranks by predictive accuracy.
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: "auto",
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
              P&amp;L TOP {plCount}
            </span>
            <span style={{ fontSize: 36, fontWeight: 700, color: "#ffffff" }}>
              by profit
            </span>
          </div>

          <div
            style={{
              flex: 1,
              background: "#111827",
              border: "1px solid #fbbf24",
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ fontSize: 14, color: "#6b7280", letterSpacing: 2 }}>
              OVERLAP
            </span>
            <span style={{ fontSize: 56, fontWeight: 700, color: "#fbbf24" }}>
              {overlap}
            </span>
            <span style={{ fontSize: 16, color: "#9ca3af" }}>
              shared addresses
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
              ACCURACY TOP {accCount}
            </span>
            <span style={{ fontSize: 36, fontWeight: 700, color: "#ffffff" }}>
              by predictive hits
            </span>
          </div>
        </div>

        <div
          style={{
            marginTop: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 18, color: "#6b7280" }}>
            polyscope.gudman.xyz/compare
          </span>
          <span style={{ fontSize: 16, color: plInFade > 0 ? "#f87171" : "#6b7280" }}>
            {plInFade > 0
              ? `${plInFade} P&L leader${plInFade === 1 ? "" : "s"} on the fade list`
              : "Counter-consensus intelligence"}
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
