import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://polyscope.gudman.xyz";

function colorForAccuracy(pct: number | null): string {
  if (pct === null) return "#9ca3af";
  if (pct >= 70) return "#34d399";
  if (pct >= 50) return "#fbbf24";
  return "#f87171";
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function GET(
  _req: Request,
  { params }: { params: { address: string } }
) {
  const address = params.address;
  let accuracyPct: number | null = null;
  let totalSignals = 0;
  let correct = 0;
  let wrong = 0;

  try {
    const r = await fetch(`${API_BASE}/api/traders/${address}`, {
      cache: "no-store",
    });
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error) {
        accuracyPct = d.accuracy_pct ?? null;
        totalSignals = d.total_divergent_signals || 0;
        correct = d.correct_predictions || 0;
        wrong = d.wrong_predictions || 0;
      }
    }
  } catch {
    // fall through
  }

  const color = colorForAccuracy(accuracyPct);
  const verdict =
    accuracyPct === null
      ? "No scored signals yet"
      : accuracyPct >= 70
        ? "Predictive smart money"
        : accuracyPct >= 50
          ? "Mixed signal"
          : "Anti-predictive — fade candidate";

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
            marginBottom: 32,
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
            TRADER PROFILE
          </span>
        </div>

        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: "#9ca3af",
            marginBottom: 8,
            display: "flex",
          }}
        >
          {shortAddr(address)}
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#6b7280",
            marginBottom: 32,
            display: "flex",
            fontFamily: "monospace",
          }}
        >
          {address}
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
              border: `2px solid ${color}`,
              borderRadius: 12,
              padding: 32,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 14, color: "#6b7280", letterSpacing: 2 }}>
              ACCURACY
            </span>
            <span style={{ fontSize: 80, fontWeight: 700, color }}>
              {accuracyPct !== null ? `${accuracyPct.toFixed(0)}%` : "—"}
            </span>
            <span style={{ fontSize: 18, color }}>
              {verdict}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              flex: 1,
            }}
          >
            <div
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 12,
                padding: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 16, color: "#9ca3af" }}>Total signals</span>
              <span style={{ fontSize: 32, fontWeight: 700, color: "#ffffff" }}>
                {totalSignals}
              </span>
            </div>
            <div
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 12,
                padding: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 16, color: "#9ca3af" }}>Correct</span>
              <span style={{ fontSize: 32, fontWeight: 700, color: "#34d399" }}>
                {correct}
              </span>
            </div>
            <div
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 12,
                padding: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 16, color: "#9ca3af" }}>Wrong</span>
              <span style={{ fontSize: 32, fontWeight: 700, color: "#f87171" }}>
                {wrong}
              </span>
            </div>
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
            polyscope.gudman.xyz/traders/{shortAddr(address)}
          </span>
          <span style={{ fontSize: 16, color: "#6b7280" }}>
            Predictive accuracy on Polymarket
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
